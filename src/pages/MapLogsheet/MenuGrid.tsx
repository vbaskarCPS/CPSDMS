// src/pages/MapLogsheet/MenuGrid.tsx
//
// The map logsheet's menu as a 3 x 3 grid of tiles (instead of a list):
//
//   Logsheet      | Add Sale / Contract | Today's Stats
//   Gallery       | Load House / Street | PCL Outreach
//   Contacts      | My Account          | Log out
//
// Two tiles open a small "choose one" pop-up:
//   - Add Sale / Contract → "Add sale (not on the map)" or "Contract / upsell"
//     (straight to Add sale when the worker doesn't have upsells).
//   - Load House / Street → "Add missing house" or "Load houses on a street".
// Tiles that don't apply right now stay in place, greyed out, so the grid
// never shifts. My Account opens the worker's own settings (PIN, phones, email).

import React, { useState } from 'react';
import {
  X, ListChecks, Receipt, BarChart3, Images, MapPinned, MessageSquare, Phone,
  UserCog, LogOut, Plus, FileText, Home, Route,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface MenuGridProps {
  workerName?: string;
  contractorId?: string;
  routeCodes: string[];
  pendingCount: number;
  pclToText: number;
  canAddSale: boolean;        // session + routes exist
  upsellsEnabled: boolean;
  hasPcl: boolean;
  onClose: () => void;
  onLogsheet: () => void;
  onAddSale: () => void;
  onContract: () => void;
  onStats: () => void;
  onGallery: () => void;
  onAddHouse: () => void;
  onLoadStreet: () => void;
  onPcl: () => void;
  onContacts: () => void;
  onAccount: () => void;
  onLogout: () => void;
}

interface TileProps {
  icon: LucideIcon;
  label: string;
  iconClass: string;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string | null;
  badgeClass?: string;
  tag?: string;               // small corner tag, e.g. "Soon"
  danger?: boolean;
}

const Tile: React.FC<TileProps> = ({ icon: Icon, label, iconClass, onClick, disabled, badge, badgeClass, tag, danger }) => (
  <button
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    className={`relative aspect-square rounded-2xl flex flex-col items-center justify-center gap-2 px-1 text-center
      ${danger ? 'bg-gray-800 border border-red-900/60' : 'bg-gray-800'}
      ${disabled ? 'opacity-35' : 'active:bg-gray-700'}`}
  >
    <Icon size={28} className={iconClass} />
    <span className={`text-[12px] font-bold leading-tight ${danger ? 'text-red-400' : 'text-white'}`}>{label}</span>
    {badge && (
      <span className={`absolute top-1.5 right-1.5 rounded-full px-1.5 text-[10px] font-bold ${badgeClass || 'bg-yellow-500 text-black'}`}>
        {badge}
      </span>
    )}
    {tag && (
      <span className="absolute top-1.5 right-1.5 rounded-full px-1.5 text-[9px] font-bold bg-gray-600 text-gray-200 uppercase">
        {tag}
      </span>
    )}
  </button>
);

type Choice = { icon: LucideIcon; label: string; className: string; onClick: () => void };

const ChoicePopup: React.FC<{ title: string; choices: Choice[]; onClose: () => void }> = ({ title, choices, onClose }) => (
  <div className="absolute inset-0 z-40 flex items-end" onClick={onClose}>
    <div className="absolute inset-0 bg-black/40" />
    <div
      className="relative w-full bg-gray-900 border-t border-gray-700 rounded-t-2xl shadow-2xl p-3 pb-5 space-y-2"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-sm font-bold text-white">{title}</span>
        <button onClick={onClose} className="p-1 text-gray-400"><X size={20} /></button>
      </div>
      {choices.map(c => (
        <button
          key={c.label}
          onClick={c.onClick}
          className={`w-full py-4 rounded-xl font-bold text-sm flex items-center gap-3 px-4 ${c.className}`}
        >
          <c.icon size={20} /> {c.label}
        </button>
      ))}
    </div>
  </div>
);

const MenuGrid: React.FC<MenuGridProps> = (p) => {
  const [choose, setChoose] = useState<'sale' | 'load' | null>(null);

  const openSale = () => {
    if (!p.upsellsEnabled) { p.onAddSale(); return; }   // nothing to choose between
    setChoose('sale');
  };

  return (
    <div className="absolute inset-0 z-30" onClick={p.onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="absolute inset-x-0 bottom-0 bg-gray-900 border-t border-gray-700 rounded-t-2xl shadow-2xl p-3 pb-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-1 pb-3">
          <span className="text-xs text-gray-400">
            {p.workerName} {p.contractorId && <span className="font-mono bg-gray-800 border border-gray-700 px-1 rounded">#{p.contractorId}</span>}
            {p.routeCodes.length > 0 && <span className="ml-2 font-mono text-gray-500">{p.routeCodes.join(' ')}</span>}
          </span>
          <button onClick={p.onClose} className="p-1 text-gray-400"><X size={20} /></button>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <Tile icon={ListChecks} label="Logsheet" iconClass="text-blue-300" onClick={p.onLogsheet}
            badge={p.pendingCount > 0 ? String(p.pendingCount) : null} />
          <Tile icon={Receipt} label={p.upsellsEnabled ? 'Add Sale / Contract' : 'Add Sale'} iconClass="text-sky-300"
            onClick={openSale} disabled={!p.canAddSale && !p.upsellsEnabled} />
          <Tile icon={BarChart3} label="Today's Stats" iconClass="text-green-300" onClick={p.onStats} />

          <Tile icon={Images} label="Gallery" iconClass="text-yellow-300" onClick={p.onGallery} />
          <Tile icon={MapPinned} label="Load House / Street" iconClass="text-yellow-400" onClick={() => setChoose('load')} />
          <Tile icon={MessageSquare} label="PCL Outreach" iconClass="text-teal-300" onClick={p.onPcl}
            disabled={!p.hasPcl} badge={p.pclToText > 0 ? String(p.pclToText) : null} badgeClass="bg-teal-600 text-white" />

          <Tile icon={Phone} label="Contacts" iconClass="text-emerald-300" onClick={p.onContacts} />
          <Tile icon={UserCog} label="My Account" iconClass="text-amber-300" onClick={p.onAccount} />
          <Tile icon={LogOut} label="Log out" iconClass="text-red-400" onClick={p.onLogout} danger />
        </div>
      </div>

      {choose === 'sale' && (
        <ChoicePopup
          title="Add Sale / Contract"
          onClose={() => setChoose(null)}
          choices={[
            ...(p.canAddSale ? [{ icon: Plus, label: 'Add sale (not on the map)', className: 'bg-cps-blue text-white active:bg-blue-600', onClick: () => { setChoose(null); p.onAddSale(); } }] : []),
            ...(p.upsellsEnabled ? [{ icon: FileText, label: 'Contract / upsell', className: 'bg-purple-700 text-white active:bg-purple-600', onClick: () => { setChoose(null); p.onContract(); } }] : []),
          ]}
        />
      )}
      {choose === 'load' && (
        <ChoicePopup
          title="Load House / Street"
          onClose={() => setChoose(null)}
          choices={[
            { icon: Home, label: 'Add missing house', className: 'bg-gray-800 text-white active:bg-gray-700', onClick: () => { setChoose(null); p.onAddHouse(); } },
            { icon: Route, label: 'Load houses on a street', className: 'bg-gray-800 text-white active:bg-gray-700', onClick: () => { setChoose(null); p.onLoadStreet(); } },
          ]}
        />
      )}
    </div>
  );
};

export default MenuGrid;
