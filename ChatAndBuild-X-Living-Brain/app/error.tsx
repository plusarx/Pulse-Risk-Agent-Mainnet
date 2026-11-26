'use client';
import { useEffect } from 'react';

// After a rebuild, an open tab still references the old JS chunk names; loading one fails with a
// ChunkLoadError. That is not a bug in the page: reload once to pick up the new build.
const STALE_BUILD = /ChunkLoadError|Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed/i;
const KEY = 'px.reloadedForStaleBuild';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = STALE_BUILD.test(`${error.name} ${error.message}`);
  useEffect(() => {
    console.error('[app error]', error);
    if (!stale) return;
    try {
      if (sessionStorage.getItem(KEY)) return; // only once, so a real outage can't loop
      sessionStorage.setItem(KEY, '1');
    } catch { /* storage blocked: still reload once */ }
    window.location.reload();
  }, [error, stale]);

  return (
    <div className="panel mx-auto mt-16 max-w-xl p-6">
      <h2 className="text-lg font-semibold">{stale ? 'The app was updated' : 'Something went wrong on this page'}</h2>
      <p className="mt-2 text-sm text-muted">
        {stale ? 'This tab was opened before the latest build. Reloading picks up the new version.' : 'The rest of the app still works. The details below help fix it.'}
      </p>
      {!stale && (
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-bg p-3 text-xs text-down">{error.name}: {error.message}{error.digest ? `\ndigest ${error.digest}` : ''}</pre>
      )}
      <div className="mt-4 flex gap-2">
        <button className="btn-primary py-2 text-sm" onClick={() => { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } window.location.reload(); }}>Reload</button>
        {!stale && <button className="btn-ghost py-2 text-sm" onClick={() => reset()}>Try again</button>}
      </div>
    </div>
  );
}
