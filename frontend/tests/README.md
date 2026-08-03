# Frontend test suites

Pure-logic tests for the parts of the frontend that decide what a customer is
charged. No DOM, no React, no server — just the functions, run through `tsx`.

```bash
npm test    # from frontend/
```

There is no test framework here on purpose: these files only call plain
functions, so `tests/harness.ts` (about 60 lines) is enough, and adding Vitest
or Jest would mean a bundler config, a jsdom environment, and a dependency tree
for two files. `tsx` is borrowed from `../server/node_modules`, so nothing new
is installed.

Individual files run standalone too:

```bash
npx --prefix ../server tsx --tsconfig tsconfig.app.json tests/pricing.test.ts
```

(`--tsconfig tsconfig.app.json` is what teaches `tsx` the `@/*` path alias the
source files use.)

## Suites

| File | Covers |
| --- | --- |
| `pricing.test.ts` | `src/lib/pricing.ts` and `src/lib/promos.ts`: pizza group resolution, the cart's price preview, flavor-portion splits, promo previews and eligibility, and cart line grouping — all checked against the rules `server/src/services/orderService.ts` actually enforces. |
| `checkout-math.test.ts` | The settlement math in `PaymentModal` / `EditPaymentsModal`, cross-checked against the server's acceptance rule (`orderService.resolvePayments`), including a 20,000-case randomised sweep. |

## Why the cross-check matters

The cart shows a price before the order exists, and the payment modal decides
whether "Confirmar cobro" is clickable — but the server recomputes both and is
the only authority. Wherever the two disagree, staff see a number that isn't
what gets charged, or a button that looks ready and then errors. These tests
encode the server's rules alongside the client's so a divergence fails here
rather than at the till.

## Regression this suite guards

`checkout-math.test.ts` exists because of a real bug found in the audit, now
fixed:

> **The payment modals validated a settlement only in aggregate, while the
> server validates each split individually.**
>
> The modals enabled submit when `sum(netAmount) === order.total + tips + fees -
> discounts`. The server additionally requires, *per split*, that
> `tipAmount <= grossAmount`, `deliveryFee <= grossAmount`, and
> `discount <= grossAmount - tipAmount - deliveryFee`.
>
> With one payment method the two always agree. With a mixed payment they could
> diverge. Confirmed against a live server at the time:
>
> - Order of $27.000. Cashier splits it "$25.000 cash, rest on the card" and
>   marks a $5.000 tip on the card line. The card split carries only $2.000 of
>   food. The modal enabled the button; the server answered
>   `400 payments[1].tipAmount no puede superar payments[1].grossAmount`, with
>   the customer standing at the till.
>
> Both modals now share `src/lib/paymentSplits.ts`, which mirrors every rule the
> server enforces, highlights the offending row, and says what to do about it
> ("La propina no cabe en lo cobrado por este método..."). The tests exercise
> those real helpers - not a copy of the formula - and include a 20,000-case
> randomised sweep asserting that everything the UI enables, the server accepts.
