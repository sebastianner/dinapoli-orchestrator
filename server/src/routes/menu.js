import { Router } from 'express';
import { getMenu } from '../services/menuService.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(getMenu());
});

export default router;
