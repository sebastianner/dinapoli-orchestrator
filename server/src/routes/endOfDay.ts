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
// reports is open to any employee too - staff may need to check the day's
// numbers while closing, not just admins. Reprinting (below) stays
// admin-only, since that's a physical-document action, not just viewing.
router.post('/close', requireAuth, async (_req, res, next) => {
  try {
    res.json(await closeDay());
  } catch (err) {
    next(err);
  }
});

router.get('/', requireAuth, (_req, res) => {
  res.json(listClosingReports());
});

router.get('/:id', requireAuth, (req, res) => {
  res.json(getClosingReport(parseReportId(req.params.id)));
});

router.post('/:id/reprint', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseReportId(req.params.id);
    await reprintClosingReport(id);
    res.json({ status: 'reprinted', id });
  } catch (err) {
    next(err);
  }
});

export default router;
