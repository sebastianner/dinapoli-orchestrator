import { Router } from 'express';
import {
  listAllProductsForAdmin,
  createProduct,
  updateProduct,
  updateProductSize,
  deleteProduct,
  listDrinkFlavors,
  setProductDrinkFlavors,
} from '../services/menuService.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// Every route here is admin-only - this is the menu settings dashboard
// (/ajustes/menu-settings), not the public menu (see routes/menu.ts).
router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  res.json(listAllProductsForAdmin());
});

// The shared drink-flavor library (e.g. "Coca-Cola") - not scoped to a
// product id, so this has to come before the /:id routes below or Express
// would try to parse "drink-flavors" as one.
router.get('/drink-flavors', (req, res) => {
  res.json(listDrinkFlavors());
});

router.post('/', (req, res) => {
  res.json(createProduct(req.body));
});

router.put('/:id', (req, res) => {
  res.json(updateProduct(Number(req.params.id), req.body));
});

router.put('/:id/sizes/:sizeKey', (req, res) => {
  res.json(updateProductSize(Number(req.params.id), req.params.sizeKey, req.body));
});

router.put('/:id/drink-flavors', (req, res) => {
  res.json(setProductDrinkFlavors(Number(req.params.id), req.body));
});

router.delete('/:id', (req, res) => {
  deleteProduct(Number(req.params.id));
  res.json({ status: 'deleted', id: Number(req.params.id) });
});

export default router;
