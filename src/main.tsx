import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { mole } from './api';
import './styles.css';
import './plugin.css';

const bridge = mole;

if (bridge) {
  document.addEventListener('click', event => {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest?.('a[href^="http"]');
    if (!anchor) return;
    event.preventDefault();
    bridge.openExternal(anchor.getAttribute('href') || '');
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
