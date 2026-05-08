import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

const API_BASE = import.meta.env.VITE_API_BASE || 'https://shopsync-backend-w8ja.onrender.com';

const AdminPanel = () => {
  const { session, userProfile, signOut } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState('shops');
  const [shops, setShops] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [shopForm, setShopForm] = useState({ name: '', phone: '', address: '', google_review_url: '', timezone: 'America/Denver' });
  const [inviteForm, setInviteForm] = useState({ email: '', full_name: '', role: 'advisor', shop_id: '' });
  const [submitting, setSubmitting] = useState(false);

  const authConfig = useCallback(() => ({
    headers: { Authorization: `Bearer ${session?.access_token}` },
  }), [session]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [shopsResp, usersResp] = await Promise.all([
        axios.get(`${API_BASE}/admin/shops`, authConfig()),
        axios.get(`${API_BASE}/admin/users`, authConfig()),
      ]);
      setShops(shopsResp.data);
      setUsers(usersResp.data);
    } catch (err) {
      setError('Failed to load data. ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  }, [authConfig]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const showFeedback = (msg, isError = false) => {
    if (isError) { setError(msg); setSuccess(''); }
    else { setSuccess(msg); setError(''); }
    setTimeout(() => { setError(''); setSuccess(''); }, 5000);
  };

  const handleCreateShop = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await axios.post(`${API_BASE}/admin/shops`, shopForm, authConfig());
      setShopForm({ name: '', phone: '', address: '', google_review_url: '', timezone: 'America/Denver' });
      showFeedback('Shop created successfully');
      fetchData();
    } catch (err) {
      showFeedback('Failed to create shop: ' + (err.response?.data?.detail || err.message), true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleInviteUser = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await axios.post(`${API_BASE}/admin/users/invite`, inviteForm, authConfig());
      setInviteForm({ email: '', full_name: '', role: 'advisor', shop_id: '' });
      showFeedback('Invite sent successfully — user will receive an email to set their password');
      fetchData();
    } catch (err) {
      showFeedback('Failed to invite user: ' + (err.response?.data?.detail || err.message), true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleUserActive = async (user) => {
    try {
      await axios.patch(
        `${API_BASE}/admin/users/${user.user_id}`,
        { active: !user.active },
        authConfig()
      );
      showFeedback(`User ${user.active ? 'deactivated' : 'activated'}`);
      fetchData();
    } catch (err) {
      showFeedback('Failed to update user: ' + (err.response?.data?.detail || err.message), true);
    }
  };

  const handleDeleteUser = async (user) => {
    if (!window.confirm(`Permanently delete ${user.full_name || user.email}? This cannot be undone.`)) return;
    try {
      await axios.delete(`${API_BASE}/admin/users/${user.user_id}`, authConfig());
      showFeedback('User deleted');
      fetchData();
    } catch (err) {
      showFeedback('Failed to delete user: ' + (err.response?.data?.detail || err.message), true);
    }
  };

  const handleUpdateUserShop = async (userId, shopId) => {
    try {
      await axios.patch(
        `${API_BASE}/admin/users/${userId}`,
        { shop_id: shopId || null },
        authConfig()
      );
      showFeedback('User shop updated');
      fetchData();
    } catch (err) {
      showFeedback('Failed to update user: ' + (err.response?.data?.detail || err.message), true);
    }
  };

  const inputClass = "w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all text-sm";
  const labelClass = "block text-sm font-medium text-gray-700 mb-2";

  return (
    <div
      className="min-h-screen bg-white"
      style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Header */}
      <div
        className="bg-white/80 backdrop-blur-2xl border-b border-gray-200 sticky top-0 z-50"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold text-black tracking-tight">Admin Panel</h1>
              <p className="text-xs text-gray-500 mt-1">{userProfile?.email}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => navigate('/advisor')}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-full hover:bg-gray-200 transition-all"
              >
                Dashboard
              </button>
              <button
                onClick={signOut}
                className="px-4 py-2 bg-black text-white text-sm font-medium rounded-full hover:bg-gray-900 transition-all"
              >
                Sign Out
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-4 flex gap-1 bg-gray-100 rounded-full p-1 w-fit">
            {['shops', 'users'].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all capitalize ${
                  tab === t ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'shops' ? `Shops (${shops.length})` : `Users (${users.length})`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Feedback */}
        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700">{error}</div>
        )}
        {success && (
          <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-2xl text-sm text-green-700">{success}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-black rounded-full animate-spin"></div>
          </div>
        ) : (
          <>
            {/* ── Shops Tab ── */}
            {tab === 'shops' && (
              <div className="space-y-6">
                {/* Create shop form */}
                <div className="bg-gray-100 rounded-3xl p-6 sm:p-8 border border-gray-200">
                  <h2 className="text-lg font-semibold text-black mb-6">Add New Shop</h2>
                  <form onSubmit={handleCreateShop} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className={labelClass}>Shop Name *</label>
                        <input
                          type="text"
                          required
                          value={shopForm.name}
                          onChange={(e) => setShopForm({ ...shopForm, name: e.target.value })}
                          placeholder="Summit Trucks"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Phone</label>
                        <input
                          type="tel"
                          value={shopForm.phone}
                          onChange={(e) => setShopForm({ ...shopForm, phone: e.target.value })}
                          placeholder="+1 (801) 555-0100"
                          className={inputClass}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={labelClass}>Address</label>
                        <input
                          type="text"
                          value={shopForm.address}
                          onChange={(e) => setShopForm({ ...shopForm, address: e.target.value })}
                          placeholder="123 Main St, Salt Lake City, UT 84101"
                          className={inputClass}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={labelClass}>Google Review URL</label>
                        <input
                          type="url"
                          value={shopForm.google_review_url}
                          onChange={(e) => setShopForm({ ...shopForm, google_review_url: e.target.value })}
                          placeholder="https://g.page/r/..."
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Timezone</label>
                        <select
                          value={shopForm.timezone}
                          onChange={(e) => setShopForm({ ...shopForm, timezone: e.target.value })}
                          className={inputClass}
                        >
                          <option value="America/Denver">Mountain Time</option>
                          <option value="America/Chicago">Central Time</option>
                          <option value="America/New_York">Eastern Time</option>
                          <option value="America/Los_Angeles">Pacific Time</option>
                          <option value="America/Phoenix">Arizona (MST no DST)</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end pt-2">
                      <button
                        type="submit"
                        disabled={submitting}
                        className="px-6 py-3 bg-black text-white text-sm font-medium rounded-full hover:bg-gray-900 disabled:opacity-50 transition-all"
                      >
                        {submitting ? 'Creating…' : 'Create Shop'}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Shop list */}
                {shops.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Existing Shops</h3>
                    {shops.map((shop) => (
                      <div key={shop.shop_id} className="bg-gray-100 rounded-2xl p-4 sm:p-6 border border-gray-200">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-semibold text-black">{shop.name}</h4>
                            {shop.address && <p className="text-sm text-gray-500 mt-1">{shop.address}</p>}
                            {shop.phone && <p className="text-xs text-gray-400 mt-0.5">{shop.phone}</p>}
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-gray-400">{shop.timezone}</p>
                            <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${shop.active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                              {shop.active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-gray-400 mt-3 font-mono break-all">ID: {shop.shop_id}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Users Tab ── */}
            {tab === 'users' && (
              <div className="space-y-6">
                {/* Invite user form */}
                <div className="bg-gray-100 rounded-3xl p-6 sm:p-8 border border-gray-200">
                  <h2 className="text-lg font-semibold text-black mb-2">Invite User</h2>
                  <p className="text-sm text-gray-500 mb-6">They'll receive an email to set their password.</p>
                  <form onSubmit={handleInviteUser} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className={labelClass}>Email *</label>
                        <input
                          type="email"
                          required
                          value={inviteForm.email}
                          onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                          placeholder="advisor@shop.com"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Full Name</label>
                        <input
                          type="text"
                          value={inviteForm.full_name}
                          onChange={(e) => setInviteForm({ ...inviteForm, full_name: e.target.value })}
                          placeholder="Jane Smith"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Role</label>
                        <select
                          value={inviteForm.role}
                          onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                          className={inputClass}
                        >
                          <option value="advisor">Advisor</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Assign to Shop</label>
                        <select
                          value={inviteForm.shop_id}
                          onChange={(e) => setInviteForm({ ...inviteForm, shop_id: e.target.value })}
                          className={inputClass}
                        >
                          <option value="">— Select shop —</option>
                          {shops.map((s) => (
                            <option key={s.shop_id} value={s.shop_id}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end pt-2">
                      <button
                        type="submit"
                        disabled={submitting}
                        className="px-6 py-3 bg-black text-white text-sm font-medium rounded-full hover:bg-gray-900 disabled:opacity-50 transition-all"
                      >
                        {submitting ? 'Sending…' : 'Send Invite'}
                      </button>
                    </div>
                  </form>
                </div>

                {/* User list */}
                {users.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">All Users</h3>
                    {users.map((user) => {
                      const userShop = shops.find((s) => s.shop_id === user.shop_id);
                      return (
                        <div key={user.user_id} className="bg-gray-100 rounded-2xl p-4 sm:p-5 border border-gray-200">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-semibold text-black text-sm">{user.full_name || '(No name)'}</h4>
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${user.role === 'admin' ? 'bg-black text-white' : 'bg-gray-200 text-gray-700'}`}>
                                  {user.role}
                                </span>
                                {!user.active && (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                                    Deactivated
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 mt-1">{user.email}</p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                Shop: {userShop?.name || '(None assigned)'}
                              </p>
                            </div>
                            <div className="flex flex-col gap-2 shrink-0">
                              <select
                                value={user.shop_id || ''}
                                onChange={(e) => handleUpdateUserShop(user.user_id, e.target.value)}
                                className="px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-700 focus:ring-2 focus:ring-black outline-none"
                              >
                                <option value="">No shop</option>
                                {shops.map((s) => (
                                  <option key={s.shop_id} value={s.shop_id}>{s.name}</option>
                                ))}
                              </select>
                              {user.user_id !== userProfile?.user_id && (
                                <>
                                  <button
                                    onClick={() => handleToggleUserActive(user)}
                                    className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all ${
                                      user.active
                                        ? 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                                        : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
                                    }`}
                                  >
                                    {user.active ? 'Deactivate' : 'Activate'}
                                  </button>
                                  {!user.active && (
                                    <button
                                      onClick={() => handleDeleteUser(user)}
                                      className="px-3 py-1.5 text-xs font-medium rounded-full transition-all bg-gray-900 text-white hover:bg-black border border-gray-900"
                                    >
                                      Delete
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AdminPanel;
