import { Router } from 'express';

import { verificarToken } from '../middlewares/auth.middleware.js';
import { verificarAdmin } from '../middlewares/admin.middleware.js';
import { verificarAprovisionamiento } from '../middlewares/provisioning.middleware.js';

import {
  registrarDispositivo,
  listarDispositivos,
  obtenerDispositivo,
  asignarSalon,
  eliminarDispositivo,
  obtenerQr
} from '../controllers/devices.controller.js';

const router = Router();

// Aprovisionamiento: no requiere sesión de maestro.
router.post(
  '/provision',
  verificarAprovisionamiento,
  registrarDispositivo
);

// Consultas: usuarios autenticados.
router.get(
  '/',
  verificarToken,
  listarDispositivos
);

router.get(
  '/:deviceId',
  verificarToken,
  obtenerDispositivo
);

router.get(
  '/:deviceId/qr',
  verificarToken,
  obtenerQr
);

// Administración: solo administradores.
router.patch(
  '/:deviceId/salon',
  verificarToken,
  verificarAdmin,
  asignarSalon
);

router.delete(
  '/:deviceId',
  verificarToken,
  verificarAdmin,
  eliminarDispositivo
);

export default router;
