'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';

/**
 * Two-step close: first click arms it, second click (within 4 s) fires. The parent supplies `onClose`,
 * which must send a REDUCE-ONLY order so it can never flip or enlarge the position.
 */
export function ClosePositionButton({ onClose, disabled }: { onClose: () => Promise<void>; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4_000); return () => clearTimeout(t); }, [armed]);
  return (
    <span className="inline-flex flex-col items-end">
      <button
        disabled={disabled || busy}
        title={disabled ? 'Register an agent key to close from here' : 'Market close (reduce-only)'}
        onClick={async () => {
          if (!armed) { setArmed(true); setErr(null); return; }
          setBusy(true); setArmed(false);
          try { await onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
        }}
        className={clsx('rounded-lg px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40',
          armed ? 'bg-down text-black' : 'bg-panel2 text-[#c9ccd6] hover:bg-down/20 hover:text-down')}>
        {busy ? 'Closing…' : armed ? 'Confirm close' : 'Close'}
      </button>
      {err && <span className="mt-1 max-w-[220px] text-right text-[11px] text-down">{err}</span>}
    </span>
  );
}
