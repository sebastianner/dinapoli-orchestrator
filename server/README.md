# Dinapoli Pizza — Order Orchestrator

Node.js/Express orchestrator: receives orders over WebSocket, prices them against
the menu, persists them in SQLite, drives a persistent print queue, and handles
billing/payment on completion.

## Setup

```bash
npm install
npm run db:reset   # creates schema.sql tables and seeds menu.json + 9 tables
npm start          # http://localhost:3000
```

`npm run dev` runs with `--watch` for local development.

## Architecture

- **DB**: SQLite via `better-sqlite3`, schema in `src/db/schema.sql` (mirrors
  `../dinapoli_schema.mmd`, extended from the original draft to capture
  per-group pizza pricing/flavors and product sizes/options — see the mmd file
  for the up to date ER diagram).
- **WebSocket intake** (`src/ws/orderSocket.js`, path `/ws/orders`): clients send
  an `OrderRequest` JSON payload (see `../dinapoly-types.ts`); the server validates
  it against the menu, prices it server-side, persists it as `PENDING`, and acks
  with the full `Order` object (or an `{ type: 'error' }` message).
  Pizza items pass only `size` + `flavors` — the group (classic/special) isn't
  chosen by the client; `orderService.resolvePizzaItem` derives it from the
  flavors picked, so mixing in a single `special` flavor upgrades the whole
  pizza to the special price for that size.
- **Persistent queue** (`src/services/queueService.js`): the queue *is* the
  `orders.status` column — no separate queue store. A poll loop (every 2s, plus
  an immediate pass on boot and right after a new order arrives) picks up every
  `PENDING` or `PRINTING` row, prints the kitchen ticket, and advances it to
  `ACTIVE`. A row stuck in `PRINTING` (crash/blackout mid-print) is retried
  exactly like a fresh order on the next tick — this is the recovery strategy.
- **Printer** (`src/services/printerService.js`): mock implementation behind a
  small interface (`print({ orderId, kind, format, content })`) that writes to
  `./print-output/`. Swap in a real ESC/POS driver (e.g. `node-thermal-printer`)
  here once printer connection details are known; no call sites change.
- **Billing + payment** (`src/services/billingService.js`,
  `src/services/paymentService.js`): triggered by the complete-order endpoint.
  Payment processes the order total in COP; billing renders a plain-text-styled
  HTML bill and sends it to the (mock) bill printer.
- **Tables**: `restaurant_tables.status` is derived automatically — busy while a
  table has any non-`COMPLETED` order, freed the moment its last open order is
  completed. New orders for a busy table are still accepted.

## API

- `GET /api/menu` — full menu, shaped exactly like `menu_simple_english_keys_v2.json`.
- `GET /api/orders?status=ACTIVE` — list orders, optionally filtered by status.
- `GET /api/orders/:id` — one order.
- `POST /api/orders/:id/complete` — marks an `ACTIVE` order `COMPLETED`; processes
  payment and prints the bill. Body: `{ "paymentMethod"?: "cash"|"card"|"transfer" }`
  (required if the order didn't already have one).
- `GET /api/tables` — table numbers and free/busy status.

## Trying it out

```bash
npm start
npm run ws:client   # scripts/test-order-client.js: places one sample dine_in order
```

Watch the server log for `[queue]`/`[printer]`/`[payment]` lines, and check
`./print-output/` for the generated kitchen ticket and (after calling the
complete endpoint) the bill HTML.

## Known gaps for a production version

- Printer is mocked (writes files) — no real hardware/ESC-POS integration yet.
- No auth on the HTTP API or WebSocket.
- Payment processing is a stub (logs + records the transaction); no real gateway.
