
import { Router } from 'express';

import { verificarToken } from '../middlewares/auth.middleware.js';

import {
  registrarToken,
  eliminarToken,
} from '../controllers/notifications.controller.js';

const router = Router();

router.use(verificarToken);

router.post('/token', registrarToken);
router.delete('/token', eliminarToken);

export default router;
