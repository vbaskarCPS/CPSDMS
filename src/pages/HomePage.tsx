// src/pages/HomePage.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, AlertCircle, ShieldCheck } from 'lucide-react';
import { sessionService } from '../lib/sessionService';
import { setStorageItem } from '../lib/localStorage';

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 1. Check Admin
      if (username === 'admin' && password === 'admin') {
        navigate('/admin');
        return;
      }

      // 2. Check Route Manager
      const rm = await sessionService.authenticateRM(username, password);
      if (rm) {
        setStorageItem('current_user', rm); // Persist session locally
        navigate('/rm-logbook');
        return;
      }

      // 3. Check Worker
      const worker = await sessionService.authenticateWorker(
        username,
        password
      );
      if (worker) {
        setStorageItem('current_user', worker);
        // Ensure session exists in cloud
        await sessionService.startLogsheetSession(worker.contractorId);
        navigate('/logsheet');
        return;
      }

      throw new Error('Invalid credentials. Please try again.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-800 mb-4 border border-gray-700">
            <ShieldCheck className="h-8 w-8 text-cps-blue" />
          </div>
          <h1 className="text-2xl font-bold text-white">
            British Columbia Aeration DMS
          </h1>
          <p className="text-sm text-gray-400">Universal Login</p>
        </div>

        <div className="bg-gray-800 rounded-lg shadow-lg p-8 border border-gray-700">
          <form onSubmit={handleLogin}>
            {error && (
              <div className="mb-4 p-3 bg-red-900/30 text-red-300 border border-red-700 rounded-md text-sm flex items-center gap-2">
                <AlertCircle size={16} /> {error}
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Username / ID
              </label>
              <div className="relative">
                <KeyRound
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  size={20}
                />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 bg-gray-700/40 border border-gray-600/50 rounded-md text-gray-100 focus:outline-none focus:border-cps-blue focus:ring-1 focus:ring-cps-blue"
                  placeholder="Enter Username or Contractor ID"
                  required
                />
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <div className="relative">
                <KeyRound
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  size={20}
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 bg-gray-700/40 border border-gray-600/50 rounded-md text-gray-100 focus:outline-none focus:border-cps-blue focus:ring-1 focus:ring-cps-blue"
                  placeholder="Your First Name or Password"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full text-white py-2 px-4 rounded-md bg-cps-blue hover:bg-blue-600 transition-colors disabled:opacity-50 font-bold shadow-lg"
            >
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default HomePage;
