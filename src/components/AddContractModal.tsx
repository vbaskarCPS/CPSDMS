// src/components/AddContractModal.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  ArrowLeft,
  Check,
  DollarSign,
  AlertCircle,
  User,
  Lock,
  Droplets,
  Mail,
  Plus,
} from 'lucide-react';
import { getStorageItem } from '../lib/localStorage';
import { MasterBooking, Worker, SessionTransaction } from '../types';
import { sessionService } from '../lib/sessionService';
import CreditCardModal from './CreditCardModal';

const CONTRACT_RECIPES = [
  {
    id: 'star_plan_pro',
    name: 'Star Plan Pro',
    type: 'Upgrade',
    basePrice: 150,
  },
  {
    id: 'lawn_rejuv',
    name: 'Lawn Rejuvenation',
    type: 'Upgrade',
    basePrice: 200,
  },
  { id: 'dethatch', name: 'Dethatching', type: 'Add-On', basePrice: 100 },
  {
    id: 'grub',
    name: 'Grub Control',
    type: 'Add-On',
    basePrice: 50,
    questions: [{ id: 'timing', label: 'Timing', options: ['Spring', 'Fall'] }],
  },
];

interface AddContractModalProps {
  onClose: () => void;
}

const AddContractModal: React.FC<AddContractModalProps> = ({ onClose }) => {
  const [step, setStep] = useState('SELECT_CONTRACT');
  const [selectedRecipe, setSelectedRecipe] = useState<any>(null);
  const [selectedBooking, setSelectedBooking] = useState<MasterBooking | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<any>({
    firstName: '',
    lastName: '',
    address: '',
    phone: '',
    email: '',
    routeNumber: '',
    notes: '',
    propertyType: 'FP',
  });
  const [paymentInfo, setPaymentInfo] = useState({
    amount: '0.00',
    method: 'Cash',
  });

  const [worker, setWorker] = useState<Worker | null>(null);
  const [availableClients, setAvailableClients] = useState<MasterBooking[]>([]);

  // Payment
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [isCreditPaid, setIsCreditPaid] = useState(false);
  const [ccData, setCcData] = useState<any>(null);

  useEffect(() => {
    const init = async () => {
      const w = getStorageItem<Worker | null>('current_user', null);
      if (!w) {
        setError('User not found.');
        return;
      }
      setWorker(w);

      const activeSession = await sessionService.getActiveLogsheetSession(
        w.contractorId
      );
      if (activeSession) {
        // Filter financials to find eligible clients for upgrades
        const clients = activeSession.financialStore.map(
          (tx) =>
            ({
              'Booking ID': tx.jobId,
              'First Name': tx.customerName.split(' ')[0],
              'Last Name': tx.customerName.split(' ').slice(1).join(' '),
              'Full Address': tx.address,
              'Route Number': tx.routeCode,
              Price: tx.displayPrice || tx.price.toString(),
            } as MasterBooking)
        );
        setAvailableClients(clients);
      }
    };
    init();
  }, []);

  const handleSubmit = async () => {
    if (!selectedRecipe || !worker) return;
    setError(null);

    try {
      const isUpgrade = selectedRecipe.type === 'Upgrade';
      const collectionAmount = parseFloat(paymentInfo.amount);
      const finalTotal = collectionAmount; // Simplified for demo

      const tx: SessionTransaction = {
        id: `tx_${Date.now()}`,
        jobId: selectedBooking
          ? selectedBooking['Booking ID']
          : `NEW-${Date.now()}`,
        timestamp: new Date().toISOString(),
        customerId: 'CLIENT',
        customerName: `${formData.firstName} ${formData.lastName}`,
        address: formData.address,
        workerId: worker.contractorId,
        workerName: worker.firstName,
        routeManagerName: 'RM',
        routeCode: formData.routeNumber,
        type: selectedRecipe.type,
        price: finalTotal,
        displayPrice: selectedRecipe.name,
        paymentMethod: paymentInfo.method,
        isPaid: true,
        items: [{ name: selectedRecipe.name, price: finalTotal }],
        itemDescription: formData.notes,
        region: 'West',
        seasonId: 'west-aeration',
        ccFullNumber: ccData?.number,
        ccExpiry: ccData?.expiry,
        ccCVC: ccData?.cvc,
      } as any;

      await sessionService.completeJob(tx, tx.jobId, worker.contractorId);

      // Update stats
      const session = await sessionService.getActiveLogsheetSession(
        worker.contractorId
      );
      if (session) {
        const newStats = sessionService.recalculateStats(
          session.financialStore,
          5
        );
        await sessionService.updateLogsheetSession(session.id, {
          stats: newStats,
        });
      }

      onClose();
    } catch (err) {
      console.error(err);
      setError('Failed to process sale.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-2xl h-[80vh] flex flex-col">
        {/* Simplified Header */}
        <div className="p-4 border-b border-gray-700 flex justify-between">
          <h2 className="text-white font-bold">
            {step === 'SELECT_CONTRACT'
              ? 'Select Contract'
              : selectedRecipe?.name}
          </h2>
          <button onClick={onClose}>
            <X className="text-gray-400" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          {step === 'SELECT_CONTRACT' && (
            <div className="grid grid-cols-2 gap-3">
              {CONTRACT_RECIPES.map((recipe) => (
                <button
                  key={recipe.id}
                  onClick={() => {
                    setSelectedRecipe(recipe);
                    setStep('ENTER_DETAILS');
                  }}
                  className="bg-gray-800 p-4 rounded text-left hover:border-blue-500 border border-transparent"
                >
                  <h3 className="font-bold text-white">{recipe.name}</h3>
                  <span className="text-xs text-blue-300">{recipe.type}</span>
                </button>
              ))}
            </div>
          )}

          {step === 'ENTER_DETAILS' && (
            <div className="space-y-4">
              <input
                placeholder="First Name"
                className="w-full bg-gray-800 p-2 text-white border border-gray-700 rounded"
                onChange={(e) =>
                  setFormData({ ...formData, firstName: e.target.value })
                }
              />
              <input
                placeholder="Last Name"
                className="w-full bg-gray-800 p-2 text-white border border-gray-700 rounded"
                onChange={(e) =>
                  setFormData({ ...formData, lastName: e.target.value })
                }
              />
              <div className="flex gap-2">
                <input
                  placeholder="Amount"
                  className="flex-1 bg-gray-800 p-2 text-white border border-gray-700 rounded"
                  value={paymentInfo.amount}
                  onChange={(e) =>
                    setPaymentInfo({ ...paymentInfo, amount: e.target.value })
                  }
                />
                <select
                  className="bg-gray-800 text-white p-2 border border-gray-700 rounded"
                  onChange={(e) => {
                    setPaymentInfo({ ...paymentInfo, method: e.target.value });
                    if (e.target.value === 'Credit Card')
                      setShowCreditModal(true);
                  }}
                >
                  <option>Cash</option>
                  <option>Credit Card</option>
                </select>
              </div>
              {isCreditPaid && (
                <div className="text-green-400 text-sm font-bold">
                  Credit Card Approved
                </div>
              )}
            </div>
          )}
        </div>

        {step === 'ENTER_DETAILS' && (
          <div className="p-4 border-t border-gray-700 flex justify-end">
            <button
              onClick={handleSubmit}
              className="bg-green-600 text-white px-6 py-2 rounded font-bold"
            >
              Complete Sale
            </button>
          </div>
        )}
      </div>
      {showCreditModal && (
        <CreditCardModal
          amount={paymentInfo.amount}
          clientName="Client"
          onClose={() => setShowCreditModal(false)}
          onProcess={(d) => {
            setIsCreditPaid(true);
            setCcData(d);
            setShowCreditModal(false);
          }}
        />
      )}
    </div>
  );
};

export default AddContractModal;
