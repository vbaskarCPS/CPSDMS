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
  Route, Navigation, Eye, Share2, Home,
} from 'lucide-react';
import { Tile } from './PhoneSheet';
import type { RMPhoneShell } from './RMPhoneLayout';
import type { GeocodeProgress } from '../RMLogbook';

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

/** One thing the map always shows (no switch); spins while it's still loading. */
export const LayerRow: React.FC<{
  icon: LucideIcon; label: string; detail: string;
  progress?: { current: number; total: number; done: boolean };
}> = ({ icon: Icon, label, detail, progress }) => {
  const loading = !!progress && !progress.done;
  return (
    <div className="w-full min-h-[56px] rounded-xl px-4 py-2 flex items-center gap-3 bg-gray-800">
      <Icon size={18} className="text-blue-300 flex-shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold text-white">{label}</span>
        <span className="block text-[11px] text-gray-400">{detail}</span>
      </span>
      {loading && (
        <span className="text-[11px] text-amber-300 font-bold flex items-center gap-1 flex-shrink-0">
          <Loader size={12} className="animate-spin" />{progress!.total > 0 ? `${progress!.current}/${progress!.total}` : 'loading'}
        </span>
      )}
    </div>
  );
};

/**
 * The "other managers" part of Layers.
 *  • Sharing: for each other manager in the CC, give them full access (the same
 *    access and tools a floater has) or just my position. Private until chosen.
 *  • Seeing: the managers who've shared with me, each of which I can hide on
 *    this device.
 */
export interface ShareRow {
  id: string; name: string;
  /** Full access (floater level). */
  access: boolean;
  /** Can see my position (always true with full access). */
  position: boolean;
  /** The admin set them up as my floater, so they have access already. */
  floats: boolean;
}
export interface SeenRow { id: string; name: string; kind: 'access' | 'position'; shown: boolean }
export interface OthersLayers {
  share: ShareRow[];
  seen: SeenRow[];
  /** True while a sharing change is being saved. */
  saving: boolean;
  onShare: (managerId: string, what: 'access' | 'position') => void;
  onShow: (managerId: string) => void;
}

const Pill: React.FC<{ on: boolean; disabled?: boolean; label: string; title: string; onClick: () => void }> = ({ on, disabled, label, title, onClick }) => (
  <button
    onClick={disabled ? undefined : onClick}
    role="switch" aria-checked={on} aria-label={title} title={title} disabled={disabled}
    className={`h-9 px-3 rounded-lg text-xs font-bold whitespace-nowrap border transition-colors ${on ? 'bg-emerald-600/25 border-emerald-500 text-emerald-200' : 'bg-gray-900 border-gray-700 text-gray-400'} ${disabled ? 'opacity-60 cursor-default' : ''}`}
  >{on ? '✓ ' : ''}{label}</button>
);

const OthersSection: React.FC<{ o: OthersLayers }> = ({ o }) => (
  <>
    <div className="pt-3 pb-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-bold"><Eye size={12} />Shared with me</div>
    {o.seen.length === 0 && <div className="text-[11px] text-gray-500 px-1 pb-1">No manager has shared with you.</div>}
    {o.seen.map(r => (
      <button
        key={r.id} onClick={() => o.onShow(r.id)} role="switch" aria-checked={r.shown} aria-label={`Show ${r.name}`}
        className={`w-full min-h-[52px] rounded-xl px-4 py-2 flex items-center gap-3 text-left ${r.shown ? 'bg-blue-600/25 ring-1 ring-blue-500' : 'bg-gray-800'}`}
      >
        {r.kind === 'access' ? <Route size={18} className={r.shown ? 'text-blue-300' : 'text-gray-400'} /> : <Navigation size={18} className={r.shown ? 'text-blue-300' : 'text-gray-400'} />}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-white truncate">{r.name}</span>
          <span className="block text-[11px] text-gray-400">{r.kind === 'access' ? 'Full access — routes, team, sales, like a floater' : 'Their position'}</span>
        </span>
        <span className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ${r.shown ? 'bg-blue-500' : 'bg-gray-600'}`}>
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${r.shown ? 'left-[22px]' : 'left-0.5'}`} />
        </span>
      </button>
    ))}
    <div className="pt-3 pb-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-bold"><Share2 size={12} />Share with</div>
    <div className="text-[11px] text-gray-500 px-1 pb-1">Full access gives that manager everything a floater gets for you. Nothing is shared until you choose.</div>
    {o.share.length === 0 && <div className="text-[11px] text-gray-500 px-1">No other managers today.</div>}
    {o.share.map(r => (
      <div key={r.id} className="w-full rounded-xl px-4 py-2.5 flex items-center gap-2 bg-gray-800">
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-white truncate">{r.name}</span>
          <span className="block text-[11px] text-gray-400">
            {r.floats ? 'Floats for you (set by the office)' : r.access ? 'Has full access to you' : r.position ? 'Sees your position' : 'Private'}
          </span>
        </span>
        <Pill label="Full access" title={`Full access for ${r.name}`} on={r.access || r.floats} disabled={o.saving || r.floats} onClick={() => o.onShare(r.id, 'access')} />
        <Pill label="Position" title={`Position for ${r.name}`} on={r.position || r.floats} disabled={o.saving || r.access || r.floats} onClick={() => o.onShare(r.id, 'position')} />
      </div>
    ))}
  </>
);

export const LayersList: React.FC<{
  geocodeProgress: GeocodeProgress;
  others?: OthersLayers;
}> = ({ geocodeProgress: g, others: o }) => (
  <div className="space-y-2 pb-2">
    <div className="text-[11px] text-gray-400 px-1">The map always shows all of this. Zoom in to street level to see every house.</div>
    <LayerRow icon={Route} label="Routes" detail="Route lines, numbers and crews, at every zoom" />
    <LayerRow icon={Home} label="Every house (zoomed in)" detail="Coloured by today's knocks, sales and PCL, with numbers and names" />
    <LayerRow icon={Clock} label="Pending prebooks" detail="Zoomed out" progress={g.pendingBookings} />
    <LayerRow icon={CheckCircle2} label="Sales & completed" detail="Zoomed out" progress={g.pendingSalesAndCompleted} />
    <LayerRow icon={History} label="Previously done (X)" detail="Zoomed out; purple houses when zoomed in" progress={g.historical} />
    <LayerRow icon={Users} label="Callbook clients (PCL)" detail="Grey dots zoomed out; blue houses when zoomed in" progress={g.pcl} />
    {o && <OthersSection o={o} />}
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
