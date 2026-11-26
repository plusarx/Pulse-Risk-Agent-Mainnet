/** Pulse Risk mark: a heartbeat line (the agent's pulse on your risk) on the gold tile. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Pulse Risk" className="shrink-0">
      <rect width="32" height="32" rx="8" fill="currentColor" className="text-accent" />
      <path d="M4 17h6l2.5-6 4 12 3-9 2 3H28" fill="none" stroke="#0b0d12" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
