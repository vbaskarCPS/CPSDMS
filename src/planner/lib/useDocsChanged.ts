// src/planner/lib/useDocsChanged.ts — reload a screen's copy when Arvy changes docs of these kinds (lib/docs docsChanged).
import { useEffect, useRef } from 'react';
import { onDocsChanged } from './docs';

export function useDocsChanged(kinds: string[], reload: () => void): void {
  const fn = useRef(reload); fn.current = reload;
  const key = kinds.join(',');
  useEffect(() => onDocsChanged(ks => { if (ks.some(k => key.split(',').includes(k))) fn.current(); }), [key]);
}
