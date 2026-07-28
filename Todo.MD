- [x] Employees can now have an **Admin** role. Only admins can access the Admin Panel and manage other employees. Additionally, only admins can create new employees and assign roles.

- [x] Admins can now permanently remove orders from the system. This feature provides better order management while ensuring only authorized users can perform this action.

  - Only admins can remove orders. This action is **irreversible**, and a confirmation dialog must be displayed before the order is permanently deleted.
  - Deleting an order removes it from the database along with all related data, including:
    - Order items
    - Customer information associated with the order
    - Payment details
  - Once an order is deleted, it **cannot be recovered**.
  - On the frontend, the **Remove Order** option in the **Order History** page should only be visible to admins.
  - Each order should have its own **Remove** button. To prevent accidental deletions, these buttons should only appear after the admin enables "Remove Mode." Clicking the button should display a confirmation dialog explaining that the action is permanent before the order is deleted.

---

- [x] Add support for customer information management and to the **Delivery Order** form.

  ### Customer Autocomplete

  - As the user types the customer's name or phone number, display an autocomplete list of saved customers.
  - Selecting a customer should automatically populate the form with:
    - Name
    - Phone number
    - Delivery addresses
  - If no matching customer exists, allow creating a new customer directly from the order form.
  - Use Spellfix1 for fuzzy matching to improve the autocomplete experience.

  ### Customer Model

  - Create a new `Customer` table.
  - Replace the customer name stored in the `Order` table with a `customer_id` foreign key.
  - Customers may exist without any associated addresses.

  ```text
  Customer
  --------
  id
  name
  email
  phone_number
  ```

  ### Customer Addresses

  A customer can have zero or more addresses.

  ```text
  CustomerAddress
  ---------------
  id
  customer_id
  street_address
  property_type      -- HOUSE | APARTMENT | OFFICE | BUILDING | OTHER
  neighborhood_id
  apartment_number
  tower
  building_name
  reference
  latitude           -- nullable
  longitude          -- nullable
  google_place_id    -- nullable
  formatted_address  -- nullable
  ```

  ### Neighborhoods

  ```text
  Neighborhood
  ------------
  id
  name
  city_id
  delivery_fee
  ```

  ### Cities

  ```text
  City
  ----
  id
  name
  department
  country
  ```

  ### Delivery Address Form

  - The delivery form should support two property types:
    - House
    - Apartment
  - Both property types should include:
    - Street address
    - City
    - Neighborhood
  - If **Apartment** is selected, display additional fields:
    - Building/Conjunto
    - Tower
    - Apartment number
  - The form should follow the Colombian addressing format.

  ### Neighborhood Selection

  - Neighborhoods should be selected from a dropdown.
  - The dropdown should be populated dynamically based on the selected city.
  - Building/Conjunto should also be selectable from an autocomplete list, while still allowing custom values.

  ### Customer Selection

  - Customers should be selectable regardless of the order type.
  - If the customer does not exist, allow creating them directly from the order slip.
  - Creating a customer **does not require an address**.
  - Addresses can be added later or during delivery order creation.

  ### Customer API

  Expose endpoints for:

  - Create customer
  - Update customer
  - Delete customer
  - Create customer address
  - Update customer address
  - Delete customer address

  Authorization rules:

  - Creating customers: **No authentication required**
  - Updating customers (adding/editing addresses): **No authentication required**
  - Deleting customers: **Admin only**

  ### Multiple Addresses

  A customer may have multiple saved addresses (e.g., Home, Work, Family).

  When creating or editing a customer, users should be able to manage multiple addresses associated with the same customer account.

  ### User Selection Enforcement
- [x] When no user selected we shouldn't display the app just a select user screen. If no user selected you shouldn't be able to access any other part of the app. This is to prevent accidental orders being created by the wrong user. The orders should always be associated with a employee. Update both frontend and backend to enforce this rule:
    - Frontend: If no user is selected, display a user selection screen. The user must select an employee before accessing any other part of the app.
    - Backend: Ensure that all order creation requests are associated with a valid employee. If no employee is selected, reject the request and return an appropriate error message.
    - This change is to prevent accidental orders being created by the wrong user. The orders should always be associated with an employee.
    - After selecting a user, use a transition animation to indicate that the user has been selected and the app is now accessible. This will provide a clear visual cue to the user that they can now proceed with their tasks. Give me 10 different transition animation ideas for this user selection process.

    ### Generar cierre del dia changes:
- [x] Right now only admins can generate a close report but it should be possible for any employee to generate a close report but with the constraint that all orders must be closed. The close report should be augmented to include the following information:
    - Total number of orders
    - Total number of items sold
    - Total number of customers served
    - Total number of delivery orders
    - Total number of dine-in orders
    - Total number of takeout orders

    ### Menu Promos:
    - [x] Make promo prices editable by admins. Admins should be able to update promo prices. This will allow for more flexibility in managing promotions and pricing strategies. Expose an endpoint for updating promo prices, and ensure that only admins can access this functionality. The frontend should provide a user-friendly interface for admins to edit promo prices, with appropriate validation and confirmation prompts to prevent accidental changes.

    ### Order status refresh:
- [x] Implement a mechanism to refresh the order status in real-time. This will ensure that the order status displayed on the frontend is always up-to-date, providing a better user experience and reducing confusion for employees and customers. The order status should be updated automatically without requiring manual page refreshes 
- push { type: 'order_updated', orderId } to the connected clients whenever an order is updated. The frontend should listen for these events and update the order status accordingly using swr mutation. This will provide a seamless and responsive experience for users, allowing them to stay informed about the status of their orders in real-time.

    ### Edit table number
    - [x] Expose an endpoint to allow editing the table number for dine-in orders. This will provide flexibility in managing dine-in orders and ensure that the correct table number is associated with each order. The API should allow authorized users to update the table number for a specific order, and the frontend should provide an intuitive interface for making these changes.
    - Implement the endpoint on frontend side for admin users to edit the number of the table for dine-in orders. This will allow admins to correct any mistakes or changes in table assignments, ensuring accurate order tracking and service.
    - add a new tab page on resumen to edit the table number for dine-in orders. This tab should be accessible to authorized users and provide a clear interface for updating the table number associated with a specific order.
    - Implement a confirmation dialog before saving the changes to the table number. This will help prevent accidental updates and ensure that users are aware of the changes they are making. The confirmation dialog should clearly display the new table number and ask for user confirmation before proceeding with the update.
    - add a plus and minus button to the table number input field to allow users to easily increment or decrement the table number. This will provide a convenient way for users to adjust the table number without having to manually type in the value, improving usability and efficiency.
    - There should be a shortcut on /tables that redirects to the edit table number page for dine-in orders. This shortcut will provide quick access for authorized users to manage table numbers, streamlining the workflow and enhancing the overall user experience.

    ### Menu dashboard settings:
  - [x] Settings dashboard for menu items. This will allow admins to configure various settings related to menu items, such as availability (product.is_available), pricing. The settings dashboard should provide a user-friendly interface for managing these configurations, ensuring that menu items are accurately represented and easily adjustable based on business needs.
  - [x] Ability to add new menu items. This feature will enable admins to expand the menu offerings by adding new items as needed. The process should be straightforward, allowing for the input of item details such as name, description, price, category, and availability status.

  ### Promotional price item menu:
    - [ ] Ability to add a promotional price to menu items. This will allow admins to create special offers and discounts for specific menu items, enhancing marketing efforts and attracting customers. The promotional price should be clearly displayed alongside the regular price, and the system should handle the logic for applying the promotional price during order processing. Augment the menu item model to include a new field for promotional price, and ensure that the frontend displays this information appropriately to customers. 

  ### Promotional dashboard panel:
    - [ ] Create a promotional dashboard to manage promos. This dashboard will provide admins with a centralized location to view, create, edit, and delete promotional offers. The dashboard should display a list of current promotions, including details such as the promo name, associated menu items, promotional price, start and end dates, and status (active/inactive). Admins should be able to easily manage promotions through this interface, ensuring that marketing campaigns are effectively executed and monitored.
