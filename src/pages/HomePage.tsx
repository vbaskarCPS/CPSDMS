// src/pages/HomePage.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, AlertCircle, Lock, GraduationCap } from 'lucide-react';
import { sessionService } from '../lib/sessionService';
import { commandCenterService, isSuperAdminCredentials } from '../lib/commandCenterService';
import { setStorageItem } from '../lib/localStorage';
import { isTrainingCredentials, TRAINING_WORKER } from '../lib/trainingData';
import { trainingService } from '../lib/trainingService';

// Logo URL (same as email templates)
const LOGO_URL = 'https://mipvcafqrmwxnoqmicxh.supabase.co/storage/v1/object/public/logos/logo-white.png';

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSessionFinalized, setIsSessionFinalized] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSessionFinalized(false);
    setLoading(true);

    try {
      // 0. Check Training Mode (Training/training)
      if (isTrainingCredentials(username, password)) {
        trainingService.enableTrainingMode();
        setStorageItem('current_user', TRAINING_WORKER);
        navigate('/logsheet');
        return;
      }

      // 1. Check Super Admin (Administrator/cps26records)
      if (isSuperAdminCredentials(username, password)) {
        trainingService.disableTrainingMode(); // Ensure training mode is off
        commandCenterService.clearCurrentCommandCenter();
        commandCenterService.setSuperAdminMode(false);
        navigate('/super-admin');
        return;
      }

      // 2. Check Command Center login
      const cc = await commandCenterService.authenticateCommandCenter(username, password);
      if (cc) {
        trainingService.disableTrainingMode();
        commandCenterService.setCurrentCommandCenter(cc);
        commandCenterService.setSuperAdminMode(false);
        navigate('/admin');
        return;
      }

      // 3. Check Route Manager
      const rm = await sessionService.authenticateRM(username, password);
      if (rm) {
        trainingService.disableTrainingMode();
        setStorageItem('current_user', rm);
        navigate('/rm-logbook');
        return;
      }

      // 4. Check Worker
      const worker = await sessionService.authenticateWorker(username, password);
      if (worker) {
        trainingService.disableTrainingMode();
        setStorageItem('current_user', worker);
        await sessionService.startLogsheetSession(worker.contractorId);
        navigate('/logsheet');
        return;
      }

      throw new Error('Invalid credentials. Please try again.');
    } catch (err) {
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
          <div className="mb-4">
            <img 
              src={LOGO_URL} 
              alt="Company Logo" 
              className="h-24 mx-auto"
            />
          </div>
          <h1 className="text-3xl font-extrabold text-white">
            Digital Management System
          </h1>
          <p className="text-sm text-gray-400">Universal Login</p>
        </div>

        <div className="bg-black rounded-lg shadow-lg p-8 border-2 border-red-600">
          <form onSubmit={handleLogin}>
            {error && (
              <div className="mb-4 p-3 bg-red-900/50 text-red-200 border border-red-500 rounded-md text-sm flex items-center gap-2">
                <AlertCircle size={16} /> {error}
              </div>
            )}

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
              <label className="block text-sm font-medium text-white mb-2">
                Username / ID
              </label>
              <div className="relative">
                <KeyRound
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-red-400"
                  size={20}
                />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 bg-black border border-red-600 rounded-md text-white placeholder-gray-500 focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400"
                  placeholder="Enter Username or Contractor ID"
                  required
                />
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-white mb-2">
                Password
              </label>
              <div className="relative">
                <KeyRound
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-red-400"
                  size={20}
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 bg-black border border-red-600 rounded-md text-white placeholder-gray-500 focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400"
                  placeholder="Your First Name or Password"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full text-white py-2 px-4 rounded-md bg-red-600 hover:bg-red-500 transition-colors disabled:opacity-50 font-bold shadow-lg"
            >
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>

          {/* Training Mode Hint */}
          <div className="mt-6 pt-4 border-t border-red-900">
            <div className="flex items-center gap-2 text-gray-400 text-xs">
              <GraduationCap size={14} className="text-red-400" />
              <span>New? Try training mode: <code className="bg-red-900/50 px-1.5 py-0.5 rounded text-white border border-red-700">Training / training</code></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HomePage;