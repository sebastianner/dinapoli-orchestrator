```md
# TODO

- [x] Invoice design
- [ ] Employee information and associate it with an order
- [ ] Verify pricing and price calculations
- [ ] Add tips
- [ ] Add delivery fee
- [ ] Add promotions

- [x] Add a **Cash Flow** module
  - [x] Store a default or configurable amount of cash available in the register, refreshed daily.
  - [x] Expose an endpoint to update the cash amount from the client.
  - [x] Create a new table containing:
    - ID
    - Cash in register
    - Expenses
    - Date
  - [x] Expose an endpoint to add expenses with a text justification.
  - [x] Subtract the expense from the available cash.
  - [x] Add the expense to the total expenses.

- [ ] Add an **End-of-Day Closing** module
  - [ ] Gather all sales data for the day.
  - [ ] Generate and print a closing receipt.
  - [ ] Calculate total sales for the day.
  - [ ] Categorize sales by:
    - [ ] Delivery
    - [ ] Dine-in / Takeaway
  - [ ] Categorize sales by payment method:
    - [ ] Bank Transfer
    - [ ] Cash
    - [ ] Card
  - [ ] Display the total amount for each category.
  - [ ] Display grand total sales.
  - [ ] Exclude tips from all sales totals.
  - [ ] Include delivery fees in all sales totals.
  - [ ] Display total expenses for the day.
- [ ] Expand billing module to accept mixed payments (e.g., cash + card, cash + bank transfer, etc.)
- [x] Right now the system prints one commanda after creating an order, but it should print two commandas with the same order information, one for the kitchen and one for the cashier.
```
