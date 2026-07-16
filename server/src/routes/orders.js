import { Router } from 'express';
import { getOrderById, listOrders, completeOrder } from '../services/orderService.js';
import { ValidationError } from '../utils/errors.js';

const router = Router();

function parseOrderId(param) {
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`invalid order id '${param}'`);
  }
  return id;
}

router.get('/', (req, res) => {
  res.json(listOrders({ status: req.query.status }));
});

router.get('/:id', (req, res) => {
  res.json(getOrderById(parseOrderId(req.params.id)));
});

router.post('/:id/complete', (req, res) => {
  const order = completeOrder(parseOrderId(req.params.id), { paymentMethod: req.body?.paymentMethod });
  res.json(order);
});

export default router;
