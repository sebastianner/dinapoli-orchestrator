# Frontend Project for a Pizzeria POS System

## Requirements

- The UI should resemble modern POS systems such as TOAST, featuring a clean, consistent color palette with support for both light and dark mode.
- The application should include smooth animations to improve the overall user experience.
- Use Zustand as the state management solution.
- The application must be fully responsive.
- Use Tailwind CSS for layout styling and SCSS for other purposes such as color palettes, variables, and animations.
- Follow Tailwind's default design system, including its predefined breakpoints and spacing values. Avoid using arbitrary decimal values.
- Use the `classnames` utility to keep class names organized and maintainable.
- The project should use Vite.
- When the application starts, it should fetch all active orders (`GET /api/orders?status=ACTIVE`), menu items, employees, tables, and any other required data.
- Cache requests that rarely change, such as `GET /api/menu`, using SWR.
- Fetching a single order's up-to-date detail (e.g. after reconnecting or deep-linking into an existing order) should use `GET /api/orders/:id`.
- All prices must be formatted in Colombian Pesos (COP).
- The entire user interface must be in Spanish, while all source code (variables, functions, etc.) should remain in English.
- All pages prefixed with `DASHBOARD` should be implemented as nested routes under `Dashboard/[subpage]`.

---

# Pages

## 1. Select Employee (`/select-employee`)

- Fetch all active employees from the API.
- Display each employee's name with a DiceBear avatar above it.
- If there are no employees, display only the "Create Employee" button.
- If employees exist, also display a "Create Employee" button beside the employee list.
- Hovering over an employee should reveal two vertically stacked buttons:
  - Select
  - Edit (smaller button below)
- Clicking **Create** or **Edit** should open a modal with a smooth animation.
- After creating or editing an employee, close the modal and display a success notification.
- There is no edit endpoint on the backend, only add and soft-delete — "Edit" here should only cover client-editable fields (e.g. re-uploading/regenerating the avatar), not renaming via a PUT that doesn't exist.
- Include a "Deactivate" action per employee (`DELETE /api/employees/:id`), which soft-deletes them (`isActive: false`) rather than removing their history.
- Add a toggle or secondary tab to view inactive employees (`GET /api/employees/inactive`), each with a "Reactivate" button (`POST /api/employees/:id/activate`).
- The active employee list itself comes from `GET /api/employees/active`.

---

## 2. Tables Page

- Create a reusable Table component representing each table returned by `/api/tables`.
- The table component should display the table number in the center.
- Available tables should be green.
- Occupied tables should be red.
- Clicking an available table navigates to the Menu page, allowing the employee to start adding items.
- Clicking an occupied table also navigates to the Menu page because additional items can still be added to the existing order, but a notification should indicate that the table is already occupied.
- Include two side buttons:
  - Delivery
  - Takeaway
- Clicking either Delivery, Takeaway, or a table should:
  - Navigate to the Menu page.
  - Create a new order in the store.
- The store should contain an array of active orders fetched from the API, while also allowing new client-side orders to be added.

---

## 3. Menu Page

- Fetch the menu from `/api/menu`.
- Display a left sidebar containing every menu category with an image.
- Clicking a category should navigate to its dedicated page.
- The category sidebar should remain visible while browsing categories.
- After adding the first item to an order, display the Order Overview component showing the subtotal.
- When viewing an existing table or order, display the existing order summary at the top or side of the page.
- Users should be able to access the Menu page without first selecting an order type or table.
- If they attempt to place an order without one selected, display a warning with a button redirecting them to `/tables`.
- Items already added must remain preserved in the store.

---

## 4. Menu Product Category Page

- Display every product within the selected category.
- Each product should include:
  - Name
  - Description
  - Price
- Product images are optional.
- Each menu item should be displayed using a reusable, visually appealing component.
- Each product should include:
  - Add to Order button
  - Add Comment button

---

## 5. Pizza & Calzone Menu

- Selecting a pizza or calzone should first require choosing a size.
- After selecting a size, navigate to the flavor selection screen.
- Include an Add Comment button.

---

## 6. Dashboard - Cash Flow

- Page for configuring cash flow settings.
- View and edit the current day's cash amount:
  - Fetch it via `GET /api/cash-flow/current` (this also opens today's period if one doesn't exist yet).
  - Edit it via `PUT /api/cash-flow/current/amount`.
- Button to update the default starting cash value, backed by `GET /api/cash-flow/settings` / `PUT /api/cash-flow/settings`.
- Include a calendar component for browsing daily expenses, listing every past register period via `GET /api/cash-flow`.
- Selecting a date should display a summary of all expenses for that day via `GET /api/cash-flow/:id/expenses`.
- If today's date is selected, display an interface for registering expenses with a required justification, submitted via `POST /api/cash-flow/expenses`.

---

## 7. Dashboard - Order History

- Include a calendar for viewing order history by date.
- Orders should be filterable by category or All.
- Backend work is required to provide an endpoint that returns orders filtered by date and category.
- Include two shortcut buttons:
  - Today
  - Yesterday
- Selecting a day should display every order from that date using reusable order components.
- If today's orders are being viewed, display a green button labeled **Generate Closing Report**.
- When viewing previous days, display a **View Closing Report** button instead.
- Generating a closing report should call:

```
POST /api/end-of-day/close
```

- Upon success, redirect to the individual closing report page.
- Include a button to reprint the order or receipt:

```
POST /api/orders/:id/reprint
```

---

## 8. Dashboard - Closing Report History

```
GET /api/end-of-day
```

- Display the complete history of closing reports using reusable components.
- Clicking one should navigate to its individual report page.

---

## 9. Dashboard - Individual Closing Report

```
GET /api/end-of-day/:id
```

- Display the report using separate dashboard columns.
- Include a chart showing sales volume by hour.
- Include a button to print the report again:

```
POST /api/end-of-day/:id/reprint
```

---

# Components

## 1. Order Overview Component

- Display every item currently in the order.
- Display the subtotal.
- Include a Remove Item button.
- Include a Submit Order button that sends the order through WebSockets. This is only for the order's *first* submission (creation); once the order already exists (status `PENDING`/`PRINTING`/`ACTIVE`), adding further items must go through:

```
POST /api/orders/:id/items
```

  which reprices and adds to `order.total`, and — if the order was already `ACTIVE` — bounces it back to `PENDING` so the kitchen gets a short addendum ticket for just the new items.
- Include an editable Tip field, saved via:

```
PUT /api/orders/:id/tip
```

  Allowed at any order status; stored separately from `total` so it's excluded from End-of-Day sales totals.
- If the order type is Delivery, display an editable Delivery Fee field using:

```
PUT /api/orders/:id/delivery-fee
```

- Include a **Charge / Complete Order** button that opens a payment modal:
  - Show the total amount owed (`order.total + order.tip + order.deliveryFee`).
  - Let the employee pick a payment method: cash, card, or transfer.
  - Support splitting the total across more than one method (e.g. part cash, part card), with an optional `tipAmount` per line so a tip charged to only one method doesn't leak into another method's sales.
  - On confirm, call:

```
POST /api/orders/:id/complete
```

    with `{ "payments"?: { method: "cash" | "card" | "transfer", amount: number, tipAmount?: number }[] }`. Omitting `payments` settles the full amount via the order's pre-declared payment method (only valid if one was set); otherwise `amount` across all entries must sum exactly to the total owed, and `tipAmount` must sum exactly to `order.tip`.
  - On success, the backend marks the order `COMPLETED` and prints the bill automatically — close the modal and show a success notification (no separate print action needed here).

---

## 2. Left Navigation Sidebar

- Part of the main layout.
- Persistent across all pages.
- Navigation links:
  - Select Employee
  - Settings
  - Tables
  - Menu
- Use any well-known open-source icon library.
- Include a shortcut button featuring the Rappi logo (placeholder only for now).

---

## 3. Header

- Part of the main layout.
- Display the Dinapoli Pizza logo at the top.
- Display:
  - Current time
  - Current date
  - Current day