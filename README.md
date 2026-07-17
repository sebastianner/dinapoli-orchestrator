# Dinapoli Pizza — Order Orchestrator

Node.js/Express/TypeScript orchestrator: receives orders over WebSocket, prices them
against the menu, persists them in SQLite, drives a persistent print queue, and
handles billing/payment on completion.

## Setup

```bash
npm install
npm run db:reset   # creates schema.sql tables and seeds menu.json + 9 tables
npm run build      # compiles src/**/*.ts -> dist/
npm start          # http://localhost:3000 (runs the compiled dist/server.js)
```

`npm run dev` runs `src/server.ts` directly via `tsx --watch` for local development
(no build step needed). `db:migrate`, `db:seed`, `db:reset`, and `ws:client` all run
their `.ts` source directly through `tsx` too.

Shared request/response/menu types live in `src/types/dinapoly-types.ts` (a copy of
`../dinapoly-types.ts`, kept in sync manually) and are imported throughout the server
instead of being hand-duplicated. DB row shapes used to type `better-sqlite3` prepared
statements live in `src/types/db.ts`.

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
- **Printer** (`src/services/printerService.js`): a single 80mm ESC/POS thermal
  printer, reached through its CUPS queue (`POS-80` by default, override with
  `PRINTER_QUEUE`) via `lp -d <queue> -o raw`, which hands our ESC/POS bytes to
  CUPS's USB backend unfiltered. Writing straight to `/dev/usb/lp0` was tried
  first and abandoned: CUPS's USB backend claims the device via libusb
  (detaching the kernel's `usblp` driver) as soon as it probes it, so that
  device node comes and goes unpredictably — going through CUPS is what
  actually owns the printer reliably on this machine. Two content paths feed it:
  - Kitchen tickets are plain 48-column text, wrapped with ESC/POS
    init/codepage-select/cut commands.
  - The bill is rendered as HTML (with the logo from `src/assets/`), rasterized
    with a headless Chromium (`puppeteer`) at 576px width, Floyd-Steinberg
    dithered to 1-bit via `pngjs`, and sent as chunked ESC/POS raster (`GS v 0`)
    commands so cheap controllers don't need to buffer the whole image at once.
  Both routes end up on the same physical printer since only one exists for now.
- **Saving + reprinting**: every generated kitchen ticket and bill is upserted
  into the `print_jobs` table (one row per `order_id` + `kind`), so a reprint
  re-sends the exact content that was originally generated rather than
  re-deriving it from the order. `POST /api/orders/:id/reprint` with
  `{ "kind": "kitchen_ticket" | "bill" }` triggers it.
- **Billing + payment** (`src/services/billingService.js`,
  `src/services/paymentService.js`): triggered by the complete-order endpoint.
  Payment processes the order total in COP; billing renders the HTML bill and
  hands it to the printer's rasterization pipeline.
- **Tables**: `restaurant_tables.status` is derived automatically — busy while a
  table has any non-`COMPLETED` order, freed the moment its last open order is
  completed. New orders for a busy table are still accepted.
- **Cash flow** (`src/services/cashFlowService.js`): tracks the physical cash
  register as a series of daily periods in `cash_flow` (one row per business
  day, Bogota local date). `getCurrentCashFlow` opens a fresh period the
  moment the latest row's `date` isn't today anymore, seeded from
  `cash_register_settings.default_opening_cash` (itself configurable) — this
  runs once at server boot (`server.ts`) and again lazily on any later
  cash-flow access, so a day never goes unopened even if the server was down
  at midnight. This row rotation is just bookkeeping, not the End-of-Day
  Closing itself (sales report, printed receipt) — that stays a manual staff
  action in a future module, which will read this table's history rather than
  rotate it. Old periods are never deleted or overwritten. Each
  `cash_expenses` row records one justified expense against a period; adding
  one subtracts the amount from that period's `cash_in_register` and adds it
  to `expenses` (both in the same transaction).

## API

- `GET /api/menu` — full menu, shaped exactly like `menu_simple_english_keys_v2.json`.
- `GET /api/orders?status=ACTIVE` — list orders, optionally filtered by status.
- `GET /api/orders/:id` — one order.
- `POST /api/orders/:id/complete` — marks an `ACTIVE` order `COMPLETED`; processes
  payment and prints the bill. Body: `{ "paymentMethod"?: "cash"|"card"|"transfer" }`
  (required if the order didn't already have one).
- `POST /api/orders/:id/reprint` — re-sends a previously saved kitchen ticket or
  bill to the printer. Body: `{ "kind": "kitchen_ticket" | "bill" }`. 404s if
  nothing has been printed/saved for that order+kind yet.
- `GET /api/tables` — table numbers and free/busy status.
- `GET /api/cash-flow/current` — the active register period (opens the first
  one from the configured default if none exists yet).
- `GET /api/cash-flow` — every register period ever recorded, newest first.
- `GET /api/cash-flow/:id/expenses` — expenses recorded against one period.
- `PUT /api/cash-flow/current/amount` — sets the current period's available
  cash directly. Body: `{ "amount": number }` (non-negative integer COP).
- `GET /api/cash-flow/settings` / `PUT /api/cash-flow/settings` — read/update
  the configurable default opening cash used to seed a new period. Body for
  `PUT`: `{ "defaultOpeningCash": number }`.
- `POST /api/cash-flow/expenses` — records an expense against the current
  period, subtracting it from available cash and adding it to the period's
  expense total. Body: `{ "amount": number, "justification": string }`.

## Trying it out

```bash
npm start
npm run ws:client   # scripts/test-order-client.js: places one sample dine_in order
```

Watch the server log for `[queue]`/`[printer]`/`[payment]` lines; the kitchen
ticket prints on the thermal printer as soon as the order is queued, and the
bill prints there too once the complete endpoint is called.

Printing goes through the `lp` CLI (part of CUPS), so the printer needs to
already exist as a CUPS queue — check with `lpstat -v` and adjust
`PRINTER_QUEUE` if it's not called `POS-80`. No special file permissions or
group membership are needed since CUPS handles device access itself.

## Known gaps for a production version

- No auth on the HTTP API or WebSocket.
- Payment processing is a stub (logs + records the transaction); no real gateway.
