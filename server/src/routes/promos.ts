import { Router } from 'express';
import { listPromoSettings, updatePromoSettings } from '../services/promoSettingsService.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// Public - every order-placing screen (menu/promos.tsx, the promo progress
// banner, cart pricing) needs the current prices, not just admins.
router.get('/', (_req, res) => {
  res.json(listPromoSettings());
});

// Admin only - changes the flat price charged for every new promo order
// from this point on (see promoSettingsService.updatePromoSettings).
router.put('/:type', requireAuth, requireAdmin, (req, res, next) => {
  try {
    res.json(updatePromoSettings(req.params.type, req.body?.price, req.body?.sodaSurcharge));
  } catch (err) {
    next(err);
  }
});

export default router;
