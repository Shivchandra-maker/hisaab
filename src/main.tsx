import { Capacitor } from '@capacitor/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StoreProvider } from './store';
import './design/app.css';

const Loading = () => (
  <div className="welcome" aria-busy="true">
    <div className="brand">
      <span className="brand-mark">₹</span>Hisaab
    </div>
  </div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider loading={<Loading />}>
      <App />
    </StoreProvider>
  </StrictMode>,
);

// Offline support on the hosted app. Skipped in dev and in the single-file preview.
// Not in the Android app: it already ships its files inside the APK.
if (
  import.meta.env.PROD &&
  import.meta.env.MODE !== 'preview' &&
  !Capacitor.isNativePlatform() &&
  'serviceWorker' in navigator
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is optional */
    });
  });
}
