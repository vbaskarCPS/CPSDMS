// src/v2/features/admin/MapViewerPage.tsx — Territory › View on map: the Digital Maps viewer (as at
// /digimaps), opened straight onto the maps ticked in the Territory list. Back returns to the list
// with the same maps still ticked.
import React, { Suspense } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Loading } from '../../ui';

const DigiMaps = React.lazy(() => import('../../../pages/DigiMaps'));

export const MapViewerPage: React.FC = () => {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const ticked = (useLocation().state as { picked?: string[] } | null)?.picked;
  const areas = (params.get('areas') || '').split('|').map(s => s.trim()).filter(Boolean);
  return (
    <Suspense fallback={<div className="v2"><Loading label="Opening the maps…" /></div>}>
      <DigiMaps embedAreas={areas} onExit={() => nav('/app/admin/territory', { state: { picked: ticked || areas } })} />
    </Suspense>
  );
};
