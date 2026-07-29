import { Router } from 'express';
import {
  searchCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  createAddress,
  updateAddress,
  deleteAddress,
  suggestBuildingNames,
} from '../services/customerService.js';
import { ValidationError } from '../utils/errors.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

function parseId(param: string, label: string): number {
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`id de ${label} inválido '${param}'`);
  }
  return id;
}

// Registered before the /:id routes below so 'search'/'addresses' in the
// path aren't swallowed as a customer id.
router.get('/search', (req, res) => {
  res.json(searchCustomers(req.query.q));
});

router.get('/addresses/buildings', (req, res, next) => {
  try {
    res.json(suggestBuildingNames(Number(req.query.neighborhoodId), req.query.q));
  } catch (err) {
    next(err);
  }
});

// Everything below is open, no auth - staff entering a walk-in/calling
// customer's details, not a public-facing account system (see
// customerService.createCustomer). Only deleting a customer outright is
// admin-gated.
router.get('/:id', (req, res, next) => {
  try {
    res.json(getCustomerById(parseId(req.params.id, 'cliente')));
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    res.json(createCustomer(req.body?.name, req.body?.phone, req.body?.email));
  } catch (err) {
    next(err);
  }
});

router.put('/:id', (req, res, next) => {
  try {
    res.json(updateCustomer(parseId(req.params.id, 'cliente'), req.body?.name, req.body?.phone, req.body?.email));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, requireAdmin, (req, res, next) => {
  try {
    deleteCustomer(parseId(req.params.id, 'cliente'));
    res.json({ status: 'deleted' });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/addresses', (req, res, next) => {
  try {
    res.json(createAddress(parseId(req.params.id, 'cliente'), req.body));
  } catch (err) {
    next(err);
  }
});

router.put('/:id/addresses/:addressId', (req, res, next) => {
  try {
    res.json(updateAddress(parseId(req.params.id, 'cliente'), parseId(req.params.addressId, 'dirección'), req.body));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/addresses/:addressId', (req, res, next) => {
  try {
    deleteAddress(parseId(req.params.id, 'cliente'), parseId(req.params.addressId, 'dirección'));
    res.json({ status: 'deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
