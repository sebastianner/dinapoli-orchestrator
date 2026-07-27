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
- **Promotions** (`orderService.validatePromoItems`/`applyPromoPricing`): an
  optional `OrderRequest.promoType` (`'duo' | 'pizza_xl'`), validated and
  flat-priced server-side regardless of what the frontend already restricts,
  same as every other price in this app. `'duo'` requires exactly 2 items from
  personal pizza (single flavor only, no mitad y mitad) / lasaña (not Mamma
  Mia) / pasta (not Marinera) / gratinado, excluding 5 "special" flavors
  (campesina, madrileña, atarraya, tricaccio, ardiente) wherever they'd
  otherwise apply, for a flat $37,000. `'pizza_xl'` requires exactly an XL
  pizza + a Gaseosa Personal + a Panes al Gratín for a flat $80,000, the soda
  and bread priced at $0 — except choosing the Coca-Cola or Quatro soda option
  adds a $2,000 surcharge. Either way the *first* qualifying item (the pizza,
  for `pizza_xl`) carries the full promo price and the rest are priced $0, so
  the sum of `order_items.unit_price` always equals `orders.total`. Persisted
  as `orders.promo_type`, set once at creation and never changed; printed on
  the kitchen ticket via `printerService.describePromoType`.
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
  The full amount owed is `order.grandTotal` (= `order.total + order.tip +
  order.deliveryFee`) in COP (tip and delivery fee are real cash collected
  even though they're excluded from `total`). Settlement can be split across
  more than one method (e.g. part cash, part card): `completeOrder` requires
  a `payments` array, `{ method, grossAmount, tipAmount? }[]` (one entry per
  method used — a plain single-method payment is just a one-entry array),
  persisted one row per method to `order_payments`. `grossAmount` — named
  distinctly from `order.total` so the two can't be confused, since it's the
  gross figure *including* tip/delivery fee — must sum exactly to the amount
  owed; `tipAmount` (0 by default) marks the slice of that row's `grossAmount`
  that's tip rather than sales and must sum exactly to `order.tip` — this is
  what lets a tip charged to only one method (e.g. added to the card while
  cash covers the rest) be excluded from *that* method's sales precisely
  instead of guessed via a proportional split (see End-of-Day below). Each
  persisted row also carries a server-computed `netAmount` (`grossAmount -
  tipAmount - deliveryFee` — never client-supplied), the products-only slice
  of that split; `SUM(netAmount)` across an order's payments always equals
  `order.total` exactly. `discount` (0 by default) is bounded by `netAmount`
  rather than `grossAmount`, since discounts apply to products, not tip or
  delivery fee. Billing renders the HTML bill — subtotal, delivery fee (when
  non-zero), tip (when non-zero), grand total, and one payment line per
  method — and hands it to the printer's rasterization pipeline.
- **Employees** (`src/services/employeeService.js`): a `name`, an optional
  `pictureUrl`, `isActive` (default `true`), and a `role` (`'staff'` or
  `'admin'`, default `'staff'`) - see Auth below for what the role gates.
  There's no generic edit endpoint, only add, soft-delete, and role changes:
  `DELETE /api/employees/:id` sets `isActive: false` rather than removing the
  row, so historical orders keep a valid `employeeId`; `POST
  /api/employees/:id/activate` reverses that; `PUT /api/employees/:id/role`
  promotes/demotes. Assigning an employee to an order is optional, but when
  provided it must be active (see WebSocket intake above). Creating an
  employee and all three of the above are admin-only (see Auth).
- **Auth** (`src/services/authService.js`, `src/middleware/auth.js`): cookie-based
  JWT sessions. `POST /api/auth/login` takes `{ employeeId, password? }` -
  `'staff'` employees log in by `employeeId` alone (picking their name/avatar
  in the UI, same flow as before); `'admin'` employees must also supply the
  matching `password` (verified against `employees.password_hash`, a bcrypt
  hash - see `src/utils/password.js` - never a reversible encryption of the
  plaintext, so a DB leak doesn't hand over usable passwords). On success the
  server sets two httpOnly cookies: `access_token`, a JWT (`{ employeeId,
  role }`) valid 24h, sent on every request; and `refresh_token`, an opaque
  random value valid 30 days and scoped to `/api/auth` only, whose sha256 is
  the only thing ever persisted (`refresh_tokens.token_hash` - same
  never-store-the-usable-secret reasoning as passwords). `POST
  /api/auth/refresh` exchanges a valid, unrevoked `refresh_token` for a new
  access token *and* a new refresh token (rotation: the old one is revoked in
  the same call, so each one is single-use) - the frontend calls this
  transparently and retries once whenever a request comes back `401` (see
  `frontend/src/lib/api.ts`), which is what lets a shift-long session skip
  re-login entirely. `POST /api/auth/logout` revokes the current refresh
  token and clears both cookies. `GET /api/auth/me` returns the employee for
  the current `access_token`, used to hydrate the frontend session on boot.
  `requireAuth` (verifies the JWT) and `requireAdmin` (re-checks the
  employee's *current* role against the DB rather than trusting the token's
  claim, so a mid-session demotion takes effect immediately instead of
  waiting up to 24h) gate: creating/deactivating/reactivating/re-roling
  employees, and deleting orders (see below). Nothing else in the API is
  gated - WebSocket order intake and every other HTTP route are unchanged,
  matching the narrower scope of what actually needed a role check. Since
  `POST /api/employees` is now admin-only, there's a bootstrap escape hatch
  for the very first admin: `npm run admin:create -- "<name>" "<password>"`
  (runs directly against the DB, no server needed).
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
  (tips and discounts excluded, delivery fees included, per spec) and
  categorized by order type (delivery vs. dine-in/takeaway) and, per
  `order_payments` row, by `method` (cash/card/transfer) — each row
  contributes `amount - tipAmount - discount` to its method's bucket, so a
  tip or discount on only one method of a mixed payment is excluded exactly
  rather than smeared proportionally across all of them. Tips and discounts
  are still tracked on the report as their own totals (`tips`, `discounts`)
  for visibility, they're just excluded from `total_sales` itself. Plus that
  day's total expenses pulled from `cash_flow`. The
  snapshot — and the exact plain-text receipt printed for
  it — is persisted as a new `closing_reports` row rather than computed
  live on every read, so history survives later corrections to the
  underlying orders, and closing the same day twice (e.g. a reprint after a
  paper jam) just appends another row instead of overwriting. This is
  entirely independent from the cash-flow row rotation above — it doesn't
  open a new register period or touch `cash_flow` at all, it only reads it.

## API

- `POST /api/auth/login` — `{ "employeeId": number, "password"?: string }`.
  `password` is required (and checked) only for `'admin'` employees; sets the
  `access_token`/`refresh_token` cookies on success.
- `POST /api/auth/refresh` — reads the `refresh_token` cookie, rotates it,
  and re-sets both cookies. No body.
- `POST /api/auth/logout` — revokes the current refresh token and clears both
  cookies. No body.
- `GET /api/auth/me` — the employee for the current `access_token` cookie.
  401s if missing/expired/invalid.
- `GET /api/menu` — full menu, shaped exactly like `menu_simple_english_keys_v2.json`.
- `GET /api/orders?status=ACTIVE&date=YYYY-MM-DD&orderType=dine_in` — list orders, optionally filtered by status, business day (Bogotá, UTC-5), and/or order type.
- `GET /api/orders/:id` — one order.
- `POST /api/orders/:id/items` — adds items to an order that isn't `COMPLETED`
  yet. Body: `{ "items": OrderItemRequest[] }` (same item shape as order
  creation). Adds their cost to `order.total` and, if the order was already
  `ACTIVE`, bounces it back to `PENDING` so the queue worker prints a short
  addendum ticket for just the new items.
- `POST /api/orders/:id/complete` — marks an `ACTIVE` order `COMPLETED`; processes
  payment and prints the bill. Body: `{ "payments": { method: "cash"|"card"|"transfer", grossAmount: number, tipAmount?: number, deliveryFee?: number, discount?: number }[] }`
  (required, non-empty — one entry per method used; a plain single-method
  payment is just a one-entry array). `grossAmount` across all entries must
  sum exactly to `order.grandTotal` (= `order.total + order.tip +
  order.deliveryFee`), and `tipAmount` (0 by default, must be `<= grossAmount`)
  must sum exactly to `order.tip` — this is how a mixed payment (e.g.
  `[{ "method": "cash", "grossAmount": 20000 }, { "method": "card",
  "grossAmount": 35000, "tipAmount": 5000 }]`) attributes a tip charged to one
  specific method without it leaking into another method's sales.
- `POST /api/orders/:id/reprint` — re-sends a previously saved kitchen ticket or
  bill to the printer. Body: `{ "kind": "kitchen_ticket" | "bill" }`. 404s if
  nothing has been printed/saved for that order+kind yet.
- `DELETE /api/orders/:id` — **admin only, irreversible.** Deletes the order
  and everything derived from it (`order_items`, `order_item_flavors`,
  `order_payments`, `print_jobs`) via the existing `ON DELETE CASCADE`
  foreign keys - no soft-delete, no undo. The frontend only exposes this
  behind an explicit two-step confirmation (a "remove mode" toggle, then a
  per-order confirm dialog, see `dashboard/order-history`), but the server
  enforces the admin check independently.
- `PUT /api/orders/:id/tip` — sets (or overwrites) the order's tip. Allowed at
  any order status. Body: `{ "tip": number }` (non-negative integer COP).
- `PUT /api/orders/:id/delivery-fee` — sets (or overwrites) the order's delivery
  fee. Allowed at any order status, but a non-zero value is rejected unless the
  order's `orderType` is `delivery`. Body: `{ "deliveryFee": number }`
  (non-negative integer COP).
- `GET /api/tables` — table numbers and free/busy status.
- `GET /api/employees/active` / `GET /api/employees/inactive` — employees,
  split by `isActive`. Public (needed by the pre-login employee picker); never
  includes `password_hash`.
- `POST /api/employees` — **admin only.** Adds a new (active) employee. Body:
  `{ "name": string, "pictureUrl"?: string, "role"?: "staff"|"admin", "password"?: string }`.
  `role` defaults to `"staff"`. `password` is required when `role` is
  `"admin"` (min 6 characters) and rejected otherwise.
- `DELETE /api/employees/:id` — **admin only.** Soft-deletes: sets `isActive: false`.
- `POST /api/employees/:id/activate` — **admin only.** Reverses a soft delete.
- `PUT /api/employees/:id/role` — **admin only.** Body: `{ "role": "staff"|"admin", "password"?: string }`.
  Promoting to `"admin"` (or rotating an existing admin's password) requires
  `password`; demoting to `"staff"` always clears the stored password hash.
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

- Auth (see Auth above) only gates employee management and order deletion -
  every other HTTP route and the WebSocket order intake are still open, by
  design (matches what's actually been asked for so far, not a full access-
  control system).
- No CSRF token on top of the cookie session - relying on `SameSite=Lax`
  (cross-site `fetch`/XHR POSTs don't carry the cookie) as the baseline
  defense instead, since none of this app's requests are cross-site to begin
  with.
- Payment processing is a stub (logs + records the transaction); no real gateway.
