import { Router } from 'express';
import { listPizzaAdminData, updatePizzaGroup, updatePizzaGroupSize, createPizzaFlavor, updatePizzaFlavor } from '../services/menuService.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// Every route here is admin-only - same footing as routes/products.ts (this
// is the menu settings dashboard, not the public menu in routes/menu.ts).
router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  res.json(listPizzaAdminData());
});

router.put('/groups/:groupId', (req, res) => {
  res.json(updatePizzaGroup(req.params.groupId, req.body));
});

router.put('/groups/:groupId/sizes/:sizeId', (req, res) => {
  res.json(updatePizzaGroupSize(req.params.groupId, req.params.sizeId, req.body));
});

router.post('/flavors', (req, res) => {
  res.json(createPizzaFlavor(req.body));
});

router.put('/flavors/:id', (req, res) => {
  res.json(updatePizzaFlavor(Number(req.params.id), req.body));
});

export default router;
