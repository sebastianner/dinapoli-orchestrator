import { Router, type Request } from 'express';
import {
  resolveRange,
  getSummary,
  getSalesTrend,
  getBreakdown,
  getHeatmap,
  getProducts,
  getCustomers,
  getEmployees,
  getPromotions,
} from '../services/analyticsService.js';
import { ValidationError } from '../utils/errors.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import type { AnalyticsRange } from '../types/dinapoly-types.js';

const router = Router();

const VALID_RANGES: AnalyticsRange[] = ['today', 'week', 'month', 'custom'];

function parseRange(req: Request) {
  const range = req.query.range;
  if (typeof range !== 'string' || !VALID_RANGES.includes(range as AnalyticsRange)) {
    throw new ValidationError(`rango inválido '${String(range)}' - se esperaba uno de ${VALID_RANGES.join(', ')}`);
  }
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  return resolveRange(range as AnalyticsRange, from, to);
}

// Whole router is admin-only - every route here exposes revenue, customer,
// or employee performance data, the same bar as /dashboard/closing-reports.
router.use(requireAuth, requireAdmin);

router.get('/summary', (req, res) => {
  res.json(getSummary(parseRange(req)));
});

router.get('/sales-trend', (req, res) => {
  res.json(getSalesTrend(parseRange(req)));
});

router.get('/breakdown', (req, res) => {
  res.json(getBreakdown(parseRange(req)));
});

router.get('/heatmap', (req, res) => {
  res.json(getHeatmap(parseRange(req)));
});

router.get('/products', (req, res) => {
  res.json(getProducts(parseRange(req)));
});

router.get('/customers', (req, res) => {
  res.json(getCustomers(parseRange(req)));
});

router.get('/employees', (req, res) => {
  res.json(getEmployees(parseRange(req)));
});

router.get('/promotions', (req, res) => {
  res.json(getPromotions(parseRange(req)));
});

export default router;
