/* Audit suite 9: the 2am business-day boundary.
 *
 * The restaurant's night runs past midnight, so an order rung in at 00:30 or
 * 01:30 belongs to the previous day's service. What that must mean, surface by
 * surface:
 *
 *   - order history, closing reports, cash flow  -> the PREVIOUS day
 *   - orders.created_at / completed_at in the DB -> the REAL timestamp, unshifted
 *   - analytics range filters (today / 7d / 30d) -> days start at 2am
 *   - the closing-reports calendar heatmap       -> the day's sales include the
 *                                                   00:00-02:00 tail
 *   - time-of-day views (hourly bars, the busy
 *     dow x hour heatmap)                        -> the REAL hour, so a 00:30
 *                                                   order shows at hour 0
 *
 * Orders are placed normally and then backdated directly in SQLite, which is
 * the only way to exercise a boundary that only occurs at 1am.
 */
import Database from 'better-sqlite3';
import { Client, Terminal, check, eq, section, summary, results, product, waitForStatus, sleep } from './lib.js';

const client = new Client();
const DB_PATH = `${process.env.DINAPOLI_DATA_DIR}/dinapoli.sqlite`;

/** YYYY-MM-DD shifted by whole days. */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Bogota local wall-clock -> the UTC instant SQLite stores. Colombia is UTC-5 year round. */
function bogotaToUtcIso(date: string, hour: number, minute = 0): string {
  const utc = new Date(`${date}T00:00:00Z`);
  utc.setUTCHours(hour + 5, minute, 0, 0);
  return utc.toISOString().replace('Z', 'Z').replace(/\.\d{3}Z$/, '.000Z');
}

async function main() {
  await client.loginAdmin(1, 'audit1234');
  const emp = (await client.get('/api/employees/active')).body[1].id;

  // A business day safely in the past, so every timestamp below is historical.
  const today = (await client.get('/api/cash-flow/current')).body.date as string;
  const D = shiftDate(today, -10);
  const NEXT = shiftDate(D, 1);
  console.log(`  business day under test: ${D} (the night of ${D} running into ${NEXT})`);

  const term = new Terminal('bizday');
  await term.connect();

  // Four orders across the boundary. The first three are one service; the
  // fourth is the next day's.
  const spec = [
    { label: 'evening  20:00', when: bogotaToUtcIso(D, 20, 0), realDate: D, realHour: 20, businessDay: D },
    { label: 'midnight 00:30', when: bogotaToUtcIso(NEXT, 0, 30), realDate: NEXT, realHour: 0, businessDay: D },
    { label: 'late     01:30', when: bogotaToUtcIso(NEXT, 1, 30), realDate: NEXT, realHour: 1, businessDay: D },
    { label: 'next day 03:00', when: bogotaToUtcIso(NEXT, 3, 0), realDate: NEXT, realHour: 3, businessDay: NEXT },
  ];

  const placed: { id: number; total: number; spec: (typeof spec)[number] }[] = [];
  for (const s of spec) {
    const reply = await term.place({
      orderType: 'dine_in', employeeId: emp, tableNumber: 1,
      items: [product('appetizers', 'garlic_bread')],
    });
    if (reply.type !== 'order_created') throw new Error(`rejected: ${reply.message}`);
    const active = await waitForStatus(client, reply.order.id, 'ACTIVE', 60000);
    const paid = await client.post(`/api/orders/${active.id}/complete`, {
      payments: [{ method: 'cash', grossAmount: active.total }],
    });
    if (paid.status !== 200) throw new Error(`settle failed: ${JSON.stringify(paid.body)}`);
    placed.push({ id: active.id, total: active.total, spec: s });
  }
  await sleep(1500); // let the bills finish rendering before we move the clock

  // Backdate both timestamps to the target instant.
  const db = new Database(DB_PATH);
  for (const p of placed) {
    db.prepare('UPDATE orders SET created_at = ?, completed_at = ? WHERE id = ?').run(p.spec.when, p.spec.when, p.id);
  }
  const perOrder = placed[0].total;
  const dayTotal = perOrder * 3; // the three orders of business day D
  db.close();

  // -------------------------------------------------------------------------
  section('A. The database keeps the real timestamp, unshifted');
  for (const p of placed) {
    const row = (await client.get(`/api/orders/${p.id}`)).body;
    eq(`${p.spec.label}: created_at is the real instant`, row.createdAt, p.spec.when);
    eq(`${p.spec.label}: completed_at is the real instant`, row.completedAt, p.spec.when);
  }

  section('B. Order history buckets the after-midnight orders into the previous day');
  {
    const onD = (await client.get(`/api/orders?date=${D}`)).body.map((o: any) => o.id);
    const onNext = (await client.get(`/api/orders?date=${NEXT}`)).body.map((o: any) => o.id);
    for (const p of placed) {
      const expected = p.spec.businessDay === D ? onD : onNext;
      const other = p.spec.businessDay === D ? onNext : onD;
      check(`${p.spec.label} appears under ${p.spec.businessDay}`, expected.includes(p.id), `ids on that day: ${expected.join(',')}`);
      check(`${p.spec.label} does NOT appear under the other day`, !other.includes(p.id));
    }
    eq(`business day ${D} holds exactly the three night orders`, onD.filter((id: number) => placed.some((p) => p.id === id)).length, 3);
  }

  section('C. Analytics range filters start the day at 2am');
  {
    // A single-day custom range is the same window the "today" button uses,
    // just anchored to a day we control.
    const summaryD = (await client.get(`/api/analytics/summary?range=custom&from=${D}&to=${D}`)).body;
    eq(`range ${D}..${D} counts all three night orders`, summaryD.orderCount, 3);
    eq(`range ${D}..${D} totals all three`, summaryD.totalSales, dayTotal);

    const summaryNext = (await client.get(`/api/analytics/summary?range=custom&from=${NEXT}&to=${NEXT}`)).body;
    eq(`the 03:00 order lands on ${NEXT} instead`, summaryNext.orderCount, 1);
    eq(`and only that one`, summaryNext.totalSales, perOrder);

    // Same rule for a multi-day window: the 7-day span ending at D must include
    // the after-midnight orders of D's night.
    const week = (await client.get(`/api/analytics/summary?range=custom&from=${shiftDate(D, -6)}&to=${D}`)).body;
    eq('a 7-day window ending on D includes D\'s after-midnight orders', week.orderCount, 3);
  }

  section('D. The day\'s sales breakdowns agree with the range total');
  {
    const breakdown = (await client.get(`/api/analytics/breakdown?range=custom&from=${D}&to=${D}`)).body;
    const byMethod = breakdown.paymentMethods.reduce((s: number, m: any) => s + m.sales, 0);
    const byType = breakdown.orderTypes.reduce((s: number, t: any) => s + t.sales, 0);
    eq('payment-method buckets cover the whole business day', byMethod, dayTotal);
    eq('order-type buckets cover the whole business day', byType, dayTotal);
  }

  section('E. Time-of-day views show the REAL hour');
  {
    // Hourly trend for the single business day: an order rung in at 00:30 must
    // appear at hour 00, not folded into hour 24 of the previous evening.
    const trend = (await client.get(`/api/analytics/sales-trend?range=custom&from=${D}&to=${D}`)).body;
    eq('the hourly chart has 24 buckets', trend.length, 24);
    const at = (hour: number) => trend.find((p: any) => p.date === String(hour).padStart(2, '0'));
    eq('the 20:00 order shows at hour 20', at(20).totalSales, perOrder);
    eq('the 00:30 order shows at hour 00, its real hour', at(0).totalSales, perOrder);
    eq('the 01:30 order shows at hour 01, its real hour', at(1).totalSales, perOrder);
    eq('nothing at hour 03 - that order belongs to the next business day', at(3).totalSales, 0);
    const trendTotal = trend.reduce((s: number, p: any) => s + p.totalSales, 0);
    eq('and the hourly chart still totals the whole business day', trendTotal, dayTotal);

    // Busy heatmap: real day-of-week and hour, so a 00:30 order sits on the
    // calendar day it actually happened.
    const heatmap = (await client.get(`/api/analytics/heatmap?range=custom&from=${D}&to=${D}`)).body;
    const dowOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
    const cell = (dow: number, hour: number) => heatmap.find((c: any) => c.dow === dow && c.hour === hour)?.orderCount ?? 0;
    eq('the 20:00 order sits on D\'s weekday at hour 20', cell(dowOf(D), 20), 1);
    eq('the 00:30 order sits on the NEXT weekday at hour 00', cell(dowOf(NEXT), 0), 1);
    eq('the 01:30 order sits on the NEXT weekday at hour 01', cell(dowOf(NEXT), 1), 1);
    const heatTotal = heatmap.reduce((s: number, c: any) => s + c.orderCount, 0);
    eq('the heatmap counts exactly the business day\'s three orders', heatTotal, 3);
  }

  section('F. The multi-day sales chart buckets by business day');
  {
    // The chart shares the KPI card's range, so its bars must add up to the
    // same figure - an after-midnight order bucketed onto the real calendar
    // date would either sit on the wrong bar or fall outside the window
    // entirely and vanish.
    const from = shiftDate(D, -2);
    const to = D;
    const trend = (await client.get(`/api/analytics/sales-trend?range=custom&from=${from}&to=${to}`)).body;
    const summaryRange = (await client.get(`/api/analytics/summary?range=custom&from=${from}&to=${to}`)).body;
    const trendTotal = trend.reduce((s: number, p: any) => s + p.totalSales, 0);
    eq('the daily chart totals what the KPI card above it says', trendTotal, summaryRange.totalSales);
    const bucketD = trend.find((p: any) => p.date === D);
    check(`the ${D} bar exists`, bucketD != null, JSON.stringify(trend.map((p: any) => p.date)));
    eq(`the ${D} bar holds the whole night, after-midnight included`, bucketD?.totalSales, dayTotal);
  }

  section('G. The closing report for that day covers the whole night');
  {
    const db2 = new Database(DB_PATH);
    // closeDay() only ever closes *today*, so the historical equivalent is
    // checked through the same aggregation the report is built from.
    const rows = db2.prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(op.gross_amount - op.tip_amount - op.discount), 0) AS sales
       FROM orders o JOIN order_payments op ON op.order_id = o.id
       WHERE o.status = 'COMPLETED' AND date(o.completed_at, '-7 hours') = ?`,
    ).get(D) as { c: number; sales: number };
    db2.close();
    eq('the closing aggregation counts all three night orders', rows.c, 3);
    eq('and totals the whole night', rows.sales, dayTotal);
  }

  section('H. "Today" follows the same rule for a live order');
  {
    const reply = await term.place({
      orderType: 'dine_in', employeeId: emp, tableNumber: 2,
      items: [product('appetizers', 'garlic_bread')],
    });
    const live = await waitForStatus(client, reply.order!.id, 'ACTIVE', 60000);
    await client.post(`/api/orders/${live.id}/complete`, { payments: [{ method: 'cash', grossAmount: live.total }] });
    const todayOrders = (await client.get(`/api/orders?date=${today}`)).body.map((o: any) => o.id);
    check('an order placed now is on the current business day', todayOrders.includes(live.id));
    const todaySummary = (await client.get('/api/analytics/summary?range=today')).body;
    check('and analytics range=today counts it', todaySummary.orderCount > 0, JSON.stringify(todaySummary.orderCount));
  }

  term.close();
  summary();
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
