import { createHash } from 'node:crypto';
import { database } from '../config/firebase.js';

export const registrarToken = async (req, res) => {
  try {
    const { fid, platform } = req.body;

    if (
      typeof fid !== 'string' ||
      fid.trim().length < 10 ||
      fid.length > 4096
    ) {
      return res.status(400).json({
        mensaje: 'El identificador FID no es válido.',
      });
    }

    const plataformasPermitidas = ['android', 'ios', 'web'];

    if (!plataformasPermitidas.includes(platform)) {
      return res.status(400).json({
        mensaje: 'La plataforma indicada no es válida.',
      });
    }

    const uid = req.usuario.uid;

    const installationId = createHash('sha256')
      .update(fid)
      .digest('hex');

    await database
      .ref(`users/${uid}/fcm_installations/${installationId}`)
      .set({
        fid,
        platform,
        updated_at: new Date().toISOString(),
      });

    return res.status(200).json({
      mensaje: 'Instalación FCM registrada correctamente.',
    });
  } catch (error) {
    console.error('Error registrando instalación FCM:', error.message);

    return res.status(500).json({
      mensaje: 'No se pudo registrar la instalación de notificaciones.',
    });
  }
};

export const eliminarToken = async (req, res) => {
  try {
    const { fid } = req.body;

    if (
      typeof fid !== 'string' ||
      fid.trim().length < 10 ||
      fid.length > 4096
    ) {
      return res.status(400).json({
        mensaje: 'El identificador FID no es válido.',
      });
    }

    const installationId = createHash('sha256')
      .update(fid)
      .digest('hex');

    await database
      .ref(
        `users/${req.usuario.uid}/fcm_installations/${installationId}`,
      )
      .remove();

    return res.status(200).json({
      mensaje: 'Instalación FCM desvinculada correctamente.',
    });
  } catch (error) {
    console.error(
      'Error desvinculando instalación FCM:',
      error.message,
    );

    return res.status(500).json({
      mensaje: 'No se pudo desvincular la instalación de notificaciones.',
    });
  }
};
