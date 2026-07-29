import { Router } from 'express';
import { closeDay, listClosingReports, getClosingReport, reprintClosingReport } from '../services/endOfDayService.js';
import { ValidationError } from '../utils/errors.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

function parseReportId(param: string): number {
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`id de informe de cierre inválido '${param}'`);
  }
  return id;
}

// Generating is open to any logged-in employee - closeDay() itself enforces
// the "every order today is already COMPLETED" precondition. Reviewing past
// reports still exposes the whole day's sales/tips/discounts breakdown
// though, so that stays admin-only.
router.post('/close', requireAuth, (_req, res) => {
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
