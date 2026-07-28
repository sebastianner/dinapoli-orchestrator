import { Router } from 'express';
import { listTables, increaseTableCount, decreaseTableCount } from '../services/tableService.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(listTables());
});

// Admin only - growing/shrinking the floor plan isn't a per-order action, and
// decreaseTableCount refuses if the table being removed is occupied.
router.post('/increase', requireAuth, requireAdmin, (req, res) => {
  res.json(increaseTableCount());
});

router.post('/decrease', requireAuth, requireAdmin, (req, res) => {
  res.json(decreaseTableCount());
});

export default router;
