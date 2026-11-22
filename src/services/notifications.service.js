import { createHash } from 'node:crypto';
import { database, messaging } from '../config/firebase.js';

const usersRef = database.ref('users');
const schedulesRef = database.ref('schedules');

/**
 * Envía una alerta a todos los docentes vinculados y administradores.
 * Guarda el resultado individual de cada instalación para evitar
 * reenviar notificaciones que ya fueron entregadas por FCM.
 */
export const enviarAlertaProgramacionVencida = async (programacion) => {
  const scheduleId = programacion?.schedule_id;
  const deviceId = programacion?.device_id;

  if (!scheduleId || !deviceId) {
    throw new Error(
      'La programación necesita schedule_id y device_id.',
    );
  }

  const entregasRef = schedulesRef
    .child(scheduleId)
    .child('overdue_alert_deliveries');

  try {
    const [usuariosSnapshot, entregasSnapshot] = await Promise.all([
      usersRef.once('value'),
      entregasRef.once('value'),
    ]);

    const usuarios = usuariosSnapshot.val() ?? {};
    const entregasGuardadas = entregasSnapshot.val() ?? {};

    // Obtener docentes vinculados y todos los administradores.
    const destinatarios = Object.entries(usuarios).filter(
      ([, usuario]) =>
        usuario?.role === 'admin' ||
        usuario?.dispositivos_vinculados?.[deviceId] === true,
    );

    // Reunir instalaciones y eliminar FID duplicados.
    const instalaciones = new Map();

    for (const [uid, usuario] of destinatarios) {
      const fcmInstallations = usuario?.fcm_installations ?? {};

      for (const [installationId, instalacion] of Object.entries(
        fcmInstallations,
      )) {
        const fid = instalacion?.fid;

        if (typeof fid !== 'string' || !fid.trim()) {
          continue;
        }

        const deliveryId = createHash('sha256')
          .update(fid)
          .digest('hex');

        if (!instalaciones.has(deliveryId)) {
          instalaciones.set(deliveryId, {
            deliveryId,
            uid,
            installationId,
            fid,
          });
        }
      }
    }

    if (instalaciones.size === 0) {
      console.log(
        `No hay instalaciones FCM para la programación ${scheduleId}.`,
      );

      return {
        destinatarios: destinatarios.length,
        total: 0,
        enviados: 0,
        fallidos: 0,
        pendientes: 0,
      };
    }

    const mensaje = {
      notification: {
        title: 'Control Aires ITC',
        body:
          'Una programación terminó y el aire acondicionado ' +
          'continúa encendido.',
      },
      data: {
        type: 'schedule_overdue',
        deviceId: String(deviceId),
        scheduleId: String(scheduleId),
        endAt: String(programacion.end_at ?? ''),
      },
    };

    let enviados = 0;
    let fallidos = 0;

    for (const instalacion of instalaciones.values()) {
      const entregaAnterior =
        entregasGuardadas[instalacion.deliveryId];

      // No volver a enviar una notificación ya confirmada por FCM.
      if (entregaAnterior?.status === 'sent') {
        enviados++;
        continue;
      }

      try {
        const messageId = await messaging.send({
          ...mensaje,
          fid: instalacion.fid,
        });

        // Guardar el éxito individual antes de continuar.
        await entregasRef.child(instalacion.deliveryId).set({
          uid: instalacion.uid,
          installation_id: instalacion.installationId,
          status: 'sent',
          sent_at: new Date().toISOString(),
          message_id: messageId,
        });

        enviados++;
      } catch (error) {
        fallidos++;

        console.error(
          'Error enviando notificación a una instalación:',
          {
            uid: instalacion.uid,
            error: error.message,
          },
        );

        // Guardar el fallo para poder reintentarlo después.
        await entregasRef.child(instalacion.deliveryId).set({
          uid: instalacion.uid,
          installation_id: instalacion.installationId,
          status: 'failed',
          failed_at: new Date().toISOString(),
          error: String(error.message ?? error).slice(0, 500),
        });
      }
    }

    console.log(
      `Programación ${scheduleId}: ` +
      `${enviados} instalaciones completadas, ` +
      `${fallidos} fallidas.`,
    );

    return {
      destinatarios: destinatarios.length,
      total: instalaciones.size,
      enviados,
      fallidos,
      pendientes: fallidos,
    };
  } catch (error) {
    console.error(
      'Error procesando notificaciones:',
      error.message,
    );

    throw error;
  }
};
