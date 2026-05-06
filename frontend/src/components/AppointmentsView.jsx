import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

const API = import.meta.env.VITE_API_BASE || 'https://shopsync-backend-w8ja.onrender.com';

const STATUS_LABEL = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Completed',
  no_show: 'No Show',
};

const STATUS_COLOR = {
  scheduled:  'bg-blue-50 text-blue-700',
  confirmed:  'bg-green-50 text-green-700',
  cancelled:  'bg-red-50 text-red-600',
  completed:  'bg-gray-100 text-gray-500',
  no_show:    'bg-orange-50 text-orange-600',
};

const TRANSITIONS = {
  scheduled: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'no_show', 'cancelled'],
  cancelled: [],
  completed: [],
  no_show:   [],
};

// Generate 15-min time slots 7 AM – 6 PM
const TIME_OPTIONS = (() => {
  const opts = [];
  for (let h = 7; h <= 18; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 18 && m > 0) break;
      const hh = h % 12 === 0 ? 12 : h % 12;
      const ampm = h < 12 ? 'AM' : 'PM';
      const label = `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
      const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      opts.push({ label, value });
    }
  }
  return opts;
})();

function todayYMD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateHeader(isoStr) {
  const d = new Date(isoStr);
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  d.setHours(0,0,0,0);
  if (d.getTime() === today.getTime()) return 'Today';
  if (d.getTime() === tomorrow.getTime()) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatTime(isoStr) {
  return new Date(isoStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function groupByDate(appointments) {
  const groups = {};
  for (const apt of appointments) {
    const d = new Date(apt.scheduled_at);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(apt);
  }
  return Object.entries(groups).sort(([a],[b]) => a.localeCompare(b));
}

// ── New Appointment Modal ──────────────────────────────────────────────────────

function NewAppointmentModal({ shopId, authConfig, onClose, onSaved }) {
  const [form, setForm] = useState({
    first_name: '', last_name: '', customer_phone: '', customer_email: '',
    vehicle_year: '', vehicle_make: '', vehicle_model: '', vehicle_vin: '',
    drop_off_reason: '', date: todayYMD(), time: '08:00',
  });
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const searchTimer = useRef(null);
  const phoneRef = useRef(null);

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function fillFromCustomer(c) {
    setForm(f => ({
      ...f,
      first_name: c.first_name || '',
      last_name: c.last_name || '',
      customer_phone: c.phone || '',
      customer_email: c.email || '',
      vehicle_year: c.last_vehicle?.vehicle_year ? String(c.last_vehicle.vehicle_year) : f.vehicle_year,
      vehicle_make: c.last_vehicle?.vehicle_make || f.vehicle_make,
      vehicle_model: c.last_vehicle?.vehicle_model || f.vehicle_model,
      vehicle_vin: c.last_vehicle?.vehicle_vin || f.vehicle_vin,
    }));
    setSearchResults([]);
    setSearchOpen(false);
  }

  function onPhoneChange(val) {
    set('customer_phone', val);
    clearTimeout(searchTimer.current);
    if (val.trim().length < 3) { setSearchResults([]); setSearchOpen(false); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/shop/${shopId}/customers/search?q=${encodeURIComponent(val.trim())}`, authConfig());
        if (r.data.customers?.length) { setSearchResults(r.data.customers); setSearchOpen(true); }
        else { setSearchResults([]); setSearchOpen(false); }
      } catch { /* ignore */ }
    }, 300);
  }

  function onNameChange(field, val) {
    set(field, val);
    clearTimeout(searchTimer.current);
    const combined = field === 'first_name' ? `${val} ${form.last_name}` : `${form.first_name} ${val}`;
    if (combined.trim().length < 3) return;
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/shop/${shopId}/customers/search?q=${encodeURIComponent(val.trim())}`, authConfig());
        if (r.data.customers?.length) { setSearchResults(r.data.customers); setSearchOpen(true); }
        else { setSearchResults([]); setSearchOpen(false); }
      } catch { /* ignore */ }
    }, 400);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim() || !form.customer_phone.trim()) {
      setError('First name, last name, and phone are required.');
      return;
    }
    if (!form.date || !form.time) {
      setError('Date and time are required.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const scheduled_at = `${form.date}T${form.time}:00`;
      await axios.post(`${API}/shop/${shopId}/appointments`, {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        customer_phone: form.customer_phone.trim(),
        customer_email: form.customer_email.trim() || undefined,
        vehicle_year: form.vehicle_year ? parseInt(form.vehicle_year) : undefined,
        vehicle_make: form.vehicle_make.trim() || undefined,
        vehicle_model: form.vehicle_model.trim() || undefined,
        vehicle_vin: form.vehicle_vin.trim() || undefined,
        drop_off_reason: form.drop_off_reason.trim() || undefined,
        scheduled_at,
        duration_minutes: 60,
      }, authConfig());
      onSaved();
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save appointment.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">New Appointment</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 text-lg">×</button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1">
          <div className="px-5 py-4 space-y-5">

            {/* Customer */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Customer</p>
              <div className="space-y-3">
                {/* Phone with search */}
                <div className="relative">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Phone Number *</label>
                  <input
                    ref={phoneRef}
                    type="tel"
                    value={form.customer_phone}
                    onChange={e => onPhoneChange(e.target.value)}
                    onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                    onFocus={() => searchResults.length && setSearchOpen(true)}
                    placeholder="(555) 555-5555"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black"
                  />
                  {searchOpen && searchResults.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                      {searchResults.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onMouseDown={() => fillFromCustomer(c)}
                          className="w-full px-4 py-2.5 text-left hover:bg-gray-50 border-b border-gray-50 last:border-0"
                        >
                          <p className="text-sm font-medium text-gray-900">{c.first_name} {c.last_name}</p>
                          <p className="text-xs text-gray-400">{c.phone}{c.last_vehicle?.vehicle_make ? ` · ${[c.last_vehicle.vehicle_year, c.last_vehicle.vehicle_make, c.last_vehicle.vehicle_model].filter(Boolean).join(' ')}` : ''}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">First Name *</label>
                    <input
                      type="text"
                      value={form.first_name}
                      onChange={e => onNameChange('first_name', e.target.value)}
                      placeholder="John"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Last Name *</label>
                    <input
                      type="text"
                      value={form.last_name}
                      onChange={e => onNameChange('last_name', e.target.value)}
                      placeholder="Smith"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Email <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input
                    type="email"
                    value={form.customer_email}
                    onChange={e => set('customer_email', e.target.value)}
                    placeholder="john@example.com"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black"
                  />
                </div>
              </div>
            </div>

            {/* Vehicle */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Vehicle</p>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Year</label>
                    <input
                      type="number"
                      value={form.vehicle_year}
                      onChange={e => set('vehicle_year', e.target.value)}
                      placeholder="2022"
                      min="1900" max="2100"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Make</label>
                    <input
                      type="text"
                      value={form.vehicle_make}
                      onChange={e => set('vehicle_make', e.target.value)}
                      placeholder="Ford"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Model</label>
                    <input
                      type="text"
                      value={form.vehicle_model}
                      onChange={e => set('vehicle_model', e.target.value)}
                      placeholder="F-150"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">VIN <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input
                    type="text"
                    value={form.vehicle_vin}
                    onChange={e => set('vehicle_vin', e.target.value.toUpperCase())}
                    placeholder="1FTFW1ET0EKE12345"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
                  />
                </div>
              </div>
            </div>

            {/* Appointment Details */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Appointment</p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Drop-off Date *</label>
                    <input
                      type="date"
                      value={form.date}
                      onChange={e => set('date', e.target.value)}
                      min={todayYMD()}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Drop-off Time *</label>
                    <select
                      value={form.time}
                      onChange={e => set('time', e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black bg-white"
                    >
                      {TIME_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Reason for Visit</label>
                  <textarea
                    value={form.drop_off_reason}
                    onChange={e => set('drop_off_reason', e.target.value)}
                    placeholder="Oil change, brake inspection, check engine light..."
                    rows={2}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black resize-none"
                  />
                </div>
              </div>
            </div>

          </div>

          {/* Footer */}
          <div className="px-5 pb-5 pt-2 border-t border-gray-100 flex-shrink-0 space-y-2">
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-black text-white rounded-xl py-3 text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Saving…' : 'Confirm Appointment & Send Text'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AppointmentsView() {
  const { session, userProfile } = useAuth();
  const navigate = useNavigate();
  const shopId = userProfile?.shop_id || '';

  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState('upcoming');
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

  async function updateStatus(aptId, newStatus) {
    setActionLoading(aptId + newStatus);
    try {
      await axios.patch(`${API}/appointments/${aptId}/status`, { status: newStatus }, authConfig());
      setAppointments(prev => prev.map(a =>
        (a.appointment_id === aptId || a.id === aptId) ? { ...a, status: newStatus } : a
      ));
    } catch { /* ignore */ }
    finally { setActionLoading(null); }
  }

  const now = new Date();

  const filtered = appointments.filter(apt => {
    const aptDate = new Date(apt.scheduled_at);
    if (filter === 'upcoming') return ['scheduled', 'confirmed'].includes(apt.status) && aptDate >= now;
    if (filter === 'today') {
      const today = new Date(); today.setHours(0,0,0,0);
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
      return aptDate >= today && aptDate < tomorrow;
    }
    return true;
  });

  const grouped = groupByDate(filtered);

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
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/advisor')} className="text-sm text-gray-500 hover:text-gray-700">
              ← Dashboard
            </button>
            <h1 className="text-lg font-semibold text-gray-900">Appointments</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyLink}
              className="hidden sm:block text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 hover:border-black hover:text-black transition-colors"
            >
              Online Booking Link
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="bg-black text-white text-sm font-medium rounded-xl px-4 py-2 hover:bg-gray-800 transition-colors"
            >
              + New Appointment
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5">
        {/* Filter tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-5">
          {[
            { key: 'upcoming', label: 'Upcoming' },
            { key: 'today',    label: 'Today' },
            { key: 'all',      label: 'All' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === f.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
          </div>
        ) : grouped.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm">No appointments found.</p>
            <button
              onClick={() => setShowModal(true)}
              className="mt-3 text-sm text-black underline underline-offset-2"
            >
              Create one
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(([dateKey, apts]) => (
              <div key={dateKey}>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">
                  {formatDateHeader(dateKey + 'T12:00:00')}
                </p>
                <div className="space-y-2">
                  {apts.map(apt => {
                    const aptId = apt.appointment_id || apt.id;
                    const transitions = TRANSITIONS[apt.status] || [];
                    const vehicle = [apt.vehicle_year, apt.vehicle_make, apt.vehicle_model].filter(Boolean).join(' ');
                    return (
                      <div key={aptId} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            {/* Time + status */}
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-semibold text-gray-900">{formatTime(apt.scheduled_at)}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[apt.status]}`}>
                                {STATUS_LABEL[apt.status]}
                              </span>
                            </div>
                            {/* Customer name */}
                            <p className="text-sm font-medium text-gray-900">
                              {apt.first_name && apt.last_name
                                ? `${apt.first_name} ${apt.last_name}`
                                : apt.customer_name}
                            </p>
                            <p className="text-xs text-gray-400">{apt.customer_phone}</p>
                            {vehicle && (
                              <p className="text-xs text-gray-500 mt-1">{vehicle}{apt.vehicle_vin ? ` · ${apt.vehicle_vin}` : ''}</p>
                            )}
                            {apt.drop_off_reason && (
                              <p className="text-xs text-gray-500 mt-0.5 italic">{apt.drop_off_reason}</p>
                            )}
                          </div>

                          {/* Action buttons */}
                          {transitions.length > 0 && (
                            <div className="flex flex-col gap-1.5 flex-shrink-0">
                              {transitions.map(s => (
                                <button
                                  key={s}
                                  onClick={() => updateStatus(aptId, s)}
                                  disabled={!!actionLoading}
                                  className={`text-xs rounded-lg px-2.5 py-1 font-medium border transition-colors disabled:opacity-40 whitespace-nowrap ${
                                    s === 'cancelled' || s === 'no_show'
                                      ? 'border-gray-200 text-gray-400 hover:border-red-200 hover:text-red-500'
                                      : 'border-gray-200 text-gray-700 hover:border-black hover:text-black'
                                  }`}
                                >
                                  {actionLoading === aptId + s ? '…' : STATUS_LABEL[s]}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <NewAppointmentModal
          shopId={shopId}
          authConfig={authConfig}
          onClose={() => setShowModal(false)}
          onSaved={fetchAppointments}
        />
      )}
    </div>
  );
}
