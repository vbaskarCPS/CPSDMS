// src/pages/Management/mobile/PhoneDrawer.tsx
//
// The always-present bottom drawer of the RM phone layout. Three resting
// heights:
//   peek — just the handle and the drawer's header strip
//   half — about half the screen; the map stays usable above it
//   full — up to just under the top bar
// Drag the handle/header to resize (it snaps to the nearest height on
// release); a plain tap on the handle toggles peek ⇄ half. The drawer reports
// its settled height so the map can keep its centre above it and the
// floating buttons can sit just on top of it.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type DrawerSnap = 'peek' | 'half' | 'full';

interface PhoneDrawerProps {
  snap: DrawerSnap;
  onSnap: (s: DrawerSnap) => void;
  /** Height in px of the peek state (handle + header strip). */
  peek: number;
  /** Space left free at the top when fully open (the top bar). */
  topGap: number;
  /** Always-visible strip under the handle. Draggable. */
  header: React.ReactNode;
  /** Scrollable body, shown when the drawer is taller than peek. */
  children?: React.ReactNode;
  /** Settled height in px (after a snap / resize), for map padding etc. */
  onHeight?: (h: number) => void;
}

const DRAG_START_PX = 6;

const PhoneDrawer: React.FC<PhoneDrawerProps> = ({ snap, onSnap, peek, topGap, header, children, onHeight }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [containerH, setContainerH] = useState(0);
  const [dragH, setDragH] = useState<number | null>(null);
  const dragRef = useRef<{ startY: number; startH: number; dragging: boolean; id: number } | null>(null);
  const swallowClickRef = useRef(false);

  // Track the parent's height (the phone screen minus nothing — we're absolute).
  useLayoutEffect(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent) return;
    const update = () => setContainerH(parent.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  const heights = {
    peek,
    half: Math.max(peek + 40, Math.round(containerH * 0.48)),
    full: Math.max(peek + 80, containerH - topGap),
  };
  const restingH = heights[snap];
  const h = dragH ?? restingH;

  useEffect(() => {
    if (dragH === null && containerH > 0) onHeight?.(restingH);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restingH, dragH === null, containerH]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragRef.current = { startY: e.clientY, startH: h, dragging: false, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.startY;
    if (!d.dragging) {
      if (Math.abs(dy) < DRAG_START_PX) return;
      d.dragging = true;
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    const next = Math.min(heights.full, Math.max(heights.peek, d.startH - dy));
    setDragH(next);
  };
  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !d.dragging) return;
    swallowClickRef.current = true;
    setTimeout(() => { swallowClickRef.current = false; }, 50);
    const cur = dragH ?? d.startH;
    const moved = cur - d.startH;
    // Nearest resting height, nudged in the direction of the drag so a short
    // flick is enough to change state.
    const order: DrawerSnap[] = ['peek', 'half', 'full'];
    let best: DrawerSnap = snap;
    let bestDist = Infinity;
    for (const s of order) {
      const dist = Math.abs(heights[s] - (cur + Math.sign(moved) * 40));
      if (dist < bestDist) { bestDist = dist; best = s; }
    }
    setDragH(null);
    onSnap(best);
  };

  const onHandleClick = () => {
    if (swallowClickRef.current) return;
    onSnap(snap === 'peek' ? 'half' : 'peek');
  };

  return (
    <div
      ref={rootRef}
      className="absolute inset-x-0 bottom-0 z-20 bg-gray-900 border-t border-gray-700 rounded-t-2xl shadow-[0_-8px_24px_rgba(0,0,0,0.5)] flex flex-col"
      style={{ height: h, transition: dragH === null ? 'height 200ms ease-out' : 'none' }}
    >
      <div
        className="flex-shrink-0 touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={e => { if (swallowClickRef.current) { e.stopPropagation(); e.preventDefault(); } }}
      >
        <button onClick={onHandleClick} className="w-full pt-2 pb-1.5 flex justify-center" aria-label={snap === 'peek' ? 'Open drawer' : 'Lower drawer'}>
          <span className="block w-10 h-1.5 rounded-full bg-gray-600" />
        </button>
        {header}
      </div>
      <div
        className="flex-1 min-h-0 overflow-y-auto custom-scrollbar overscroll-contain"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {children}
      </div>
    </div>
  );
};

export default PhoneDrawer;
