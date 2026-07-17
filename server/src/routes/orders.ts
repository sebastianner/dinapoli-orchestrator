import { Router } from 'express';
import { getOrderById, listOrders, completeOrder, reprintOrderDocument } from '../services/orderService.js';
import { ValidationError } from '../utils/errors.js';

const router = Router();

function parseOrderId(param: string): number {
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`invalid order id '${param}'`);
  }
  return id;
}

router.get('/', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  res.json(listOrders({ status }));
});

router.get('/:id', (req, res) => {
  res.json(getOrderById(parseOrderId(req.params.id)));
});

router.post('/:id/complete', async (req, res, next) => {
  try {
    const order = await completeOrder(parseOrderId(req.params.id), { paymentMethod: req.body?.paymentMethod });
    res.json(order);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reprint', async (req, res, next) => {
  try {
    const kind = req.body?.kind;
    if (typeof kind !== 'string') {
      throw new ValidationError("body must include kind: 'kitchen_ticket' | 'bill'");
    }
    await reprintOrderDocument(parseOrderId(req.params.id), kind);
    res.json({ status: 'reprinted', orderId: parseOrderId(req.params.id), kind });
  } catch (err) {
    next(err);
  }
});

export default router;
