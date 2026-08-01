import { Router } from 'express';
import { getMenu, searchProducts, searchPizzaFlavors } from '../services/menuService.js';

const router = Router();

router.get('/search', (req, res) => {
  res.json(searchProducts(req.query.q));
});

router.get('/flavors/search', (req, res) => {
  res.json(searchPizzaFlavors(req.query.q));
});

router.get('/', (req, res) => {
  res.json(getMenu());
});

export default router;
