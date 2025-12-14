// src/pages/Logsheet/components/LogsheetJobCard.tsx
import React from 'react';
import { MapPin, ChevronRight, Check, FileText, Phone, Mail, AlertCircle } from 'lucide-react';
import { MasterBooking } from '../../../types';

interface LogsheetJobCardProps {
  job: MasterBooking;
  onClick: () => void;
}

const LogsheetJobCard: React.FC<LogsheetJobCardProps> = ({ job, onClick }) => {
  const isCompleted = job.Completed === 'x';
  const isPrepaid = job.Prepaid === 'x';
  
  // Data Extraction
  const notes = job['Log Sheet Notes']; 
  const propertyType = job['FO/BO/FP'] || 'FP'; 
  const phone = job['Home Phone'] || job['Cell Phone'];
  const email = job['Email Address'];
  
  // Upsell Info
  const isContract = (job as any).isContract;
  const contractTitle = (job as any)['Contract Title'];
  
  // Breakdown Data
  const breakdown = (job as any)['Payment Breakdown'];
  
  // --- COLOR LOGIC ---
  let borderColor = 'border-gray-700';
  let bgColor = 'bg-gray-800';
  
  if (isCompleted) {
      if ((job as any).isUpgrade) {
          borderColor = 'border-orange-600';
          bgColor = 'bg-orange-900/20';
      } else if ((job as any).isAddOn) {
          borderColor = 'border-blue-600';
          bgColor = 'bg-blue-900/20';
      } else if ((job as any).isNewSale) {
          borderColor = 'border-yellow-600';
          bgColor = 'bg-yellow-900/20';
      } else {
          borderColor = 'border-green-600';
          bgColor = 'bg-green-900/20';
      }
  }

  const displayNotes = isContract && contractTitle ? contractTitle : notes;

  return (
    <div 
      onClick={onClick}
      className={`relative p-4 rounded-xl border shadow-sm transition-all active:scale-[0.98] flex items-center justify-between cursor-pointer mb-2 ${bgColor} ${borderColor} ${isCompleted ? '' : 'hover:border-gray-600'}`}
    >
      <div className="flex-1 min-w-0 pr-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="bg-gray-700 text-gray-300 text-[10px] font-mono px-1.5 py-0.5 rounded border border-gray-600">{job['Route Number']}</span>
          <h3 className="font-bold text-gray-100 text-sm truncate">{job['First Name']} {job['Last Name']}</h3>
        </div>

        <div className="flex items-center gap-1 text-gray-400 text-xs mb-1">
           <MapPin size={10} className="shrink-0" />
           <span className="truncate">{job['Full Address']}</span>
        </div>

        <div className="flex flex-col gap-0.5 mb-1.5">
            {phone && <div className="flex items-center gap-1 text-gray-500 text-[10px]"><Phone size={10} className="shrink-0"/> <span>{phone}</span></div>}
            {email && <div className="flex items-center gap-1 text-gray-500 text-[10px]"><Mail size={10} className="shrink-0"/> <span className="truncate max-w-[180px]">{email}</span></div>}
        </div>

        {displayNotes && (
            <div className={`text-[10px] rounded p-1.5 flex items-start gap-2 mt-1 leading-tight ${isCompleted ? 'text-gray-300 italic' : 'bg-yellow-900/20 border border-yellow-700/30 text-yellow-200'}`}>
                {isCompleted ? <Check size={10}/> : <FileText size={10} className="shrink-0 mt-0.5"/>}
                {displayNotes}
            </div>
        )}
      </div>

      <div className="text-right shrink-0 flex flex-col items-end justify-center gap-1">
        <span className="text-[9px] font-bold bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded border border-gray-600 uppercase">{propertyType}</span>
        
        <div className="flex flex-col items-end">
            <div className="flex items-center gap-1">
               {isPrepaid && !breakdown && <span className="text-[9px] bg-green-900/30 text-green-400 px-1.5 py-0.5 rounded border border-green-800 font-bold">PP</span>}
               <span className={`font-mono font-bold text-lg ${isCompleted ? 'text-gray-300' : (isPrepaid ? 'text-green-300' : 'text-white')}`}>{job.Price}</span>
            </div>
            {/* DISPLAY BREAKDOWN if available */}
            {breakdown && (
                <div className="text-[9px] text-gray-400 font-mono text-right leading-tight">
                    {Object.entries(breakdown).map(([k, v]) => (
                        <div key={k}>{k}: ${Number(v).toFixed(0)}</div>
                    ))}
                </div>
            )}
        </div>
        
        {isCompleted ? <div className="flex items-center gap-1 text-green-500 text-xs font-bold mt-1"><Check size={14} strokeWidth={3} /> DONE</div> : <ChevronRight size={16} className="text-gray-500 mt-1" />}
      </div>
    </div>
  );
};

export default LogsheetJobCard;