// src/pages/Management/mobile/PhoneSheet.tsx
//
// Bottom sheets for the RM phone layout, in the same style as the map
// logsheet's menu: a dimmed backdrop (tap to close) and a rounded panel that
// rises from the bottom. Plus the 3-column tile grid used by the hamburger.

import React from 'react';
import { X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface PhoneSheetProps {
  title?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Cap the panel height (CSS value). Default 85%. */
  maxHeight?: string;
  /** Stack above other overlays. Default z-40. */
  zClass?: string;
}

export const PhoneSheet: React.FC<PhoneSheetProps> = ({ title, onClose, children, maxHeight = '85%', zClass = 'z-40' }) => (
  <div className={`absolute inset-0 ${zClass} flex items-end`} onClick={onClose}>
    <div className="absolute inset-0 bg-black/50" />
    <div
      className="relative w-full bg-gray-900 border-t border-gray-700 rounded-t-2xl shadow-2xl flex flex-col"
      style={{ maxHeight, paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <div className="min-w-0 text-sm font-bold text-white">{title}</div>
        <button onClick={onClose} className="w-9 h-9 -mr-2 flex items-center justify-center text-gray-400 active:text-white" aria-label="Close">
          <X size={20} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3">{children}</div>
    </div>
  </div>
);

export interface TileProps {
  icon: LucideIcon;
  label: string;
  iconClass: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  badge?: string | null;
  badgeClass?: string;
}

export const Tile: React.FC<TileProps> = ({ icon: Icon, label, iconClass, onClick, disabled, active, badge, badgeClass }) => (
  <button
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    className={`relative aspect-[1.1] rounded-2xl flex flex-col items-center justify-center gap-1.5 px-1 text-center
      ${active ? 'bg-blue-600/30 ring-2 ring-blue-500' : 'bg-gray-800'}
      ${disabled ? 'opacity-35' : 'active:bg-gray-700'}`}
  >
    <Icon size={26} className={iconClass} />
    <span className="text-[12px] font-bold leading-tight text-white">{label}</span>
    {badge && (
      <span className={`absolute top-1.5 right-1.5 rounded-full px-1.5 min-w-[18px] text-[10px] font-bold ${badgeClass || 'bg-yellow-500 text-black'}`}>
        {badge}
      </span>
    )}
  </button>
);
