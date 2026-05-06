import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

const API = import.meta.env.VITE_API_BASE || 'https://shopsync-backend-w8ja.onrender.com';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay(); // 0=Sun
}

function toYMD(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function CustomerScheduler() {
  const { shopId } = useParams();
  const [step, setStep] = useState('calendar'); // calendar | slots | form | confirm
  const [shopInfo, setShopInfo] = useState(null);
  const [openDays, setOpenDays] = useState([]);
  const [blockedDates, setBlockedDates] = useState([]);
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState(null);
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [form, setForm] = useState({ customer_name: '', customer_phone: '', customer_email: '', service_type: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [booked, setBooked] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get(`${API}/schedule/${shopId}`)
      .then(r => {
        setShopInfo(r.data.shop);
        setOpenDays(r.data.open_days);
        setBlockedDates(r.data.blocked_dates || []);
      })
      .catch(() => setError('Unable to load scheduling page. Please try again.'));
  }, [shopId]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function isDateAvailable(year, month, day) {
    const d = new Date(year, month, day);
    if (d < today) return false;
    const dow = d.getDay(); // 0=Sun
    if (!openDays.includes(dow)) return false;
    const ymd = toYMD(d);
    if (blockedDates.includes(ymd)) return false;
    return true;
  }

  function prevMonth() {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else setCalMonth(m => m - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else setCalMonth(m => m + 1);
  }

  function handleDateClick(day) {
    const d = new Date(calYear, calMonth, day);
    if (!isDateAvailable(calYear, calMonth, day)) return;
    setSelectedDate(d);
    setSelectedSlot(null);
    setSlotsLoading(true);
    setStep('slots');
    const ymd = toYMD(d);
    axios.get(`${API}/schedule/${shopId}/slots?date=${ymd}`)
      .then(r => setSlots(r.data.slots || []))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }

  function handleSlotSelect(slot) {
    if (!slot.available) return;
    setSelectedSlot(slot);
    setStep('form');
  }

  async function handleBook(e) {
    e.preventDefault();
    if (!form.customer_name.trim() || !form.customer_phone.trim()) {
      setSubmitError('Name and phone are required.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      const payload = {
        customer_name: form.customer_name.trim(),
        customer_phone: form.customer_phone.trim(),
        customer_email: form.customer_email.trim() || undefined,
        service_type: form.service_type.trim() || undefined,
        notes: form.notes.trim() || undefined,
        scheduled_at: selectedSlot.datetime,
        duration_minutes: 60,
      };
      const r = await axios.post(`${API}/schedule/${shopId}/book`, payload);
      setBooked(r.data);
      setStep('confirm');
    } catch (err) {
      setSubmitError(err.response?.data?.detail || 'Booking failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!shopInfo) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
      </div>
    );
  }

  const daysInMonth = getDaysInMonth(calYear, calMonth);
  const firstDay = getFirstDayOfMonth(calYear, calMonth);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="max-w-lg mx-auto">
          <h1 className="text-xl font-semibold text-gray-900">{shopInfo.name}</h1>
          <p className="text-sm text-gray-500 mt-0.5">Schedule a Service Appointment</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">

        {/* Step: Calendar */}
        {(step === 'calendar' || step === 'slots') && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <button onClick={prevMonth} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-600">
                ‹
              </button>
              <span className="font-medium text-gray-900">{MONTHS[calMonth]} {calYear}</span>
              <button onClick={nextMonth} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-600">
                ›
              </button>
            </div>
            <div className="grid grid-cols-7 mb-2">
              {DAYS.map(d => (
                <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-1">
              {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const avail = isDateAvailable(calYear, calMonth, day);
                const d = new Date(calYear, calMonth, day);
                const isSelected = selectedDate && toYMD(d) === toYMD(selectedDate);
                return (
                  <button
                    key={day}
                    onClick={() => handleDateClick(day)}
                    disabled={!avail}
                    className={`
                      mx-auto w-9 h-9 flex items-center justify-center rounded-full text-sm font-medium transition-colors
                      ${isSelected ? 'bg-black text-white' : ''}
                      ${avail && !isSelected ? 'hover:bg-gray-100 text-gray-900 cursor-pointer' : ''}
                      ${!avail ? 'text-gray-300 cursor-default' : ''}
                    `}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step: Slots */}
        {step === 'slots' && selectedDate && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <button onClick={() => setStep('calendar')} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
              <span className="text-sm font-medium text-gray-900">
                {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </span>
            </div>
            {slotsLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
              </div>
            ) : slots.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-6">No available slots for this day.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {slots.map((slot, i) => (
                  <button
                    key={i}
                    onClick={() => handleSlotSelect(slot)}
                    disabled={!slot.available}
                    className={`
                      py-2.5 px-3 rounded-xl text-sm font-medium border transition-colors
                      ${slot.available
                        ? 'border-gray-200 hover:border-black hover:bg-black hover:text-white text-gray-900'
                        : 'border-gray-100 text-gray-300 cursor-default bg-gray-50'}
                    `}
                  >
                    {slot.time}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step: Form */}
        {step === 'form' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-5">
              <button onClick={() => setStep('slots')} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {selectedDate?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                </p>
                <p className="text-xs text-gray-500">at {selectedSlot?.time}</p>
              </div>
            </div>
            <form onSubmit={handleBook} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  value={form.customer_name}
                  onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))}
                  placeholder="John Smith"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Phone Number *</label>
                <input
                  type="tel"
                  value={form.customer_phone}
                  onChange={e => setForm(f => ({ ...f, customer_phone: e.target.value }))}
                  placeholder="(555) 555-5555"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="email"
                  value={form.customer_email}
                  onChange={e => setForm(f => ({ ...f, customer_email: e.target.value }))}
                  placeholder="john@example.com"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Service Type <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="text"
                  value={form.service_type}
                  onChange={e => setForm(f => ({ ...f, service_type: e.target.value }))}
                  placeholder="Oil change, brake inspection, etc."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Any additional details..."
                  rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black resize-none"
                />
              </div>
              {submitError && (
                <p className="text-red-500 text-sm">{submitError}</p>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-black text-white rounded-xl py-3 text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Booking…' : 'Confirm Appointment'}
              </button>
            </form>
          </div>
        )}

        {/* Step: Confirmation */}
        {step === 'confirm' && booked && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
            <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">You're Booked!</h2>
            <p className="text-gray-500 text-sm mb-5">
              A confirmation text has been sent to {booked.customer_phone}.
            </p>
            <div className="bg-gray-50 rounded-xl p-4 text-left space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Shop</span>
                <span className="font-medium text-gray-900">{shopInfo.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Date & Time</span>
                <span className="font-medium text-gray-900">{booked.scheduled_local}</span>
              </div>
              {booked.service_type && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Service</span>
                  <span className="font-medium text-gray-900">{booked.service_type}</span>
                </div>
              )}
            </div>
            {shopInfo.address && (
              <p className="text-xs text-gray-400 mt-4">{shopInfo.address}</p>
            )}
            {shopInfo.phone && (
              <p className="text-xs text-gray-400 mt-1">{shopInfo.phone}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
