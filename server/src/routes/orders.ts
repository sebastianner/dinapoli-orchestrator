import { Router } from 'express';
import { getOrderById, listOrders, completeOrder, reprintOrderDocument, addOrderItems, deleteOrder } from '../services/orderService.js';
import { notifyPrintQueue } from '../services/queueService.js';
import { ValidationError } from '../utils/errors.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

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
  const page = typeof req.query.page === 'string' ? Number(req.query.page) : undefined;
  const pageSize = typeof req.query.pageSize === 'string' ? Number(req.query.pageSize) : undefined;
  // page/pageSize are opt-in - omit both to get every match in one shot (unchanged
  // for existing callers like the active-orders panel and the closing-report chart).
  const { orders, total } = listOrders({ status, date, orderType, page, pageSize });
  res.set('X-Total-Count', String(total));
  res.json(orders);
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

router.post('/:id/items', (req, res, next) => {
  try {
    const order = addOrderItems(parseOrderId(req.params.id), req.body?.items);
    notifyPrintQueue();
    res.json(order);
  } catch (err) {
    next(err);
  }
});

// Irreversible - admin only. The frontend gates this behind an explicit
// confirmation dialog (see order-history), but the server enforces it too.
router.delete('/:id', requireAuth, requireAdmin, (req, res, next) => {
  try {
    deleteOrder(parseOrderId(req.params.id));
    res.json({ status: 'deleted', orderId: parseOrderId(req.params.id) });
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
