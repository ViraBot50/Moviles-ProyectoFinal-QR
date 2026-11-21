import { Router } from 'express';

import { verificarToken } from '../middlewares/auth.middleware.js';
import { verificarAdmin } from '../middlewares/admin.middleware.js';
import { eliminarUsuario } from '../controllers/admin.controller.js';

const router = Router();

router.delete(
  '/users/:uid',
  verificarToken,
  verificarAdmin,
  eliminarUsuario
);

export default router;
