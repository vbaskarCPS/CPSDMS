// src/pages/Management/components/ContractorJobs.tsx
import React from 'react';
import { MapPin, Check, X, DollarSign, Clock } from 'lucide-react';
import { MasterBooking, SessionTransaction } from '../../../types';

interface ContractorJobsProps {
  bookings: MasterBooking[];
  financialStore: SessionTransaction[];
}

const ContractorJobs: React.FC<ContractorJobsProps> = ({
  bookings,
  financialStore,
}) => {
  if (bookings.length === 0 && financialStore.length === 0) {
    return (
      <div className="text-center text-gray-500 text-xs py-2">
        No jobs assigned.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* PENDING JOBS */}
      {bookings.filter((b) => b.Status !== 'completed').length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">
            Pending / Assigned
          </h4>
          <div className="space-y-2">
            {bookings
              .filter((b) => b.Status !== 'completed')
              .map((job) => (
                <div
                  key={job['Booking ID']}
                  className="bg-gray-900/50 p-2 rounded border border-gray-700 flex justify-between items-center"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-gray-300 truncate">
                      {job['First Name']} {job['Last Name']}
                    </div>
                    <div className="text-[10px] text-gray-500 flex items-center gap-1">
                      <MapPin size={8} /> {job['Full Address']}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {job.Prepaid === 'x' && (
                      <span className="text-[9px] bg-green-900/30 text-green-400 px-1 rounded">
                        PP
                      </span>
                    )}
                    <span className="text-xs font-mono text-gray-400">
                      {job.Price}
                    </span>
                    <Clock size={12} className="text-yellow-500" />
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* COMPLETED JOBS */}
      {financialStore.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">
            Completed Today
          </h4>
          <div className="space-y-2">
            {financialStore.map((tx) => (
              <div
                key={tx.id}
                className="bg-gray-900/50 p-2 rounded border border-green-900/30 flex justify-between items-center"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-gray-300 truncate">
                    {tx.customerName}
                  </div>
                  <div className="text-[10px] text-gray-500 flex items-center gap-1">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        tx.type === 'Production'
                          ? 'bg-blue-500'
                          : 'bg-purple-500'
                      }`}
                    />
                    {tx.type}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-mono text-green-400">
                    ${tx.price}
                  </div>
                  <div className="text-[9px] text-gray-500">
                    {tx.paymentMethod}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ContractorJobs;
