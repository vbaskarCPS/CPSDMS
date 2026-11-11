// src/planner/ui/UpdateReady.tsx — "New version ready" once a newer planner has downloaded (src/lib/offline/appUpdate).
// The planner stays open on a phone for days and nothing reloads it, so without this it keeps running the old
// version: a newer Arvy then plans things (a superset, a pyramid) that the old screens can't save or show.
// Nothing reloads by itself (you may be mid-set); tap Update when it suits.
import { useEffect, useState } from 'react';
import { applyUpdate, onUpdateReady, updateReady } from '../../lib/offline/appUpdate';

export function UpdateReady() {
  const [show, setShow] = useState(updateReady());
  useEffect(() => onUpdateReady(() => setShow(true)), []);
  if (!show) return null;
  return (
    <div className="pl-update" role="status">
      <span>New version ready</span>
      <button type="button" onClick={applyUpdate}>Update</button>
    </div>
  );
}
