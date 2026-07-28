import db from '../db/index.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import type { PromoSettings, PromoType } from '../types/dinapoly-types.js';
import type { PromoSettingsRow } from '../types/db.js';

const PROMO_TYPES = new Set<PromoType>(['duo', 'pizza_xl']);

function isPositiveInteger(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

function isNonNegativeInteger(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

function rowToPromoSettings(row: PromoSettingsRow): PromoSettings {
  return { promoType: row.promo_type, price: row.price, sodaSurcharge: row.soda_surcharge };
}

const getPromoSettingsRow = db.prepare<[string], PromoSettingsRow>('SELECT * FROM promo_settings WHERE promo_type = ?');
const listPromoSettingsRows = db.prepare<[], PromoSettingsRow>('SELECT * FROM promo_settings ORDER BY promo_type');
const updatePromoSettingsRow = db.prepare<[number, number, string]>(
  'UPDATE promo_settings SET price = ?, soda_surcharge = ? WHERE promo_type = ?'
);

export function listPromoSettings(): PromoSettings[] {
  return listPromoSettingsRows.all().map(rowToPromoSettings);
}

/** Used by orderService.applyPromoPricing to read the current price at order-creation time - 404s only if migrate.ts's default-row seed was somehow skipped. */
export function getPromoSettings(promoType: PromoType): PromoSettings {
  const row = getPromoSettingsRow.get(promoType);
  if (!row) throw new NotFoundError(`promo settings for '${promoType}' not found`);
  return rowToPromoSettings(row);
}

/** Admin only (see routes/promos.ts). `sodaSurcharge` is only meaningful for 'pizza_xl' - rejected for 'duo', and left unchanged if omitted. */
export function updatePromoSettings(promoType: unknown, price: unknown, sodaSurcharge: unknown): PromoSettings {
  if (typeof promoType !== 'string' || !PROMO_TYPES.has(promoType as PromoType)) {
    throw new ValidationError(`promoType must be one of ${[...PROMO_TYPES].join(', ')}`);
  }
  const existing = getPromoSettingsRow.get(promoType);
  if (!existing) throw new NotFoundError(`promo settings for '${promoType}' not found`);

  if (!isPositiveInteger(price)) {
    throw new ValidationError('price must be a positive integer');
  }

  if (promoType === 'duo') {
    if (sodaSurcharge != null) {
      throw new ValidationError("soda_surcharge only applies to 'pizza_xl'");
    }
    updatePromoSettingsRow.run(price, 0, promoType);
  } else {
    const resolvedSurcharge = sodaSurcharge != null ? sodaSurcharge : existing.soda_surcharge;
    if (!isNonNegativeInteger(resolvedSurcharge)) {
      throw new ValidationError('sodaSurcharge must be a non-negative integer');
    }
    updatePromoSettingsRow.run(price, resolvedSurcharge, promoType);
  }

  return rowToPromoSettings(getPromoSettingsRow.get(promoType)!);
}
