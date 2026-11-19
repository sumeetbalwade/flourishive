import { ToastProvider } from '@flourishive/ui';
import Desktop from './pages/Desktop.tsx';
import { Document } from './pages/Document.tsx';
import Gallery from './pages/Gallery.tsx';
import { Letters } from './pages/Letters.tsx';
import { Login, Mfa } from './pages/Login.tsx';
import { Signing } from './pages/Signing.tsx';
import { Templates } from './pages/Templates.tsx';
import { useRoute } from './router.ts';

// Clickable prototypes (Phase 0). Start at #/login.
export default function App() {
  const route = useRoute();
  let page;
  if (route === '/login') page = <Login />;
  else if (route === '/mfa') page = <Mfa />;
  else if (route === '/design') page = <Gallery />;
  else if (route === '/desktop') page = <Desktop />;
  else if (route === '/app/signing') page = <Signing />;
  else if (route === '/app/templates') page = <Templates />;
  else if (route.startsWith('/app/letters/')) page = <Document id={route.split('/').pop()!} />;
  else if (route.startsWith('/app/')) page = <Letters />;
  else page = <Login />;
  return <ToastProvider>{page}</ToastProvider>;
}
