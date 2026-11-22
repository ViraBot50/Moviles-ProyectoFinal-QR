
import { createHash } from 'node:crypto';
import { database, messaging } from '../config/firebase.js';

const obtenerIdInstalacion = (fid) =>
  createHash('sha256').update(fid).digest('hex');

// ============================================================
// REGISTRAR FID DE UNA INSTALACIÓN
// ============================================================

export const registrarToken = async (req, res) => {
  try {
    const { fid, platform } = req.body;

    if (
      typeof fid !== 'string' ||
      fid.trim().length < 10 ||
      fid.length > 4096
    ) {
      return res.status(400).json({
        mensaje: 'El identificador FID no es válido.'
      });
    }

    const plataformasPermitidas = ['android', 'ios', 'web'];

    if (!plataformasPermitidas.includes(platform)) {
      return res.status(400).json({
        mensaje: 'La plataforma indicada no es válida.'
      });
    }

    const uid = req.usuario.uid;
    const fidLimpio = fid.trim();
    const installationId = obtenerIdInstalacion(fidLimpio);

    await database
      .ref(`users/${uid}/fcm_installations/${installationId}`)
      .set({
        fid: fidLimpio,
        platform,
        updated_at: new Date().toISOString()
      });

    return res.status(200).json({
      mensaje: 'FID registrado correctamente.'
    });

  } catch (error) {
    console.error('Error registrando FID:', error);

    return res.status(500).json({
      mensaje: 'No se pudo registrar la instalación de notificaciones.'
    });
  }
};

// ============================================================
// DESVINCULAR FID DE UNA INSTALACIÓN
// ============================================================

export const eliminarToken = async (req, res) => {
  try {
    const { fid } = req.body;

    if (
      typeof fid !== 'string' ||
      fid.trim().length < 10 ||
      fid.length > 4096
    ) {
      return res.status(400).json({
        mensaje: 'El identificador FID no es válido.'
      });
    }

    const installationId = obtenerIdInstalacion(fid.trim());

    await database
      .ref(`users/${req.usuario.uid}/fcm_installations/${installationId}`)
      .remove();

    return res.status(200).json({
      mensaje: 'Instalación desvinculada correctamente.'
    });

  } catch (error) {
    console.error('Error desvinculando FID:', error);

    return res.status(500).json({
      mensaje: 'No se pudo desvincular la instalación.'
    });
  }
};

// ============================================================
// NOTIFICAR NUEVO REPORTE EXCLUSIVAMENTE A ADMINISTRADORES
// ============================================================

export const notificarNuevoReporte = async (req, res) => {
  try {
    const { reportId } = req.body;
    const uid = req.usuario.uid;

    if (
      typeof reportId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(reportId)
    ) {
      return res.status(400).json({
        mensaje: 'El identificador del reporte no es válido.'
      });
    }

    // Verificar que sea un profesor autorizado.
    const usuarioSnapshot = await database
      .ref(`users/${uid}`)
      .once('value');

    const usuario = usuarioSnapshot.val();

    if (
      !usuario ||
      usuario.role !== 'user' ||
      usuario.autorizado !== true
    ) {
      return res.status(403).json({
        mensaje: 'No tienes permiso para generar esta notificación.'
      });
    }

    // Consultar el reporte.
    const reporteRef = database.ref(`reports/${reportId}`);
    const reporteSnapshot = await reporteRef.once('value');
    const reporte = reporteSnapshot.val();

    if (!reporte) {
      return res.status(404).json({
        mensaje: 'El reporte no existe.'
      });
    }

    // Comprobar que pertenezca al profesor autenticado.
    if (reporte.user_id !== uid) {
      return res.status(403).json({
        mensaje: 'No puedes notificar un reporte de otro usuario.'
      });
    }

    if (reporte.estado !== 'pending') {
      return res.status(409).json({
        mensaje: 'El reporte ya no está pendiente.'
      });
    }

    // Evitar notificaciones duplicadas.
    if (reporte.notificacion_enviada === true) {
      return res.status(200).json({
        mensaje: 'La notificación de este reporte ya fue enviada.'
      });
    }

    // Obtener usuarios.
    const usuariosSnapshot = await database
      .ref('users')
      .once('value');

    const usuarios = usuariosSnapshot.val() || {};

    // Recopilar FID exclusivamente de administradores.
    const instalaciones = [];

    for (const [adminUid, admin] of Object.entries(usuarios)) {
      if (admin?.role !== 'admin') continue;

      const registros = admin.fcm_installations || {};

      for (const [installationId, instalacion] of Object.entries(registros)) {
        const fid = instalacion?.fid;

        if (typeof fid === 'string' && fid.trim().length > 10) {
          instalaciones.push({
            uid: adminUid,
            installationId,
            fid: fid.trim()
          });
        }
      }
    }

    // Eliminar FID duplicados.
    const instalacionesUnicas = [
      ...new Map(
        instalaciones.map((instalacion) => [
          instalacion.fid,
          instalacion
        ])
      ).values()
    ];

    if (instalacionesUnicas.length === 0) {
      return res.status(200).json({
        mensaje: 'Reporte registrado. No hay administradores con instalaciones activas.',
        notificacionesEnviadas: 0
      });
    }

    const titulo = 'Nuevo reporte de falla';

    const cuerpo = `${reporte.salon_nombre || 'Salón'}: ${
      reporte.tipo === 'no_apaga'
        ? 'El aire acondicionado no apaga.'
        : 'El aire acondicionado no enciende.'
    }`;

    let notificacionesEnviadas = 0;

    // Firebase admite hasta 500 FID por envío multicast.
    for (let i = 0; i < instalacionesUnicas.length; i += 500) {
      const lote = instalacionesUnicas.slice(i, i + 500);
      const fids = lote.map((item) => item.fid);

      const resultado = await messaging.sendEachForMulticast({
        fids,
        notification: {
          title: titulo,
          body: cuerpo
        },
        data: {
          type: 'new_report',
          reportId
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'control_aires_notifications',
            sound: 'default'
          }
        }
      });

      notificacionesEnviadas += resultado.successCount;

      resultado.responses.forEach((respuesta, index) => {
        if (!respuesta.success) {
          console.error(
            `Error notificando al administrador ${lote[index].uid}:`,
            respuesta.error?.code,
            respuesta.error?.message
          );
        }
      });
    }

    if (notificacionesEnviadas > 0) {
      await reporteRef.update({
        notificacion_enviada: true,
        fecha_notificacion: Date.now()
      });
    }

    return res.status(200).json({
      mensaje: 'Proceso de notificación finalizado.',
      notificacionesEnviadas
    });

  } catch (error) {
    console.error('Error notificando nuevo reporte:', error);

    return res.status(500).json({
      mensaje: 'No se pudieron enviar las notificaciones.'
    });
  }
};
