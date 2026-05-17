// src/components/BamboraTransactionsModal.tsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  CreditCard,
  CheckCircle,
  XCircle,
  Loader,
  AlertTriangle,
  DollarSign,
  Inbox,
} from 'lucide-react';
import {
  getTransactionsForDate,
  BamboraTransaction,
} from '../lib/bamboraService';

interface BamboraTransactionsModalProps {
  sessionDate: string;
  onClose: () => void;
}

type FilterType = 'all' | 'approved' | 'declined' | 'processing' | 'error';

const BamboraTransactionsModal: React.FC<BamboraTransactionsModalProps> = ({
  sessionDate,
  onClose,
}) => {
  const [transactions, setTransactions] = useState<BamboraTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // --- Load Transactions ---
  const loadTransactions = async (showSpinner = false) => {
    try {
      if (showSpinner) setLoading(true);
      setError(null);
      const data = await getTransactionsForDate(sessionDate);
      setTransactions(data);
    } catch (err: any) {
      console.error('Failed to load transactions:', err);
      setError(err?.message || 'Failed to load transactions.');
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  // --- Initial Load + Auto-refresh every 10s ---
  useEffect(() => {
    loadTransactions(true);
    intervalRef.current = setInterval(() => {
      loadTransactions(false);
    }, 10000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionDate]);

  // --- Filtered list ---
  const filteredTransactions = useMemo(() => {
    if (filter === 'all') return transactions;
    return transactions.filter((t) => t.status === filter);
  }, [transactions, filter]);

  // --- Stats ---
  const stats = useMemo(() => {
    const approved = transactions.filter((t) => t.status === 'approved');
    const declined = transactions.filter((t) => t.status === 'declined');
    const processing = transactions.filter((t) => t.status === 'processing');
    const errorCount = transactions.filter((t) => t.status === 'error');
    const approvedTotal = approved.reduce(
      (sum, t) => sum + parseFloat(t.amount || '0'),
      0
    );
    return {
      total: transactions.length,
      approved: approved.length,
      declined: declined.length,
      processing: processing.length,
      error: errorCount.length,
      approvedTotal,
    };
  }, [transactions]);

  // --- Format time as e.g. "2:47 PM" ---
  const formatTime = (iso: string): string => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return '';
    }
  };

  // --- Format the date pill ---
  const formatDatePill = (dateStr: string): string => {
    try {
      const [y, m, d] = dateStr.split('-');
      const dt = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
      return dt.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // --- Status visuals lookup ---
  const getStatusUI = (status: BamboraTransaction['status']) => {
    switch (status) {
      case 'approved':
        return {
          icon: <CheckCircle size={14} />,
          color: 'text-green-400',
          bg: 'bg-green-400/15',
          label: 'APPROVED',
          badgeBg: 'bg-green-400/10',
        };
      case 'declined':
        return {
          icon: <XCircle size={14} />,
          color: 'text-red-400',
          bg: 'bg-red-400/15',
          label: 'DECLINED',
          badgeBg: 'bg-red-400/10',
        };
      case 'processing':
        return {
          icon: <Loader size={14} className="animate-spin" />,
          color: 'text-yellow-400',
          bg: 'bg-yellow-400/15',
          label: 'PROCESSING',
          badgeBg: 'bg-yellow-400/10',
        };
      case 'error':
      default:
        return {
          icon: <AlertTriangle size={14} />,
          color: 'text-orange-400',
          bg: 'bg-orange-400/15',
          label: 'ERROR',
          badgeBg: 'bg-orange-400/10',
        };
    }
  };

  const filterPills: { id: FilterType; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: stats.total },
    { id: 'approved', label: 'Approved', count: stats.approved },
    { id: 'declined', label: 'Declined', count: stats.declined },
    { id: 'processing', label: 'Processing', count: stats.processing },
    { id: 'error', label: 'Error', count: stats.error },
  ];

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-gray-800 w-full max-w-2xl rounded-xl border border-gray-700 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <CreditCard className="text-cps-blue" size={20} />
            <h3 className="text-base font-bold text-white">Card Transactions</h3>
            <span className="text-[10px] text-gray-300 bg-gray-700 px-2 py-0.5 rounded-full font-medium">
              {formatDatePill(sessionDate)}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Stat Strip */}
        <div className="grid grid-cols-4 gap-px bg-gray-700 border-b border-gray-700">
          <div className="bg-gray-800 p-2 flex flex-col items-center">
            <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">
              Total
            </span>
            <div className="text-white font-bold text-lg">{stats.total}</div>
          </div>
          <div className="bg-gray-800 p-2 flex flex-col items-center">
            <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">
              Approved
            </span>
            <div className="text-green-400 font-bold text-lg">
              {stats.approved}
            </div>
          </div>
          <div className="bg-gray-800 p-2 flex flex-col items-center">
            <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">
              Declined
            </span>
            <div className="text-red-400 font-bold text-lg">
              {stats.declined}
            </div>
          </div>
          <div className="bg-gray-800 p-2 flex flex-col items-center">
            <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">
              $ Approved
            </span>
            <div className="flex items-center gap-0.5 text-green-400 font-bold text-lg">
              <DollarSign size={14} className="opacity-70" />
              {stats.approvedTotal.toFixed(0)}
            </div>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-gray-700">
          {filterPills.map((p) => (
            <button
              key={p.id}
              onClick={() => setFilter(p.id)}
              className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors ${
                filter === p.id
                  ? 'bg-cps-blue text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {p.label} <span className="opacity-70">({p.count})</span>
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar min-h-[200px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader className="animate-spin text-cps-blue" size={28} />
              <p className="text-gray-400 text-sm">Loading transactions…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 px-6 text-center">
              <AlertTriangle className="text-red-400" size={28} />
              <p className="text-red-300 text-sm">{error}</p>
              <button
                onClick={() => loadTransactions(true)}
                className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-md"
              >
                Retry
              </button>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Inbox className="text-gray-500" size={28} />
              <p className="text-gray-400 text-sm">
                {transactions.length === 0
                  ? 'No card transactions yet today.'
                  : 'No transactions match this filter.'}
              </p>
            </div>
          ) : (
            <div>
              {filteredTransactions.map((t) => {
                const ui = getStatusUI(t.status);
                const amountNum = parseFloat(t.amount || '0');
                return (
                  <div
                    key={t.idempotency_key}
                    className="flex items-center gap-3 px-5 py-3 border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors"
                  >
                    {/* Status Icon */}
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${ui.bg} ${ui.color}`}
                    >
                      {ui.icon}
                    </div>

                    {/* Name + meta */}
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-sm font-medium truncate">
                        {t.client_name || 'Unknown Client'}
                      </div>
                      <div className="text-gray-500 text-[11px] font-mono truncate">
                        {formatTime(t.created_at)} ·{' '}
                        {t.idempotency_key.slice(0, 8)}…
                      </div>
                    </div>

                    {/* Amount + Badge */}
                    <div className="text-right flex-shrink-0">
                      <div className={`text-sm font-bold ${ui.color}`}>
                        ${amountNum.toFixed(2)}
                      </div>
                      <div
                        className={`inline-block text-[9px] font-bold ${ui.color} ${ui.badgeBg} px-1.5 py-0.5 rounded-md mt-0.5`}
                      >
                        {ui.label}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-700 text-center">
          <p className="text-[10px] text-gray-500">
            Auto-refreshing every 10 seconds · Sorted newest first
          </p>
        </div>
      </div>
    </div>
  );
};

export default BamboraTransactionsModal;