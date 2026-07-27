import { Router } from 'express';
import { closeDay, listClosingReports, getClosingReport, reprintClosingReport } from '../services/endOfDayService.js';
import { ValidationError } from '../utils/errors.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

function parseReportId(param: string): number {
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`invalid closing report id '${param}'`);
  }
  return id;
}

// End-of-day closing reports expose the whole day's sales/tips/discounts
// breakdown - generating and reviewing them is admin-only, both routes.
router.post('/close', requireAuth, requireAdmin, (_req, res) => {
  res.json(closeDay());
});

router.get('/', requireAuth, requireAdmin, (_req, res) => {
  res.json(listClosingReports());
});

router.get('/:id', requireAuth, requireAdmin, (req, res) => {
  res.json(getClosingReport(parseReportId(req.params.id)));
});

router.post('/:id/reprint', requireAuth, requireAdmin, (req, res) => {
  const id = parseReportId(req.params.id);
  reprintClosingReport(id);
  res.json({ status: 'reprinted', id });
});

export default router;
