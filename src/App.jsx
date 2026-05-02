import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Login from './pages/Login.jsx';
import Forecast from './pages/Forecast.jsx';
import Themes from './pages/Themes.jsx';
import Library from './pages/Library.jsx';
import Suggestions from './pages/Suggestions.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Forecast />} />
        <Route path="/themes" element={<Themes />} />
        <Route path="/library" element={<Library />} />
        <Route path="/suggestions" element={<Suggestions />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center space-y-4">
        <h1 className="font-serif text-3xl text-umc-900">Page not found</h1>
        <a href="/" className="btn-primary inline-block">
          Back to forecast
        </a>
      </div>
    </div>
  );
}
