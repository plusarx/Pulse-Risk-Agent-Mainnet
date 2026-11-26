// One command for local development: the app (3100), the chat service (3200) and the agent loop, with prefixed logs.
//   npm run dev:all
// Ctrl+C stops all three. The agent runs in dry run unless agent/.env says otherwise.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jobs = [
  { name: 'app ', cwd: root, args: ['run', 'dev'] },
  { name: 'chat', cwd: resolve(root, 'agent'), args: ['run', 'chat'] },
  { name: 'loop', cwd: resolve(root, 'agent'), args: ['start'] },
];

const kids = jobs.map((j) => {
  const p = spawn('npm', j.args, { cwd: j.cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = (s) => { for (const line of String(s).split(/\r?\n/)) if (line.trim()) console.log(`[${j.name}] ${line}`); };
  p.stdout.on('data', out); p.stderr.on('data', out);
  p.on('exit', (code) => { console.log(`[${j.name}] exited (${code})`); stop(); });
  return p;
});

let stopping = false;
function stop() {
  if (stopping) return; stopping = true;
  for (const k of kids) { try { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(k.pid), '/T', '/F'], { stdio: 'ignore' }); else k.kill('SIGTERM'); } catch { /* already gone */ } }
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
