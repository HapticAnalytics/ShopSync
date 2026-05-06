import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import CustomerPortal from './components/CustomerPortal';
import AdvisorDashboard from './components/AdvisorDashboard';
import Login from './components/Login';
import AdminPanel from './components/AdminPanel';

const LoadingScreen = () => (
  <div className="min-h-screen bg-white flex items-center justify-center">
    <div className="w-10 h-10 border-2 border-gray-200 border-t-black rounded-full animate-spin"></div>
  </div>
);

const ProtectedRoute = ({ children, requireAdmin = false }) => {
  const { session, userProfile, loading } = useAuth();

  if (loading || (session && !userProfile)) return <LoadingScreen />;
  if (!session) return <Navigate to="/login" replace />;
  if (requireAdmin && userProfile?.role !== 'admin') return <Navigate to="/advisor" replace />;

  return children;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/track/:uniqueLink" element={<CustomerPortal />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/advisor"
            element={
              <ProtectedRoute>
                <AdvisorDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute requireAdmin>
                <AdminPanel />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/advisor" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
