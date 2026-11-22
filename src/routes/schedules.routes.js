import { Router } from 'express';

import { verificarToken } from '../middlewares/auth.middleware.js';

import {
  crearProgramacion,
  listarProgramaciones,
  obtenerProgramacion,
  cancelarProgramacion
} from '../controllers/schedules.controller.js';

const router = Router();

router.use(verificarToken);

router.post('/', crearProgramacion);
router.get('/', listarProgramaciones);
router.get('/:scheduleId', obtenerProgramacion);
router.patch('/:scheduleId/cancel', cancelarProgramacion);

export default router;
