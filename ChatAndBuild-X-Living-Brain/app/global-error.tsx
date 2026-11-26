'use client';
import { useEffect } from 'react';

// Last-resort boundary (errors in the root layout / providers). Same stale-build handling as app/error.tsx.
const STALE_BUILD = /ChunkLoadError|Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed/i;

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const stale = STALE_BUILD.test(`${error.name} ${error.message}`);
  useEffect(() => {
    console.error('[global error]', error);
    if (!stale) return;
    try {
      if (sessionStorage.getItem('px.reloadedForStaleBuild')) return;
      sessionStorage.setItem('px.reloadedForStaleBuild', '1');
    } catch { /* ignore */ }
    window.location.reload();
  }, [error, stale]);
  return (
    <html lang="en">
      <body style={{ background: '#0e0f14', color: '#e8eaf0', fontFamily: 'system-ui, sans-serif', padding: 40 }}>
        <h2>{stale ? 'The app was updated: reloading…' : 'Something went wrong'}</h2>
        {!stale && <pre style={{ whiteSpace: 'pre-wrap', color: '#ff5b5b', fontSize: 12 }}>{error.name}: {error.message}{error.digest ? `\ndigest ${error.digest}` : ''}</pre>}
        <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '8px 16px', borderRadius: 10 }}>Reload</button>
      </body>
    </html>
  );
}
