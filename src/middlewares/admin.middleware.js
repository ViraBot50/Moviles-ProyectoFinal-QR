import { database } from '../config/firebase.js';

export const verificarAdmin = async (req, res, next) => {
  try {
    const snapshot = await database
      .ref(`users/${req.usuario.uid}/role`)
      .once('value');

    if (snapshot.val() !== 'admin') {
      return res.status(403).json({
        mensaje: 'No tienes permisos de administrador.'
      });
    }

    next();
  } catch (error) {
    console.error('Error verificando administrador:', error.message);

    return res.status(500).json({
      mensaje: 'No se pudieron verificar los permisos.'
    });
  }
};
