import { Router } from 'express';
import { closeDay, listClosingReports, getClosingReport, reprintClosingReport } from '../services/endOfDayService.js';
import { ValidationError } from '../utils/errors.js';

const router = Router();

function parseReportId(param: string): number {
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`invalid closing report id '${param}'`);
  }
  return id;
}

router.post('/close', (_req, res) => {
  res.json(closeDay());
});

router.get('/', (_req, res) => {
  res.json(listClosingReports());
});

router.get('/:id', (req, res) => {
  res.json(getClosingReport(parseReportId(req.params.id)));
});

router.post('/:id/reprint', (req, res) => {
  const id = parseReportId(req.params.id);
  reprintClosingReport(id);
  res.json({ status: 'reprinted', id });
});

export default router;
