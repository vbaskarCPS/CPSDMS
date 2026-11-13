// src/v2/features/benny/BennyMark.tsx — the Benny's mark: a B with a sparkle. currentColor, so it takes the button's colour.
import React from 'react';

export const BennyMark: React.FC<{ size?: number | string; className?: string }> = ({ size = 24, className }) => (
  <svg viewBox="0 0 100 90" width={size} height={size} className={className} aria-hidden="true" focusable="false">
    <g fill="currentColor">
      <path fillRule="evenodd" d="M12 18 H40 C52 18 59 24 59 33.5 C59 39.5 55.8 43.8 50.6 45.6 C57 47.3 61 52.3 61 59.5 C61 69.6 53.3 76 40.8 76 H12 Z M26 29 V41.5 H37.5 C42 41.5 44.5 39.3 44.5 35.3 C44.5 31.2 42 29 37.5 29 Z M26 51.5 V65 H38.8 C43.8 65 46.6 62.6 46.6 58.2 C46.6 53.9 43.8 51.5 38.8 51.5 Z" />
      <path d="M78 4 C79.8 16.5 84.5 21.2 97 23 C84.5 24.8 79.8 29.5 78 42 C76.2 29.5 71.5 24.8 59 23 C71.5 21.2 76.2 16.5 78 4 Z" />
      <path d="M62 0 C62.6 4.3 64 5.7 68.3 6.3 C64 6.9 62.6 8.3 62 12.6 C61.4 8.3 60 6.9 55.7 6.3 C60 5.7 61.4 4.3 62 0 Z" />
    </g>
  </svg>
);
