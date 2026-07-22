# Dinapoli Pizza — Order Orchestrator

Node.js/Express/TypeScript orchestrator: receives orders over WebSocket, prices them
against the menu, persists them in SQLite, drives a persistent print queue, and
handles billing/payment on completion.

## Setup

```bash
npm install
npm run db:reset   # creates schema.sql tables and seeds menu.json + restaurant tables/settings
npm run build      # compiles src/**/*.ts -> dist/
npm start          # http://localhost:3000 (runs the compiled dist/server.js)
```

`npm run dev` runs `src/server.ts` directly via `tsx --watch` for local development
(no build step needed). `db:migrate`, `db:seed`, `db:reset`, and `ws:client` all run
their `.ts` source directly through `tsx` too.

Shared request/response/menu types live in `src/types/dinapoly-types.ts` and are
imported throughout the server instead of being hand-duplicated. DB row shapes used
to type `better-sqlite3` prepared statements live in `src/types/db.ts`.

## Architecture

- **DB**: SQLite via `better-sqlite3`, schema in `src/db/schema.sql` (mirrors
  `../dinapoli_schema.mmd`, extended from the original draft to capture
  per-group pizza pricing/flavors and product sizes/options — see the mmd file
  for the up to date ER diagram).
- **WebSocket intake** (`src/ws/orderSocket.js`, path `/ws/orders`): clients send
  an `OrderRequest` JSON payload (see `src/types/dinapoly-types.ts`); the server
  validates it against the menu, prices it server-side, persists it as `PENDING`,
  and acks with the full `Order` object (or an `{ type: 'error' }` message).
  `OrderRequest.employeeId` is optional but, when present, must be an
  existing, active employee (see Employees below) — the ack's `Order` object
  carries both `employeeId` and `employeeName` (both `null` when omitted), so
  the client gets the placing employee's name back without a second lookup.
  Pizza items pass only `size` + `flavors` — the group (classic/special) isn't
  chosen by the client; `orderService.resolvePizzaItem` derives it from the
  flavors picked, so mixing in a single `special` flavor upgrades the whole
  pizza to the special price for that size. `OrderRequest.tip` is optional
  (defaults to 0) and can also be set/overwritten later at any status via
  `PUT /api/orders/:id/tip` — it's stored separately from `total` (which is
  items-only) so it can be excluded from End-of-Day sales totals.
  `OrderRequest.deliveryFee` works the same way (optional, defaults to 0,
  updatable via `PUT /api/orders/:id/delivery-fee`) but is restricted to
  `orderType: 'delivery'` and — unlike tip — is meant to be *included* in
  sales totals (see End-of-Day Closing below).
- **Persistent queue** (`src/services/queueService.js`): the queue *is* the
  `orders.status` column — no separate queue store. A poll loop (every 2s, plus
  an immediate pass on boot and right after a new order or item addition
  arrives) picks up every `PENDING` or `PRINTING` row, prints a kitchen
  ticket, and advances it to `ACTIVE`. A row stuck in `PRINTING`
  (crash/blackout mid-print) is retried exactly like a fresh order on the
  next tick — this is the recovery strategy. Which ticket gets printed
  depends on `order_items.printed_at`: if none of the order's items have it
  set yet, this is the order's first pass through the queue and the full
  kitchen ticket prints; if some already do, this row is here because
  `POST /api/orders/:id/items` bounced an `ACTIVE` order back to `PENDING`,
  and only a short addendum ticket for the unprinted items prints instead
  (the kitchen already has the rest cooking/plated). Either way,
  successfully-printed items get `printed_at` stamped so the same item is
  never printed twice.
  - `POST /api/orders/:id/items` — adds items to any order that isn't
    `COMPLETED` yet (`PENDING`, `PRINTING`, or `ACTIVE`), using the same
    item validation/pricing as order creation, and adds their cost to
    `order.total`.
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
  `src/services/paymentService.js`): triggered by `POST /api/orders/:id/complete`.
  The full amount owed is `order.total + order.tip + order.deliveryFee` in COP
  (tip and delivery fee are real cash collected even though they're excluded
  from `total`). Settlement can be split across more than one method (e.g.
  part cash, part card): `completeOrder` accepts an optional `payments` array,
  `{ method, amount, tipAmount? }[]`, persisted one row per method to
  `order_payments`. `amount` across all rows must sum exactly to the amount
  owed; `tipAmount` (0 by default) marks the slice of that row's `amount`
  that's tip rather than sales and must sum exactly to `order.tip` — this is
  what lets a tip charged to only one method (e.g. added to the card while
  cash covers the rest) be excluded from *that* method's sales precisely
  instead of guessed via a proportional split (see End-of-Day below). Omitting
  `payments` falls back to a single payment for the full amount via the
  order's pre-declared `paymentMethod`, with that one method absorbing the
  whole tip — the common, non-split case needs no client changes. Billing
  renders the HTML bill — subtotal, delivery fee (when non-zero), tip (when
  non-zero), grand total, and one payment line per method — and hands it to
  the printer's rasterization pipeline.
- **Employees** (`src/services/employeeService.js`): identification only, no
  auth — a `name`, an optional `pictureUrl`, and `isActive` (default `true`).
  There's no edit endpoint, only add and soft-delete: `DELETE
  /api/employees/:id` sets `isActive: false` rather than removing the row, so
  historical orders keep a valid `employeeId`; `POST /api/employees/:id/activate`
  reverses that. Assigning an employee to an order is optional, but when
  provided it must be active (see WebSocket intake above).
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
  action (see below). Old periods are never deleted or overwritten. Each
  `cash_expenses` row records one justified expense against a period; adding
  one subtracts the amount from that period's `cash_in_register` and adds it
  to `expenses` (both in the same transaction).
- **End-of-Day Closing** (`src/services/endOfDayService.js`): a manual staff
  action (`POST /api/end-of-day/close`) that snapshots the current Bogota
  business day's sales — every `COMPLETED` order whose `completed_at` falls
  on that day (Colombia has no DST, so a fixed UTC-5 SQL offset is enough to
  match `todayDateStrBogota()`), summed as `total + delivery_fee` per order
  (tips excluded, delivery fees included, per spec) and categorized by order
  type (delivery vs. dine-in/takeaway) and, per `order_payments` row, by
  `method` (cash/card/transfer) — each row contributes `amount - tipAmount`
  to its method's bucket, so a tip charged to only one method of a mixed
  payment is excluded exactly rather than smeared proportionally across all
  of them. Plus that day's total expenses pulled from `cash_flow`. The
  snapshot — and the exact plain-text receipt printed for
  it — is persisted as a new `closing_reports` row rather than computed
  live on every read, so history survives later corrections to the
  underlying orders, and closing the same day twice (e.g. a reprint after a
  paper jam) just appends another row instead of overwriting. This is
  entirely independent from the cash-flow row rotation above — it doesn't
  open a new register period or touch `cash_flow` at all, it only reads it.

## API

- `GET /api/menu` — full menu, shaped exactly like `menu_simple_english_keys_v2.json`.
- `GET /api/orders?status=ACTIVE` — list orders, optionally filtered by status.
- `GET /api/orders/:id` — one order.
- `POST /api/orders/:id/items` — adds items to an order that isn't `COMPLETED`
  yet. Body: `{ "items": OrderItemRequest[] }` (same item shape as order
  creation). Adds their cost to `order.total` and, if the order was already
  `ACTIVE`, bounces it back to `PENDING` so the queue worker prints a short
  addendum ticket for just the new items.
- `POST /api/orders/:id/complete` — marks an `ACTIVE` order `COMPLETED`; processes
  payment and prints the bill. Body: `{ "payments"?: { method: "cash"|"card"|"transfer", amount: number, tipAmount?: number }[] }`.
  Omit `payments` to settle the full amount owed via the order's pre-declared
  `paymentMethod` (errors if it doesn't have one). Otherwise `amount` across
  all entries must sum exactly to `order.total + order.tip + order.deliveryFee`,
  and `tipAmount` (0 by default, must be `<= amount`) must sum exactly to
  `order.tip` — this is how a mixed payment (e.g. `[{ "method": "cash",
  "amount": 20000 }, { "method": "card", "amount": 35000, "tipAmount": 5000 }]`)
  attributes a tip charged to one specific method without it leaking into
  another method's sales.
- `POST /api/orders/:id/reprint` — re-sends a previously saved kitchen ticket or
  bill to the printer. Body: `{ "kind": "kitchen_ticket" | "bill" }`. 404s if
  nothing has been printed/saved for that order+kind yet.
- `PUT /api/orders/:id/tip` — sets (or overwrites) the order's tip. Allowed at
  any order status. Body: `{ "tip": number }` (non-negative integer COP).
- `PUT /api/orders/:id/delivery-fee` — sets (or overwrites) the order's delivery
  fee. Allowed at any order status, but a non-zero value is rejected unless the
  order's `orderType` is `delivery`. Body: `{ "deliveryFee": number }`
  (non-negative integer COP).
- `GET /api/tables` — table numbers and free/busy status.
- `GET /api/employees/active` / `GET /api/employees/inactive` — employees,
  split by `isActive`.
- `POST /api/employees` — adds a new (active) employee. Body:
  `{ "name": string, "pictureUrl"?: string }`.
- `DELETE /api/employees/:id` — soft-deletes: sets `isActive: false`.
- `POST /api/employees/:id/activate` — reverses a soft delete.
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
- `POST /api/end-of-day/close` — generates, saves, and prints the closing
  report for today's business day (Bogota local date). Safe to call more
  than once a day; each call appends a new report rather than overwriting.
- `GET /api/end-of-day` — every closing report ever generated, newest first.
- `GET /api/end-of-day/:id` — one closing report.
- `POST /api/end-of-day/:id/reprint` — re-sends a previously generated
  closing report's exact saved receipt to the printer.

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
