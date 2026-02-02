// src/components/EtransferProtocolModal.tsx
import React from 'react';
import { X, Mail, CheckCircle } from 'lucide-react';

interface EtransferProtocolModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerAddress: string;
  contractorFirstName: string;
  contractorLastName: string;
}

const EtransferProtocolModal: React.FC<EtransferProtocolModalProps> = ({
  isOpen,
  onClose,
  customerAddress,
  contractorFirstName,
  contractorLastName,
}) => {
  if (!isOpen) return null;

  // Format contractor name as "FirstName L."
  const contractorInitial = contractorLastName ? contractorLastName.charAt(0).toUpperCase() + '.' : '';
  const contractorDisplay = `${contractorFirstName} ${contractorInitial}`.trim();

  // Memo example
  const memoExample = `${customerAddress}${customerAddress && contractorDisplay ? ', ' : ''}${contractorDisplay}`;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-fade-in">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-gray-700 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Mail className="text-cps-blue" size={20} />
            <h2 className="text-lg font-bold text-white">E-Transfer Protocol</h2>
          </div>
          <button 
            onClick={onClose} 
            className="p-1 hover:bg-gray-800 rounded-full transition-colors"
          >
            <X className="text-gray-400" size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Send To */}
          <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
            <p className="text-[10px] font-bold text-blue-400 uppercase mb-1">Send To</p>
            <p className="text-white font-mono text-lg font-bold">accounting@property-stars.com</p>
          </div>

          {/* Memo Instructions */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Customer Must Include in Memo</p>
            <div className="bg-gray-900 rounded p-3 border border-gray-600">
              <p className="text-yellow-300 font-medium text-sm">
                {memoExample || 'Street address, Contractor first name & initial'}
              </p>
            </div>
            <p className="text-gray-500 text-[10px] mt-2 italic">
              Example: Street address, contractor first name & initial of last name
            </p>
          </div>

          {/* Checklist */}
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-green-900/30 border border-green-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                <CheckCircle size={12} className="text-green-400" />
              </div>
              <div>
                <p className="text-gray-200 text-sm font-medium">No password required</p>
                <p className="text-gray-500 text-xs">(If prompted for one, use: <span className="text-yellow-400 font-mono">spring</span>)</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-green-900/30 border border-green-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                <CheckCircle size={12} className="text-green-400" />
              </div>
              <p className="text-gray-200 text-sm font-medium">Customer must show confirmation that e-transfer has been sent</p>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-green-900/30 border border-green-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                <CheckCircle size={12} className="text-green-400" />
              </div>
              <p className="text-gray-200 text-sm font-medium">Record the email address the sender's bank account is associated with</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="w-full py-3 bg-cps-blue hover:bg-blue-600 text-white rounded-lg font-bold transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};

export default EtransferProtocolModal;