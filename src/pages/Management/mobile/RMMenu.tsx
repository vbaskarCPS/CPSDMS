// src/pages/Management/mobile/RMMenu.tsx
//
// The RM map's menu, shared by the phone (hamburger sheet) and desktop (grid
// button in the stats bar) so both offer the same six tiles:
//
//   Team (Manage Team, with the team lock inside) · Pins (drop pins + worker
//   driver stops) · Layers (map filters) · Card Txns · Asphalt · view switch ·
//   Dashboard (the new app's home)
//
// Stats and Team Battle aren't tiles: Stats opens from the header (phone) or
// the stats bar (desktop), and Team Battle is a section inside Stats.

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Users, MapPin, Layers, CreditCard, Shovel, Truck, Loader, Clock, CheckCircle2, History, ChevronRight, LayoutDashboard,
} from 'lucide-react';
import { Tile } from './PhoneSheet';
import type { RMPhoneShell } from './RMPhoneLayout';
import type { FilterVisibility, GeocodeProgress } from '../RMLogbook';

export type MenuSub = 'layers' | 'pins';

export const MenuTiles: React.FC<{
  shell: RMPhoneShell;
  pinMode: boolean;
  driverStopCount: number;
  /** Close the menu (before opening a modal from a tile). */
  onClose: () => void;
  onOpenSub: (s: MenuSub) => void;
  viewSwitch: { icon: LucideIcon; label: string; onClick: () => void } | null;
}> = ({ shell, pinMode, driverStopCount, onClose, onOpenSub, viewSwitch }) => (
  <div className="grid grid-cols-3 gap-2.5 pb-1">
    <Tile
      icon={Users} label="Team" iconClass="text-blue-300"
      onClick={() => { onClose(); shell.onOpenManageTeam(); }}
      badge={shell.isTeamLocked ? 'Locked' : null} badgeClass="bg-red-600 text-white"
    />
    <Tile
      icon={MapPin} label="Pins" iconClass="text-purple-300" active={pinMode}
      onClick={() => onOpenSub('pins')}
      badge={driverStopCount > 0 ? String(driverStopCount) : null} badgeClass="bg-teal-600 text-white"
    />
    <Tile icon={Layers} label="Layers" iconClass="text-sky-300" onClick={() => onOpenSub('layers')} />
    <Tile icon={CreditCard} label="Card Txns" iconClass="text-emerald-300" onClick={() => { onClose(); shell.onOpenTransactions(); }} />
    <Tile
      icon={Shovel} label="Asphalt" iconClass="text-amber-300" disabled={!shell.isSealing}
      onClick={() => { onClose(); shell.onOpenAsphalt(); }}
      badge={shell.isSealing && shell.unassignedAsphaltCount > 0 ? String(shell.unassignedAsphaltCount) : null}
      badgeClass="bg-amber-500 text-black"
    />
    {viewSwitch && (
      <Tile icon={viewSwitch.icon} label={viewSwitch.label} iconClass="text-gray-300" onClick={() => { onClose(); viewSwitch.onClick(); }} />
    )}
    {/* The manager dashboard (the new app's home, with Payouts, Days and everything else). */}
    <Tile icon={LayoutDashboard} label="Dashboard" iconClass="text-rose-300" onClick={() => { onClose(); window.location.assign('/app'); }} />
  </div>
);

export const LayerRow: React.FC<{
  icon: LucideIcon; label: string; on: boolean;
  progress: { current: number; total: number; done: boolean };
  onToggle: () => void;
}> = ({ icon: Icon, label, on, progress, onToggle }) => {
  const loading = !progress.done;
  return (
    <button
      onClick={loading ? undefined : onToggle}
      className={`w-full h-14 rounded-xl px-4 flex items-center gap-3 ${on && !loading ? 'bg-blue-600/25 ring-1 ring-blue-500' : 'bg-gray-800'} ${loading ? 'opacity-60' : ''}`}
    >
      <Icon size={18} className={on ? 'text-blue-300' : 'text-gray-400'} />
      <span className="text-sm font-bold text-white flex-1 text-left">{label}</span>
      {loading ? (
        <span className="text-[11px] text-amber-300 font-bold flex items-center gap-1">
          <Loader size={12} className="animate-spin" />{progress.total > 0 ? `${progress.current}/${progress.total}` : 'waiting'}
        </span>
      ) : (
        <span className={`w-11 h-6 rounded-full relative transition-colors ${on ? 'bg-blue-500' : 'bg-gray-600'}`}>
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
        </span>
      )}
    </button>
  );
};

export const LayersList: React.FC<{
  filterVisibility: FilterVisibility;
  geocodeProgress: GeocodeProgress;
  onToggle: (k: keyof FilterVisibility) => void;
}> = ({ filterVisibility: f, geocodeProgress: g, onToggle }) => (
  <div className="space-y-2 pb-2">
    <LayerRow icon={Clock} label="Pending prebooks" on={f.pendingBookings} progress={g.pendingBookings} onToggle={() => onToggle('pendingBookings')} />
    <LayerRow icon={CheckCircle2} label="Sales & completed" on={f.pendingSalesAndCompleted} progress={g.pendingSalesAndCompleted} onToggle={() => onToggle('pendingSalesAndCompleted')} />
    <LayerRow icon={History} label="Previously done" on={f.historical} progress={g.historical} onToggle={() => onToggle('historical')} />
    <LayerRow icon={Users} label="Callbook clients (PCL)" on={f.pcl} progress={g.pcl} onToggle={() => onToggle('pcl')} />
  </div>
);

export const PinsList: React.FC<{
  pinMode: boolean;
  /** Turns pin mode on/off and closes the menu. */
  onTogglePinMode: () => void;
  driverStopCount: number;
  onOpenDriverStops: () => void;
  /** Wording: "Tap" on the phone, "Click" on desktop. */
  verb?: 'Tap' | 'Click';
}> = ({ pinMode, onTogglePinMode, driverStopCount, onOpenDriverStops, verb = 'Tap' }) => (
  <div className="space-y-2 pb-2">
    <button
      onClick={onTogglePinMode}
      className={`w-full min-h-[56px] rounded-xl px-4 py-2.5 flex items-center gap-3 text-left ${pinMode ? 'bg-purple-600/30 ring-1 ring-purple-500' : 'bg-gray-800'}`}
    >
      <MapPin size={18} className="text-purple-300 flex-shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold text-white">{pinMode ? 'Stop dropping pins' : 'Drop pins'}</span>
        <span className="block text-[11px] text-gray-400">{pinMode ? 'Pin mode is on.' : `${verb} the map to drop a pin; choose who can see it.`}</span>
      </span>
      <span className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ${pinMode ? 'bg-purple-500' : 'bg-gray-600'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${pinMode ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
    <button
      onClick={onOpenDriverStops}
      className="w-full min-h-[56px] rounded-xl px-4 py-2.5 flex items-center gap-3 text-left bg-gray-800"
    >
      <Truck size={18} className="text-teal-300 flex-shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold text-white">Worker driver stops</span>
        <span className="block text-[11px] text-gray-400">{driverStopCount > 0 ? `${driverStopCount} stop${driverStopCount === 1 ? '' : 's'} queued — reorder or clear` : 'None queued'}</span>
      </span>
      <ChevronRight size={16} className="text-gray-500" />
    </button>
  </div>
);
