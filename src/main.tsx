import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

import './styles/base.css';
import './styles/app.css';
import './styles/components.css';
import './styles/metrics.css';
import './styles/table.css';
import './styles/chart.css';
import './styles/controls.css';

document.documentElement.dataset.theme = localStorage.getItem('sn.theme') ?? 'light';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
