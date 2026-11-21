import { firebaseAuth, database } from '../config/firebase.js';
import { supabase, storageBucket } from '../config/supabase.js';

export const eliminarUsuario = async (req, res) => {
  const { uid } = req.params;

  try {
    if (!uid || uid === req.usuario.uid) {
      return res.status(400).json({
        mensaje: 'No puedes eliminar tu propia cuenta.'
      });
    }

    const usersRef = database.ref('users');
    const usersSnapshot = await usersRef.once('value');
    const users = usersSnapshot.val() || {};

    const usuarioObjetivo = users[uid];

    if (!usuarioObjetivo) {
      return res.status(404).json({
        mensaje: 'El usuario no existe en la base de datos.'
      });
    }

    // Evitar eliminar al último administrador.
    if (usuarioObjetivo.role === 'admin') {
      const cantidadAdmins = Object.values(users)
        .filter(user => user?.role === 'admin').length;

      if (cantidadAdmins <= 1) {
        return res.status(409).json({
          mensaje: 'No puedes eliminar al último administrador.'
        });
      }
    }

    // 1. Eliminar cuenta de Firebase Authentication.
    try {
      await firebaseAuth.deleteUser(uid);
    } catch (error) {
      // Permitir continuar si la cuenta ya fue eliminada.
      if (error.code !== 'auth/user-not-found') {
        throw error;
      }
    }

    // 2. Eliminar fotografías del usuario en Supabase.
    const carpeta = `perfiles/${uid}`;
    const archivos = [];

    let offset = 0;
    const limite = 100;

    while (true) {
      const { data, error } = await supabase.storage
        .from(storageBucket)
        .list(carpeta, {
          limit: limite,
          offset
        });

      if (error) throw error;

      const archivosPagina = (data || [])
        .filter(item => item.id !== null)
        .map(item => `${carpeta}/${item.name}`);

      archivos.push(...archivosPagina);

      if (!data || data.length < limite) break;

      offset += limite;
    }

    if (archivos.length > 0) {
      const { error } = await supabase.storage
        .from(storageBucket)
        .remove(archivos);

      if (error) throw error;
    }

    // 3. Eliminar registro de Realtime Database.
    await database.ref(`users/${uid}`).remove();

    return res.status(200).json({
      mensaje: 'Usuario eliminado correctamente.',
      uid
    });

  } catch (error) {
    console.error('Error eliminando usuario:', error);

    return res.status(500).json({
      mensaje: 'No se pudo completar la eliminación del usuario.'
    });
  }
};
