import { Router } from 'express';
import {
  addEmployee,
  listActiveEmployees,
  listInactiveEmployees,
  deactivateEmployee,
  activateEmployee,
} from '../services/employeeService.js';
import { ValidationError } from '../utils/errors.js';

const router = Router();

function parseEmployeeId(param: string): number {
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`invalid employee id '${param}'`);
  }
  return id;
}

router.get('/active', (req, res) => {
  res.json(listActiveEmployees());
});

router.get('/inactive', (req, res) => {
  res.json(listInactiveEmployees());
});

router.post('/', (req, res, next) => {
  try {
    res.json(addEmployee(req.body?.name, req.body?.pictureUrl));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    res.json(deactivateEmployee(parseEmployeeId(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/activate', (req, res, next) => {
  try {
    res.json(activateEmployee(parseEmployeeId(req.params.id)));
  } catch (err) {
    next(err);
  }
});

export default router;
