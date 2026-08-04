# Dinapoli POS — end-to-end audit

**Date:** 2026-08-01 · **Scope:** `server/` + `frontend/`, code review plus automated
testing against a live instance · **Method:** ~700 assertions across 8 suites, a
simulated 260-order service across 16 concurrent WebSocket clients, and manual
inspection of every printed document.

No printer was attached, so `printerService` gained an emulation mode
(`PRINTER_EMULATION_DIR`) that writes each job's exact ESC/POS byte stream to
disk plus a decoded text rendering, and saves bills as PNG + HTML. The database
path also became overridable (`DINAPOLI_DATA_DIR`) so nothing here ever touched
`server/data/dinapoli.sqlite`.

---

## Status

H1, M1, M2, M4, M5 and every low finding (L1–L8) have been **fixed and
verified**; each is now covered by an assertion that fails if it comes back.
**M3** (cash tips excluded from the drawer figure) was investigated and
confirmed to be correct, intentional behavior, not a defect. **H2**
(unauthenticated money endpoints) is **still open** — it wasn't in scope for
this pass.

## Verdict

**The money is correct.** Every pricing rule, every settlement invariant, and
every end-of-day rollup checked out exactly — including under concurrency. I
could not produce a single order that was charged the wrong amount, settled for
the wrong amount, or reported incorrectly.

**The printing subsystem was where this would have hurt in production.** Bill
rendering had no concurrency limit and collapsed under simultaneous
settlements; kitchen tickets froze the whole server for ~1 s each. Both are
fixed and covered by regression tests.

**The money endpoints have no authentication.** Anyone on the restaurant's
network can settle an order, rewrite a completed order's payment record, or
change the cash drawer figure. Admin-gated endpoints are all correctly gated —
these simply have no gate at all.

---

## What was verified as correct

| Area | Evidence |
| --- | --- |
| Pizza pricing (group/size/portion/upgrade rules) | 175 assertions, 0 failures |
| Independent repricing of a full service | 260 orders repriced from `/api/menu` client-side; **0 disagreements** with what the server charged |
| Settlement invariants | Held on all 313 completed orders: `Σ(items) = total`, `Σ(gross) = grandTotal`, `Σ(net) = total`, `Σ(tip/fee/discount)` roll up exactly, `collected = grandTotal − discount` |
| Input validation | 40+ malformed orders rejected (portions ≠ 100, duplicate flavors, over-max flavors, unknown keys, quantity 0/negative/fractional, sold-out items, wrong table, missing customer, another customer's address, inactive employee) |
| Payment validation | 1 COP over or short is refused; negative/fractional amounts refused; tip > split refused; discount > products slice refused; delivery fee on a dine-in order refused |
| Simultaneous settlement of one order | 5/5 rounds: exactly one winner, exactly one payment row, never double-charged |
| Blackout recovery | An order stranded in `PRINTING` with unprinted items is picked back up, reprinted, and advanced to `ACTIVE` |
| Kitchen queue | 260 tickets drained with none stuck in `PRINTING`; no item ever printed twice (`printed_at` holds) |
| Addendum tickets | Items added mid-service print only the new items; the saved snapshot still grows to the full order for reprints |
| Admin access control | 11 admin endpoints × (staff session, anonymous) = **22/22 correctly refused** |
| End-of-day report | All 16 fields matched an independent recomputation from the orders; the printed receipt matched the stored snapshot; analytics matched the closing report |
| ESC/POS injection | Control bytes in a customer name are stripped; readable characters survive |
| Order intake throughput | 260 orders across 10 terminals in 191 ms (1361/s), ack p50 120 ms / p95 181 ms; queue drained all 260 tickets in 31 ms |
| Broadcast consistency | All 6 passive screens received byte-identical broadcast streams (1175 `order_updated` each, zero divergence) |

---

## Findings

### H1 — Bill rendering had no concurrency limit; the settle request hung and Chromium leaked — FIXED

**Severity: high.** `printerService.renderHtmlToPng` opens a new Chromium page
per bill with no cap ([printerService.ts:753](server/src/services/printerService.ts:753)).
Puppeteer's default `protocolTimeout` is 180 s, and a page whose screenshot
times out never reaches `page.close()` promptly.

Measured degradation (`tests/bill-concurrency.ts`), two independent runs:

| Concurrent settlements | Succeeded | p50 latency | max latency |
| --- | --- | --- | --- |
| 1 | 1/1 | 465–630 ms | 630 ms |
| 2 | 2/2 | 332 ms – 4.5 s | 4.5 s |
| 4 | 4/4 | 522 ms – 5.3 s | 5.3 s |
| 8 | 8/8 | **5.7–5.8 s** | 6.6 s |
| 16 | **2/16** | **185–186 s** | 186 s |

Both runs collapsed identically at 16, with
`Page.captureScreenshot timed out` / `Runtime.callFunctionOn timed out`.

At 260 *simultaneous* settlements the process reached **173 Chromium processes
and 10.2 GB resident**, 88 bills failed outright, and roughly 162 requests never
returned at all. The leaked processes never went away.

Re-running the identical 260-order service **capped at 4 concurrent** settled
**260/260 orders with zero bill failures**, 11 Chromium processes, and a server
still answering `/health` in 205 ms throughout — 182 s wall clock, i.e. ~1.4
settlements/second. That is the honest ceiling of the current bill pipeline, and
it is fine for a restaurant; the failure only appears when the work is
unbounded.

**It can also hang outright.** On a later run — same code, concurrency capped at
4, machine under other load — a single bill render wedged permanently: the
server sat idle (CPU flat at 15.5 s, 155 MB, `/health` answering in 209 ms),
13 Chromium processes alive, and the settlement request for order 81 never
returned and never errored, for over ten minutes. Puppeteer's `protocolTimeout`
never fired. So the failure mode isn't only "slow under a burst" — an individual
bill can deadlock the request that triggered it with no error anywhere. The
payment was already committed, so again no money was lost, but the cashier's
screen would hang indefinitely.

What this looks like in the restaurant: several tables settling at once near
closing. The cashier's "Cobrar orden" spinner never resolves and the customer's
bill never comes out.

**The money is safe** — payment rows and the `COMPLETED` flip are committed in
one transaction *before* printing is attempted
([orderService.ts:1052](server/src/services/orderService.ts:1052)), and the bill
HTML is saved to `print_jobs` before rasterizing, so it stays reprintable. That
design decision is what keeps this from being a data-loss bug.

**Fixed** in `printerService.ts`: renders are serialized behind a promise-chain
lock, `puppeteer.launch` gets an explicit 30 s `protocolTimeout`, the whole
render is raced against a 45 s wall-clock deadline, and `page.close()` is itself
time-boxed and non-throwing so the failure path can't wedge or mask the real
error. Serializing costs about half a second per bill, which is well inside what
a thermal printer can lay down anyway.

Re-measured after the fix, same machine and method:

| Concurrent settlements | Before | After |
| --- | --- | --- |
| 1 | 1/1, 465–630 ms | 1/1, **239 ms** |
| 2 | 2/2, 332 ms – 4.5 s | 2/2, **495 ms** |
| 4 | 4/4, 522 ms – 5.3 s | 4/4, **681 ms** |
| 8 | 8/8, 5.7–5.8 s | 8/8, **1.2 s** |
| 16 | **2/16, 185–186 s** | **16/16, 2.2 s** (3.9 s wall for all sixteen) |

Chromium stays at its normal 8-process idle pool throughout, and a full
60-order service settled 60/60 with zero bill failures. `bill-concurrency.ts`
now asserts all sixteen succeed, none approaches the old protocol timeout, and
the process doesn't accumulate pages.

### H2 — Every money-moving endpoint accepts an unauthenticated caller — OPEN

**Severity: high.** Verified: 9/9 return 2xx with no cookie at all.

| Endpoint | What an anonymous caller can do |
| --- | --- |
| `POST /api/orders/:id/complete` | Settle any open order, choosing the method, tip and discount |
| `PUT /api/orders/:id/payments` | Rewrite a completed order's payment split — this feeds the closing report |
| `POST /api/orders/:id/items` | Add items to any open order |
| `PUT /api/cash-flow/current/amount` | Set the cash drawer figure to anything |
| `POST /api/cash-flow/expenses` | Record register expenses |
| `GET /api/orders` | Read the entire order book including every payment |
| `POST /api/orders/:id/reprint` | Make the counter printer emit documents |
| WebSocket `/ws/orders` | Place orders |

The server binds to `0.0.0.0` ([server.ts:21](server/src/server.ts:21)), so this
is the whole LAN, including guest Wi-Fi if it shares a subnet. The README's
"Known gaps" section frames this as intentional, but it predates
`PUT /orders/:id/payments` and the cash-flow endpoints, which are materially
different from "order intake is open".

**Fix:** `router.use(requireAuth)` on the orders and cash-flow routers. Every
client already holds a session; nothing in the UI would change.

### M1 — The kitchen ticket printed the wrong promo price when the order carried extra items — FIXED

**Severity: medium.** `printerService.promoBasePrice`
([printerService.ts:416](server/src/services/printerService.ts:416)) derives the
promo's price from the order's items, but picks the wrong one:

- `duo` → `Math.max(unitPrice)` across **all** items, including items that are not part of the promo.
- `pizza_xl` → the **first** item with a `pizzaRef`, which need not be the promo pizza.

Reproduced end to end:

```
Order 265 — duo promo + a full-price XL pizza
  ticket printed:  PROMO DUO ($86.000)
  actual promo:    $37.000

Order 266 — pizza_xl promo, with an extra small pizza added to the cart first
  ticket printed:  PROMO PIZZA XL ($34.000)
  actual promo:    $86.000
```

The order total is charged correctly in both cases — only the printed label is
wrong. But it's a price on a document staff and customers read, and the frontend
lets exactly this happen: `addPromoItem` appends promo items to the end of the
cart, so anything added beforehand comes first.

**Fixed.** `order_items` gained a `promo_item` column, written by
`applyPromoPricing` at creation and exposed as `OrderItem.promoItem`;
`promoBasePrice` now reads only those rows (falling back to the old whole-order
scan for pre-column orders). The information genuinely wasn't recoverable
afterwards — a promo item's price is the flat promo price, 0, or a soda
surcharge, none of which is distinguishable from a regular price — which is why
guessing was wrong in the first place. `test-printing.ts` asserts both original
reproductions now print the right figure, and that only the promo's own items
carry the flag.

### M2 — The payment modals enabled a settlement the server rejects — FIXED

**Severity: medium.** `PaymentModal` and `EditPaymentsModal` validate only in
aggregate — `sum(netAmount) === total + tips + fees − discounts`
([PaymentModal.tsx:94](frontend/src/components/order/PaymentModal.tsx:94)) —
while `orderService.resolvePayments` also validates **each split individually**
(`tipAmount <= grossAmount`, `deliveryFee <= grossAmount`,
`discount <= grossAmount − tip − fee`).

With one payment method the two always agree. With a mixed payment they diverge.
Confirmed against a live server:

```
Order of $27.000 — "pay $25.000 cash, put the $5.000 tip on the card"
  modal:  submit button ENABLED
  server: 400  payments[1].tipAmount no puede superar payments[1].grossAmount

Order of $27.000 delivery — "$31.000 cash + $3.000 card", $7.000 fee on the card line
  modal:  submit button ENABLED
  server: 400  payments[1].deliveryFee no puede superar payments[1].grossAmount
```

A randomised sweep of 20,000 UI-valid settlements found this class of
disagreement throughout. The customer is at the till when it happens, and the
error surfaced is a raw API string naming an array index.

**Fixed.** Both modals now share `frontend/src/lib/paymentSplits.ts`, which
mirrors every rule `resolvePayments` enforces — per split as well as in
aggregate. The offending row is ring-highlighted and the reason is spelled out
in the cashier's terms ("La propina no cabe en lo cobrado por este método -
muévela al otro método o súbele el monto") rather than leaving a greyed-out
button with no explanation. The legitimate arrangement of the same amounts
(putting the tip on the split that can carry it) still goes through.
`checkout-math.test.ts` drives the real helpers and sweeps 20,000 randomised
settlements: everything the UI now enables, the server accepts.

### M3 — Cash tips excluded from the drawer count — investigated, not a defect

**Severity: none — closed.** Flagged initially because both the closing
receipt ([endOfDayService.ts:185](server/src/services/endOfDayService.ts:185))
and the `/caja` page ([caja.tsx:139](frontend/src/routes/caja.tsx:139)) compute
"Efectivo final en caja" as `base + cashSales`, where `cashSales` deliberately
excludes tips — and on the simulated service that left a consistent gap
(180,800 COP) between the printed figure and what a test that assumed tips
stay in the till would expect.

**Confirmed with the client: this is intentional.** Cash tips are pulled from
the register and given to staff immediately, not left in the float overnight.
Under that policy `base + cashSales` — tips excluded — *is* the correct
expected drawer total, because the tip cash was never supposed to become part
of the counted float in the first place. The `/caja` tooltip
("Es el efectivo que debería haber físicamente en la caja en este momento.")
is accurate as written.

The original test (`test-accounting.ts`) modeled a cash payment as the
customer's food and tip arriving in the register together in one lump, then
asserted the drawer should include all of it — that assumption about how tips
physically move, not the app's math, was what was wrong. The test now asserts
the actual invariant instead: `drawer === base + cashSales`, exactly, with no
tolerance for a tip-shaped gap.

### M4 — Windows printing froze the entire server for ~1 s per ticket — FIXED

**Severity: medium.** `writeToDevice` shells out **synchronously** via
`execFileSync`, twice per job: `ensurePrinterEnabled` (`Resume-Printer`) then
`print-raw.ps1`. Measured on this machine:

```
Resume-Printer            566 ms
print-raw.ps1             430 ms
                        --------
per kitchen ticket       ~996 ms of total event-loop freeze
```

During that second the Node event loop is stopped: no WebSocket acks, no HTTP
responses, no live updates to any screen. The 1361 orders/s figure above was
measured with the emulated (file-write) printer; with the real path the ceiling
is roughly one ticket per second, and every other client stalls behind it. This
also compounds M2/L6 — the order button can spin with no explanation.

**Fixed**, both halves:

- `writeToDevice` and everything above it (`printText`, `printKitchenTicket`, `printKitchenTicketAddendum`, `printPlainText`, `closeDay`, `reprintClosingReport`) are now async, using `execFile` instead of `execFileSync`. On CUPS the payload is piped to `lp`'s stdin by hand, since the async API has no `input` option.
- `ensurePrinterEnabled` moved off the per-job path onto a 30 s maintenance timer plus one pass at boot (`startPrinterMaintenance`, wired up in `server.ts`). It could never have been reactive anyway — a paused queue *accepts* the job without error, so there is no failure to respond to — and nothing is lost by resuming late, because jobs spooled against a paused queue flush the moment it resumes.

Measured after the fix, same 1 s-per-ticket cost, same method:

| | Before | After |
| --- | --- | --- |
| Ack for an order placed mid-print | **993 ms** | **1 ms** |
| Worst `/health` during 8 s of printing | **1009 ms** | **19 ms** |
| `/health` calls completed in that window | 116 | **567** |
| Requests dropped outright (`ECONNRESET`) | **1** | **0** |
| Orders lost | 0 | 0 |

Printing itself is unchanged at ~1 s per ticket and still serial — a thermal
printer is a serial device. What changed is that it no longer costs anyone else
anything.

**The async switch opened one new race, handled explicitly.** With the loop free
during a print, staff can add items to the very order being printed. The old
code stamped `printed_at` on *every* unprinted item of the order once the ticket
came out, which would have marked that late item as printed without it ever
being on the paper — the kitchen would simply never have seen it. `processOrder`
now stamps only the specific item ids that were on the ticket, then re-checks:
if anything unprinted remains, the order goes back to `PENDING` for an addendum
instead of to `ACTIVE`, which the queue would never look at again.
`print-blocking.ts` section F asserts exactly this.

### M5 — A dead Puppeteer browser was never recovered — FIXED

**Severity: medium.** `getBrowser()`
([printerService.ts:715](server/src/services/printerService.ts:715)) caches
`browserPromise` forever with no reset path:

- If `puppeteer.launch()` ever rejects, the rejected promise is cached and **every** subsequent bill fails identically until the process restarts.
- If the browser later crashes or is killed, the cached handle is dead and `newPage()` throws forever.

On a POS that runs for weeks this is the likely long-term failure: bills quietly
stop printing (`completeOrder` catches and logs), orders keep completing, and
nobody notices until someone checks for receipts.

**Fixed.** `browserPromise` is now cleared both on launch rejection and on the
browser's `disconnected` event, so the next bill launches a fresh browser
instead of re-awaiting a dead handle. Guarded against replacing a newer promise
by comparing identity before clearing.

### M6 — the multi-day sales chart silently lost every after-midnight order — FIXED

**Severity: medium.** `analyticsService.getDailyTrend` filtered by *business*
day but bucketed by *real calendar* date
([analyticsService.ts:150](server/src/services/analyticsService.ts:150)). Those
disagree for exactly the orders this restaurant takes most of: the ones after
midnight.

An order completed at 00:30 on the 24th belongs to the 23rd's service. The
filter included it; the bucket put it on the 24th. `getSalesTrend` then
zero-fills one point per day from `start` to `end` and looks each bucket up by
date — so a bucket outside the window is **dropped without trace**.

Reproduced with three orders on one night (20:00, 00:30, 01:30, $10.000 each)
over a range ending on that business day:

```
KPI card "Ventas totales":   $30.000
the chart's bar for that day: $10.000     <- the two after-midnight orders gone
```

The chart and the KPI directly above it disagreed by two thirds, and the code
comment claimed the opposite ("so the chart's total matches the KPI summary
above it").

**Fixed** by bucketing on the business day too. This is the "how much did we
sell on day X" view, so day X is the business day — the same day the closing
report and the calendar heatmap use. The charts that answer "at what *time* of
day" (the hourly bars, the busy day×hour heatmap) deliberately stay on the real
clock, so a 00:30 order still appears at hour 0 on the calendar day it really
happened. `test-business-day.ts` covers both halves.

### Low — all fixed

- **L1** — `processPayment` validated `order.total > 0` *after* the payment rows and `COMPLETED` flip were committed. Unreachable today, but an order would have been settled in the database while the client saw a 4xx. The check moved into `completeOrder` ahead of the transaction; `processPayment` is now side-effect-free reporting.
- **L2** — The busy heatmap counted only `COMPLETED` orders, so the current shift's busiest hours read as empty exactly when someone would look at them. It now counts every order in the window — kitchen load is load whether or not the table has paid.
- **L3** — `closeDay`'s open-order guard filtered on `created_at`'s business day while sales aggregate on `completed_at`, so an order left open from an earlier day slipped past. It now blocks on *any* open order and names them (`#41, #58 (2026-07-30)`) so staff aren't hunting today's floor for something that isn't there.
- **L4** — `Fecha: 01/08/2026, 19:16:56` is 27 characters against a 24-column double-width line and always wrapped mid-timestamp. Now two lines, `Fecha:` and `Hora:`, seconds dropped.
- **L5** — The delivery day number was counted live on every render, so deleting an earlier delivery order renumbered every later one and a reprint stopped matching the ticket the kitchen was holding. It's now assigned once inside the creating transaction (`orders.delivery_day_number`) and read back; pre-column rows fall back to the old count.
- **L6** — `orderSocketClient.submitOrder` had no timeout, so a missing reply left the button spinning forever. It now rejects after 20 s with something actionable ("revisa si la orden se creó antes de reintentar"). Timed-out entries stay in the positional reply queue as tombstones rather than being spliced out, which would have handed a late reply to the wrong submission.
- **L7** — Correcting a completed order's payments left the *saved* bill showing the original methods, so a reprint contradicted the record. `updateOrderPayments` now re-renders and stores the bill — without printing it, since correcting a record shouldn't push paper.
- **L8** — `pizza_flavors.extra_cost` was live in the server's pricing path but hardcoded to 0 on creation, unreachable from any endpoint, and absent from `GET /api/menu`. The moment anyone set it, the cart would quote one price and the bill charge another. It's now exposed as `PizzaFlavor.extraCost` and mirrored client-side, including the server's pro-rata-by-portion rounding, on pizzas and on products that take a pizza flavor.

### Scaling note (not a defect)

Each order generates ~5.5 `order_updated` broadcasts, sent to every connected
socket. On the 260-order service with 16 clients that was **22,864 broadcast
messages**, and since `LiveOrderUpdates` responds to each one with a
`fetchOrder` plus a revalidation of every `/orders?…` cache key
([LiveOrderUpdates.tsx:22](frontend/src/components/layout/LiveOrderUpdates.tsx:22)),
roughly 35–40k HTTP requests for one evening. Survivable on a LAN with a handful
of tablets, but it compounds M4's event-loop stalls. Sending the changed order
in the broadcast payload — rather than an id every client must go fetch — would
remove almost all of it.

---

## Documentation drift — fixed

The README was unusually thorough, which made the stale parts more likely to
mislead. All corrected:

1. `PUT /api/orders/:id/tip` and `PUT /api/orders/:id/delivery-fee` were documented in four places — **neither route exists.** Replaced with an explanation of how tip and delivery fee are actually declared (per method, inside `payments`, at completion).
2. `pizza_xl` was documented as seeded at `$80,000`; `migrate.ts` seeds `86000`.
3. The XL promo was documented as requiring "a Gaseosa Personal"; the code requires `soft_drink_1_5l` (Gaseosa 1.5L), and the surcharge flavors are Coca-Cola/Quatro/**Premio**, not just the first two.
4. `GET /api/end-of-day` and `/:id` were marked **admin only**; both are `requireAuth` only, deliberately — only reprinting is admin-gated.
5. `GET /api/auth/me` returns `{ employee }`, not the employee.
6. Undocumented routes now documented: `PUT /orders/:id/customer`, `PUT /orders/:id/payments`, the whole `/api/analytics/*` router, `GET /api/menu/flavors/search`, `PUT /api/products/:id/sizes/:sizeKey`.
7. `schema.sql`'s "One row per delivery-fee zone… seeds `orders.deliveryFee`… (see `orderService.createOrder`)" comment sat on the `cities` table (it describes `neighborhoods`) and documented behaviour `createOrder` no longer has. Moved and rewritten.
8. `schema.sql`'s `order_payments` comment referred to a column named `amount`; it is `gross_amount`.

## Changes made to the code

Three, all additive and off by default:

| File | Change |
| --- | --- |
| `server/src/db/index.ts` | `DINAPOLI_DATA_DIR` overrides the database directory. Unset behaves exactly as before. |
| `server/src/services/printerService.ts` | `PRINTER_EMULATION_DIR`: when set, `writeToDevice` writes the ESC/POS payload to disk (`.bin` + decoded `.txt`) instead of an OS print queue, and bills also drop a `.png` and `.html`. Unset behaves exactly as before. |
| `server/package.json`, `frontend/package.json` | `npm test` scripts. |

Beyond that, the fixes above touch: `printerService.ts` (H1, M4, M5, M1, L4,
L5, L7), `queueService.ts` (M4), `orderService.ts` + `paymentService.ts` (M1,
L1, L5, L7), `endOfDayService.ts` + `routes/endOfDay.ts` (M4, L3),
`analyticsService.ts` (L2), `menuService.ts` + `schema.sql` + `migrate.ts` (M1,
L5, L8), `server.ts` (M4), and on the frontend the new `lib/paymentSplits.ts`
(M2), `lib/orderSocket.ts` (L6), `lib/pricing.ts` and its call sites (L8).

**One migration is required**: `npm run db:migrate` adds
`order_items.promo_item` and `orders.delivery_day_number`. Both are additive
with safe defaults, and existing rows fall back to the previous behaviour, so
running against an existing database is non-destructive.

## Test suites added

- **`server/tests/`** — 8 suites driving a real server (orders over WebSocket, everything else over HTTP). `npm test` boots a throwaway database and emulated printer, runs everything, and tears it down. `npm run test:stress` adds the busy-day simulation and the bill-concurrency measurement. See [server/tests/README.md](server/tests/README.md).
- **`frontend/tests/`** — pure-logic tests for the cart price preview, promo previews, and the checkout math, cross-checked against the server's own acceptance rules. `npm test`. See [frontend/tests/README.md](frontend/tests/README.md).

Both suites are green. The only remaining report is one `WARN` for H2
(unauthenticated money endpoints), left open on purpose. Everything else,
including M3, now has a hard assertion behind it.

Final tallies: server **508 passing / 0 failing / 1 warning**, frontend
**116 passing / 0 failing**.

## What's left

1. **H2** — `requireAuth` on the orders and cash-flow routers. Two lines, and the only remaining open finding.

---

## M4 — how the decision was made

Four options were on the table:

1. **Async `execFile`** — removes the freeze, keeps per-ticket cost the same.
2. **Stop calling `Resume-Printer` per job** — removes 566 ms of the 996 ms.
3. **A long-lived PowerShell process fed over stdin** — cuts per-ticket cost to tens of milliseconds, but adds a helper process to supervise and restart, and a wedged printer helper is precisely the failure this system already struggles to notice.
4. **A native `winspool.drv` binding** (`koffi`/`ffi-napi`) — fastest, no child process, but a native dependency that must be rebuilt per Node version on a machine meant to sit in a restaurant and just work.

**(1) + (2) were applied.** Together they remove the whole class of problem with
no new dependencies and no new processes. (3) is only worth revisiting if
per-ticket *latency* itself turns out to matter, which it likely doesn't since a
thermal printer takes a moment to physically print anyway. (4) is worth avoiding
unless something else already forces a native module into the build.

This only ever affected Windows: the Linux/macOS path (`lp -d queue -o raw`) is
a single fast exec with no module loading, so the same `execFileSync` cost a few
milliseconds there. It's async now regardless.

### Reproducing it

`printerService` has two emulation knobs, both inert unless
`PRINTER_EMULATION_DIR` is set:

- `PRINTER_EMULATION_DELAY_MS` — models a real printer's per-ticket cost, asynchronously, the way the fixed path behaves.
- `PRINTER_EMULATION_BLOCKING=1` — makes that wait block the event loop instead, reproducing the original pathology.

`npm run test:print-blocking` boots a server with a 1 s per-ticket cost and runs
the suite. Running the same suite against a server started with
`PRINTER_EMULATION_BLOCKING=1` fails three assertions — which is what
demonstrates they'd catch a regression rather than passing vacuously.

---

## The 2am business-day boundary, surface by surface

The restaurant's service runs past midnight, so an order rung in at 00:30 or
01:30 belongs to the previous day's night. `BUSINESS_DAY_SQL_OFFSET` in
[utils/date.ts](server/src/utils/date.ts) is `-7 hours` — Bogotá's UTC-5 plus a
2-hour cutoff — and `currentBusinessDateBogota()` is its JavaScript twin.

The rule that makes this coherent: **anything that assigns a total to a day uses
the business day; anything that shows a time of day uses the real clock.**
Verified end to end by `test-business-day.ts`, which backdates orders to 20:00,
00:30, 01:30 and 03:00 around a known boundary — the only way to exercise 1am
behaviour.

| Surface | Bucketing | Verified |
| --- | --- | --- |
| `orders.created_at` / `completed_at` in SQLite | **Real instant**, never shifted | ✅ |
| Order history date filter | Business day | ✅ 00:30 and 01:30 appear under the previous day |
| Closing report (`aggregateSales`) | Business day | ✅ the night's three orders, the 03:00 one excluded |
| Closing-reports **calendar heatmap** | Business day (it's driven by `closing_reports.date`) | ✅ each day's colour/figure includes its 00:00–02:00 tail |
| Cash flow period rotation | Business day | ✅ |
| Analytics `range=today` | Business day | ✅ still the same night at 1am |
| Analytics `week` / `month` / `custom` | Business days — each day starts at 2am | ✅ a 7-day window ending on D includes D's after-midnight orders |
| Analytics summary / breakdown / products / customers / employees / promos | Business day | ✅ every breakdown sums to the range total |
| **Multi-day sales chart** | Business day | ✅ *(was broken — see M6)* |
| **Hourly sales chart** | **Real hour** | ✅ a 00:30 order shows at hour 0, and the 24 bars still total the whole night |
| **Busy day×hour heatmap** | **Real day and hour** (range filter still business day) | ✅ a 00:30 order sits on the real weekday at hour 0 |
| Delivery "#N of the day" counter | Business day | ✅ |

### One asymmetry worth knowing about (not a defect)

Order history's `?date=` filter matches on **`created_at`**, while sales
aggregation matches on **`completed_at`**. For a normal order both fall in the
same business day. They diverge only for an order rung in before the 2am cutoff
and settled after it — it appears in one day's *history* and the next day's
*sales*.

That is arguably the right answer for each (history = when it was taken, sales =
when the money was), but it means the closing-report page's hourly chart — which
is fed by the history filter — can differ slightly from the report's own total
on such a night. Left as is; noted so it isn't mistaken for a rounding bug later.
