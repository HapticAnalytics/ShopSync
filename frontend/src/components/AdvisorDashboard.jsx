import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { VINScanner } from './VINScanner';

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

// ── Vehicle data ───────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 1979 }, (_, i) => String(CURRENT_YEAR + 1 - i));

const MAKES = [
  'Acura','Alfa Romeo','Audi','BMW','Buick','Cadillac','Chevrolet','Chrysler',
  'Dodge','Ford','Genesis','GMC','Honda','Hyundai','Infiniti','Jaguar','Jeep',
  'Kia','Land Rover','Lexus','Lincoln','Mazda','Mercedes-Benz','Mitsubishi',
  'Nissan','Porsche','RAM','Rivian','Subaru','Tesla','Toyota','Volkswagen',
  'Volvo','Other',
];

const MODELS_BY_MAKE = {
  'Chevrolet': ['Blazer','Colorado','Corvette','Equinox','Express','Malibu','Silverado 1500','Silverado 2500','Silverado 3500','Suburban','Tahoe','Trailblazer','Traverse','Other'],
  'Dodge':     ['Challenger','Charger','Durango','Hornet','Ram 1500','Ram 2500','Ram 3500','Other'],
  'Ford':      ['Bronco','Bronco Sport','Edge','Escape','Expedition','Explorer','F-150','F-250','F-350','Maverick','Mustang','Ranger','Transit','Other'],
  'GMC':       ['Acadia','Canyon','Envoy','Sierra 1500','Sierra 2500','Sierra 3500','Terrain','Yukon','Yukon XL','Other'],
  'Jeep':      ['Cherokee','Compass','Gladiator','Grand Cherokee','Grand Wagoneer','Renegade','Wagoneer','Wrangler','Other'],
  'RAM':       ['1500','2500','3500','ProMaster','ProMaster City','Other'],
  'Toyota':    ['4Runner','Camry','Corolla','GX','Highlander','Land Cruiser','RAV4','Sequoia','Sienna','Tacoma','Tundra','Other'],
  'Honda':     ['Accord','CR-V','HR-V','Odyssey','Passport','Pilot','Ridgeline','Other'],
  'Nissan':    ['Armada','Frontier','Kicks','Murano','Pathfinder','Rogue','Titan','Other'],
  'Subaru':    ['Ascent','Crosstrek','Forester','Impreza','Legacy','Outback','Other'],
  'Hyundai':   ['Ioniq 5','Ioniq 6','Palisade','Santa Cruz','Santa Fe','Tucson','Other'],
  'Kia':       ['EV6','EV9','Sorento','Sportage','Telluride','Other'],
  'BMW':       ['M3','M5','X1','X3','X5','X7','3 Series','5 Series','7 Series','Other'],
  'Mercedes-Benz': ['G-Class','GLE','GLS','Sprinter','C-Class','E-Class','S-Class','Other'],
  'Audi':      ['A4','A6','Q3','Q5','Q7','Q8','Other'],
  'Volkswagen':['Atlas','Golf','ID.4','Jetta','Taos','Tiguan','Other'],
  'Tesla':     ['Cybertruck','Model 3','Model S','Model X','Model Y','Other'],
  'Land Rover':['Defender','Discovery','Discovery Sport','Range Rover','Range Rover Sport','Other'],
  'Rivian':    ['R1S','R1T','Other'],
  'Lexus':     ['GX','GX 550','LX','RX','NX','Other'],
  'Acura':     ['MDX','RDX','TLX','Other'],
  'Cadillac':  ['Escalade','XT4','XT5','XT6','Other'],
  'Lincoln':   ['Aviator','Corsair','Navigator','Nautilus','Other'],
  'Buick':     ['Enclave','Encore','Encore GX','Envision','Other'],
  'Infiniti':  ['QX50','QX55','QX60','QX80','Other'],
  'Mazda':     ['CX-5','CX-50','CX-9','Mazda3','Mazda6','Other'],
  'Porsche':   ['Cayenne','Macan','Panamera','Taycan','Other'],
  'Volvo':     ['XC40','XC60','XC90','Other'],
  'Mitsubishi':['Eclipse Cross','Outlander','Outlander Sport','Other'],
};

// ── Logo ───────────────────────────────────────────────────────────────────────

function ShopSyncLogo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-9 h-9 bg-black rounded-xl flex items-center justify-center flex-shrink-0">
        <svg viewBox="0 0 22 22" fill="none" className="w-5 h-5">
          {/* Sync arrows */}
          <path d="M4.5 11C4.5 7.41 7.41 4.5 11 4.5c1.86 0 3.54.75 4.76 1.97" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          <polyline points="13.5,3.5 15.9,6.5 13.1,8.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M17.5 11c0 3.59-2.91 6.5-6.5 6.5-1.86 0-3.54-.75-4.76-1.97" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          <polyline points="8.5,18.5 6.1,15.5 8.9,13.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <span className="text-xl font-bold text-black tracking-tight">ShopSync</span>
    </div>
  );
}

// ── Vehicle dropdowns ──────────────────────────────────────────────────────────

function YearSelect({ value, onChange }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ fontSize: '16px' }}
      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all appearance-none">
      <option value="">Year</option>
      {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
    </select>
  );
}

function MakeSelect({ value, onChange, onOther }) {
  return (
    <select
      value={MAKES.includes(value) ? value : value ? 'Other' : ''}
      onChange={e => { onChange(e.target.value); if (e.target.value === 'Other') onOther(); }}
      style={{ fontSize: '16px' }}
      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all appearance-none">
      <option value="">Make</option>
      {MAKES.map(m => <option key={m} value={m}>{m}</option>)}
    </select>
  );
}

function ModelSelect({ make, value, onChange }) {
  const models = MODELS_BY_MAKE[make] || [];
  if (!make || make === 'Other' || models.length === 0 || (value && !models.includes(value))) {
    return (
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder="Model"
        style={{ fontSize: '16px' }}
        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" />
    );
  }
  return (
    <select value={models.includes(value) ? value : ''}
      onChange={e => { if (e.target.value === 'Other') onChange(''); else onChange(e.target.value); }}
      style={{ fontSize: '16px' }}
      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all appearance-none">
      <option value="">Model</option>
      {models.map(m => <option key={m} value={m}>{m}</option>)}
    </select>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

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
  const [shopInfo, setShopInfo] = useState({ name: '' });
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
  const [vehicleToDelete, setVehicleToDelete] = useState(null);
  const [messages, setMessages] = useState([]);

  // Check-in form
  const [formData, setFormData] = useState({
    customer_name: '', customer_phone: '', customer_email: '',
    make: '', model: '', year: '', vin: '', estimated_completion: '',
  });
  const [makeOther, setMakeOther] = useState(false);
  const [makeOtherText, setMakeOtherText] = useState('');
  const [showVINScanner, setShowVINScanner] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [approvalForm, setApprovalForm] = useState({ description: '', cost: '' });
  const [approvalPhoto, setApprovalPhoto] = useState(null);
  const [messageText, setMessageText] = useState('');

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
      setShopInfo({ name: '' });
    }
  }, [shopId]);

  const fetchDashboard = useCallback(async () => {
    if (!shopId) return;
    try {
      const resp = await axios.get(`${API_BASE}/shop/${shopId}/dashboard-summary`, authConfig());
      const { vehicles: v, message_counts, approvals: a, photos } = resp.data;
      setVehicles(v);
      setNewMessageCounts(message_counts);
      setApprovals(a);
      setVehiclePhotos(photos);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, [shopId, authConfig]);

  useEffect(() => {
    if (!shopId) { setLoading(false); return; }
    fetchShopInfo();
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30000);
    return () => clearInterval(interval);
  }, [fetchShopInfo, fetchDashboard, shopId]);

  useEffect(() => {
    let filtered = vehicles;
    if (statusFilter !== 'all') filtered = filtered.filter(v => v.status === statusFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(v =>
        v.customer_name?.toLowerCase().includes(q) ||
        v.make?.toLowerCase().includes(q) ||
        v.model?.toLowerCase().includes(q) ||
        v.year?.toString().includes(q) ||
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
    } catch {}
  };

  // ── No shop ──────────────────────────────────────────────────────────────

  if (!loading && !shopId) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <h2 className="text-2xl font-semibold text-black mb-3">No Shop Assigned</h2>
          <p className="text-gray-500 text-sm mb-6">Your account isn't linked to a shop yet. Contact your administrator.</p>
          {isAdmin && (
            <button onClick={() => navigate('/admin')} className="px-6 py-3 bg-black text-white text-sm font-medium rounded-full hover:bg-gray-900 transition-all">
              Go to Admin Panel
            </button>
          )}
          <button onClick={signOut} className="block mx-auto mt-3 text-sm text-gray-400 hover:text-gray-600">Sign Out</button>
        </div>
      </div>
    );
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  const effectiveMake = makeOther ? makeOtherText : formData.make;

  const handleCheckIn = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...formData,
        make: effectiveMake,
        year: formData.year ? parseInt(formData.year) : undefined,
      };
      delete payload.license_plate; // removed field
      const resp = await axios.post(`${API_BASE}/vehicles/`, payload, authConfig());
      const newVehicle = resp.data;
      if (uploadFile) {
        const fd = new FormData();
        fd.append('file', uploadFile);
        await axios.post(`${API_BASE}/vehicles/${newVehicle.vehicle_id}/media?caption=vehicle_photo`, fd, authConfig());
      }
      setFormData({ customer_name: '', customer_phone: '', customer_email: '', make: '', model: '', year: '', vin: '', estimated_completion: '' });
      setMakeOther(false); setMakeOtherText(''); setUploadFile(null);
      setShowCheckIn(false);
      fetchDashboard();
      alert('Vehicle checked in! Customer SMS sent with tracking link.');
    } catch {
      alert('Failed to check in vehicle. Please try again.');
    }
  };

  const updateStatus = async (vehicleId, newStatus) => {
    try {
      await axios.patch(`${API_BASE}/vehicles/${vehicleId}/status`, { new_status: newStatus }, authConfig());
      await fetchDashboard();
      if (newStatus === 'ready') alert('Vehicle marked ready! Customer has been notified.');
    } catch { fetchDashboard(); }
  };

  const deleteVehicle = async () => {
    if (!vehicleToDelete) return;
    try {
      await axios.patch(`${API_BASE}/vehicles/${vehicleToDelete.vehicle_id}/status`, { new_status: 'completed', message: 'Archived' }, authConfig());
      setShowDeleteConfirm(false); setVehicleToDelete(null);
      await fetchDashboard();
    } catch { alert('Failed to archive vehicle.'); }
  };

  const toggleWarranty = async (vehicle) => {
    try {
      const resp = await axios.patch(`${API_BASE}/vehicles/${vehicle.vehicle_id}/toggle-warranty`, {}, authConfig());
      if (resp.data.awaiting_warranty) alert('Vehicle moved to Awaiting Warranty status');
      else alert('Warranty status removed.');
      await fetchDashboard();
    } catch { alert('Failed to update warranty status'); }
  };

  const createApproval = async (e) => {
    e.preventDefault();
    try {
      const approvalResp = await axios.post(
        `${API_BASE}/vehicles/${selectedVehicle.vehicle_id}/approvals`,
        { description: approvalForm.description, cost: parseFloat(approvalForm.cost) },
        authConfig()
      );
      if (approvalPhoto) {
        const fd = new FormData();
        fd.append('file', approvalPhoto);
        await axios.post(`${API_BASE}/vehicles/${selectedVehicle.vehicle_id}/media?caption=approval_${approvalResp.data.approval_id}`, fd, authConfig());
      }
      setApprovalForm({ description: '', cost: '' }); setApprovalPhoto(null);
      setShowApprovalModal(false); fetchDashboard();
      alert('Approval request sent to customer!');
    } catch { alert('Failed to create approval request'); }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/vehicles/${selectedVehicle.vehicle_id}/messages`, { message_text: messageText, sender_type: 'advisor' }, authConfig());
      setMessageText('');
      fetchMessages(selectedVehicle.vehicle_id);
    } catch { alert('Failed to send message'); }
  };

  const getApprovalStatus = (vehicleId) => {
    const list = approvals[vehicleId] || [];
    return {
      pending: list.filter(a => a.approved === null).length,
      approved: list.filter(a => a.approved === true).length,
      declined: list.filter(a => a.approved === false).length,
    };
  };

  // ── Loading ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-12 h-12 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen bg-white"
      style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* ── Header ── */}
      <div
        className="bg-white/80 backdrop-blur-2xl border-b border-gray-200 sticky top-0 z-50"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          {/* Logo row + buttons */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center justify-between sm:gap-3">
              <ShopSyncLogo />
              <p className="text-xs text-gray-500 sm:hidden">{shopInfo.name}</p>
            </div>
            {/* Buttons — all in one row on all sizes */}
            <div className="flex items-center gap-1.5">
              <button onClick={() => navigate('/appointments')}
                className="flex-1 sm:flex-none px-2.5 sm:px-3 py-2 bg-gray-100 text-gray-700 text-xs sm:text-sm font-medium rounded-full hover:bg-gray-200 transition-all whitespace-nowrap">
                Appointments
              </button>
              <button onClick={() => setShowCheckIn(true)}
                className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-black text-white text-xs sm:text-sm font-medium rounded-full hover:bg-gray-900 transition-all whitespace-nowrap">
                Check In
              </button>
              {isAdmin && (
                <button onClick={() => navigate('/admin')}
                  className="flex-1 sm:flex-none px-2.5 sm:px-3 py-2 bg-gray-100 text-gray-700 text-xs sm:text-sm font-medium rounded-full hover:bg-gray-200 transition-all">
                  Admin
                </button>
              )}
              <button onClick={signOut}
                className="flex-1 sm:flex-none px-2.5 sm:px-3 py-2 bg-gray-100 text-gray-700 text-xs sm:text-sm font-medium rounded-full hover:bg-gray-200 transition-all whitespace-nowrap">
                Sign Out
              </button>
            </div>
          </div>

          {/* Sub-header: shop name + search */}
          <div className="hidden sm:flex items-center gap-1 mt-1 mb-4">
            <span className="text-sm text-gray-500">{shopInfo.name}</span>
            <span className="text-gray-300">·</span>
            <span className="text-sm text-gray-500">{vehicles.length} Active</span>
          </div>

          <div className="mt-3 flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <svg className="absolute left-4 top-3.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search vehicles…"
                className="w-full pl-11 pr-4 py-3 bg-gray-100 border border-gray-200 rounded-full text-sm placeholder-gray-400 focus:bg-white focus:ring-2 focus:ring-black outline-none transition-all" />
            </div>
            <div className="relative">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-4 py-3 pr-10 bg-gray-100 border border-gray-200 rounded-full text-sm focus:bg-white focus:ring-2 focus:ring-black outline-none transition-all appearance-none cursor-pointer">
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

      {/* ── Vehicle grid ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-12">
        {filteredVehicles.length === 0 && searchQuery && (
          <div className="text-center py-20">
            <p className="text-gray-400 text-sm">No vehicles found</p>
            <button onClick={() => { setSearchQuery(''); setStatusFilter('all'); }} className="mt-4 text-sm text-blue-600 hover:text-blue-700">Clear filters</button>
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
                    <img src={vehiclePhoto} alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                      className="w-full h-40 object-cover rounded-2xl" onError={(e) => { e.target.style.display = 'none'; }} />
                  </div>
                )}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-black truncate">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                    <p className="text-sm text-gray-600 mt-1">{vehicle.customer_name}</p>
                    <p className="text-xs text-gray-400">{vehicle.customer_phone}</p>
                  </div>
                  <button onClick={() => { setVehicleToDelete(vehicle); setShowDeleteConfirm(true); }}
                    className="ml-2 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-all">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>

                <div className="inline-flex items-center px-3 py-1 bg-white rounded-full mb-4 border border-gray-200">
                  <div className={`w-1.5 h-1.5 ${vehicle.status === 'awaiting_warranty' ? 'bg-orange-600' : 'bg-blue-600'} rounded-full mr-2`} />
                  <span className="text-xs font-medium text-gray-700">{status.label}</span>
                </div>

                <p className="text-xs text-gray-400 mb-4">
                  {new Date(vehicle.checked_in_at).toLocaleDateString()} at {new Date(vehicle.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>

                {(approvalStatus.approved > 0 || approvalStatus.declined > 0 || messageCount > 0) && (
                  <div className="mb-4 flex flex-wrap gap-2">
                    {approvalStatus.approved > 0 && <span className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded-full border border-green-200">{approvalStatus.approved} Approved</span>}
                    {approvalStatus.declined > 0 && <span className="text-xs text-red-700 bg-red-50 px-2 py-1 rounded-full border border-red-200">{approvalStatus.declined} Declined</span>}
                    {messageCount > 0 && <span className="text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded-full border border-blue-200">{messageCount} Messages</span>}
                  </div>
                )}

                <div className="relative mb-3">
                  <select value={vehicle.status} onChange={(e) => updateStatus(vehicle.vehicle_id, e.target.value)}
                    className="w-full px-4 py-2.5 pr-10 bg-white rounded-full text-sm font-medium text-gray-700 focus:ring-2 focus:ring-black outline-none transition-all appearance-none cursor-pointer border border-gray-200">
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
                  <button onClick={() => { setSelectedVehicle(vehicle); setShowApprovalModal(true); }}
                    className="relative px-4 py-2.5 bg-white text-gray-700 rounded-full text-xs font-medium hover:bg-gray-50 transition-all border border-gray-200">
                    Request Approval
                    {approvalStatus.pending > 0 && <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs w-4 h-4 flex items-center justify-center rounded-full">{approvalStatus.pending}</span>}
                  </button>
                  <button onClick={() => { setSelectedVehicle(vehicle); setShowApprovalsViewer(true); }}
                    className="relative px-4 py-2.5 bg-white text-gray-700 rounded-full text-xs font-medium hover:bg-gray-50 transition-all border border-gray-200">
                    View Approvals
                    {(approvalStatus.approved > 0 || approvalStatus.declined > 0) && <span className="absolute -top-1 -right-1 bg-green-600 text-white text-xs w-4 h-4 flex items-center justify-center rounded-full">{approvalStatus.approved + approvalStatus.declined}</span>}
                  </button>
                </div>

                <button onClick={() => { setSelectedVehicle(vehicle); fetchMessages(vehicle.vehicle_id); setShowMessageModal(true); }}
                  className="relative w-full mt-2 px-4 py-2.5 bg-white text-gray-700 rounded-full text-xs font-medium hover:bg-gray-50 transition-all border border-gray-200">
                  Message
                  {messageCount > 0 && <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs w-4 h-4 flex items-center justify-center rounded-full">{messageCount}</span>}
                </button>

                <div className="relative mt-2 dropdown-container">
                  <button onClick={() => setOpenDropdown(openDropdown === vehicle.vehicle_id ? null : vehicle.vehicle_id)}
                    className="w-full px-4 py-2.5 bg-white text-gray-700 rounded-full text-xs font-medium hover:bg-gray-50 transition-all border border-gray-200 flex items-center justify-center gap-2">
                    More Actions
                    <svg className={`w-3 h-3 transition-transform ${openDropdown === vehicle.vehicle_id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {openDropdown === vehicle.vehicle_id && (
                    <div className="absolute bottom-full mb-2 left-0 right-0 bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden z-10">
                      <button onClick={() => { toggleWarranty(vehicle); setOpenDropdown(null); }}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        {vehicle.awaiting_warranty ? 'Remove Warranty Status' : 'Mark Awaiting Warranty'}
                      </button>
                      <button onClick={() => {
                        const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
                        input.onchange = async (e) => {
                          const file = e.target.files[0]; if (!file) return;
                          const fd = new FormData(); fd.append('file', file);
                          try { await axios.post(`${API_BASE}/vehicles/${vehicle.vehicle_id}/media?caption=vehicle_photo`, fd, authConfig()); fetchDashboard(); }
                          catch { alert('Failed to upload photo'); }
                        };
                        input.click(); setOpenDropdown(null);
                      }} className="w-full px-4 py-2.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        Set Vehicle Photo
                      </button>
                      <button onClick={() => { window.open(`/track/${vehicle.unique_link}`, '_blank'); setOpenDropdown(null); }}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        View Portal
                      </button>
                      <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/track/${vehicle.unique_link}`); alert('Link copied'); setOpenDropdown(null); }}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2">
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
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2 0M3 6l2-4h10l2 4M13 16h4l2-2 1-4h-7" />
              </svg>
            </div>
            <h3 className="text-2xl font-semibold text-black mb-2">No vehicles in service</h3>
            <p className="text-gray-500 mb-8">Check in your first vehicle to get started</p>
            <button onClick={() => setShowCheckIn(true)} className="px-8 py-3 bg-black text-white text-sm font-medium rounded-full hover:bg-gray-900 transition-all">
              Check In Vehicle
            </button>
          </div>
        )}
      </div>

      {/* ── Archive Confirm Modal ── */}
      {showDeleteConfirm && vehicleToDelete && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 sm:p-8">
            <h3 className="text-xl font-semibold text-black mb-2">Archive Vehicle?</h3>
            <p className="text-sm text-gray-600 mb-8">{vehicleToDelete.year} {vehicleToDelete.make} {vehicleToDelete.model} will be moved to completed status.</p>
            <div className="flex gap-3">
              <button onClick={() => { setShowDeleteConfirm(false); setVehicleToDelete(null); }} className="flex-1 px-6 py-3 bg-gray-100 text-gray-900 rounded-full text-sm font-medium hover:bg-gray-200">Cancel</button>
              <button onClick={deleteVehicle} className="flex-1 px-6 py-3 bg-black text-white rounded-full text-sm font-medium hover:bg-gray-900">Archive</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Check-In Modal ── */}
      {showCheckIn && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 overflow-y-auto">
          <div className="min-h-screen flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col my-8">
              <div className="p-6 border-b border-gray-100 flex-shrink-0">
                <h2 className="text-xl font-semibold text-black">Check In Vehicle</h2>
                <p className="text-sm text-gray-500 mt-1">Enter customer and vehicle details</p>
              </div>
              <div className="overflow-y-auto flex-1">
                <form onSubmit={handleCheckIn} className="p-6">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Customer</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Customer Name *</label>
                      <input type="text" required value={formData.customer_name} onChange={(e) => setFormData({...formData, customer_name: e.target.value})}
                        placeholder="John Doe" style={{ fontSize: '16px' }}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Phone *</label>
                      <input type="tel" required value={formData.customer_phone} onChange={(e) => setFormData({...formData, customer_phone: e.target.value})}
                        placeholder="(555) 000-0000" style={{ fontSize: '16px' }}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Email <span className="text-gray-400 font-normal">(optional)</span></label>
                      <input type="email" value={formData.customer_email} onChange={(e) => setFormData({...formData, customer_email: e.target.value})}
                        placeholder="john@example.com" style={{ fontSize: '16px' }}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" />
                    </div>
                  </div>

                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Vehicle</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Year</label>
                      <YearSelect value={formData.year} onChange={v => setFormData({...formData, year: v})} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Make</label>
                      {makeOther ? (
                        <div className="flex gap-2">
                          <input type="text" value={makeOtherText} onChange={e => setMakeOtherText(e.target.value)}
                            placeholder="Enter make" style={{ fontSize: '16px' }} autoFocus
                            className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none" />
                          <button type="button" onClick={() => { setMakeOther(false); setMakeOtherText(''); setFormData({...formData, make: '', model: ''}); }}
                            className="px-3 text-gray-400 hover:text-gray-600">×</button>
                        </div>
                      ) : (
                        <MakeSelect value={formData.make} onChange={v => setFormData({...formData, make: v, model: ''})} onOther={() => setMakeOther(true)} />
                      )}
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Model</label>
                      <ModelSelect make={makeOther ? 'Other' : formData.make} value={formData.model} onChange={v => setFormData({...formData, model: v})} />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">VIN <span className="text-gray-400 font-normal">(optional)</span></label>
                      <div className="flex gap-2">
                        <input type="text" value={formData.vin} onChange={(e) => setFormData({...formData, vin: e.target.value.toUpperCase()})}
                          placeholder="1HGBH41JXMN109186" style={{ fontSize: '16px' }}
                          className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all font-mono" />
                        <button type="button" onClick={() => setShowVINScanner(true)}
                          title="Scan VIN barcode"
                          className="w-12 h-12 flex items-center justify-center border border-gray-200 bg-gray-50 rounded-2xl hover:border-black hover:bg-gray-100 transition-colors flex-shrink-0">
                          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9V6a1 1 0 011-1h3M3 15v3a1 1 0 001 1h3m12-16h-3a1 1 0 00-1 1v3m4 12h-3a1 1 0 01-1-1v-3M8 9h1m-1 3h1m-1 3h1m3-6h1m-1 3h1m-1 3h1m3-6h1m-1 3h1m-1 3h1" />
                          </svg>
                        </button>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">Tap the scanner icon to scan with your camera</p>
                    </div>
                  </div>

                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Service</p>
                  <div className="space-y-4 mb-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Estimated Completion</label>
                      <input type="datetime-local" value={formData.estimated_completion} onChange={(e) => setFormData({...formData, estimated_completion: e.target.value})}
                        style={{ fontSize: '16px' }}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Vehicle Photo <span className="text-gray-400 font-normal">(optional)</span></label>
                      <input type="file" accept="image/*" onChange={(e) => setUploadFile(e.target.files[0])}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl outline-none transition-all file:mr-4 file:py-1.5 file:px-4 file:rounded-full file:border-0 file:bg-black file:text-white file:text-xs file:font-medium" />
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button type="button" onClick={() => { setShowCheckIn(false); setMakeOther(false); setMakeOtherText(''); }}
                      className="flex-1 px-6 py-3 bg-gray-100 text-gray-900 rounded-full text-sm font-medium hover:bg-gray-200">Cancel</button>
                    <button type="submit" className="flex-1 px-6 py-3 bg-black text-white rounded-full text-sm font-medium hover:bg-gray-900">Check In</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── VIN Scanner ── */}
      {showVINScanner && (
        <VINScanner
          onScan={vin => { setFormData(f => ({...f, vin})); setShowVINScanner(false); }}
          onClose={() => setShowVINScanner(false)}
        />
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
                <textarea required value={approvalForm.description} onChange={(e) => setApprovalForm({...approvalForm, description: e.target.value})}
                  placeholder="Describe the repair needed…" rows="3"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Cost</label>
                <div className="relative">
                  <span className="absolute left-4 top-3.5 text-gray-500">$</span>
                  <input type="number" step="0.01" required value={approvalForm.cost} onChange={(e) => setApprovalForm({...approvalForm, cost: e.target.value})}
                    placeholder="0.00" className="w-full pl-8 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Photo of Issue <span className="text-gray-400 font-normal">(optional)</span></label>
                <input type="file" accept="image/*" onChange={(e) => setApprovalPhoto(e.target.files[0])}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl outline-none file:mr-4 file:py-1.5 file:px-4 file:rounded-full file:border-0 file:bg-black file:text-white file:text-xs" />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => { setShowApprovalModal(false); setApprovalPhoto(null); }} className="flex-1 px-6 py-3 bg-gray-100 text-gray-900 rounded-full text-sm font-medium hover:bg-gray-200">Cancel</button>
                <button type="submit" className="flex-1 px-6 py-3 bg-black text-white rounded-full text-sm font-medium hover:bg-gray-900">Send Request</button>
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
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 bg-gray-50">
              {messages.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">No messages yet</div>
              ) : (
                messages.map((msg) => {
                  const isAdvisor = msg.sender_type === 'advisor';
                  const isAI = msg.sender_type === 'ai';
                  const isCustomer = msg.sender_type === 'customer';
                  return (
                    <div key={msg.message_id} className={`flex ${isAdvisor ? 'justify-end' : 'justify-start'}`}>
                      {(isAI || isCustomer) && (
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mr-2 mt-1 text-xs font-bold ${isAI ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-200 text-gray-500'}`}>
                          {isAI ? 'AI' : selectedVehicle.customer_name?.[0]?.toUpperCase() || 'C'}
                        </div>
                      )}
                      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                        isAdvisor ? 'bg-black text-white' :
                        isAI ? 'bg-indigo-50 border border-indigo-100 text-black' :
                        'bg-white text-black border border-gray-200'
                      }`}>
                        <p className={`text-xs mb-1 font-medium ${isAdvisor ? 'text-gray-400' : isAI ? 'text-indigo-500' : 'text-gray-500'}`}>
                          {isAdvisor ? 'You' : isAI ? 'ShopSync AI' : selectedVehicle.customer_name}
                        </p>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.message_text}</p>
                        <p className="text-xs mt-1 text-gray-400">{new Date(msg.sent_at).toLocaleString()}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="p-4 sm:p-6 bg-white border-t border-gray-100">
              <form onSubmit={sendMessage} className="space-y-3">
                <textarea required value={messageText} onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Type a message… (customer will receive an SMS)" rows="2"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none resize-none text-sm" />
                <div className="flex gap-3">
                  <button type="button" onClick={() => { setShowMessageModal(false); setMessageText(''); }} className="flex-1 px-6 py-3 bg-gray-100 text-gray-900 rounded-full text-sm font-medium hover:bg-gray-200">Close</button>
                  <button type="submit" className="flex-1 px-6 py-3 bg-black text-white rounded-full text-sm font-medium hover:bg-gray-900">Send & SMS</button>
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
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-xl font-semibold text-black">Approval Requests</h2>
              <p className="text-sm text-gray-500 mt-1">{selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {approvals[selectedVehicle.vehicle_id]?.length > 0 ? (
                <div className="space-y-4">
                  {approvals[selectedVehicle.vehicle_id].map((approval) => (
                    <div key={approval.approval_id} className={`rounded-2xl p-5 border-2 ${approval.approved === null ? 'border-yellow-300 bg-yellow-50' : approval.approved ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-black">{approval.description}</h4>
                          <p className="text-2xl font-bold text-black mt-2">${approval.cost.toFixed(2)}</p>
                        </div>
                        {approval.approved === null ? <span className="px-3 py-1 bg-yellow-200 text-yellow-800 rounded-full text-xs font-semibold ml-2 whitespace-nowrap">Pending</span>
                          : approval.approved ? <span className="px-3 py-1 bg-green-200 text-green-800 rounded-full text-xs font-semibold ml-2 whitespace-nowrap">Approved</span>
                          : <span className="px-3 py-1 bg-red-200 text-red-800 rounded-full text-xs font-semibold ml-2 whitespace-nowrap">Declined</span>}
                      </div>
                      <div className="text-xs text-gray-600 space-y-1">
                        <p>Requested: {new Date(approval.created_at).toLocaleString()}</p>
                        {approval.approved !== null && <p className="font-medium">Customer responded: {new Date(approval.approved_at).toLocaleString()}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <p className="text-gray-500 font-medium">No approval requests yet</p>
                  <p className="text-sm text-gray-400 mt-2">Create an approval request to get customer authorization</p>
                </div>
              )}
            </div>
            <div className="p-4 sm:p-6 border-t border-gray-100">
              <button onClick={() => setShowApprovalsViewer(false)} className="w-full px-6 py-3 bg-black text-white rounded-full text-sm font-medium hover:bg-gray-900">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdvisorDashboard;
