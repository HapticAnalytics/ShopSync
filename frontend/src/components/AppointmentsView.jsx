import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

const API = import.meta.env.VITE_API_URL || 'https://shopsync-api.vercel.app';

const STATUS_LABELS = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Completed',
  no_show: 'No Show',
};

const STATUS_COLORS = {
  scheduled: 'bg-blue-50 text-blue-700',
  confirmed: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-600',
  completed: 'bg-gray-100 text-gray-600',
  no_show: 'bg-orange-50 text-orange-600',
};

const STATUS_TRANSITIONS = {
  scheduled: ['confirmed', 'cancelled', 'no_show'],
  confirmed: ['completed', 'cancelled', 'no_show'],
  cancelled: [],
  completed: [],
  no_show: [],
};

export default function AppointmentsView() {
  const { session, userProfile } = useAuth();
  const navigate = useNavigate();
  const shopId = userProfile?.shop_id || '';
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('upcoming'); // upcoming | all
  const [blockModal, setBlockModal] = useState(false);
  const [blockDate, setBlockDate] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [blocking, setBlocking] = useState(false);
  const [blockError, setBlockError] = useState('');
  const [actionLoading, setActionLoading] = useState(null);

  const authConfig = useCallback(() => ({
    headers: { Authorization: `Bearer ${session?.access_token}` },
  }), [session]);

  const bookingLink = shopId ? `${window.location.origin}/schedule/${shopId}` : '';

  const fetchAppointments = useCallback(() => {
    if (!shopId) return;
    setLoading(true);
    axios.get(`${API}/shop/${shopId}/appointments`, authConfig())
      .then(r => setAppointments(r.data.appointments || []))
      .catch(() => setAppointments([]))
      .finally(() => setLoading(false));
  }, [shopId, authConfig]);

  useEffect(() => { fetchAppointments(); }, [fetchAppointments]);

  function copyLink() {
    navigator.clipboard.writeText(bookingLink).catch(() => {});
  }

  const now = new Date();

  const filtered = appointments.filter(apt => {
    if (filter === 'upcoming') {
      return ['scheduled', 'confirmed'].includes(apt.status) && new Date(apt.scheduled_at) >= now;
    }
    return true;
  }).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

  async function updateStatus(aptId, newStatus) {
    setActionLoading(aptId + newStatus);
    try {
      await axios.patch(`${API}/appointments/${aptId}/status`, { status: newStatus }, authConfig());
      setAppointments(prev => prev.map(a => a.id === aptId ? { ...a, status: newStatus } : a));
    } catch {
      // silently fail — let user retry
    } finally {
      setActionLoading(null);
    }
  }

  async function submitBlock(e) {
    e.preventDefault();
    if (!blockDate) { setBlockError('Date is required.'); return; }
    setBlocking(true);
    setBlockError('');
    try {
      await axios.post(`${API}/shop/${shopId}/blocked-dates`, {
        blocked_date: blockDate,
        reason: blockReason.trim() || undefined,
      }, authConfig());
      setBlockModal(false);
      setBlockDate('');
      setBlockReason('');
    } catch (err) {
      setBlockError(err.response?.data?.detail || 'Failed to block date.');
    } finally {
      setBlocking(false);
    }
  }

  function formatDateTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  }

  if (!shopId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">No shop assigned to your account.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/advisor')}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ← Dashboard
            </button>
            <h1 className="text-lg font-semibold text-gray-900">Appointments</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyLink}
              className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 hover:border-black hover:text-black transition-colors"
              title={bookingLink}
            >
              Copy Booking Link
            </button>
            <button
              onClick={() => setBlockModal(true)}
              className="text-xs bg-black text-white rounded-lg px-3 py-1.5 hover:bg-gray-800 transition-colors"
            >
              Block Date
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Filter tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-5">
          {['upcoming', 'all'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f === 'upcoming' ? 'Upcoming' : 'All'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">No appointments found.</p>
            {bookingLink && (
              <p className="text-xs text-gray-400 mt-2">
                Share your booking link to get started.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(apt => {
              const transitions = STATUS_TRANSITIONS[apt.status] || [];
              return (
                <div key={apt.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 text-sm">{apt.customer_name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[apt.status]}`}>
                          {STATUS_LABELS[apt.status]}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{formatDateTime(apt.scheduled_at)}</p>
                      {apt.service_type && (
                        <p className="text-xs text-gray-500 mt-0.5">{apt.service_type}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-0.5">{apt.customer_phone}</p>
                      {apt.notes && (
                        <p className="text-xs text-gray-400 mt-1 italic">{apt.notes}</p>
                      )}
                    </div>
                    {transitions.length > 0 && (
                      <div className="flex flex-col gap-1.5 flex-shrink-0">
                        {transitions.map(s => (
                          <button
                            key={s}
                            onClick={() => updateStatus(apt.id, s)}
                            disabled={actionLoading === apt.id + s}
                            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1 text-gray-600 hover:border-black hover:text-black transition-colors disabled:opacity-50 whitespace-nowrap"
                          >
                            {actionLoading === apt.id + s ? '…' : STATUS_LABELS[s]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Block Date Modal */}
      {blockModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Block a Date</h2>
            <form onSubmit={submitBlock} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Date *</label>
                <input
                  type="date"
                  value={blockDate}
                  onChange={e => setBlockDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Reason <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="text"
                  value={blockReason}
                  onChange={e => setBlockReason(e.target.value)}
                  placeholder="Holiday, staff training, etc."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black"
                />
              </div>
              {blockError && <p className="text-red-500 text-sm">{blockError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setBlockModal(false); setBlockError(''); }}
                  className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={blocking}
                  className="flex-1 bg-black text-white rounded-xl py-2.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
                >
                  {blocking ? 'Blocking…' : 'Block Date'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
