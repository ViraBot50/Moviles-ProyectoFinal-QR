
import { database } from '../config/firebase.js';
import { enviarAlertaProgramacionVencida } from './notifications.service.js';

const schedulesRef = database.ref('schedules');
const locksRef = database.ref('scheduleLocks');

const INTERVALO_REVISION = 60 * 1000;
const TOLERANCIA_MINUTOS = 5;
const ESPERA_ADICIONAL = 30 * 60 * 1000;
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

// ======================================================
// LIBERAR RESERVA
// ======================================================

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

// ======================================================
// FINALIZAR PROGRAMACIÓN SIN ALERTA
// ======================================================

const finalizarSinAlerta = async (
  scheduleId,
  deviceId,
  motivo,
) => {
  await schedulesRef.child(scheduleId).update({
    status: 'completed',
    overdue_alert_status: motivo,
    overdue_alert_processing_at: null,
    completed_at: new Date().toISOString(),
  });

  await liberarReserva(deviceId, scheduleId);

  console.log(
    `Programación ${scheduleId}: finalizada sin alerta (${motivo}).`,
  );
};

// ======================================================
// RECLAMAR PROGRAMACIÓN
// ======================================================

const reclamarProgramacion = async (scheduleId) => {
  const referencia = schedulesRef.child(scheduleId);
  const ahora = Date.now();

  const resultado = await referencia.transaction((actual) => {
    if (!actual || actual.status !== 'scheduled') return;

    const fechaRevision = obtenerFechaRevision(actual);

    if (!fechaRevision || ahora < fechaRevision.getTime()) return;

    const estadosFinalizados = [
      'sent',
      'skipped_no_installations_timeout',
    ];

    if (
      estadosFinalizados.includes(actual.overdue_alert_status)
    ) {
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

// ======================================================
// ESPERAR INSTALACIONES FCM
// ======================================================

const esperarInstalaciones = async (
  scheduleId,
  programacion,
  deviceId,
) => {
  const fechaRevision = obtenerFechaRevision(programacion);

  if (!fechaRevision) {
    throw new Error(
      'La programación no tiene una fecha de finalización válida.',
    );
  }

  // El plazo comienza después de los 5 minutos de tolerancia.
  const fechaInicioEspera = fechaRevision;

  const fechaLimite =
    fechaInicioEspera.getTime() + ESPERA_ADICIONAL;

  const ahora = Date.now();

  if (ahora >= fechaLimite) {
    await finalizarSinAlerta(
      scheduleId,
      deviceId,
      'skipped_no_installations_timeout',
    );

    return;
  }

  const primeraEspera =
    !programacion.overdue_alert_wait_started_at;

  await schedulesRef.child(scheduleId).update({
    overdue_alert_status: 'waiting_recipients',
    overdue_alert_wait_started_at: fechaInicioEspera.toISOString(),
    overdue_alert_processing_at: null,
  });

  if (primeraEspera) {
    console.log(
      `Programación ${scheduleId}: no hay instalaciones FCM disponibles. ` +
      'Se esperarán hasta 30 minutos para enviar la alerta.',
    );
  }
};

// ======================================================
// PROCESAR PROGRAMACIÓN VENCIDA
// ======================================================

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

    // Ya no consultamos power_state ni last_state_update.
    // La programación activa es suficiente para procesar la alerta.

    const resultado = await enviarAlertaProgramacionVencida({
      ...programacion,
      schedule_id: scheduleId,
    });

    // No hay instalaciones FCM registradas.
    // Esperar hasta 30 minutos después de la tolerancia.
    if (resultado.total === 0) {
      await esperarInstalaciones(
        scheduleId,
        programacion,
        deviceId,
      );

      return;
    }

    // Si algún envío falla, se reintentará en la siguiente revisión.
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

// ======================================================
// REPARAR RESERVAS DE PROGRAMACIONES FINALIZADAS
// ======================================================

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

// ======================================================
// REVISAR PROGRAMACIONES
// ======================================================

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

// ======================================================
// INICIAR MONITOR
// ======================================================

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
