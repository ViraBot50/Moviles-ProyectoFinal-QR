import { firebaseAuth } from '../config/firebase.js';

export const verificarToken = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      return res.status(401).json({
        mensaje: 'No se proporcionó un token de autenticación.'
      });
    }

    const token = authorization.split(' ')[1];

    // Verificar también que el token no haya sido revocado.
    const decodedToken = await firebaseAuth.verifyIdToken(token, true);

    req.usuario = {
      uid: decodedToken.uid,
      email: decodedToken.email ?? null
    };

    next();

  } catch (error) {
    console.error('Error verificando token:', error.message);

    return res.status(401).json({
      mensaje: 'Token inválido, expirado o revocado.'
    });
  }
};
