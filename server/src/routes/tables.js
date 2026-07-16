import { Router } from 'express';
import { listTables } from '../services/tableService.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(listTables());
});

export default router;
