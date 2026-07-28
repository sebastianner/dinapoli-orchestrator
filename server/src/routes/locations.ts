import { Router } from 'express';
import {
  listCities,
  createCity,
  updateCity,
  deleteCity,
  listNeighborhoods,
  createNeighborhood,
  updateNeighborhood,
  deleteNeighborhood,
} from '../services/locationService.js';
import { ValidationError } from '../utils/errors.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

function parseId(param: string, label: string): number {
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`invalid ${label} '${param}'`);
  }
  return id;
}

// GET stays open - every order-placing screen needs this dropdown data.
// Mutations are admin-only: this is operational config (delivery zones/
// fees), same footing as cash-flow settings.
router.get('/cities', (req, res) => {
  res.json(listCities());
});

router.post('/cities', requireAuth, requireAdmin, (req, res, next) => {
  try {
    res.json(createCity(req.body?.name, req.body?.department, req.body?.country));
  } catch (err) {
    next(err);
  }
});

router.put('/cities/:id', requireAuth, requireAdmin, (req, res, next) => {
  try {
    res.json(updateCity(parseId(req.params.id, 'city id'), req.body?.name, req.body?.department, req.body?.country));
  } catch (err) {
    next(err);
  }
});

router.delete('/cities/:id', requireAuth, requireAdmin, (req, res, next) => {
  try {
    deleteCity(parseId(req.params.id, 'city id'));
    res.json({ status: 'deleted' });
  } catch (err) {
    next(err);
  }
});

router.get('/cities/:id/neighborhoods', (req, res, next) => {
  try {
    res.json(listNeighborhoods(parseId(req.params.id, 'city id')));
  } catch (err) {
    next(err);
  }
});

router.post('/neighborhoods', requireAuth, requireAdmin, (req, res, next) => {
  try {
    res.json(createNeighborhood(req.body?.name, req.body?.cityId, req.body?.deliveryFee));
  } catch (err) {
    next(err);
  }
});

router.put('/neighborhoods/:id', requireAuth, requireAdmin, (req, res, next) => {
  try {
    res.json(updateNeighborhood(parseId(req.params.id, 'neighborhood id'), req.body?.name, req.body?.deliveryFee));
  } catch (err) {
    next(err);
  }
});

router.delete('/neighborhoods/:id', requireAuth, requireAdmin, (req, res, next) => {
  try {
    deleteNeighborhood(parseId(req.params.id, 'neighborhood id'));
    res.json({ status: 'deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
