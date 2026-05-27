import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './style.css';
import { App } from './App';

const appRoot = document.getElementById('app');
if (!appRoot) throw new Error('missing app root');

createRoot(appRoot).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
