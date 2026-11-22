import { Skeleton, brand } from '@flourishive/ui';
import { useEffect, useState } from 'react';

/**
 * Shows a PDF inside the page. The file comes from a short-lived signed link; it is fetched and shown
 * from a local blob, because the server forbids framing its own addresses.
 */
export function PdfPreview({ path, title }: { path: string; title: string }) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let made: string | undefined;
    let gone = false;
    setUrl(undefined);
    setFailed(false);
    fetch(`${brand.apiUrl}${path}`)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (gone) return;
        made = URL.createObjectURL(new Blob([b], { type: 'application/pdf' }));
        setUrl(made);
      })
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path]);
  if (failed)
    return (
      <p className="p-8 text-sm text-muted">
        The preview could not be loaded. Use Download instead.
      </p>
    );
  if (!url) return <Skeleton className="h-[78vh] w-full" />;
  return <iframe title={title} src={url} className="h-[78vh] w-full bg-surface-2" />;
}
