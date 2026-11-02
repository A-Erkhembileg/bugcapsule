import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

document.documentElement.dataset.layout =
  new URLSearchParams(location.search).get('view') === 'full'
    ? 'full'
    : 'popup';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
