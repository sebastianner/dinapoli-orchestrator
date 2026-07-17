import { Router } from 'express';
import {
  getCurrentCashFlow,
  listCashFlowHistory,
  updateCurrentCash,
  getSettings,
  updateDefaultOpeningCash,
  addExpense,
  listExpensesForCashFlow,
} from '../services/cashFlowService.js';
import { ValidationError } from '../utils/errors.js';

const router = Router();

function parseCashFlowId(param: string): number {
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`invalid cash flow id '${param}'`);
  }
  return id;
}

router.get('/current', (req, res) => {
  res.json(getCurrentCashFlow());
});

router.get('/', (req, res) => {
  res.json(listCashFlowHistory());
});

router.get('/:id/expenses', (req, res) => {
  res.json(listExpensesForCashFlow(parseCashFlowId(req.params.id)));
});

router.put('/current/amount', (req, res) => {
  res.json(updateCurrentCash(req.body?.amount));
});

router.get('/settings', (req, res) => {
  res.json(getSettings());
});

router.put('/settings', (req, res) => {
  res.json(updateDefaultOpeningCash(req.body?.defaultOpeningCash));
});

router.post('/expenses', (req, res) => {
  res.json(addExpense(req.body?.amount, req.body?.justification));
});

export default router;
