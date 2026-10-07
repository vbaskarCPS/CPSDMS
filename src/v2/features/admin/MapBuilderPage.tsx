// src/v2/features/admin/MapBuilderPage.tsx — Territory › Builder: the map builder for one area, exactly
// as it is (full screen), opened from the Territory list; its "Areas" button comes back to the list.
import React, { Suspense } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loading } from '../../ui';

const MapBuilder = React.lazy(() => import('../../../pages/SuperAdmin/MapBuilder'));

export const MapBuilderPage: React.FC = () => {
  const { area = '' } = useParams();
  const nav = useNavigate();
  return (
    <Suspense fallback={<div className="v2"><Loading label="Opening the map builder…" /></div>}>
      <MapBuilder key={area} embedArea={area} onExit={() => nav('/app/admin/territory')} />
    </Suspense>
  );
};
