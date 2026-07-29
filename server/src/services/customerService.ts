import db from '../db/index.js';
import { ValidationError, NotFoundError, ConflictError } from '../utils/errors.js';
import { buildTrigramMatchQuery } from '../utils/trigramSearch.js';
import { getNeighborhoodById } from './locationService.js';
import type { Customer, CustomerAddress, PropertyType } from '../types/dinapoly-types.js';
import type { CustomerRow, CustomerAddressRow } from '../types/db.js';

const PROPERTY_TYPES = new Set<PropertyType>(['HOUSE', 'APARTMENT', 'OFFICE', 'BUILDING', 'OTHER']);
const SEARCH_RESULT_LIMIT = 10;

// Colombian mobile numbers: 10 digits, starting with 3. Matches the
// frontend's own check (CustomerInfoModal.tsx) - re-validated here since the
// frontend restriction is UX only.
const PHONE_REGEX = /^3[0-9]{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isPositiveInteger(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

function validatePhone(phone: unknown): asserts phone is string | null | undefined {
  if (phone != null && (typeof phone !== 'string' || !PHONE_REGEX.test(phone))) {
    throw new ValidationError('el teléfono debe ser un número celular colombiano de 10 dígitos que empiece por 3');
  }
}

function validateEmail(email: unknown): asserts email is string | null | undefined {
  if (email != null && (typeof email !== 'string' || !EMAIL_REGEX.test(email))) {
    throw new ValidationError('el correo electrónico debe ser una dirección válida');
  }
}

/** True when a better-sqlite3 error is a FOREIGN KEY constraint violation, i.e. rows elsewhere still reference this one. */
function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof Error && /FOREIGN KEY/i.test(err.message);
}

interface CustomerAddressJoinRow extends CustomerAddressRow {
  neighborhood_name: string;
  neighborhood_delivery_fee: number;
  city_id: number;
  city_name: string;
}

function rowToAddress(row: CustomerAddressJoinRow): CustomerAddress {
  return {
    id: row.id,
    customerId: row.customer_id,
    streetAddress: row.street_address,
    addressLine2: row.address_line_2,
    propertyType: row.property_type,
    neighborhoodId: row.neighborhood_id,
    neighborhoodName: row.neighborhood_name,
    cityId: row.city_id,
    cityName: row.city_name,
    deliveryFee: row.neighborhood_delivery_fee,
    apartmentNumber: row.apartment_number,
    tower: row.tower,
    buildingName: row.building_name,
    reference: row.reference,
    latitude: row.latitude,
    longitude: row.longitude,
    googlePlaceId: row.google_place_id,
    formattedAddress: row.formatted_address,
  };
}

const ADDRESS_JOIN_SQL = `
  SELECT ca.*, n.name AS neighborhood_name, n.delivery_fee AS neighborhood_delivery_fee, n.city_id AS city_id, c.name AS city_name
  FROM customer_addresses ca
  JOIN neighborhoods n ON n.id = ca.neighborhood_id
  JOIN cities c ON c.id = n.city_id
`;

const getAddressRowsForCustomer = db.prepare<[number], CustomerAddressJoinRow>(`${ADDRESS_JOIN_SQL} WHERE ca.customer_id = ? ORDER BY ca.id DESC`);
const getAddressJoinRow = db.prepare<[number], CustomerAddressJoinRow>(`${ADDRESS_JOIN_SQL} WHERE ca.id = ?`);
const getAddressRawRow = db.prepare<[number], CustomerAddressRow>('SELECT * FROM customer_addresses WHERE id = ?');

function rowToCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    addresses: getAddressRowsForCustomer.all(row.id).map(rowToAddress),
  };
}

const getCustomerRow = db.prepare<[number], CustomerRow>('SELECT * FROM customers WHERE id = ?');
const insertCustomer = db.prepare<[string, string | null, string | null]>('INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)');
const updateCustomerRow = db.prepare<[string, string | null, string | null, number]>(
  'UPDATE customers SET name = ?, phone = ?, email = ? WHERE id = ?'
);
const deleteCustomerRow = db.prepare<[number]>('DELETE FROM customers WHERE id = ?');

export function getCustomerById(id: number): Customer {
  const row = getCustomerRow.get(id);
  if (!row) throw new NotFoundError(`cliente ${id} no encontrado`);
  return rowToCustomer(row);
}

export function createCustomer(name: unknown, phone: unknown, email: unknown): Customer {
  if (typeof name !== 'string' || name.trim() === '') throw new ValidationError('el nombre es obligatorio');
  validatePhone(phone);
  validateEmail(email);
  const { lastInsertRowid } = insertCustomer.run(name.trim(), phone || null, email || null);
  return getCustomerById(Number(lastInsertRowid));
}

export function updateCustomer(id: number, name: unknown, phone: unknown, email: unknown): Customer {
  const existing = getCustomerRow.get(id);
  if (!existing) throw new NotFoundError(`cliente ${id} no encontrado`);
  if (name != null && (typeof name !== 'string' || name.trim() === '')) throw new ValidationError('el nombre debe ser una cadena de texto no vacía');
  if (phone !== undefined) validatePhone(phone);
  if (email !== undefined) validateEmail(email);
  updateCustomerRow.run(
    typeof name === 'string' ? name.trim() : existing.name,
    phone !== undefined ? ((phone as string | null) || null) : existing.phone,
    email !== undefined ? ((email as string | null) || null) : existing.email,
    id
  );
  return getCustomerById(id);
}

/** Admin only (see routes/customers.ts). Fails (409) if the customer has existing orders - same "don't corrupt order history" reasoning that keeps employees soft-deleted. */
export function deleteCustomer(id: number): void {
  getCustomerById(id);
  try {
    deleteCustomerRow.run(id);
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new ConflictError(`el cliente ${id} tiene órdenes asociadas y no se puede eliminar`);
    throw err;
  }
}

interface AddressInput {
  streetAddress: string;
  addressLine2: string | null;
  propertyType: PropertyType;
  neighborhoodId: number;
  apartmentNumber: string | null;
  tower: string | null;
  buildingName: string | null;
  reference: string | null;
}

function validateAddressInput(body: Record<string, unknown>, existing?: CustomerAddressRow): AddressInput {
  const streetAddress = body.streetAddress !== undefined ? body.streetAddress : existing?.street_address;
  if (typeof streetAddress !== 'string' || streetAddress.trim() === '') {
    throw new ValidationError('streetAddress es obligatorio');
  }

  const propertyType = body.propertyType !== undefined ? body.propertyType : existing?.property_type;
  if (typeof propertyType !== 'string' || !PROPERTY_TYPES.has(propertyType as PropertyType)) {
    throw new ValidationError(`propertyType debe ser uno de ${[...PROPERTY_TYPES].join(', ')}`);
  }

  const neighborhoodId = body.neighborhoodId !== undefined ? body.neighborhoodId : existing?.neighborhood_id;
  if (!isPositiveInteger(neighborhoodId)) throw new ValidationError('neighborhoodId debe ser un número entero positivo');
  getNeighborhoodById(neighborhoodId); // 404s if missing

  return {
    streetAddress: streetAddress.trim(),
    addressLine2: body.addressLine2 !== undefined ? ((body.addressLine2 as string | null) || null) : (existing?.address_line_2 ?? null),
    propertyType: propertyType as PropertyType,
    neighborhoodId,
    apartmentNumber: body.apartmentNumber !== undefined ? ((body.apartmentNumber as string | null) || null) : (existing?.apartment_number ?? null),
    tower: body.tower !== undefined ? ((body.tower as string | null) || null) : (existing?.tower ?? null),
    buildingName: body.buildingName !== undefined ? ((body.buildingName as string | null) || null) : (existing?.building_name ?? null),
    reference: body.reference !== undefined ? ((body.reference as string | null) || null) : (existing?.reference ?? null),
  };
}

const insertAddress = db.prepare<[number, string, string | null, string, number, string | null, string | null, string | null, string | null]>(
  `INSERT INTO customer_addresses
     (customer_id, street_address, address_line_2, property_type, neighborhood_id, apartment_number, tower, building_name, reference)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const updateAddressRow = db.prepare<[string, string | null, string, number, string | null, string | null, string | null, string | null, number]>(
  `UPDATE customer_addresses
   SET street_address = ?, address_line_2 = ?, property_type = ?, neighborhood_id = ?, apartment_number = ?, tower = ?, building_name = ?, reference = ?
   WHERE id = ?`
);
const deleteAddressRow = db.prepare<[number]>('DELETE FROM customer_addresses WHERE id = ?');

export function createAddress(customerId: number, body: unknown): CustomerAddress {
  getCustomerById(customerId); // 404s if missing
  const input = validateAddressInput((body ?? {}) as Record<string, unknown>);
  const { lastInsertRowid } = insertAddress.run(
    customerId,
    input.streetAddress,
    input.addressLine2,
    input.propertyType,
    input.neighborhoodId,
    input.apartmentNumber,
    input.tower,
    input.buildingName,
    input.reference
  );
  return rowToAddress(getAddressJoinRow.get(Number(lastInsertRowid))!);
}

export function updateAddress(customerId: number, addressId: number, body: unknown): CustomerAddress {
  getCustomerById(customerId); // 404s if missing
  const existing = getAddressRawRow.get(addressId);
  if (!existing || existing.customer_id !== customerId) {
    throw new NotFoundError(`dirección ${addressId} no encontrada para el cliente ${customerId}`);
  }
  const input = validateAddressInput((body ?? {}) as Record<string, unknown>, existing);
  updateAddressRow.run(
    input.streetAddress,
    input.addressLine2,
    input.propertyType,
    input.neighborhoodId,
    input.apartmentNumber,
    input.tower,
    input.buildingName,
    input.reference,
    addressId
  );
  return rowToAddress(getAddressJoinRow.get(addressId)!);
}

/** No auth required, same as create/update (see routes/customers.ts) - only deleting the whole customer is admin-gated. */
export function deleteAddress(customerId: number, addressId: number): void {
  const existing = getAddressRawRow.get(addressId);
  if (!existing || existing.customer_id !== customerId) {
    throw new NotFoundError(`dirección ${addressId} no encontrada para el cliente ${customerId}`);
  }
  try {
    deleteAddressRow.run(addressId);
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new ConflictError(`la dirección ${addressId} está siendo usada por una orden existente y no se puede eliminar`);
    throw err;
  }
}

/** Distinct previously-used building/conjunto names for a neighborhood - not a managed table, the autocomplete just grows organically so custom values are always allowed too. */
export function suggestBuildingNames(neighborhoodId: unknown, query: unknown): string[] {
  if (!isPositiveInteger(neighborhoodId)) throw new ValidationError('neighborhoodId debe ser un número entero positivo');
  getNeighborhoodById(neighborhoodId); // 404s if missing
  const like = `%${typeof query === 'string' ? query.trim() : ''}%`;
  const rows = db
    .prepare<[number, string], { building_name: string }>(
      `SELECT DISTINCT building_name FROM customer_addresses
       WHERE neighborhood_id = ? AND building_name IS NOT NULL AND building_name LIKE ?
       ORDER BY building_name LIMIT ${SEARCH_RESULT_LIMIT}`
    )
    .all(neighborhoodId, like);
  return rows.map((r) => r.building_name);
}

const searchByTrigram = db.prepare<[string], CustomerRow>(
  `SELECT c.* FROM customers_fts f
   JOIN customers c ON c.id = f.rowid
   WHERE customers_fts MATCH ?
   ORDER BY rank
   LIMIT ${SEARCH_RESULT_LIMIT}`
);
const searchByPrefix = db.prepare<[string, string], CustomerRow>(
  `SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name LIMIT ${SEARCH_RESULT_LIMIT}`
);

/** Fuzzy/typo-tolerant customer search for the order form's autocomplete - see buildTrigramMatchQuery. */
export function searchCustomers(query: unknown): Customer[] {
  if (typeof query !== 'string' || query.trim() === '') return [];
  const trigramQuery = buildTrigramMatchQuery(query);
  const rows = trigramQuery ? searchByTrigram.all(trigramQuery) : searchByPrefix.all(`${query.trim()}%`, `${query.trim()}%`);
  return rows.map(rowToCustomer);
}
