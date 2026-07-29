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
  `OrderRequest.employeeId` is required and must be an existing, active
  employee (see Employees below) - every order must be attributable to
  whoever placed it, so an order can never be created by "nobody" or the
  wrong person; the frontend enforces the matching rule on its side (no
  employee selected -> no route but `/select-employee` is reachable at all,
  see `frontend/src/routes/__root.tsx`). The ack's `Order` object carries
  both `employeeId` and `employeeName`, so the client gets the placing
  employee's name back without a second lookup.
  `OrderRequest.customerId` works the same way but is required for
  `'takeaway'`/`'delivery'` (optional for `'dine_in'` — customers can be
  attached to any order type, see Customers & locations below);
  `customerAddressId` is additionally required for `'delivery'` and must be
  one of that customer's own saved addresses. The ack's `Order` carries
  `customerId`/`customerAddressId` plus `customerName`/`phone`/`address`
  (a formatted string) derived server-side via a JOIN, so - like
  `employeeName` - the client never has to look the customer back up itself.
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
- **Live status broadcasts** (`src/ws/broadcast.js`): every `/ws/orders`
  connection is tracked in a client registry, separate from the request/reply
  order-intake flow above. Whenever an order is created, gains items, changes
  status (including the queue worker's own `PENDING`→`PRINTING`→`ACTIVE`
  ticks), or completes, the server pushes `{ type: 'order_updated', orderId }`
  to *every* connected client, not just whichever one triggered the change.
  Same idea for tables: `markTableBusy`/`refreshTableStatus`
  (`tableService.ts`) push `{ type: 'tables_updated' }` whenever a table flips
  free/busy. The frontend keeps one persistent, auto-reconnecting connection
  open for the whole session (`orderSocketClient.connectPersistent()`,
  wired up in `LiveOrderUpdates.tsx`) and reacts by re-fetching the affected
  order (feeding both the SWR cache and `useOrderStore.upsertActiveOrder`) or
  revalidating `/tables` — so Order History, Tables, and the active-orders
  sidebar all stay live without a manual refresh or any page-level polling.
- **Promotions** (`orderService.validatePromoItems`/`applyPromoPricing`): an
  optional `OrderRequest.promoType` (`'duo' | 'pizza_xl'`), validated and
  flat-priced server-side regardless of what the frontend already restricts,
  same as every other price in this app. `'duo'` requires exactly 2 items from
  personal pizza (single flavor only, no mitad y mitad) / lasaña (not Mamma
  Mia) / pasta (not Marinera) / gratinado, excluding 5 "special" flavors
  (campesina, madrileña, atarraya, tricaccio, ardiente) wherever they'd
  otherwise apply. `'pizza_xl'` requires exactly an XL pizza + a Gaseosa
  Personal + a Panes al Gratín, the soda and bread priced at $0 — except
  choosing the Coca-Cola or Quatro soda option adds a surcharge. Either way
  the *first* qualifying item (the pizza, for `pizza_xl`) carries the full
  promo price and the rest are priced $0, so the sum of `order_items.unit_price`
  always equals `orders.total`. Persisted as `orders.promo_type`, set once at
  creation and never changed; printed on the kitchen ticket via
  `printerService.describePromoType`, which derives the printed price from the
  order's own stored `order_items.unit_price` rather than the current setting,
  so an old ticket reprint is unaffected by later price edits (see below).
  - **Promo pricing** (`promoSettingsService`, `promo_settings` table — one row
    per `promo_type`, `price` + `soda_surcharge` for `pizza_xl`, `soda_surcharge`
    always 0 and unused for `duo`): admin-editable rather than hardcoded, seeded
    with `duo = $37,000` / `pizza_xl = $80,000` + `$2,000` soda surcharge.
    `applyPromoPricing` reads the current row live at order-creation time (no
    caching, no restart needed for an edit to take effect) — same
    server-is-authoritative principle as every other price. `GET /api/promos`
    is public (every order-placing screen needs it for display);
    `PUT /api/promos/:type` (`{ price, sodaSurcharge? }`, `sodaSurcharge` only
    accepted for `pizza_xl`) is admin-only, exposed in the frontend at
    `/ajustes/promos` behind a two-step edit-then-confirm modal.
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
  employees, deleting orders, deleting a customer, and creating/editing/
  deleting cities or neighborhoods (see below for both). Nothing else in the
  API is gated - WebSocket order intake and every other HTTP route are unchanged,
  matching the narrower scope of what actually needed a role check. Since
  `POST /api/employees` is now admin-only, there's a bootstrap escape hatch
  for the very first admin: `npm run admin:create -- "<name>" "<password>"`
  (runs directly against the DB, no server needed).
- **Ajustes** (`frontend/src/routes/ajustes`): employees, cities/
  neighborhoods, promos, table assignments, and menu settings all live here,
  gated client-side in one place by the layout route's own `beforeLoad`
  (each page used to carry its own copy of the same check) instead of
  per-page. The sidebar's "Ajustes" icon only renders for admins. Order
  history and closing reports stay under the separate `/dashboard`
  (sidebar icon "Resumen", visible to everyone) since order history is open
  to every employee - closing reports keeps its own admin-only `beforeLoad`
  there instead, same as before `/ajustes` existed.
- **Customers & locations** (`src/services/customerService.js`,
  `src/services/locationService.js`): a customer (`name`, optional
  `phone`/`email`) can have zero or more saved addresses; `orders` no longer
  stores a customer's name/phone/address as free text (see WebSocket intake
  above) - it references `customer_id`/`customer_address_id`, and
  `orderService.getOrderById` derives `customerName`/`phone`/`address` via a
  JOIN so printing/billing code didn't need to change at all. Creating an
  order for `'delivery'` checks that the chosen `customerAddressId` actually
  belongs to `customerId`. A `CustomerAddress` is `streetAddress` +
  `propertyType` (`'HOUSE'` or `'APARTMENT'` in the current order form; the
  DB also allows `'OFFICE'`/`'BUILDING'`/`'OTHER'` for later) + a
  `neighborhoodId` - apartments additionally carry `buildingName`/`tower`/
  `apartmentNumber` (`buildingName` isn't a managed list, it's autocompleted
  from whatever's already been typed for that neighborhood via `GET
  /api/customers/addresses/buildings`, so custom values always work too).
  `Neighborhood.deliveryFee` (COP) is exposed on every address the frontend
  fetches, so checkout can suggest a delivery order's fee without a second
  lookup - it's never auto-applied server-side, staff still confirm/adjust it
  like any other `payments[].deliveryFee` at completion. Every
  `Neighborhood` belongs to a `City`; both are seeded with a starting
  Cali/neighborhoods set (`db/seed.js`) - the only city seeded, which makes
  it the default in the delivery address form - and manageable afterward via
  the admin-only `/ajustes/ubicaciones` page.
  Creating/updating a customer or their addresses needs no auth at all (this
  is staff entering a walk-in/calling customer's details, not a public
  account system) - only `DELETE /api/customers/:id` is admin-gated, and
  only because customers with existing orders can't be deleted anyway (see
  below). `GET /api/customers/search?q=` is the order form's autocomplete:
  fuzzy, typo-tolerant matching against name and phone, backed by a
  `customers_fts` FTS5 virtual table with the **trigram** tokenizer
  (`customerService.searchCustomers` OR-joins the query's own trigrams
  rather than relying on FTS5's default AND-across-tokens, so one mistyped
  character doesn't fail the whole search). Trigram was chosen over the
  spellfix1 extension Todo.MD originally asked for: spellfix1 isn't vendored
  anywhere in this repo/environment and would need a per-platform compiled
  binary, while FTS5 trigram is already compiled into the installed
  `better-sqlite3` with zero extra setup. Deleting a customer or a
  neighborhood/city that still has rows referencing it (orders, addresses)
  fails with a 409 rather than orphaning/cascading - same reasoning that
  keeps employees soft-deleted instead of removed.
- **Product search** (`menuService.searchProducts`): `GET /api/menu/search?q=`
  is the same fuzzy/typo-tolerant trigram approach as customer search above -
  literally the same helper (`utils/trigramSearch.buildTrigramMatchQuery`),
  applied to a second FTS5 table, `products_fts`, over `products.name`/
  `description`. Results span every category (each one tagged with its
  `categoryId`), unlike `GET /api/menu` which comes back pre-grouped -
  matches don't require knowing which category a product lives in (e.g.
  "gratin" finds `Tomates al Gratín`/`Panes al Gratín` from Entradas *and*
  `Gratinado` from Gratinados in one search). Backing an FTS5 table for a
  table that predates it needs a one-time backfill (`migrate.ts`'s
  `backfillProductsFts`) - naively guarding it with `WHERE id NOT IN (SELECT
  rowid FROM products_fts)` doesn't work, since `products_fts` is an
  *external content* table and a plain read against it passes straight
  through to `products` regardless of indexing state; the real signal is
  whether `products_fts_docsize` has any rows yet. On the frontend, this
  powers `/menu/todos` ("Todos" in `CategorySidebar`, sitting above Pizzas)
  - a flattened, searchable view of every product across every category,
  respecting the same promo-eligibility rules as browsing a single category
  while a promo draft is active. The search input debounces locally
  (`lib/useDebouncedValue`, also now used by the customer autocomplete)
  instead of firing a request per keystroke.
- **Sold-out products** (`Product.isAvailable`): `GET /api/menu` and
  `GET /api/menu/search` used to filter to `is_available = 1`, so a sold-out
  product just vanished from the customer/staff-facing menu. Now every
  product comes back regardless, tagged `isAvailable`, and `ProductCard`
  renders a disabled, grayscaled card with an "Agotado" badge instead of the
  price/Agregar button when it's `false` - visible but not orderable, rather
  than silently gone. Ordering one is still rejected server-side either way
  (`orderService.resolveProductItem` already checked `is_available` before
  this change and still does) - the frontend guard is belt-and-suspenders,
  not the only thing stopping it.
- **Menu settings** (`menuService.listAllProductsForAdmin`/`createProduct`/
  `updateProduct`/`deleteProduct`, admin-only `/api/products` - a distinct
  router from the public `/api/menu`): every product regardless of
  `is_available`, with the numeric row id updates/deletes target (`GET
  /api/menu`'s `Product` is keyed by the string `key` instead). Create is
  deliberately narrow - flat-priced products only (name/description/price/
  category/availability), matching the todo's literal scope; a product
  priced per size (calzone) or requiring a pizza flavor (gratinado) still
  has to be seeded directly. Deleting fails with a 409 if the product has
  existing order history (same `isForeignKeyViolation` pattern as
  `customerService.deleteCustomer`) - mark it unavailable instead.
  `/ajustes/menu-settings` lists every product grouped by category, with
  two responsive row treatments switched by the `lg` breakpoint rather than
  one layout trying to serve both: below `lg` (mobile and tablet), rows are
  read-only (status dot/name/price) and tapping one opens `EditProductModal`
  - cramming an inline price input, an availability toggle, and a delete
  button next to the name doesn't leave the name room to even truncate, let
  alone read, on a narrow screen. At `lg` and up, the row stays inline-
  editable (price input + toggle + delete visible at once), which is where
  the horizontal room to do that actually exists.
- **Pizza settings** (`menuService.listPizzaAdminData`/`updatePizzaGroup`/
  `updatePizzaGroupSize`/`createPizzaFlavor`/`updatePizzaFlavor`, admin-only
  `/api/pizza-admin`): pizzas aren't `products` rows (see `buildPizzaCategory`),
  so they need their own admin surface separate from `/api/products`. Editable:
  a group's (category's) name, and the price each size sells for within a
  given group (`pizza_group_sizes.price` - null keeps a size not flat-priced,
  e.g. `slice`, which prices via portion splitting instead); flavors can be
  created and have their name/description/group membership edited (a flavor
  can be offered under more than one group, `pizza_group_flavors` being
  many-to-many). Sizes themselves (slices/maxFlavors) are structural and
  shared across both groups, so they're not editable here, and there's no
  delete for groups/flavors in this pass - both can be referenced by order
  history, same "mark unavailable instead" reasoning as products (not
  applicable yet since flavors have no `isAvailable` toggle exposed here
  either - out of scope for this pass). `/ajustes/menu-settings` gained a
  left-hand rail (`PizzaSettingsPanel.tsx`) listing every product category
  plus a single "Pizzas" entry - on mobile/tablet it's a horizontal
  scrollable chip strip, on desktop a vertical list, so it never has to
  shrink a category name to fit. Inside the Pizzas panel, switching between
  Clásicas/Especiales is a `<select>`, not a text box - only two groups
  exist and neither is created/deleted here, so free text would just invite
  typos; renaming a group is a separate explicit "Renombrar" button so it's
  never confused with the switcher. Flavor rows (up to 25 for Especiales)
  are always tap-to-edit via `EditPizzaFlavorModal`, at every breakpoint -
  unlike products' price/toggle/delete, a flavor edit needs
  name+description+group-checkboxes, which never fits inline regardless of
  screen width, so there's no separate desktop-inline treatment to maintain.
  A search box filters the active group's flavor list client-side.
- **Drink flavors** (`menuService.listDrinkFlavors`/`setProductDrinkFlavors`,
  admin-only `GET /api/products/drink-flavors`/`PUT /api/products/:id/drink-flavors`):
  a product's selectable, price-neutral flavors (e.g. Gaseosa 1.5L's Coca-Cola/
  Premio/Quatro/...) used to be one `product_options` row per product per
  flavor - "Coca-Cola" duplicated across every soda that offered it. Replaced
  by `drink_flavors` (shared/reusable, same shape as `pizza_flavors`) plus
  `product_drink_flavors` (which products offer which flavor, many-to-many) -
  editing "Coca-Cola" once now updates it everywhere it's offered. A product
  with zero flavor rows (Coca-Cola 3L, Leche) just doesn't show a picker at
  all, same presence-based rendering as `sizes`/`options` elsewhere.
  `setProductDrinkFlavors` takes the *exact* set a product should offer as an
  array of names, find-or-creating each one in `drink_flavors` (so typing
  "Coca-Cola" for a second product resolves to the same row, not a duplicate)
  and reconciling `product_drink_flavors` membership to match - old links not
  in the new set are dropped. `/ajustes/menu-settings`'s drinks category rows
  gain a "N sabores"/"+ Sabores" button (desktop inline, or inside
  `EditProductModal` on mobile/tablet) opening `DrinkFlavorsModal`: existing
  flavors show as removable chips, typing filters the shared library for a
  "select existing" suggestion list, and a name with no match offers "+ Crear
  "…"" to create a new one on save.
- **Tables**: `restaurant_tables.status` is derived automatically — busy while a
  table has any non-`COMPLETED` order, freed the moment its last open order is
  completed. New orders for a busy table are still accepted.
  - **Table count** (`tableService.increaseTableCount`/`decreaseTableCount`,
    admin-only `POST /api/tables/increase`/`decrease`): the restaurant's table
    count isn't fixed at 9 - `restaurant_tables.number`/`orders.table_number`
    used to be hard-`CHECK`ed to 1-9, widened (`migrate.ts`'s
    `widenTableNumberBounds`, a table-rebuild since SQLite can't ALTER a CHECK
    in place) to just `> 0` once table count became runtime-adjustable. Tables
    are always numbered 1..N with no gaps: increase adds N+1, decrease removes
    N (refusing with a 409 if it's currently occupied) - so `tableExists(n)` is
    just "n is within the current count", used in place of the old hardcoded
    upper bound everywhere a table number is validated (`orderService
    .validateOrderRequest`, `updateOrderTable`). A sanity ceiling (40) is
    enforced in the service, not the DB, purely to stop the admin panel from
    growing the floor plan into something nonsensical by mistake.
    `/ajustes/table-assignments` exposes this as a `+`/`-` stepper with a
    confirmation dialog before saving (steps the single-step endpoint above
    that many times in sequence for a multi-table change).
  - **Reassigning an order's table** (`orderService.updateOrderTable`, admin-
    only `PUT /api/orders/:id/table`): corrects a dine-in order's table after
    the fact - frees the old table (`refreshTableStatus`, recomputed rather
    than assumed - it might have another open order) and marks the new one
    busy. Same `/ajustes/table-assignments` page, plus an admin-only
    shortcut on a busy dine-in table's tile (`/tables`, both the grid and
    floor-plan views) that deep-links straight to that order's edit modal via
    a `?orderId=` search param.
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
  for visibility, they're just excluded from `total_sales` itself. The report
  also carries `itemsSold` (sum of `order_items.quantity` across the day's
  completed orders), `customersServed` (distinct `customer_id` count — the
  same customer ordering twice still counts once), and per-type order counts
  (`deliveryOrderCount`/`dineInOrderCount`/`takeawayOrderCount`). Plus that
  day's total expenses pulled from `cash_flow`. The
  snapshot — and the exact plain-text receipt printed for
  it — is persisted as a new `closing_reports` row rather than computed
  live on every read, so history survives later corrections to the
  underlying orders, and closing the same day twice (e.g. a reprint after a
  paper jam) just appends another row instead of overwriting. This is
  entirely independent from the cash-flow row rotation above — it doesn't
  open a new register period or touch `cash_flow` at all, it only reads it.
  Generating a report is open to any logged-in employee, not just admins —
  `closeDay()` rejects the request (409) if any of today's orders aren't
  `COMPLETED` yet, so a report can never under-count sales from an order
  that's still open. Reviewing past reports (`GET /api/end-of-day`,
  `GET /api/end-of-day/:id`, reprinting) stays admin-only though, since they
  expose the full day's sales/tips/discounts breakdown.

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
- `GET /api/menu/search?q=` — fuzzy product search across every category (see
  Product search above). Each result is a `Product` plus `categoryId`.
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
  per-order confirm dialog, see `ajustes/order-history`), but the server
  enforces the admin check independently.
- `PUT /api/orders/:id/tip` — sets (or overwrites) the order's tip. Allowed at
  any order status. Body: `{ "tip": number }` (non-negative integer COP).
- `PUT /api/orders/:id/delivery-fee` — sets (or overwrites) the order's delivery
  fee. Allowed at any order status, but a non-zero value is rejected unless the
  order's `orderType` is `delivery`. Body: `{ "deliveryFee": number }`
  (non-negative integer COP).
- `PUT /api/orders/:id/table` — **admin only.** Reassigns a `dine_in` order to a
  different table. Body: `{ "tableNumber": number }` (must be one of the
  restaurant's current tables). 409s if the order is already `COMPLETED`.
- `GET /api/tables` — table numbers and free/busy status.
- `POST /api/tables/increase` / `POST /api/tables/decrease` — **admin only.**
  Adds/removes exactly one table (always the highest number). `decrease` 409s
  if that table currently has an open order.
- `GET /api/products` — **admin only.** Every product regardless of
  `is_available`, for `/ajustes/menu-settings` (see Menu settings above).
- `POST /api/products` — **admin only.** `{ "categoryId": string, "name": string, "description"?: string, "price": number, "isAvailable"?: boolean }`.
  Flat-priced products only.
- `PUT /api/products/:id` — **admin only.** Same body, all fields optional.
- `DELETE /api/products/:id` — **admin only.** 409s if the product has existing
  order history.
- `GET /api/products/drink-flavors` — **admin only.** The shared flavor
  library (`{ id: number, key: string, name: string }[]`), for
  `DrinkFlavorsModal`'s "select existing" suggestions.
- `PUT /api/products/:id/drink-flavors` — **admin only.** `{ "flavors": string[] }` -
  the exact set of flavor names this product should offer (0 to many);
  find-or-creates each name in the shared library and reconciles membership
  to match (see Drink flavors above).
- `GET /api/pizza-admin` — **admin only.** `{ groups: AdminPizzaGroup[], flavors: AdminPizzaFlavor[] }`
  (see Pizza settings above).
- `PUT /api/pizza-admin/groups/:groupId` — **admin only.** `{ "name": string }`.
- `PUT /api/pizza-admin/groups/:groupId/sizes/:sizeId` — **admin only.**
  `{ "price": number | null }`.
- `POST /api/pizza-admin/flavors` — **admin only.**
  `{ "name": string, "description"?: string, "groupIds": PizzaGroupId[] }`.
- `PUT /api/pizza-admin/flavors/:id` — **admin only.** Same body, all fields optional.
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
- `GET /api/customers/search?q=` — fuzzy customer search (name/phone), each
  result including its saved addresses. Open, no auth.
- `GET /api/customers/:id` — one customer with addresses.
- `POST /api/customers` — `{ "name": string, "phone"?: string, "email"?: string }`.
- `PUT /api/customers/:id` — same body, all fields optional (partial update).
- `DELETE /api/customers/:id` — **admin only.** 409s if the customer has
  existing orders.
- `POST /api/customers/:id/addresses` / `PUT /api/customers/:id/addresses/:addressId` —
  `{ "streetAddress": string, "propertyType": "HOUSE"|"APARTMENT"|"OFFICE"|"BUILDING"|"OTHER", "neighborhoodId": number, "apartmentNumber"?: string, "tower"?: string, "buildingName"?: string, "reference"?: string }`.
- `DELETE /api/customers/:id/addresses/:addressId` — open, no auth (same as
  editing). 409s if the address is used by an existing order.
- `GET /api/customers/addresses/buildings?neighborhoodId=&q=` — distinct
  previously-used building/conjunto names for that neighborhood, for the
  address form's autocomplete.
- `GET /api/locations/cities` — open, no auth (every order-placing screen
  needs it).
- `POST /api/locations/cities` / `PUT /api/locations/cities/:id` — **admin only.**
  `{ "name": string, "department"?: string, "country"?: string }`.
- `DELETE /api/locations/cities/:id` — **admin only.** 409s if it still has neighborhoods.
- `GET /api/locations/cities/:id/neighborhoods` — open, no auth.
- `POST /api/locations/neighborhoods` / `PUT /api/locations/neighborhoods/:id` — **admin only.**
  `{ "name": string, "cityId": number, "deliveryFee"?: number }` (cityId only on create).
- `DELETE /api/locations/neighborhoods/:id` — **admin only.** 409s if it still has addresses.
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
- `POST /api/end-of-day/close` — any logged-in employee. Generates, saves,
  and prints the closing report for today's business day (Bogota local
  date). 409s if any of today's orders isn't `COMPLETED` yet. Safe to call
  more than once a day otherwise; each call appends a new report rather than
  overwriting.
- `GET /api/end-of-day` — **admin only.** Every closing report ever
  generated, newest first.
- `GET /api/end-of-day/:id` — **admin only.** One closing report.
- `POST /api/end-of-day/:id/reprint` — **admin only.** Re-sends a previously
  generated closing report's exact saved receipt to the printer.
- `GET /api/promos` — open, no auth (every order-placing screen needs it for
  display). Current price/soda surcharge for both promo types.
- `PUT /api/promos/:type` — **admin only.** `{ "price": number, "sodaSurcharge"?: number }`.
  `sodaSurcharge` is only accepted for `pizza_xl`; sending it for `duo` 400s.

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
