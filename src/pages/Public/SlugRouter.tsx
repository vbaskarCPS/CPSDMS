// src/pages/Public/SlugRouter.tsx
import React from 'react';
import { useParams } from 'react-router-dom';
import ShuttlePage from './ShuttlePage';

// ApplicantForm is lazy-loaded since it's the less common path from this router
const ApplicantForm = React.lazy(() => import('./ApplicantForm'));

const SlugRouter: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();

  if (slug?.endsWith('-shuttle')) {
    return <ShuttlePage />;
  }

  return <ApplicantForm />;
};

export default SlugRouter;