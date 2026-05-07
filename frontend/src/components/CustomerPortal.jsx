import { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_BASE || 'https://shopsync-backend-w8ja.onrender.com';

const statusConfig = {
  checked_in:    { label: 'Checked In',        step: 1 },
  inspection:    { label: 'Inspection',         step: 2 },
  waiting_parts: { label: 'Awaiting Parts',     step: 3 },
  in_progress:   { label: 'In Progress',        step: 4 },
  quality_check: { label: 'Quality Check',      step: 5 },
  ready:         { label: 'Ready for Pickup',   step: 6 },
};

const CustomerPortal = () => {
  const { uniqueLink } = useParams();
  const [vehicle, setVehicle] = useState(null);
  const [shopInfo, setShopInfo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [media, setMedia] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedMedia, setSelectedMedia] = useState(null);

  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchVehicleData = async () => {
    try {
      const resp = await axios.get(`${API_BASE}/vehicles/${uniqueLink}`);
      setVehicle(resp.data);
      setLoading(false);
      return resp.data;
    } catch {
      setError('Vehicle not found');
      setLoading(false);
      return null;
    }
  };

  const fetchShopInfo = async (shopId) => {
    try {
      const resp = await axios.get(`${API_BASE}/shop/${shopId}`);
      setShopInfo(resp.data);
    } catch {
      // non-critical — fall through, UI will show defaults
    }
  };

  const fetchMessages = async (vehicleId) => {
    try {
      const resp = await axios.get(`${API_BASE}/vehicles/${vehicleId}/messages`);
      setMessages(resp.data);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
  };

  const fetchMedia = async (vehicleId) => {
    try {
      const resp = await axios.get(`${API_BASE}/vehicles/${vehicleId}/media`);
      setMedia(resp.data);
    } catch (err) {
      console.error('Failed to fetch media:', err);
    }
  };

  const fetchApprovals = async (vehicleId) => {
    try {
      const resp = await axios.get(`${API_BASE}/vehicles/${vehicleId}/approvals`);
      setApprovals(resp.data);
    } catch (err) {
      console.error('Failed to fetch approvals:', err);
    }
  };

  useEffect(() => {
    fetchVehicleData().then((v) => {
      if (v) fetchShopInfo(v.shop_id);
    });
  }, [uniqueLink]);

  useEffect(() => {
    if (!vehicle?.vehicle_id) return;
    const id = vehicle.vehicle_id;
    fetchMessages(id);
    fetchMedia(id);
    fetchApprovals(id);
    const interval = setInterval(() => {
      fetchMessages(id);
      fetchMedia(id);
      fetchApprovals(id);
      fetchVehicleData();
    }, 30000);
    return () => clearInterval(interval);
  }, [vehicle?.vehicle_id]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const sendMessage = async () => {
    if (!newMessage.trim()) return;
    try {
      await axios.post(`${API_BASE}/vehicles/${vehicle.vehicle_id}/messages`, {
        message_text: newMessage,
        sender_type: 'customer',
      });
      setNewMessage('');
      fetchMessages(vehicle.vehicle_id);
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const respondToApproval = async (approvalId, approved) => {
    try {
      await axios.patch(`${API_BASE}/approvals/${approvalId}`, { approved });
      fetchApprovals(vehicle.vehicle_id);
      alert(approved ? 'Repair approved!' : 'Repair declined');
    } catch {
      alert('Failed to respond to approval');
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────

  const getTimeRemaining = () => {
    if (!vehicle?.estimated_completion) return null;
    const diffMs = new Date(vehicle.estimated_completion) - new Date();
    if (diffMs < 0) return 'Overdue';
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);
    const remainingHours = totalHours % 24;
    const minutes = totalMinutes % 60;
    if (days >= 1) return remainingHours > 0 ? `${days}d ${remainingHours}h remaining` : `${days}d remaining`;
    if (totalHours > 0) return `${totalHours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
  };

  const getApprovalPhoto = (approvalId) => media.find((m) => m.caption === `approval_${approvalId}`);

  const getVehiclePhoto = () => {
    const vehiclePhoto = media.find((m) => m.caption === 'vehicle_photo');
    if (vehiclePhoto) return vehiclePhoto;
    const general = media.filter((m) => !m.caption || (!m.caption.startsWith('approval_') && m.caption !== 'vehicle_photo'));
    return general[0] || null;
  };

  // ── Loading / error states ───────────────────────────────────────────────

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

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-6">🚗</div>
          <h1 className="text-2xl font-semibold text-black mb-2">Vehicle Not Found</h1>
          <p className="text-gray-500">Please check your tracking link and try again.</p>
        </div>
      </div>
    );
  }

  const shopName = shopInfo?.name || 'Service Center';
  const googleReviewUrl = shopInfo?.google_review_url || '';
  const currentStatus = statusConfig[vehicle.status] || statusConfig.checked_in;
  const progress = ((currentStatus.step - 1) / 5) * 100;
  const timeRemaining = getTimeRemaining();
  const pendingApprovals = approvals.filter((a) => a.approved === null);
  const generalMedia = media.filter((m) => !m.caption || (!m.caption.startsWith('approval_') && m.caption !== 'vehicle_photo'));
  const photos = generalMedia.filter((m) => m.media_type === 'photo');
  const videos = generalMedia.filter((m) => m.media_type === 'video');
  const vehiclePhoto = getVehiclePhoto();

  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
      {/* ── Header ── */}
      <div className="bg-white/80 backdrop-blur-2xl border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-semibold text-black truncate">{shopName}</h1>
              <p className="text-xs sm:text-sm text-gray-500 mt-0.5">Service Tracker</p>
            </div>
            {timeRemaining && (
              <div className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs sm:text-sm font-semibold text-center ${timeRemaining === 'Overdue' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
                {timeRemaining}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* ── Ready banner ── */}
        {vehicle.status === 'ready' && (
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-3xl p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-semibold text-green-900 text-xl">Your Vehicle is Ready!</p>
                <p className="text-sm text-green-700 mt-2">
                  Thank you for choosing {shopName}. We would love to hear about your experience!
                </p>
                {googleReviewUrl && (
                  <a
                    href={googleReviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 mt-4 px-6 py-3 bg-green-600 text-white rounded-full font-semibold hover:bg-green-700 transition-all text-sm shadow-lg"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    Leave a Google Review
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Pending approvals alert ── */}
        {pendingApprovals.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-3xl p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-semibold text-yellow-900">Action Required</p>
                <p className="text-sm text-yellow-700 mt-1">
                  You have {pendingApprovals.length} repair approval{pendingApprovals.length > 1 ? 's' : ''} waiting for your response
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Vehicle card ── */}
        <div className="bg-gray-100 rounded-3xl overflow-hidden border border-gray-200">
          <div className="p-6">
            <div className="flex flex-col sm:flex-row gap-6">
              <div className="flex-shrink-0">
                <div className="w-full sm:w-48 h-48 bg-gray-200 rounded-2xl overflow-hidden flex items-center justify-center">
                  {vehiclePhoto ? (
                    vehiclePhoto.media_type === 'photo' ? (
                      <img
                        src={vehiclePhoto.media_url}
                        alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                        className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => setSelectedMedia(vehiclePhoto)}
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <video src={vehiclePhoto.media_url} className="w-full h-full object-cover cursor-pointer" onClick={() => setSelectedMedia(vehiclePhoto)} />
                    )
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-gray-200 to-gray-300 flex flex-col items-center justify-center">
                      <svg className="w-16 h-16 text-gray-400" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M8 40 L12 24 C13 20 15 18 19 18 L26 18 L30 12 L34 12 L38 18 L45 18 C49 18 51 20 52 24 L56 40" strokeLinecap="round"/>
                        <rect x="8" y="40" width="48" height="10" rx="4"/>
                        <circle cx="18" cy="50" r="5" fill="currentColor" className="text-gray-400"/>
                        <circle cx="46" cy="50" r="5" fill="currentColor" className="text-gray-400"/>
                        <circle cx="18" cy="50" r="2.5" fill="white"/>
                        <circle cx="46" cy="50" r="2.5" fill="white"/>
                      </svg>
                      <p className="text-xs text-gray-400 mt-2">No photo yet</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex-1">
                <h2 className="text-2xl sm:text-3xl font-semibold text-black">{vehicle.year} {vehicle.make} {vehicle.model}</h2>
                <p className="text-sm text-gray-500 mt-1">Service in progress</p>
                <div className="mt-6 space-y-3">
                  <div className="flex items-center justify-between py-2 border-b border-gray-200">
                    <span className="text-sm text-gray-500">Customer</span>
                    <span className="text-sm font-medium text-black">{vehicle.customer_name}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-gray-200">
                    <span className="text-sm text-gray-500">Checked In</span>
                    <span className="text-sm font-medium text-black">
                      {new Date(vehicle.checked_in_at).toLocaleDateString()} at {new Date(vehicle.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {vehicle.estimated_completion && (
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm text-gray-500">Est. Ready</span>
                      <span className="text-sm font-medium text-blue-600">
                        {new Date(vehicle.estimated_completion).toLocaleDateString()} at {new Date(vehicle.estimated_completion).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Service progress ── */}
        {vehicle.awaiting_warranty ? (
          <div className="bg-orange-50 rounded-3xl p-5 sm:p-8 border-2 border-orange-200">
            <h3 className="text-lg sm:text-xl font-semibold text-orange-900 mb-4">Service Status</h3>
            <div className="flex flex-col items-center py-8">
              <div className="w-20 h-20 rounded-full bg-orange-500 flex items-center justify-center mb-4">
                <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                </svg>
              </div>
              <h4 className="text-2xl font-semibold text-orange-900 mb-2">Awaiting Warranty Approval</h4>
              <p className="text-sm text-orange-700 text-center max-w-md">
                Your vehicle service requires warranty approval. We'll notify you as soon as we receive approval and work can continue.
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-gray-100 rounded-3xl p-5 sm:p-8 border border-gray-200">
            <h3 className="text-lg sm:text-xl font-semibold text-black mb-6 sm:mb-8">Service Progress</h3>
            <div className="relative">
              <div className="absolute top-6 left-0 right-0 h-0.5 bg-gray-300 hidden sm:block"></div>
              <div className="absolute top-6 left-0 h-0.5 bg-black transition-all duration-700 hidden sm:block" style={{ width: `${progress}%` }}></div>
              <div className="relative grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
                {Object.entries(statusConfig).map(([key, cfg]) => {
                  const isActive = cfg.step <= currentStatus.step;
                  const isCurrent = cfg.step === currentStatus.step;
                  return (
                    <div key={key} className="flex flex-col items-center">
                      <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-semibold text-xs sm:text-sm transition-all flex-shrink-0 ${isActive ? 'bg-black text-white' : 'bg-gray-300 text-gray-500'} ${isCurrent ? 'ring-2 sm:ring-4 ring-gray-300 animate-float' : ''}`}>
                        {isActive ? (
                          <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        ) : cfg.step}
                      </div>
                      <p className={`mt-2 sm:mt-3 text-[10px] sm:text-xs text-center font-medium leading-tight ${isCurrent ? 'text-black' : isActive ? 'text-gray-700' : 'text-gray-400'}`}>{cfg.label}</p>
                    </div>
                  );
                })}
              </div>
            </div>
            <style jsx>{`
              @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
              .animate-float { animation: float 2s ease-in-out infinite; }
            `}</style>
          </div>
        )}

        {/* ── Approval requests ── */}
        {approvals.length > 0 && (
          <div className="bg-gray-100 rounded-3xl overflow-hidden border border-gray-200">
            <div className="bg-yellow-50 border-b border-yellow-100 p-5 sm:p-6">
              <h3 className="text-lg sm:text-xl font-semibold text-black">Repair Approvals</h3>
              <p className="text-xs sm:text-sm text-gray-600 mt-1">Additional work needed on your vehicle</p>
            </div>
            <div className="p-5 sm:p-6 space-y-4">
              {approvals.map((approval) => {
                const approvalPhoto = getApprovalPhoto(approval.approval_id);
                return (
                  <div key={approval.approval_id} className={`rounded-2xl p-5 sm:p-6 border-2 ${approval.approved === null ? 'border-yellow-300 bg-yellow-50' : approval.approved ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
                    <div className="mb-4">
                      {approvalPhoto && (
                        <img src={approvalPhoto.media_url} alt="Issue photo" className="w-full h-40 object-cover rounded-2xl cursor-pointer border-2 border-gray-300 hover:border-gray-400 transition-all mb-3" onClick={() => setSelectedMedia(approvalPhoto)} />
                      )}
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-semibold text-black text-base leading-snug flex-1">{approval.description}</h4>
                        {approval.approved === null ? (
                          <span className="flex-shrink-0 px-2.5 py-1 bg-yellow-200 text-yellow-800 rounded-full text-xs font-semibold">Pending</span>
                        ) : approval.approved ? (
                          <span className="flex-shrink-0 px-2.5 py-1 bg-green-200 text-green-800 rounded-full text-xs font-semibold">✓ Approved</span>
                        ) : (
                          <span className="flex-shrink-0 px-2.5 py-1 bg-red-200 text-red-800 rounded-full text-xs font-semibold">✗ Declined</span>
                        )}
                      </div>
                      <p className="text-2xl font-bold text-black mt-2">${approval.cost.toFixed(2)}</p>
                    </div>
                    {approval.approved === null && (
                      <div className="flex gap-3 mt-4">
                        <button onClick={() => respondToApproval(approval.approval_id, false)} className="flex-1 px-6 py-3 bg-white border-2 border-gray-300 text-gray-900 rounded-full font-semibold hover:bg-gray-50 transition-all">Decline</button>
                        <button onClick={() => respondToApproval(approval.approval_id, true)} className="flex-1 px-6 py-3 bg-black text-white rounded-full font-semibold hover:bg-gray-900 transition-all">Approve Repair</button>
                      </div>
                    )}
                    {approval.approved !== null && (
                      <p className="text-sm text-gray-600 mt-4">{approval.approved ? 'Approved' : 'Declined'} on {new Date(approval.approved_at).toLocaleString()}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Progress media ── */}
        {generalMedia.length > 0 && (
          <div className="bg-gray-100 rounded-3xl overflow-hidden border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-black">Progress Updates</h3>
              <p className="text-sm text-gray-500 mt-1">{photos.length} photos · {videos.length} videos</p>
            </div>
            <div className="p-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
              {generalMedia.map((item) => (
                <div key={item.media_id} className="relative group">
                  {item.media_type === 'photo' ? (
                    <img src={item.media_url} alt="Progress photo" className="w-full h-40 object-cover rounded-2xl cursor-pointer hover:opacity-90 transition-opacity border border-gray-200" onClick={() => setSelectedMedia(item)} />
                  ) : (
                    <div className="relative">
                      <video src={item.media_url} className="w-full h-40 object-cover rounded-2xl cursor-pointer border border-gray-200" onClick={() => setSelectedMedia(item)} />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-2xl cursor-pointer" onClick={() => setSelectedMedia(item)}>
                        <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                        </svg>
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-gray-400 mt-2">{new Date(item.uploaded_at).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Messages ── */}
        <div className="bg-gray-100 rounded-3xl overflow-hidden border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-xl font-semibold text-black">Messages</h3>
            <p className="text-sm text-gray-500 mt-1">Chat with your service advisor</p>
          </div>
          <div className="p-6 space-y-4 min-h-[300px] max-h-96 overflow-y-auto bg-white">
            {messages.length === 0 ? (
              <div className="text-center py-16">
                <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="text-gray-500 font-medium">No messages yet</p>
                <p className="text-sm text-gray-400 mt-1">Start a conversation with your service advisor</p>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.message_id} className={`flex ${msg.sender_type === 'customer' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-sm rounded-3xl px-5 py-3 ${msg.sender_type === 'customer' ? 'bg-black text-white' : 'bg-gray-100 text-black border border-gray-200'}`}>
                    <p className={`text-xs font-semibold mb-1.5 ${msg.sender_type === 'customer' ? 'text-gray-400' : 'text-gray-500'}`}>
                      {msg.sender_type === 'customer' ? 'You' : 'Service Advisor'}
                    </p>
                    <p className="text-sm leading-relaxed">{msg.message_text}</p>
                    <p className="text-xs mt-1.5 text-gray-400">{new Date(msg.sent_at).toLocaleString()}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="p-4 sm:p-6 bg-white border-t border-gray-200">
            <div className="flex gap-2">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Type your message…"
                className="flex-1 min-w-0 px-3 sm:px-4 py-3 bg-gray-50 border border-gray-200 rounded-full text-base text-black placeholder-gray-400 focus:ring-2 focus:ring-black outline-none transition-all"
              />
              <button onClick={sendMessage} className="px-4 sm:px-6 py-3 bg-black text-white rounded-full font-semibold hover:bg-gray-900 transition-all flex-shrink-0 text-sm whitespace-nowrap">
                Send
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Media lightbox ── */}
      {selectedMedia && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setSelectedMedia(null)}>
          <div className="max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end mb-4">
              <button onClick={() => setSelectedMedia(null)} className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-all">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {selectedMedia.media_type === 'photo' ? (
              <img src={selectedMedia.media_url} alt="Full size" className="w-full h-auto rounded-3xl" />
            ) : (
              <video src={selectedMedia.media_url} controls autoPlay className="w-full h-auto rounded-3xl" />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerPortal;
