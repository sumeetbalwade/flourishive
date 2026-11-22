import { Accept } from './pages/Accept.tsx';
import { LetterLink } from './pages/LetterLink.tsx';
import { Home } from './pages/Home.tsx';
import { Shell } from './pages/Shell.tsx';
import { Verify } from './pages/Verify.tsx';
import { usePath } from './router.ts';

export default function App() {
  const path = usePath();
  const verify = /^\/d\/([^/]+)\/?$/.exec(path);
  const letter = /^\/letter\/([^/]+)\/?$/.exec(path);
  const accept = /^\/accept\/([^/]+)\/?$/.exec(path);
  return (
    <Shell>
      {letter ? (
        <LetterLink key={letter[1]} token={letter[1]!} />
      ) : accept ? (
        <Accept key={accept[1]} token={accept[1]!} />
      ) : verify ? (
        <Verify key={verify[1]} token={verify[1]!} />
      ) : (
        <Home />
      )}
    </Shell>
  );
}
