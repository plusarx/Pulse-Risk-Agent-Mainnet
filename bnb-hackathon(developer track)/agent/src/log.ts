const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

// Anything that looks like a key/token is masked before it reaches the console.
const SECRET = /(0x[0-9a-fA-F]{64})|(sk-[A-Za-z0-9_-]{16,})|(ghp_[A-Za-z0-9]{20,})|(Bearer\s+[A-Za-z0-9._-]{16,})/g;
export const redact = (s: string) => s.replace(SECRET, '***');

function emit(level: Level, msg: string, extra?: unknown) {
  const min = LEVELS[(process.env.LOG_LEVEL as Level) in LEVELS ? (process.env.LOG_LEVEL as Level) : 'info'];
  if (LEVELS[level] < min) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${msg}${extra === undefined ? '' : ' ' + JSON.stringify(extra, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`;
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(redact(line));
}

export const log = {
  debug: (m: string, x?: unknown) => emit('debug', m, x),
  info: (m: string, x?: unknown) => emit('info', m, x),
  warn: (m: string, x?: unknown) => emit('warn', m, x),
  error: (m: string, x?: unknown) => emit('error', m, x),
};
