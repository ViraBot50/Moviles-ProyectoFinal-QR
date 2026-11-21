import { Router } from 'express';
import multer from 'multer';

import { verificarToken } from '../middlewares/auth.middleware.js';

import {
  subirFotoPerfil,
  obtenerUrlImagen,
  eliminarFotoPerfil
} from '../controllers/storage.controller.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, callback) => {
    const permitidos = [
      'image/jpeg',
      'image/png',
      'image/webp'
    ];

    if (!permitidos.includes(file.mimetype)) {
      return callback(
        new Error('Formato de imagen no permitido.')
      );
    }

    callback(null, true);
  }
});

router.post(
  '/profile',
  verificarToken,
  upload.single('imagen'),
  subirFotoPerfil
);

router.post(
  '/profile/url',
  verificarToken,
  obtenerUrlImagen
);

router.delete(
  '/profile',
  verificarToken,
  eliminarFotoPerfil
);

export default router;
