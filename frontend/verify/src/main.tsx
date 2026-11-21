import { loadBrand } from '@flourishive/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// The name, domain and API address can be changed in brand.json without a rebuild.
await loadBrand(
  {
    appName: import.meta.env.VITE_APP_NAME,
    tenantDomain: import.meta.env.VITE_TENANT_DOMAIN,
    apiUrl: import.meta.env.VITE_API_URL,
  },
  { titleSuffix: 'Verify' },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
