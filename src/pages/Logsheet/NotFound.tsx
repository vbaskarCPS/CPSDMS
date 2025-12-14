// src/pages/Logsheet/NotFound.tsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Home } from 'lucide-react';

const NotFound: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 text-center">
      <AlertTriangle size={64} className="text-yellow-500 mb-6" />
      <h1 className="text-3xl font-bold text-white mb-2">Page Not Found</h1>
      <p className="text-gray-400 mb-8">
        The page you are looking for does not exist or has been moved.
      </p>
      <button 
        onClick={() => navigate('/')} 
        className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-bold flex items-center gap-2 transition-colors border border-gray-700"
      >
        <Home size={20} /> Back to Home
      </button>
    </div>
  );
};

export default NotFound;