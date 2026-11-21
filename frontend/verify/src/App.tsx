import { Accept } from './pages/Accept.tsx';
import { Home } from './pages/Home.tsx';
import { Shell } from './pages/Shell.tsx';
import { Verify } from './pages/Verify.tsx';
import { usePath } from './router.ts';

export default function App() {
  const path = usePath();
  const verify = /^\/d\/([^/]+)\/?$/.exec(path);
  const accept = /^\/accept\/([^/]+)\/?$/.exec(path);
  return (
    <Shell>
      {accept ? (
        <Accept key={accept[1]} token={accept[1]!} />
      ) : verify ? (
        <Verify key={verify[1]} token={verify[1]!} />
      ) : (
        <Home />
      )}
    </Shell>
  );
}
