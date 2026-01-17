// src/pages/HomePage.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, AlertCircle, ShieldCheck, Lock } from 'lucide-react';
import { sessionService } from '../lib/sessionService';
import { commandCenterService, isSuperAdminCredentials } from '../lib/commandCenterService';
import { setStorageItem } from '../lib/localStorage';

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  // --- SESSION FINALIZED STATE (special error display) ---
  const [isSessionFinalized, setIsSessionFinalized] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSessionFinalized(false);
    setLoading(true);

    try {
      // 1. Check Super Admin (Administrator/cps26records)
      if (isSuperAdminCredentials(username, password)) {
        // Clear any existing CC context
        commandCenterService.clearCurrentCommandCenter();
        commandCenterService.setSuperAdminMode(false);
        navigate('/super-admin');
        return;
      }

      // 2. Check Command Center login
      const cc = await commandCenterService.authenticateCommandCenter(username, password);
      if (cc) {
        commandCenterService.setCurrentCommandCenter(cc);
        commandCenterService.setSuperAdminMode(false);
        navigate('/admin');
        return;
      }

      // 3. Check Route Manager
      // Note: authenticateRM will set the CC context automatically based on the user's CC
      const rm = await sessionService.authenticateRM(username, password);
      if (rm) {
        setStorageItem('current_user', rm);
        navigate('/rm-logbook');
        return;
      }

      // 4. Check Worker
      // Note: authenticateWorker will set the CC context automatically based on the user's CC
      const worker = await sessionService.authenticateWorker(username, password);
      if (worker) {
        setStorageItem('current_user', worker);
        // Ensure session exists in cloud
        await sessionService.startLogsheetSession(worker.contractorId);
        navigate('/logsheet');
        return;
      }

      throw new Error('Invalid credentials. Please try again.');
    } catch (err) {
      // --- HANDLE SESSION_FINALIZED ERROR ---
      if (err instanceof Error && err.message === 'SESSION_FINALIZED') {
        setIsSessionFinalized(true);
      } else {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
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
            {/* Standard Error */}
            {error && (
              <div className="mb-4 p-3 bg-red-900/30 text-red-300 border border-red-700 rounded-md text-sm flex items-center gap-2">
                <AlertCircle size={16} /> {error}
              </div>
            )}

            {/* Session Finalized Special Message */}
            {isSessionFinalized && (
              <div className="mb-4 p-4 bg-green-900/20 border border-green-700 rounded-lg">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full bg-green-900/50 border border-green-600 flex items-center justify-center flex-shrink-0">
                    <Lock size={18} className="text-green-400" />
                  </div>
                  <div>
                    <h3 className="text-green-300 font-bold text-sm">Session Finalized</h3>
                    <p className="text-green-400/80 text-xs">Your day is complete!</p>
                  </div>
                </div>
                <p className="text-gray-400 text-xs mt-2">
                  Your payout has been processed and your logsheet is closed for today. 
                  Great work! See you next time.
                </p>
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