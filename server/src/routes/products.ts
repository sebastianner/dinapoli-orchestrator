import { Router } from 'express';
import { listAllProductsForAdmin, createProduct, updateProduct, deleteProduct } from '../services/menuService.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// Every route here is admin-only - this is the menu settings dashboard
// (/ajustes/menu-settings), not the public menu (see routes/menu.ts).
router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  res.json(listAllProductsForAdmin());
});

router.post('/', (req, res) => {
  res.json(createProduct(req.body));
});

router.put('/:id', (req, res) => {
  res.json(updateProduct(Number(req.params.id), req.body));
});

router.delete('/:id', (req, res) => {
  deleteProduct(Number(req.params.id));
  res.json({ status: 'deleted', id: Number(req.params.id) });
});

export default router;
