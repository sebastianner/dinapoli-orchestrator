import { Router } from 'express';
import {
  getOrderById,
  listOrders,
  completeOrder,
  reprintOrderDocument,
  setOrderTip,
  setOrderDeliveryFee,
  addOrderItems,
} from '../services/orderService.js';
import { notifyPrintQueue } from '../services/queueService.js';
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
  const date = typeof req.query.date === 'string' ? req.query.date : undefined;
  const orderType = typeof req.query.orderType === 'string' ? req.query.orderType : undefined;
  res.json(listOrders({ status, date, orderType }));
});

router.get('/:id', (req, res) => {
  res.json(getOrderById(parseOrderId(req.params.id)));
});

router.post('/:id/complete', async (req, res, next) => {
  try {
    const order = await completeOrder(parseOrderId(req.params.id), { payments: req.body?.payments });
    res.json(order);
  } catch (err) {
    next(err);
  }
});

router.put('/:id/tip', (req, res, next) => {
  try {
    const order = setOrderTip(parseOrderId(req.params.id), req.body?.tip);
    res.json(order);
  } catch (err) {
    next(err);
  }
});

router.put('/:id/delivery-fee', (req, res, next) => {
  try {
    const order = setOrderDeliveryFee(parseOrderId(req.params.id), req.body?.deliveryFee);
    res.json(order);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/items', (req, res, next) => {
  try {
    const order = addOrderItems(parseOrderId(req.params.id), req.body?.items);
    notifyPrintQueue();
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
