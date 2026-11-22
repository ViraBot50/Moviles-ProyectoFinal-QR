import { database } from '../config/firebase.js';
import { enviarAlertaProgramacionVencida } from './notifications.service.js';

const schedulesRef = database.ref('schedules');
const devicesRef = database.ref('devices');
const locksRef = database.ref('scheduleLocks');

const INTERVALO_REVISION = 60 * 1000;
const TOLERANCIA_MINUTOS = 5;
const ESPERA_ADICIONAL = 30 * 60 * 1000;
const ESTADO_MAXIMO_ANTIGUEDAD = 2 * 60 * 1000;
const TIEMPO_RECUPERACION_PROCESO = 2 * 60 * 1000;

let monitorIniciado = false;
let revisionEnCurso = false;

const obtenerFecha = (valor) => {
  if (typeof valor !== 'string') return null;

  const fecha = new Date(valor);

  return Number.isNaN(fecha.getTime()) ? null : fecha;
};

const obtenerFechaRevision = (programacion) => {
  const fechaFin = obtenerFecha(programacion.end_at);

  if (!fechaFin) return null;

  return new Date(
    fechaFin.getTime() + TOLERANCIA_MINUTOS * 60 * 1000,
  );
};

const liberarReserva = async (deviceId, scheduleId) => {
  if (
    typeof deviceId !== 'string' ||
    !deviceId.trim() ||
    typeof scheduleId !== 'string' ||
    !scheduleId.trim()
  ) {
    return;
  }

  await locksRef.child(deviceId).transaction((actual) =>
    actual === scheduleId ? null : undefined,
  );
};

const finalizarSinAlerta = async (
  scheduleId,
  deviceId,
  motivo,
  datosAdicionales = {},
) => {
  await schedulesRef.child(scheduleId).update({
    status: 'completed',
    overdue_alert_status: motivo,
    overdue_alert_processing_at: null,
    completed_at: new Date().toISOString(),
    ...datosAdicionales,
  });

  await liberarReserva(deviceId, scheduleId);

  console.log(
    `Programación ${scheduleId}: finalizada sin alerta (${motivo}).`,
  );
};

const reclamarProgramacion = async (scheduleId) => {
  const referencia = schedulesRef.child(scheduleId);
  const ahora = Date.now();

  const resultado = await referencia.transaction((actual) => {
    if (!actual || actual.status !== 'scheduled') return;

    const fechaRevision = obtenerFechaRevision(actual);

    if (!fechaRevision || ahora < fechaRevision.getTime()) return;

    const estadosFinalizados = [
      'sent',
      'skipped_off',
      'skipped_unknown',
      'skipped_unknown_timeout',
      'skipped_no_installations_timeout',
      'skipped_missing_device',
      'skipped_invalid_device',
    ];

    if (estadosFinalizados.includes(actual.overdue_alert_status)) {
      return;
    }

    if (actual.overdue_alert_status === 'processing') {
      const inicioProceso = Date.parse(
        actual.overdue_alert_processing_at ?? '',
      );

      const procesoVigente =
        Number.isFinite(inicioProceso) &&
        ahora - inicioProceso < TIEMPO_RECUPERACION_PROCESO;

      if (procesoVigente) return;
    }

    return {
      ...actual,
      overdue_alert_status: 'processing',
      overdue_alert_processing_at: new Date(ahora).toISOString(),
    };
  });

  return resultado.committed ? resultado.snapshot.val() : null;
};

/**
 * Espera una condición necesaria para procesar la alerta.
 *
 * El límite de 30 minutos se cuenta desde el final de la
 * tolerancia inicial de 5 minutos y se comparte entre:
 * - Esperar un estado confiable del dispositivo.
 * - Esperar instalaciones FCM para enviar la notificación.
 */
const esperarCondicion = async (
  scheduleId,
  programacion,
  deviceId,
  {
    estadoEspera,
    motivoTimeout,
    mensaje,
  },
) => {
  const fechaRevision = obtenerFechaRevision(programacion);

  if (!fechaRevision) {
    throw new Error(
      'La programación no tiene una fecha de finalización válida.',
    );
  }

  const fechaInicioEspera =
    obtenerFecha(programacion.overdue_alert_wait_started_at) ??
    fechaRevision;

  const fechaLimite =
    fechaInicioEspera.getTime() + ESPERA_ADICIONAL;

  const ahora = Date.now();

  if (ahora >= fechaLimite) {
    await finalizarSinAlerta(
      scheduleId,
      deviceId,
      motivoTimeout,
      {
        overdue_alert_wait_started_at: fechaInicioEspera.toISOString(),
        overdue_alert_wait_finished_at: new Date(ahora).toISOString(),
      },
    );

    return;
  }

  const primeraEspera =
    !programacion.overdue_alert_wait_started_at;

  await schedulesRef.child(scheduleId).update({
    overdue_alert_status: estadoEspera,
    overdue_alert_wait_started_at: fechaInicioEspera.toISOString(),
    overdue_alert_processing_at: null,
  });

  if (primeraEspera) {
    console.log(
      `Programación ${scheduleId}: ${mensaje} ` +
      'Se revisará cada minuto durante un máximo de 30 minutos.',
    );
  }
};

const procesarProgramacion = async (scheduleId) => {
  const programacion = await reclamarProgramacion(scheduleId);

  if (!programacion) return;

  const deviceId = programacion.device_id;

  try {
    if (
      typeof deviceId !== 'string' ||
      !deviceId.trim()
    ) {
      await finalizarSinAlerta(
        scheduleId,
        null,
        'skipped_invalid_device',
      );

      return;
    }

    const dispositivoSnapshot = await devicesRef
      .child(deviceId)
      .once('value');

    if (!dispositivoSnapshot.exists()) {
      await finalizarSinAlerta(
        scheduleId,
        deviceId,
        'skipped_missing_device',
      );

      return;
    }

    const dispositivo = dispositivoSnapshot.val();

    const estado = dispositivo.power_state;
    const ultimaActualizacion = obtenerFecha(
      dispositivo.last_state_update,
    );

    const ahora = Date.now();

    const estadoConfiable =
      (estado === 'on' || estado === 'off') &&
      ultimaActualizacion !== null &&
      ahora - ultimaActualizacion.getTime() >= 0 &&
      ahora - ultimaActualizacion.getTime() <=
        ESTADO_MAXIMO_ANTIGUEDAD;

    if (!estadoConfiable) {
      await esperarCondicion(
        scheduleId,
        programacion,
        deviceId,
        {
          estadoEspera: 'waiting_state',
          motivoTimeout: 'skipped_unknown_timeout',
          mensaje: 'esperando un estado confiable del dispositivo.',
        },
      );

      return;
    }

    if (estado === 'off') {
      await finalizarSinAlerta(
        scheduleId,
        deviceId,
        'skipped_off',
      );

      return;
    }

    const resultado = await enviarAlertaProgramacionVencida({
      ...programacion,
      schedule_id: scheduleId,
    });

    // No hay instalaciones FCM registradas.
    // Se conserva la reserva y se espera hasta el límite compartido.
    if (resultado.total === 0) {
      await esperarCondicion(
        scheduleId,
        programacion,
        deviceId,
        {
          estadoEspera: 'waiting_recipients',
          motivoTimeout: 'skipped_no_installations_timeout',
          mensaje: 'esperando instalaciones FCM para enviar la alerta.',
        },
      );

      return;
    }

    if (
      resultado.fallidos > 0 ||
      resultado.enviados === 0
    ) {
      throw new Error(
        'Hay notificaciones pendientes o no se pudieron completar los envíos.',
      );
    }

    const fechaCompletado = new Date().toISOString();

    await schedulesRef.child(scheduleId).update({
      status: 'completed',
      overdue_alert_status: 'sent',
      overdue_alert_sent_at: fechaCompletado,
      overdue_alert_processing_at: null,
      completed_at: fechaCompletado,
    });

    await liberarReserva(deviceId, scheduleId);

    console.log(
      `Programación ${scheduleId}: alerta enviada correctamente.`,
    );
  } catch (error) {
    console.error(
      `Error procesando programación ${scheduleId}:`,
      error.message,
    );

    const referencia = schedulesRef.child(scheduleId);
    const snapshot = await referencia.once('value');
    const actual = snapshot.val();

    if (
      actual?.status === 'scheduled' &&
      actual.overdue_alert_status === 'processing'
    ) {
      await referencia.update({
        overdue_alert_status: 'pending',
        overdue_alert_processing_at: null,
      });
    }
  }
};

const repararReservasFinalizadas = async (
  scheduleId,
  programacion,
) => {
  if (
    !['completed', 'cancelled'].includes(programacion?.status)
  ) {
    return;
  }

  if (!programacion.device_id) return;

  try {
    await liberarReserva(programacion.device_id, scheduleId);
  } catch (error) {
    console.error(
      `No se pudo reparar la reserva de ${scheduleId}:`,
      error.message,
    );
  }
};

const revisarProgramaciones = async () => {
  if (revisionEnCurso) return;

  revisionEnCurso = true;

  try {
    const snapshot = await schedulesRef.once('value');
    const programaciones = snapshot.val() ?? {};

    for (const [scheduleId, programacion] of Object.entries(
      programaciones,
    )) {
      if (programacion?.status === 'scheduled') {
        await procesarProgramacion(scheduleId);
        continue;
      }

      await repararReservasFinalizadas(
        scheduleId,
        programacion,
      );
    }
  } catch (error) {
    console.error(
      'Error revisando programaciones:',
      error.message,
    );
  } finally {
    revisionEnCurso = false;
  }
};

export const iniciarMonitorProgramaciones = () => {
  if (monitorIniciado) return;

  monitorIniciado = true;

  console.log(
    'Monitor de programaciones iniciado. Revisión cada minuto.',
  );

  void revisarProgramaciones();

  const intervalo = setInterval(() => {
    void revisarProgramaciones();
  }, INTERVALO_REVISION);

  intervalo.unref();
};
