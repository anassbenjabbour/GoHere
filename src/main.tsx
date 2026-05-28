import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import 'leaflet/dist/leaflet.css';
import '@fontsource/press-start-2p/400.css';
import './styles.css';
import App from './App';

registerSW({
  immediate: true,
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
