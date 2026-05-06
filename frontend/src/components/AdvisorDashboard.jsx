import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

const API_BASE = import.meta.env.VITE_API_BASE || 'https://shopsync-backend-w8ja.onrender.com';

const statusConfig = {
  checked_in:        { label: 'Checked In',       color: 'bg-blue-500' },
  inspection:        { label: 'Inspection',        color: 'bg-blue-500' },
  waiting_parts:     { label: 'Awaiting Parts',    color: 'bg-blue-500' },
  in_progress:       { label: 'In Progress',       color: 'bg-blue-500' },
  awaiting_warranty: { label: 'Awaiting Warranty', color: 'bg-orange-500' },
  quality_check:     { label: 'Quality Check',     color: 'bg-blue-500' },
  ready:             { label: 'Ready',             color: 'bg-blue-500' },
};

const AdvisorDashboard = () => {
  const { session, userProfile, signOut } = useAuth();
  const navigate = useNavigate();

  const shopId = userProfile?.shop_id || '';
  const isAdmin = userProfile?.role === 'admin';

  const [vehicles, setVehicles] = useState([]);
  const [filteredVehicles, setFilteredVehicles] = useState([]);
  const [approvals, setApprovals] = useState({});
  const [newMessageCounts, setNewMessageCounts] = useState({});
  const [vehiclePhotos, setVehiclePhotos] = useState({});
  const [shopInfo, setShopInfo] = useState({ name: 'Loading…' });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [openDropdown, setOpenDropdown] = useState(null);

  // Modal state
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showApprovalsViewer, setShowApprovalsViewer] = useState(false);
  const [showOilChangeModal, setShowOilChangeModal] = useState(false);
  const [vehicleToDelete, setVehicleToDelete] = useState(null);
  const [messages, setMessages] = useState([]);

  const [formData, setFormData] = useState({
    customer_name: '', customer_phone: '', customer_email: '',
    make: '', model: '', year: '', vin: '', license_plate: '', estimated_completion: '',
  });
  const [uploadFile, setUploadFile] = useState(null);
  const [approvalForm, setApprovalForm] = useState({ description: '', cost: '' });
  const [approvalPhoto, setApprovalPhoto] = useState(null);
  const [messageText, setMessageText] = useState('');
  const [oilChangeForm, setOilChangeForm] = useState({ mileage: '', oil_type: '', filter_brand: '', notes: '' });

  // ── Auth headers ─────────────────────────────────────────────────────────
  const authConfig = useCallback(() => ({
    headers: { Authorization: `Bearer ${session?.access_token}` },
  }), [session]);

  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchShopInfo = useCallback(async () => {
    if (!shopId) return;
    try {
      const resp = await axios.get(`${API_BASE}/shop/${shopId}`);
      setShopInfo(resp.data);
    } catch {
      setShopInfo({ name: 'Dashboard' });
    }
  }, [shopId]);

  const fetchDashboard = useCallback(async () => {
    if (!shopId) return;
    try {
      const resp = await axios.get(
        `${API_BASE}/shop/${shopId}/dashboard-summary`,
        authConfig()
      );
      const { vehicles: v, message_counts, approvals: a, photos } = resp.data;
      setVehicles(v);
      setNewMessageCounts(message_counts);
      setApprovals(a);
      setVehiclePhotos(photos);
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch dashboard:', err);
      setLoading(false);
    }
  }, [shopId, authConfig]);

  useEffect(() => {
    if (!shopId) {
      setLoading(false);
      return;
    }
    fetchShopInfo();
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30000);
    return () => clearInterval(interval);
  }, [fetchShopInfo, fetchDashboard, shopId]);

  useEffect(() => {
    let filtered = vehicles;
    if (statusFilter !== 'all') {
      filtered = filtered.filter(v => v.status === statusFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(v =>
        v.customer_name?.toLowerCase().includes(q) ||
        v.make?.toLowerCase().includes(q) ||
        v.model?.toLowerCase().includes(q) ||
        v.year?.toString().includes(q) ||
        v.license_plate?.toLowerCase().includes(q) ||
        v.vin?.toLowerCase().includes(q)
      );
    }
    setFilteredVehicles(filtered);
  }, [vehicles, searchQuery, statusFilter]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (openDropdown && !e.target.closest('.dropdown-container')) setOpenDropdown(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openDropdown]);

  const fetchMessages = async (vehicleId) => {
    try {
      const resp = await axios.get(`${API_BASE}/vehicles/${vehicleId}/messages`);
      setMessages(resp.data);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
  };

  // ── No shop assigned ─────────────────────────────────────────────────────

  if (!loading && !shopId) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <h2 className="text-2xl font-semibold text-black mb-3">No Shop Assigned</h2>
          <p className="text-gray-500 text-sm mb-6">
            Your account isn't linked to a shop yet. Contact your administrator.
          </p>
          {isAdmin && (
            <button
              onClick={() => navigate('/admin')}
              className="px-6 py-3 bg-black text-white text-sm font-medium rounded-full hover:bg-gray-900 transition-all"
            >
              Go to Admin Panel
            </button>
          )}
          <button
            onClick={signOut}
            className="block mx-auto mt-3 text-sm text-gray-400 hover:text-gray-600"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleCheckIn = async (e) => {
    e.preventDefault();
    try {
      const resp = await axios.post(`${API_BASE}/vehicles/`, formData, authConfig());
      const newVehicle = resp.data;

      if (uploadFile) {
        const fd = new FormData();
        fd.append('file', uploadFile);
        await axios.post(
          `${API_BASE}/vehicles/${newVehicle.vehicle_id}/media?caption=vehicle_photo`,
          fd,
          authConfig()
        );
      }

      setFormData({ customer_name: '', customer_phone: '', customer_email: '', make: '', model: '', year: '', vin: '', license_plate: '', estimated_completion: '' });
      setUploadFile(null);
      setShowCheckIn(false);
      fetchDashboard();
      alert('Vehicle checked in! Customer SMS sent with tracking link.');
    } catch (err) {
      console.error('Failed to check in vehicle:', err);
      alert('Failed to check in vehicle. Please try again.');
    }
  };

  const updateStatus = async (vehicleId, newStatus) => {
    try {
      await axios.patch(
        `${API_BASE}/vehicles/${vehicleId}/status`,
        { new_status: newStatus },
        authConfig()
      );
      await fetchDashboard();
      if (newStatus === 'ready') {
        alert('Vehicle marked ready! Customer has been notified.');
      }
    } catch (err) {
      console.error('Failed to update status:', err);
      fetchDashboard();
    }
  };

  const deleteVehicle = async () => {
    if (!vehicleToDelete) return;
    try {
      await axios.patch(
        `${API_BASE}/vehicles/${vehicleToDelete.vehicle_id}/status`,
        { new_status: 'completed', message: 'Vehicle service completed and archived' },
        authConfig()
      );
      setShowDeleteConfirm(false);
      setVehicleToDelete(null);
      await fetchDashboard();
    } catch (err) {
      console.error('Failed to archive vehicle:', err);
      alert('Failed to archive vehicle. Please try again.');
    }
  };

  const toggleWarranty = async (vehicle) => {
    try {
      const resp = await axios.patch(
        `${API_BASE}/vehicles/${vehicle.vehicle_id}/toggle-warranty`,
        {},
        authConfig()
      );
      if (resp.data.awaiting_warranty) {
        alert('Vehicle moved to Awaiting Warranty status');
      } else {
        alert('Warranty status removed. Please update the vehicle status to continue service.');
      }
      await fetchDashboard();
    } catch (err) {
      console.error('Failed to toggle warranty:', err);
      alert('Failed to update warranty status');
    }
  };

  const createApproval = async (e) => {
    e.preventDefault();
    try {
      const approvalResp = await axios.post(
        `${API_BASE}/vehicles/${selectedVehicle.vehicle_id}/approvals`,
        { description: approvalForm.description, cost: parseFloat(approvalForm.cost) },
        authConfig()
      );
      const approvalId = approvalResp.data.approval_id;

      if (approvalPhoto) {
        const fd = new FormData();
        fd.append('file', approvalPhoto);
        await axios.post(
          `${API_BASE}/vehicles/${selectedVehicle.vehicle_id}/media?caption=approval_${approvalId}`,
          fd,
          authConfig()
        );
      }

      setApprovalForm({ description: '', cost: '' });
      setApprovalPhoto(null);
      setShowApprovalModal(false);
      fetchDashboard();
      alert('Approval request sent to customer!');
    } catch (err) {
      console.error('Failed to create approval:', err);
      alert('Failed to create approval request');
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    try {
      await axios.post(
        `${API_BASE}/vehicles/${selectedVehicle.vehicle_id}/messages`,
        { message_text: messageText, sender_type: 'advisor' },
        authConfig()
      );
      setMessageText('');
      fetchMessages(selectedVehicle.vehicle_id);
    } catch (err) {
      console.error('Failed to send message:', err);
      alert('Failed to send message');
    }
  };

  const logOilChange = async (e) => {
    e.preventDefault();
    try {
      const text = `Oil Change Completed:\nMileage: ${oilChangeForm.mileage}\nOil Type: ${oilChangeForm.oil_type}\nFilter: ${oilChangeForm.filter_brand}\nNotes: ${oilChangeForm.notes || 'None'}`;
      await axios.post(
        `${API_BASE}/vehicles/${selectedVehicle.vehicle_id}/messages`,
        { message_text: text, sender_type: 'advisor' },
        authConfig()
      );
      setOilChangeForm({ mileage: '', oil_type: '', filter_brand: '', notes: '' });
      setShowOilChangeModal(false);
      alert('Oil change logged successfully!');
    } catch (err) {
      console.error('Failed to log oil change:', err);
      alert('Failed to log oil change');
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────

  const getApprovalStatus = (vehicleId) => {
    const list = approvals[vehicleId] || [];
    return {
      pending: list.filter(a => a.approved === null).length,
      approved: list.filter(a => a.approved === true).length,
      declined: list.filter(a => a.approved === false).length,
      total: list.length,
    };
  };

  const vehiclesByStatus = vehicles.reduce((acc, v) => {
    acc[v.status] = (acc[v.status] || []).concat(v);
    return acc;
  }, {});

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-gray-200 border-t-black rounded-full animate-spin mx-auto"></div>
          <p className="mt-6 text-gray-600 font-normal text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* ── Header ── */}
      <div className="bg-white/80 backdrop-blur-2xl border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6">
            <div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-black tracking-tight">Dashboard</h1>
              <p className="text-xs sm:text-sm text-gray-500 mt-2 font-normal">{shopInfo.name} · {vehicles.length} Active</p>
            </div>
            <div className="flex items-center gap-3">
              {isAdmin && (
                <button
                  onClick={() => navigate('/admin')}
                  className="px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-full hover:bg-gray-200 transition-all"
                >
                  Admin
                </button>
              )}
              <button
                onClick={() => setShowCheckIn(true)}
                className="px-6 py-2.5 bg-black text-white text-sm font-medium rounded-full hover:bg-gray-900 transition-all duration-200"
              >
                Check In Vehicle
              </button>
              <button
                onClick={signOut}
                className="px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-full hover:bg-gray-200 transition-all"
              >
                Sign Out
              </button>
            </div>
          </div>

          <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <svg className="absolute left-4 top-3.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search vehicles…"
                className="w-full pl-11 pr-4 py-3 bg-gray-100 border border-gray-200 rounded-full text-sm text-black placeholder-gray-400 focus:bg-white focus:ring-2 focus:ring-black outline-none transition-all shadow-sm"
              />
            </div>
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-4 py-3 pr-10 bg-gray-100 border border-gray-200 rounded-full text-sm text-black focus:bg-white focus:ring-2 focus:ring-black outline-none transition-all appearance-none cursor-pointer shadow-sm"
              >
                <option value="all">All Status</option>
                {Object.entries(statusConfig).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg.label}</option>
                ))}
              </select>
              <svg className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* ── Status counters ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
          {Object.entries(statusConfig).map(([status, cfg]) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className="bg-gray-100 hover:bg-gray-200 rounded-2xl p-3 sm:p-4 transition-all text-left border border-gray-200 shadow-sm"
            >
              <div className="text-2xl sm:text-3xl font-semibold text-black">{vehiclesByStatus[status]?.length || 0}</div>
              <div className="text-xs text-gray-500 mt-1.5 font-normal">{cfg.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Vehicle grid ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-12">
        {filteredVehicles.length === 0 && searchQuery && (
          <div className="text-center py-20">
            <p className="text-gray-400 text-sm">No vehicles found</p>
            <button
              onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}
              className="mt-4 text-sm text-blue-600 hover:text-blue-700"
            >
              Clear filters
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredVehicles.map((vehicle) => {
            const status = statusConfig[vehicle.status] || statusConfig.checked_in;
            const approvalStatus = getApprovalStatus(vehicle.vehicle_id);
            const messageCount = newMessageCounts[vehicle.vehicle_id] || 0;
            const vehiclePhoto = vehiclePhotos[vehicle.vehicle_id];

            return (
              <div key={vehicle.vehicle_id} className="bg-gray-100 rounded-3xl p-6 hover:bg-gray-200 transition-all duration-200 border border-gray-200 shadow-sm">
                {vehiclePhoto && (
                  <div className="mb-4">
                    <img
                      src={vehiclePhoto}
                      alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                      className="w-full h-40 object-cover rounded-2xl"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  </div>
                )}

                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-black truncate">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                    <p className="text-sm text-gray-600 mt-1">{vehicle.customer_name}</p>
                    <p className="text-xs text-gray-400">{vehicle.customer_phone}</p>
                  </div>
                  <button
                    onClick={() => { setVehicleToDelete(vehicle); setShowDeleteConfirm(true); }}
                    className="ml-2 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-all"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>

                <div className="inline-flex items-center px-3 py-1 bg-white rounded-full mb-4 border border-gray-200">
                  <div className={`w-1.5 h-1.5 ${vehicle.status === 'awaiting_warranty' ? 'bg-orange-600' : 'bg-blue-600'} rounded-full mr-2`}></div>
                  <span className="text-xs font-medium text-gray-700">{status.label}</span>
                </div>

                <p className="text-xs text-gray-400 mb-4">
                  {new Date(vehicle.checked_in_at).toLocaleDateString()} at {new Date(vehicle.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>

                {(approvalStatus.approved > 0 || approvalStatus.declined > 0 || messageCount > 0) && (
                  <div className="mb-4 flex flex-wrap gap-2">
                    {approvalStatus.approved > 0 && (
                      <span className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded-full border border-green-200">{approvalStatus.approved} Approved</span>
                    )}
                    {approvalStatus.declined > 0 && (
                      <span className="text-xs text-red-700 bg-red-50 px-2 py-1 rounded-full border border-red-200">{approvalStatus.declined} Declined</span>
                    )}
                    {messageCount > 0 && (
                      <span className="text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded-full border border-blue-200">{messageCount} Messages</span>
                    )}
                  </div>
                )}

                <div className="relative mb-3">
                  <select
                    value={vehicle.status}
                    onChange={(e) => updateStatus(vehicle.vehicle_id, e.target.value)}
                    className="w-full px-4 py-2.5 pr-10 bg-white rounded-full text-sm font-medium text-gray-700 focus:ring-2 focus:ring-black outline-none transition-all appearance-none cursor-pointer border border-gray-200"
                  >
                    {Object.entries(statusConfig).map(([key, cfg]) => {
                      if (key === 'awaiting_warranty' && !vehicle.awaiting_warranty) return null;
                      return <option key={key} value={key}>{cfg.label}</option>;
                    })}
                  </select>
                  <svg className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setSelectedVehicle(vehicle); setShowApprovalModal(true); }}
                    className="relative px-4 py-2.5 bg-white text-gray-700 rounded-full text-xs font-medium hover:bg-gray-50 transition-all border border-gray-200"
                  >
                    Request Approval
                    {approvalStatus.pending > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs w-4 h-4 flex items-center justify-center rounded-full">{approvalStatus.pending}</span>
                    )}
                  </button>
                  <button
                    onClick={() => { setSelectedVehicle(vehicle); setShowApprovalsViewer(true); }}
                    className="relative px-4 py-2.5 bg-white text-gray-700 rounded-full text-xs font-medium hover:bg-gray-50 transition-all border border-gray-200"
                  >
                    View Approvals
                    {(approvalStatus.approved > 0 || approvalStatus.declined > 0) && (
                      <span className="absolute -top-1 -right-1 bg-green-600 text-white text-xs w-4 h-4 flex items-center justify-center rounded-full">{approvalStatus.approved + approvalStatus.declined}</span>
                    )}
                  </button>
                </div>

                <button
                  onClick={() => { setSelectedVehicle(vehicle); fetchMessages(vehicle.vehicle_id); setShowMessageModal(true); }}
                  className="relative w-full mt-2 px-4 py-2.5 bg-white text-gray-700 rounded-full text-xs font-medium hover:bg-gray-50 transition-all border border-gray-200"
                >
                  Message
                  {messageCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs w-4 h-4 flex items-center justify-center rounded-full">{messageCount}</span>
                  )}
                </button>

                <div className="relative mt-2 dropdown-container">
                  <button
                    onClick={() => setOpenDropdown(openDropdown === vehicle.vehicle_id ? null : vehicle.vehicle_id)}
                    className="w-full px-4 py-2.5 bg-white text-gray-700 rounded-full text-xs font-medium hover:bg-gray-50 transition-all border border-gray-200 flex items-center justify-center gap-2"
                  >
                    More Actions
                    <svg className={`w-3 h-3 transition-transform ${openDropdown === vehicle.vehicle_id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {openDropdown === vehicle.vehicle_id && (
                    <div className="absolute bottom-full mb-2 left-0 right-0 bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden z-10">
                      <button
                        onClick={() => { setSelectedVehicle(vehicle); setShowOilChangeModal(true); setOpenDropdown(null); }}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        Log Oil Change
                      </button>

                      <button
                        onClick={() => { toggleWarranty(vehicle); setOpenDropdown(null); }}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        {vehicle.awaiting_warranty ? 'Remove Warranty Status' : 'Mark Awaiting Warranty'}
                      </button>

                      <button
                        onClick={() => {
                          const input = document.createElement('input');
                          input.type = 'file'; input.accept = 'image/*';
                          input.onchange = async (e) => {
                            const file = e.target.files[0];
                            if (!file) return;
                            const fd = new FormData();
                            fd.append('file', file);
                            try {
                              await axios.post(`${API_BASE}/vehicles/${vehicle.vehicle_id}/media?caption=vehicle_photo`, fd, authConfig());
                              alert('Vehicle photo updated');
                              fetchDashboard();
                            } catch { alert('Failed to upload photo'); }
                          };
                          input.click();
                          setOpenDropdown(null);
                        }}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        Set Vehicle Photo
                      </button>

                      <button
                        onClick={() => {
                          const input = document.createElement('input');
                          input.type = 'file'; input.accept = 'image/*,video/*'; input.multiple = true;
                          input.onchange = async (e) => {
                            const files = Array.from(e.target.files);
                            for (const file of files) {
                              const fd = new FormData();
                              fd.append('file', file);
                              try { await axios.post(`${API_BASE}/vehicles/${vehicle.vehicle_id}/media`, fd, authConfig()); }
                              catch (err) { console.error('Failed to upload:', err); }
                            }
                            alert('Progress media uploaded');
                            fetchDashboard();
                          };
                          input.click();
                          setOpenDropdown(null);
                        }}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                        Add Progress Media
                      </button>

                      <button
                        onClick={() => { window.open(`/track/${vehicle.unique_link}`, '_blank'); setOpenDropdown(null); }}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        View Portal
                      </button>

                      <button
                        onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/track/${vehicle.unique_link}`); alert('Link copied'); setOpenDropdown(null); }}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        Copy Tracking Link
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {vehicles.length === 0 && !searchQuery && (
          <div className="text-center py-24">
            <div className="text-6xl mb-6">🚗</div>
            <h3 className="text-2xl font-semibold text-black mb-2">No vehicles in service</h3>
            <p className="text-gray-500 mb-8">Check in your first vehicle to get started</p>
            <button onClick={() => setShowCheckIn(true)} className="px-8 py-3 bg-black text-white text-sm font-medium rounded-full hover:bg-gray-900 transition-all">
              Check In Vehicle
            </button>
          </div>
        )}
      </div>

      {/* ── Oil Change Modal ── */}
      {showOilChangeModal && selectedVehicle && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 sm:p-8">
            <h3 className="text-xl font-semibold text-black mb-1">Log Oil Change</h3>
            <p className="text-sm text-gray-500 mb-6">{selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</p>
            <form onSubmit={logOilChange} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Current Mileage</label>
                <input type="number" required value={oilChangeForm.mileage} onChange={(e) => setOilChangeForm({...oilChangeForm, mileage: e.target.value})} placeholder="65000" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Oil Type</label>
                <input type="text" required value={oilChangeForm.oil_type} onChange={(e) => setOilChangeForm({...oilChangeForm, oil_type: e.target.value})} placeholder="5W-30 Synthetic" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Filter Brand</label>
                <input type="text" required value={oilChangeForm.filter_brand} onChange={(e) => setOilChangeForm({...oilChangeForm, filter_brand: e.target.value})} placeholder="Mobil 1" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Notes (Optional)</label>
                <textarea value={oilChangeForm.notes} onChange={(e) => setOilChangeForm({...oilChangeForm, notes: e.target.value})} placeholder="Additional notes…" rows="3" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all resize-none" />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => { setShowOilChangeModal(false); setOilChangeForm({ mileage: '', oil_type: '', filter_brand: '', notes: '' }); }} className="flex-1 px-6 py-3 bg-gray-100 text-gray-900 rounded-full text-sm font-medium hover:bg-gray-200 transition-all">Cancel</button>
                <button type="submit" className="flex-1 px-6 py-3 bg-black text-white rounded-full text-sm font-medium hover:bg-gray-900 transition-all">Log Service</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Archive Confirm Modal ── */}
      {showDeleteConfirm && vehicleToDelete && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 sm:p-8">
            <h3 className="text-xl font-semibold text-black mb-2">Archive Vehicle?</h3>
            <p className="text-sm text-gray-600 mb-8">{vehicleToDelete.year} {vehicleToDelete.make} {vehicleToDelete.model} will be moved to completed status.</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={() => { setShowDeleteConfirm(false); setVehicleToDelete(null); }} className="flex-1 px-6 py-3 bg-gray-100 text-gray-900 rounded-full text-sm font-medium hover:bg-gray-200 transition-all">Cancel</button>
              <button onClick={deleteVehicle} className="flex-1 px-6 py-3 bg-black text-white rounded-full text-sm font-medium hover:bg-gray-900 transition-all">Archive</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Check-In Modal ── */}
      {showCheckIn && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 overflow-y-auto">
          <div className="min-h-screen flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col my-8">
              <div className="p-6 sm:p-8 border-b border-gray-100 flex-shrink-0">
                <h2 className="text-xl sm:text-2xl font-semibold text-black">Check In Vehicle</h2>
                <p className="text-sm text-gray-500 mt-1">Enter customer and vehicle details</p>
              </div>
              <div className="overflow-y-auto flex-1">
                <form onSubmit={handleCheckIn} className="p-6 sm:p-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Customer Name</label>
                      <input type="text" required value={formData.customer_name} onChange={(e) => setFormData({...formData, customer_name: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" placeholder="John Doe" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                      <input type="tel" required value={formData.customer_phone} onChange={(e) => setFormData({...formData, customer_phone: e.target.value})} placeholder="+1 (555) 000-0000" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                      <input type="email" value={formData.customer_email} onChange={(e) => setFormData({...formData, customer_email: e.target.value})} placeholder="john@example.com" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Make</label>
                      <input type="text" value={formData.make} onChange={(e) => setFormData({...formData, make: e.target.value})} placeholder="Ford" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Model</label>
                      <input type="text" value={formData.model} onChange={(e) => setFormData({...formData, model: e.target.value})} placeholder="F-150" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Year</label>
                      <input type="number" value={formData.year} onChange={(e) => setFormData({...formData, year: e.target.value})} placeholder="2024" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">VIN</label>
                      <input type="text" value={formData.vin} onChange={(e) => setFormData({...formData, vin: e.target.value})} placeholder="1HGBH41JXMN109186" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">License Plate</label>
                      <input type="text" value={formData.license_plate} onChange={(e) => setFormData({...formData, license_plate: e.target.value})} placeholder="ABC 123" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Estimated Completion</label>
                      <input type="datetime-local" value={formData.estimated_completion} onChange={(e) => setFormData({...formData, estimated_completion: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Vehicle Photo</label>
                      <input type="file" accept="image/*" onChange={(e) => setUploadFile(e.target.files[0])} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-black file:text-white file:text-xs file:font-medium hover:file:bg-gray-900" />
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button type="button" onClick={() => setShowCheckIn(false)} className="flex-1 px-6 py-3 bg-gray-100 text-gray-900 rounded-full text-sm font-medium hover:bg-gray-200 transition-all">Cancel</button>
                    <button type="submit" className="flex-1 px-6 py-3 bg-black text-white rounded-full text-sm font-medium hover:bg-gray-900 transition-all">Check In</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Request Approval Modal ── */}
      {showApprovalModal && selectedVehicle && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 sm:p-8">
            <h3 className="text-xl font-semibold text-black mb-1">Request Approval</h3>
            <p className="text-sm text-gray-500 mb-6">{selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</p>
            <form onSubmit={createApproval} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea required value={approvalForm.description} onChange={(e) => setApprovalForm({...approvalForm, description: e.target.value})} placeholder="Describe the repair needed…" rows="3" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Cost</label>
                <div className="relative">
                  <span className="absolute left-4 top-3.5 text-gray-500">$</span>
                  <input type="number" step="0.01" required value={approvalForm.cost} onChange={(e) => setApprovalForm({...approvalForm, cost: e.target.value})} placeholder="0.00" className="w-full pl-8 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Photo of Issue (Optional)</label>
                <input type="file" accept="image/*" onChange={(e) => setApprovalPhoto(e.target.files[0])} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-black file:text-white file:text-xs file:font-medium hover:file:bg-gray-900" />
                <p className="text-xs text-gray-500 mt-2">Upload a photo showing the issue (worn brake pads, damaged part, etc.)</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <button type="button" onClick={() => { setShowApprovalModal(false); setApprovalPhoto(null); }} className="flex-1 px-6 py-3 bg-gray-100 text-gray-900 rounded-full text-sm font-medium hover:bg-gray-200 transition-all">Cancel</button>
                <button type="submit" className="flex-1 px-6 py-3 bg-black text-white rounded-full text-sm font-medium hover:bg-gray-900 transition-all">Send Request</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Message Modal ── */}
      {showMessageModal && selectedVehicle && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-gray-100">
              <h3 className="text-lg sm:text-xl font-semibold text-black">Messages</h3>
              <p className="text-xs sm:text-sm text-gray-500 mt-1">{selectedVehicle.customer_name} · {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-gray-50">
              {messages.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">No messages yet</div>
              ) : (
                messages.map((msg) => (
                  <div key={msg.message_id} className={`flex ${msg.sender_type === 'advisor' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] sm:max-w-sm rounded-3xl px-4 sm:px-5 py-3 ${msg.sender_type === 'advisor' ? 'bg-black text-white' : 'bg-white text-black border border-gray-200'}`}>
                      <p className={`text-xs mb-1.5 ${msg.sender_type === 'advisor' ? 'text-gray-400' : 'text-gray-500'}`}>{msg.sender_type === 'advisor' ? 'You' : selectedVehicle.customer_name}</p>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.message_text}</p>
                      <p className="text-xs mt-1.5 text-gray-400">{new Date(msg.sent_at).toLocaleString()}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="p-4 sm:p-6 bg-white border-t border-gray-100">
              <form onSubmit={sendMessage} className="space-y-4">
                <textarea required value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder="Type a message…" rows="3" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all resize-none text-sm" />
                <div className="flex flex-col sm:flex-row gap-3">
                  <button type="button" onClick={() => { setShowMessageModal(false); setMessageText(''); }} className="flex-1 px-6 py-3 bg-gray-100 text-gray-900 rounded-full text-sm font-medium hover:bg-gray-200 transition-all">Close</button>
                  <button type="submit" className="flex-1 px-6 py-3 bg-black text-white rounded-full text-sm font-medium hover:bg-gray-900 transition-all">Send</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── View Approvals Modal ── */}
      {showApprovalsViewer && selectedVehicle && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
            <div className="p-6 sm:p-8 border-b border-gray-100">
              <h2 className="text-xl sm:text-2xl font-semibold text-black">Approval Requests</h2>
              <p className="text-xs sm:text-sm text-gray-500 mt-1">{selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-6 sm:p-8">
              {approvals[selectedVehicle.vehicle_id]?.length > 0 ? (
                <div className="space-y-4">
                  {approvals[selectedVehicle.vehicle_id].map((approval) => (
                    <div key={approval.approval_id} className={`rounded-2xl p-4 sm:p-6 border-2 ${approval.approved === null ? 'border-yellow-300 bg-yellow-50' : approval.approved ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-black text-base sm:text-lg">{approval.description}</h4>
                          <p className="text-xl sm:text-2xl font-bold text-black mt-2">${approval.cost.toFixed(2)}</p>
                        </div>
                        {approval.approved === null ? (
                          <span className="px-3 py-1 bg-yellow-200 text-yellow-800 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap ml-2">Pending</span>
                        ) : approval.approved ? (
                          <span className="px-3 py-1 bg-green-200 text-green-800 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap ml-2">✓ Approved</span>
                        ) : (
                          <span className="px-3 py-1 bg-red-200 text-red-800 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap ml-2">✗ Declined</span>
                        )}
                      </div>
                      <div className="text-xs sm:text-sm text-gray-600 space-y-1">
                        <p>Requested: {new Date(approval.created_at).toLocaleString()}</p>
                        {approval.approved !== null && <p className="font-medium">Customer responded: {new Date(approval.approved_at).toLocaleString()}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="text-4xl sm:text-6xl mb-4">📋</div>
                  <p className="text-gray-500 font-medium text-sm sm:text-base">No approval requests yet</p>
                  <p className="text-xs sm:text-sm text-gray-400 mt-2">Create an approval request to get customer authorization</p>
                </div>
              )}
            </div>
            <div className="p-4 sm:p-6 border-t border-gray-100">
              <button onClick={() => setShowApprovalsViewer(false)} className="w-full px-6 py-3 bg-black text-white rounded-full text-sm font-medium hover:bg-gray-900 transition-all">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdvisorDashboard;
