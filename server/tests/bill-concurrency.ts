/* Audit suite 4: how bill rasterization behaves as concurrent settlements rise.
 *
 * Uses POST /orders/:id/reprint {kind:'bill'} - the same renderHtmlToPng ->
 * dither -> writeToDevice pipeline completeOrder uses, minus the DB writes, so
 * this measures the printing path in isolation against already-settled orders.
 */
import { Client, section, check, summary, results, sleep } from './lib.js';

const client = new Client();

async function reprintBill(id: number): Promise<{ ok: boolean; ms: number; detail: string }> {
  const start = Date.now();
  try {
    const r = await client.post(`/api/orders/${id}/reprint`, { kind: 'bill' });
    return { ok: r.status === 200, ms: Date.now() - start, detail: `${r.status} ${JSON.stringify(r.body).slice(0, 120)}` };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, detail: (e as Error).message };
  }
}

async function chromeCount(): Promise<number> {
  const { execSync } = await import('node:child_process');
  try {
    const out = execSync('powershell.exe -NoProfile -Command "(Get-Process chrome -ErrorAction SilentlyContinue).Count"', { encoding: 'utf8' });
    return Number(out.trim()) || 0;
  } catch { return -1; }
}

async function main() {
  await client.loginAdmin(1, 'audit1234');
  const orders = (await client.get('/api/orders?status=COMPLETED&page=1&pageSize=100&sort=newest')).body;
  check('there are settled orders to reprint', orders.length >= 47, `${orders.length}`);

  section('Bill rasterization latency vs. concurrency');
  console.log('  concurrency | ok/total | p50 ms | max ms  | chrome procs after');
  console.log('  ------------|----------|--------|---------|-------------------');

  let offset = 0;
  for (const concurrency of [1, 2, 4, 8, 16]) {
    const batch = orders.slice(offset, offset + concurrency).map((o: any) => o.id);
    offset += concurrency;
    const t0 = Date.now();
    const rs = await Promise.all(batch.map(reprintBill));
    const wall = Date.now() - t0;
    const ok = rs.filter((r) => r.ok).length;
    const sorted = rs.map((r) => r.ms).sort((a, b) => a - b);
    const procs = await chromeCount();
    console.log(`  ${String(concurrency).padEnd(11)} | ${String(ok + '/' + concurrency).padEnd(8)} | ${String(sorted[Math.floor(sorted.length / 2)]).padEnd(6)} | ${String(sorted[sorted.length - 1]).padEnd(7)} | ${procs} (wall ${wall}ms)`);
    const failures = rs.filter((r) => !r.ok);
    if (failures.length) console.log(`      failures: ${failures.slice(0, 2).map((f) => f.detail).join(' | ')}`);
    await sleep(3000);
  }

  section('Do Chromium pages get released between batches?');
  const before = await chromeCount();
  await sleep(8000);
  const after = await chromeCount();
  console.log(`  chrome processes: ${before} -> ${after} after 8s idle`);
  // One idle Puppeteer browser is ~8 processes (browser, GPU, network, zygotes,
  // utility). A leak looks nothing like that: before renders were serialized,
  // an uncapped 260-order run reached 173. The threshold catches that, it
  // doesn't police the normal pool.
  const IDLE_POOL_CEILING = 20;
  check('Chromium pages are released rather than accumulating', after <= IDLE_POOL_CEILING,
    `${after} processes still alive - a page-per-bill leak, not the normal idle pool`);

  section('Every settlement returns, however many arrive at once');
  {
    // The regression this guards: with renders unbounded, 16 simultaneous bills
    // left 14 of them timing out after ~3 minutes each, and one wedged
    // permanently with no error at all. Serialized, they queue up and every one
    // of them comes back.
    const batch = orders.slice(offset, offset + 16).map((o: any) => o.id);
    const t0 = Date.now();
    const rs = await Promise.all(batch.map(reprintBill));
    const wall = Date.now() - t0;
    const ok = rs.filter((r) => r.ok).length;
    const slowest = Math.max(...rs.map((r) => r.ms));
    console.log(`  16 at once: ${ok}/${batch.length} ok, slowest ${slowest}ms, wall ${wall}ms`);
    check('all 16 concurrent settlements succeed', ok === batch.length,
      rs.filter((r) => !r.ok).slice(0, 2).map((r) => r.detail).join(' | '));
    check('none of them takes anywhere near the old 3-minute protocol timeout', slowest < 60000, `slowest ${slowest}ms`);
    check('the server is still answering while they queue', (await client.get('/health')).status === 200);
  }

  summary();
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
