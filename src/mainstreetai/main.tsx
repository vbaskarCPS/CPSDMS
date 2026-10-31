// src/mainstreetai/main.tsx — the Main Street AI website (mainstreetai.html), served at mainstreetai.propertystars.app
// and, for a preview on the app's own address, /site/mainstreetai. No sign-in, no service worker.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Site } from './Site';
import './site.css';

createRoot(document.getElementById('root')!).render(<StrictMode><Site /></StrictMode>);
