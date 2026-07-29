import { Router } from 'express';
import {
  addEmployee,
  listActiveEmployees,
  listInactiveEmployees,
  deactivateEmployee,
  activateEmployee,
  setEmployeeRole,
} from '../services/employeeService.js';
import { ValidationError } from '../utils/errors.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

function parseEmployeeId(param: string): number {
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`id de empleado inválido '${param}'`);
  }
  return id;
}

// Public: the select-employee/login screen needs these before anyone is
// authenticated. No sensitive data leaves here - password_hash is never
// part of the Employee shape returned to clients.
router.get('/active', (req, res) => {
  res.json(listActiveEmployees());
});

router.get('/inactive', (req, res) => {
  res.json(listInactiveEmployees());
});

// Everything below manages employee accounts - admin only.
router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    res.json(await addEmployee(req.body?.name, req.body?.pictureUrl, req.body?.role, req.body?.password));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, requireAdmin, (req, res, next) => {
  try {
    res.json(deactivateEmployee(parseEmployeeId(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/activate', requireAuth, requireAdmin, (req, res, next) => {
  try {
    res.json(activateEmployee(parseEmployeeId(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.put('/:id/role', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    res.json(await setEmployeeRole(parseEmployeeId(req.params.id), req.body?.role, req.body?.password));
  } catch (err) {
    next(err);
  }
});

export default router;
