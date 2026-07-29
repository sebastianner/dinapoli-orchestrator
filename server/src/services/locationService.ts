import db from '../db/index.js';
import { ValidationError, NotFoundError, ConflictError } from '../utils/errors.js';
import type { City, Neighborhood } from '../types/dinapoly-types.js';
import type { CityRow, NeighborhoodRow } from '../types/db.js';

function isNonNegativeInteger(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

function isPositiveInteger(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

/** True when a better-sqlite3 error is a FOREIGN KEY constraint violation, i.e. rows elsewhere still reference this one. */
function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof Error && /FOREIGN KEY/i.test(err.message);
}

function rowToCity(row: CityRow): City {
  return { id: row.id, name: row.name, department: row.department, country: row.country };
}

function rowToNeighborhood(row: NeighborhoodRow): Neighborhood {
  return { id: row.id, name: row.name, cityId: row.city_id, deliveryFee: row.delivery_fee };
}

const getCityRow = db.prepare<[number], CityRow>('SELECT * FROM cities WHERE id = ?');
const listCityRows = db.prepare<[], CityRow>('SELECT * FROM cities ORDER BY name');
const insertCity = db.prepare<[string, string | null, string]>('INSERT INTO cities (name, department, country) VALUES (?, ?, ?)');
const updateCityRow = db.prepare<[string, string | null, string, number]>('UPDATE cities SET name = ?, department = ?, country = ? WHERE id = ?');
const deleteCityRow = db.prepare<[number]>('DELETE FROM cities WHERE id = ?');

export function listCities(): City[] {
  return listCityRows.all().map(rowToCity);
}

export function getCityById(id: number): City {
  const row = getCityRow.get(id);
  if (!row) throw new NotFoundError(`ciudad ${id} no encontrada`);
  return rowToCity(row);
}

export function createCity(name: unknown, department: unknown, country: unknown): City {
  if (typeof name !== 'string' || name.trim() === '') throw new ValidationError('el nombre es obligatorio');
  if (department != null && typeof department !== 'string') throw new ValidationError('el departamento debe ser una cadena de texto');
  const countryValue = typeof country === 'string' && country.trim() !== '' ? country.trim() : 'Colombia';
  const { lastInsertRowid } = insertCity.run(name.trim(), department || null, countryValue);
  return getCityById(Number(lastInsertRowid));
}

export function updateCity(id: number, name: unknown, department: unknown, country: unknown): City {
  const existing = getCityRow.get(id);
  if (!existing) throw new NotFoundError(`ciudad ${id} no encontrada`);
  if (name != null && (typeof name !== 'string' || name.trim() === '')) throw new ValidationError('el nombre debe ser una cadena de texto no vacía');
  if (department !== undefined && department != null && typeof department !== 'string') throw new ValidationError('el departamento debe ser una cadena de texto');
  updateCityRow.run(
    typeof name === 'string' ? name.trim() : existing.name,
    department !== undefined ? ((department as string | null) || null) : existing.department,
    typeof country === 'string' && country.trim() !== '' ? country.trim() : existing.country,
    id
  );
  return getCityById(id);
}

/** Fails (409) if any neighborhood still references this city - no cascade, same reasoning as customers/orders. */
export function deleteCity(id: number): void {
  getCityById(id);
  try {
    deleteCityRow.run(id);
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new ConflictError(`la ciudad ${id} tiene barrios y no se puede eliminar`);
    throw err;
  }
}

const getNeighborhoodRow = db.prepare<[number], NeighborhoodRow>('SELECT * FROM neighborhoods WHERE id = ?');
const listNeighborhoodRows = db.prepare<[number], NeighborhoodRow>('SELECT * FROM neighborhoods WHERE city_id = ? ORDER BY name');
const insertNeighborhood = db.prepare<[string, number, number]>('INSERT INTO neighborhoods (name, city_id, delivery_fee) VALUES (?, ?, ?)');
const updateNeighborhoodRow = db.prepare<[string, number, number]>('UPDATE neighborhoods SET name = ?, delivery_fee = ? WHERE id = ?');
const deleteNeighborhoodRow = db.prepare<[number]>('DELETE FROM neighborhoods WHERE id = ?');

export function listNeighborhoods(cityId: number): Neighborhood[] {
  getCityById(cityId); // 404s if the city doesn't exist
  return listNeighborhoodRows.all(cityId).map(rowToNeighborhood);
}

export function getNeighborhoodById(id: number): Neighborhood {
  const row = getNeighborhoodRow.get(id);
  if (!row) throw new NotFoundError(`barrio ${id} no encontrado`);
  return rowToNeighborhood(row);
}

export function createNeighborhood(name: unknown, cityId: unknown, deliveryFee: unknown): Neighborhood {
  if (typeof name !== 'string' || name.trim() === '') throw new ValidationError('el nombre es obligatorio');
  if (!isPositiveInteger(cityId)) throw new ValidationError('cityId debe ser un número entero positivo');
  getCityById(cityId); // 404s if missing
  const fee = deliveryFee == null ? 0 : deliveryFee;
  if (!isNonNegativeInteger(fee)) throw new ValidationError('deliveryFee debe ser un número entero no negativo');
  const { lastInsertRowid } = insertNeighborhood.run(name.trim(), cityId, fee);
  return getNeighborhoodById(Number(lastInsertRowid));
}

export function updateNeighborhood(id: number, name: unknown, deliveryFee: unknown): Neighborhood {
  const existing = getNeighborhoodRow.get(id);
  if (!existing) throw new NotFoundError(`barrio ${id} no encontrado`);
  if (name != null && (typeof name !== 'string' || name.trim() === '')) throw new ValidationError('el nombre debe ser una cadena de texto no vacía');
  if (deliveryFee != null && !isNonNegativeInteger(deliveryFee)) throw new ValidationError('deliveryFee debe ser un número entero no negativo');
  updateNeighborhoodRow.run(
    typeof name === 'string' ? name.trim() : existing.name,
    deliveryFee != null ? deliveryFee : existing.delivery_fee,
    id
  );
  return getNeighborhoodById(id);
}

/** Fails (409) if any customer address still references this neighborhood. */
export function deleteNeighborhood(id: number): void {
  getNeighborhoodById(id);
  try {
    deleteNeighborhoodRow.run(id);
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new ConflictError(`el barrio ${id} tiene direcciones y no se puede eliminar`);
    throw err;
  }
}
