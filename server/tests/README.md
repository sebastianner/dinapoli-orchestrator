# Server test suites

End-to-end tests that drive a real server the way the POS terminals do — orders
over the `/ws/orders` WebSocket, everything else over HTTP with a cookie session.

```bash
npm test                   # every suite except the long ones (~2 min)
npm run test:stress        # adds busy-day.ts + bill-concurrency.ts (~15 min)
npm run test:print-blocking # boots its own server with a 1s-per-ticket printer (~1 min)
```

`tests/run-all.ts` does the setup for you: it creates a throwaway SQLite
database in a temp directory, seeds the menu plus one admin and five staff
accounts, starts `src/server.ts` against it, runs each suite, and shuts it down.
It prints the scratch directory at the end so you can look at the database, the
server log, and the printed documents afterwards.

**Nothing here touches `server/data/dinapoli.sqlite` or a real printer.** Two
environment variables make that possible, both read by the app itself:

| Variable | Effect |
| --- | --- |
| `DINAPOLI_DATA_DIR` | Where `src/db/index.ts` opens the SQLite file. Unset = the normal `server/data`. |
| `PRINTER_EMULATION_DIR` | When set, `printerService.writeToDevice` writes each job to this directory instead of sending it to an OS print queue. |

## Emulated printer output

Every job lands as three or four files:

- `NNNNN-<queue>.bin` — the exact ESC/POS byte stream that would have gone to the printer.
- `NNNNN-<queue>.txt` — the same stream decoded: `<INIT>`, `<B>bold</B>`, `<CUT>`, `<RASTER 576px x 984px>`, and the printable text.
- `order-<id>-bill.png` / `order-<id>-bill.html` — for bills, the rendered receipt image and the HTML it came from.

The queue name in the filename is the routing: `kitchen_printer` vs
`counter_printer`. That is what `test-printing.ts` asserts against.

## Suites

| File | Covers |
| --- | --- |
| `test-pricing.ts` | Pizza group/size/portion pricing, product sizes and flavors, promo composition and pricing, and every input the server must reject (bad portions, unknown keys, sold-out items, wrong table, missing customer, inactive employee). |
| `test-money.ts` | Settlement: exact payment, under/overpayment, tips, delivery fees, discounts, mixed splits, double-completion, post-hoc payment corrections, and the table free/busy lifecycle. Asserts the full set of money invariants on every order it touches. |
| `test-printing.ts` | Kitchen ticket content and routing, addendum tickets, the growing saved snapshot, reprint routing, the delivery comanda copy, bill arithmetic, and ESC/POS injection safety. |
| `test-robustness.ts` | Concurrency races on one order, blackout recovery of the print queue, the full admin/staff/anonymous access matrix, malformed input, and session rotation. |
| `test-business-day.ts` | The 2am boundary. Backdates orders to 20:00, 00:30, 01:30 and 03:00 around a known night, then checks each surface: the DB keeps the real instant, order history and the closing aggregation fold the after-midnight orders into the previous day, every analytics range starts its days at 2am, and the time-of-day views (hourly bars, busy heatmap) still show the real hour. |
| `test-accounting.ts` | Closes the business day and checks every field of the closing report — and the printed receipt — against the day's orders recomputed independently. Also cross-checks the analytics endpoints. Runs last, because closing requires an empty floor. |
| `busy-day.ts` | A simulated Friday night: 10 POS terminals + 6 passive screens, 260 concurrent orders, mid-service additions, register expenses, and settlement with mixed payments. Independently reprices every order from `/api/menu`. |
| `bill-concurrency.ts` | Measures bill rasterization latency and failure rate as concurrent settlements rise (1 → 16). |
| `print-blocking.ts` | Whether a slow printer slows anything else down: order-ack latency and `/health` responsiveness while tickets print, plus the add-an-item-mid-print race. Run via `npm run test:print-blocking`, which starts a dedicated server with `PRINTER_EMULATION_DELAY_MS` set - the other suites would crawl if every ticket cost a second. |

`busy-day.ts` is tunable: `BUSY_ORDERS`, `BUSY_TERMINALS`, `BUSY_DASHBOARDS`,
and `BUSY_SETTLE_CONCURRENCY`. `print-blocking.ts` takes
`PRINTER_EMULATION_DELAY_MS` (default 1000).

### Proving print-blocking.ts isn't passing vacuously

`PRINTER_EMULATION_BLOCKING=1` makes the emulated printer block the event loop
the way `execFileSync` used to. Start a server with it and run the suite: three
assertions fail (ack latency, `/health` latency, dropped connections). That's
the regression it exists to catch.

## Known defects these suites still report

Reported as `WARN`, not `FAIL`, so the suites stay green as a regression gate
while still surfacing what the audit found. Turn them into failures once fixed.

1. **Every money-moving endpoint is reachable with no session**
   (`test-robustness.ts`, section E). `POST /orders/:id/complete`,
   `PUT /orders/:id/payments`, `POST /cash-flow/expenses` and
   `PUT /cash-flow/current/amount` all accept an unauthenticated caller on the
   LAN. Admin-gated endpoints are correctly gated; these simply have no gate.

2. **Cash tips are missing from "Efectivo final en caja"**
   (`test-accounting.ts`, section D). The closing receipt computes the expected
   drawer as `base + cashSales`, and `cashSales` deliberately excludes tips — so
   a tip handed over in cash sits in the drawer without being accounted for, and
   the nightly count comes up over by exactly the cash tips.

## Regressions these suites now guard

Fixed during the audit, and asserted here so they can't come back:

- **Bill rendering is serialized and time-boxed** (`bill-concurrency.ts`).
  Renders used to be unbounded: 16 at once left 14 failing after ~3 minutes
  each, and 260 leaked ~170 Chromium processes and 10 GB. The suite now asserts
  that 16 simultaneous settlements all succeed, none takes near the old
  protocol timeout, and the process doesn't accumulate pages.
- **The promo price on the kitchen ticket** (`test-printing.ts`, section E).
  Derived from the persisted `promoItem` flag rather than guessed from prices,
  and checked against orders where a pricier non-promo item shares the order.
- **The delivery day number is stable** (`test-printing.ts`, section I2).
  Deleting an earlier delivery order no longer renumbers later ones.
- **A payment correction refreshes the saved bill** (`test-printing.ts`,
  section H2), so a reprint shows the corrected methods.
- **The ticket's date and time fit the paper** (`test-printing.ts`, section A).
- **A slow printer doesn't slow anything else down** (`print-blocking.ts`).
  Printing used to be `execFileSync` - ~1s of frozen event loop per ticket, no
  acks, no HTTP, no live updates. It's async now, and the suite asserts an order
  placed mid-print is acked in single-digit milliseconds and that nothing is
  dropped. Section F covers the race that change introduced: an item added while
  its own order's ticket is printing must not be stamped printed without
  appearing on paper.
