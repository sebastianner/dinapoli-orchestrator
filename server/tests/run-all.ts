/**
 * Boots a throwaway server (its own SQLite file, its own emulated printer
 * spool) and runs every audit suite against it, then tears it down.
 *
 *   npm run test            # everything except the long stress run
 *   npm run test:stress     # adds busy-day.ts + bill-concurrency.ts
 *
 * Nothing here touches server/data/dinapoli.sqlite or a real printer: the
 * server child process gets DINAPOLI_DATA_DIR and PRINTER_EMULATION_DIR, which
 * redirect the database and every print job to a scratch directory.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.AUDIT_PORT ?? 3999);
const BASE = `http://localhost:${PORT}`;
const WITH_STRESS = process.argv.includes('--stress');
// print-blocking.ts needs the server itself started with a per-ticket print
// cost, which would make every other suite crawl - so it gets its own server.
const ONLY_PRINT_BLOCKING = process.argv.includes('--print-blocking');
const PRINT_BLOCKING_DELAY_MS = process.env.PRINTER_EMULATION_DELAY_MS ?? '1000';

const SCRATCH = path.join(os.tmpdir(), `dinapoli-tests-${Date.now()}`);
const DATA_DIR = path.join(SCRATCH, 'data');
const PRINTOUTS = path.join(SCRATCH, 'printouts');

const ADMIN_NAME = 'Test Admin';
const ADMIN_PASSWORD = 'audit1234';
const STAFF = ['Cajero Uno', 'Mesero Dos', 'Mesero Tres', 'Mesero Cuatro', 'Domiciliario Cinco'];

const SUITES = [
  'test-pricing.ts',
  'test-money.ts',
  'test-printing.ts',
  'test-robustness.ts',
  'test-business-day.ts',
];
const STRESS_SUITES = ['busy-day.ts', 'bill-concurrency.ts'];
// Must run last: it closes the business day, which requires every order settled.
const FINAL_SUITES = ['test-accounting.ts'];

const childEnv = {
  ...process.env,
  DINAPOLI_DATA_DIR: DATA_DIR,
  PRINTER_EMULATION_DIR: PRINTOUTS,
  AUDIT_BASE: BASE,
  AUDIT_OUT: SCRATCH,
  PORT: String(PORT),
  JWT_SECRET: 'dinapoli-test-secret',
};

const USE_SHELL = process.platform === 'win32'; // npx is a .cmd there, so it needs a shell

/** With shell:true the args are re-parsed by cmd.exe, so anything with a space has to carry its own quotes. */
function shellSafe(args: string[]): string[] {
  return USE_SHELL ? args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args;
}

function runSync(cmd: string, args: string[], label: string): void {
  const res = spawnSync(cmd, shellSafe(args), { cwd: SERVER_ROOT, env: childEnv, stdio: 'inherit', shell: USE_SHELL });
  if (res.status !== 0) throw new Error(`${label} failed (exit ${res.status})`);
}

function seedDatabase(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PRINTOUTS, { recursive: true });
  console.log(`\n>>> preparing a throwaway database at ${DATA_DIR}`);
  runSync('npx', ['tsx', 'src/db/migrate.ts', '--reset'], 'migrate');
  runSync('npx', ['tsx', 'src/db/seed.ts'], 'seed');
  runSync('npx', ['tsx', 'scripts/create-admin.ts', ADMIN_NAME, ADMIN_PASSWORD], 'create-admin');

  // A few staff accounts and non-zero delivery fees, so the suites have
  // something realistic to work with. Written to a file rather than passed via
  // `node -e`, which cmd.exe would mangle on the newlines.
  const extraSeed = path.join(SCRATCH, 'extra-seed.cjs');
  fs.writeFileSync(extraSeed, `
const Database = require(${JSON.stringify(path.join(SERVER_ROOT, 'node_modules', 'better-sqlite3'))});
const db = new Database(process.env.DINAPOLI_DATA_DIR + '/dinapoli.sqlite');
for (const n of ${JSON.stringify(STAFF)}) db.prepare('INSERT INTO employees (name, role, is_active) VALUES (?, ?, 1)').run(n, 'staff');
const fees = [5000, 6000, 7000, 8000, 9000, 10000];
db.prepare('SELECT id FROM neighborhoods').all().forEach((n, i) =>
  db.prepare('UPDATE neighborhoods SET delivery_fee = ? WHERE id = ?').run(fees[i % fees.length], n.id));
db.prepare('UPDATE cash_register_settings SET default_opening_cash = 200000 WHERE id = 1').run();
console.log('Seeded ' + db.prepare('SELECT COUNT(*) c FROM employees').get().c + ' employees.');
`);
  runSync('node', [extraSeed], 'extra seed');
}

async function waitForHealth(timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not become healthy on ${BASE} within ${timeoutMs}ms`);
}

function startServer(extraEnv: Record<string, string> = {}): ChildProcess {
  console.log(`>>> starting the test server on ${BASE}`);
  // The server's stdout goes straight to a file descriptor rather than through
  // a pipe this process would have to drain. We run each suite with spawnSync,
  // which blocks this event loop completely - a piped child would fill the OS
  // pipe buffer within a few hundred log lines and then block forever inside
  // its own console.log, freezing the server mid-suite.
  const logFd = fs.openSync(path.join(SCRATCH, 'server.log'), 'a');
  const child = spawn('npx', shellSafe(['tsx', 'src/server.ts']), {
    cwd: SERVER_ROOT,
    env: { ...childEnv, ...extraEnv },
    stdio: ['ignore', logFd, logFd],
    shell: USE_SHELL,
  });
  child.on('exit', () => { try { fs.closeSync(logFd); } catch { /* already closed */ } });
  return child;
}

function stopServer(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function runSuite(suite: string, extraEnv: Record<string, string> = {}): boolean {
  console.log(`\n\n################ ${suite} ################`);
  const res = spawnSync('npx', shellSafe(['tsx', path.join(__dirname, suite)]), {
    cwd: SERVER_ROOT, env: { ...childEnv, ...extraEnv }, stdio: 'inherit', shell: USE_SHELL,
  });
  return res.status === 0;
}

async function main() {
  seedDatabase();
  const failures: string[] = [];

  if (ONLY_PRINT_BLOCKING) {
    // Its own server, started with a realistic per-ticket print cost.
    const blockingEnv = { PRINTER_EMULATION_DELAY_MS: PRINT_BLOCKING_DELAY_MS };
    const server = startServer(blockingEnv);
    try {
      await waitForHealth();
      if (!runSuite('print-blocking.ts', blockingEnv)) failures.push('print-blocking.ts');
    } finally {
      stopServer(server);
    }
    console.log(`\n=============================================`);
    console.log(`scratch dir: ${SCRATCH}`);
    if (failures.length) { console.log('print-blocking.ts reported failures'); process.exit(1); }
    console.log('PRINT-BLOCKING SUITE PASSED');
    return;
  }

  const server = startServer();
  try {
    await waitForHealth();
    const suites = [...SUITES, ...(WITH_STRESS ? STRESS_SUITES : []), ...FINAL_SUITES];
    for (const suite of suites) {
      if (!runSuite(suite)) failures.push(suite);
    }
  } finally {
    stopServer(server);
  }

  console.log(`\n=============================================`);
  console.log(`scratch dir (db, printouts, server log): ${SCRATCH}`);
  if (failures.length) {
    console.log(`SUITES REPORTING FAILURES: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('ALL SERVER SUITES PASSED');
}

main().catch((err) => { console.error(err); process.exit(2); });
