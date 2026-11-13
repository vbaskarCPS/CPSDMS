// src/v2/features/benny/DraftPage.tsx — the live crew draft on its own page: where the "your pick" notification opens.
import React from 'react';
import { useParams } from 'react-router-dom';
import { DraftCard } from './DraftCard';
import './benny.css';

export const DraftPage: React.FC = () => {
  const { id } = useParams();
  return (
    <div className="v2-main v2-narrow" style={{ maxWidth: 640 }}>
      <div className="v2-head"><span className="v2-h1">Crew draft</span></div>
      <div className="benny-root">{id ? <DraftCard id={id} /> : null}</div>
    </div>
  );
};
