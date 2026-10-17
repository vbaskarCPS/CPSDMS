// src/v2/features/admin/MapBuilderPage.tsx — Territory › Builder: the map builder for one area, exactly
// as it is (full screen), opened from the Territory list; its "Areas" button comes back to the list.
// It also gets every other master map's outline, drawn faintly behind the roads.
import React, { Suspense, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLoad } from '../../lib/data';
import { listAreaPrefixes, territoryOutlines, type OutlineInfo } from '../../lib/territory';
import { Loading } from '../../ui';

const MapBuilder = React.lazy(() => import('../../../pages/SuperAdmin/MapBuilder'));

export const MapBuilderPage: React.FC = () => {
  const { area = '' } = useParams();
  const nav = useNavigate();
  // the outlines are a nice-to-have: if they can't load, the builder works as before
  const outlines = useLoad(() => territoryOutlines().catch(() => null), []);
  const prefixes = useLoad(() => listAreaPrefixes().catch(() => []), []);
  const otherMaps = useMemo(() => outlines.data ? {
    outlines: outlines.data,
    info: new Map<string, OutlineInfo>((prefixes.data || []).map(p => [p.area_name, { region: p.region }])),
  } : null, [outlines.data, prefixes.data]);
  return (
    <Suspense fallback={<div className="v2"><Loading label="Opening the map builder…" /></div>}>
      <MapBuilder key={area} embedArea={area} otherMaps={otherMaps} onExit={() => nav('/app/admin/territory')} />
    </Suspense>
  );
};
