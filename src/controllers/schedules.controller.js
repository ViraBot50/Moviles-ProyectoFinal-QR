
import { randomUUID } from 'node:crypto';
import { database } from '../config/firebase.js';

const schedulesRef = database.ref('schedules');
const devicesRef = database.ref('devices');
const usersRef = database.ref('users');
const locksRef = database.ref('scheduleLocks');

const normalizarDeviceId = (id) =>
  typeof id === 'string' &&
  /^[0-9A-F]{12}$/.test(id);

const obtenerPerfil = async (uid) => {
  const snapshot = await usersRef.child(uid).once('value');
  return snapshot.val();
};

const esAdministrador = (perfil) => perfil?.role === 'admin';

const tieneAccesoAlDispositivo = (perfil, deviceId) =>
  esAdministrador(perfil) ||
  perfil?.dispositivos_vinculados?.[deviceId] === true;

const puedeProgramar = (perfil) =>
  esAdministrador(perfil) || perfil?.autorizado === true;

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
    actual === scheduleId ? null : undefined
  );
};

// ======================================================
// CREAR PROGRAMACIÓN
// ======================================================

export const crearProgramacion = async (req, res) => {
  let deviceId;
  let scheduleId;

  try {
    const {
      deviceId: idRecibido,
      startAt,
      durationHours,
    } = req.body;

    deviceId = idRecibido;

    if (!normalizarDeviceId(deviceId)) {
      return res.status(400).json({
        mensaje: 'El identificador del dispositivo no es válido.',
      });
    }

    if (
      typeof startAt !== 'string' ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(startAt)
    ) {
      return res.status(400).json({
        mensaje: 'La fecha de inicio debe incluir zona horaria.',
      });
    }

    const fechaInicio = new Date(startAt);

    if (Number.isNaN(fechaInicio.getTime())) {
      return res.status(400).json({
        mensaje: 'La fecha de inicio no es válida.',
      });
    }

    if (fechaInicio.getTime() <= Date.now()) {
      return res.status(400).json({
        mensaje: 'La hora de inicio debe ser futura.',
      });
    }

    if (
      !Number.isInteger(durationHours) ||
      durationHours < 1 ||
      durationHours > 12
    ) {
      return res.status(400).json({
        mensaje:
          'La duración debe ser un número entero entre 1 y 12 horas.',
      });
    }

    const perfil = await obtenerPerfil(req.usuario.uid);

    if (!perfil) {
      return res.status(404).json({
        mensaje: 'No se encontró el perfil del usuario.',
      });
    }

    if (!puedeProgramar(perfil)) {
      return res.status(403).json({
        mensaje:
          'Tu cuenta todavía no está autorizada para programar dispositivos.',
      });
    }

    if (!tieneAccesoAlDispositivo(perfil, deviceId)) {
      return res.status(403).json({
        mensaje: 'No tienes vinculado este dispositivo.',
      });
    }

    const dispositivoSnapshot = await devicesRef
      .child(deviceId)
      .once('value');

    if (!dispositivoSnapshot.exists()) {
      return res.status(404).json({
        mensaje: 'El dispositivo no existe.',
      });
    }

    scheduleId = randomUUID();

    const fechaFin = new Date(
      fechaInicio.getTime() + durationHours * 60 * 60 * 1000
    );

    const programacion = {
      schedule_id: scheduleId,
      device_id: deviceId,
      user_id: req.usuario.uid,
      user_email: req.usuario.email,
      start_at: fechaInicio.toISOString(),
      duration_hours: durationHours,
      end_at: fechaFin.toISOString(),
      status: 'scheduled',
      created_at: new Date().toISOString(),
    };

    // Reservar el dispositivo de forma atómica.
    const lockRef = locksRef.child(deviceId);

    const resultado = await lockRef.transaction((actual) => {
      if (actual !== null) {
        return;
      }

      return scheduleId;
    });

    if (!resultado.committed) {
      return res.status(409).json({
        mensaje:
          'Este dispositivo ya tiene una programación pendiente.',
      });
    }

    try {
      await schedulesRef.child(scheduleId).set(programacion);
    } catch (error) {
      await liberarReserva(deviceId, scheduleId);
      throw error;
    }

    return res.status(201).json({
      mensaje: 'Programación creada correctamente.',
      programacion,
    });
  } catch (error) {
    console.error('Error creando programación:', error);

    return res.status(500).json({
      mensaje: 'No se pudo crear la programación.',
    });
  }
};

// ======================================================
// LISTAR PROGRAMACIONES
// ======================================================

export const listarProgramaciones = async (req, res) => {
  try {
    const perfil = await obtenerPerfil(req.usuario.uid);

    if (!perfil) {
      return res.status(404).json({
        mensaje: 'No se encontró el perfil del usuario.',
      });
    }

    const snapshot = await schedulesRef.once('value');
    const datos = snapshot.val() || {};

    const esAdmin = esAdministrador(perfil);

    const programaciones = Object.entries(datos)
      .map(([firebaseKey, datosProgramacion]) => ({
        ...datosProgramacion,
        scheduleId: firebaseKey,
      }))
      .filter((programacion) =>
        esAdmin || programacion.user_id === req.usuario.uid
      )
      .sort((a, b) =>
        new Date(a.start_at) - new Date(b.start_at)
      );

    return res.status(200).json({
      programaciones,
    });
  } catch (error) {
    console.error('Error listando programaciones:', error);

    return res.status(500).json({
      mensaje: 'No se pudieron consultar las programaciones.',
    });
  }
};

// ======================================================
// CONSULTAR UNA PROGRAMACIÓN
// ======================================================

export const obtenerProgramacion = async (req, res) => {
  try {
    const { scheduleId } = req.params;

    const [perfil, snapshot] = await Promise.all([
      obtenerPerfil(req.usuario.uid),
      schedulesRef.child(scheduleId).once('value'),
    ]);

    if (!perfil) {
      return res.status(404).json({
        mensaje: 'No se encontró el perfil del usuario.',
      });
    }

    if (!snapshot.exists()) {
      return res.status(404).json({
        mensaje: 'La programación no existe.',
      });
    }

    const programacion = snapshot.val();

    if (
      !esAdministrador(perfil) &&
      programacion.user_id !== req.usuario.uid
    ) {
      return res.status(403).json({
        mensaje: 'No tienes permiso para consultar esta programación.',
      });
    }

    return res.status(200).json({
      scheduleId,
      programacion,
    });
  } catch (error) {
    console.error('Error consultando programación:', error);

    return res.status(500).json({
      mensaje: 'No se pudo consultar la programación.',
    });
  }
};

// ======================================================
// CANCELAR PROGRAMACIÓN
// ======================================================

export const cancelarProgramacion = async (req, res) => {
  try {
    const { scheduleId } = req.params;

    const perfil = await obtenerPerfil(req.usuario.uid);

    if (!perfil) {
      return res.status(404).json({
        mensaje: 'No se encontró el perfil del usuario.',
      });
    }

    const referencia = schedulesRef.child(scheduleId);

    // Obtener el registro antes de iniciar la transacción.
    const lecturaInicial = await referencia.once('value');

    if (!lecturaInicial.exists()) {
      return res.status(404).json({
        mensaje: 'La programación no existe.',
      });
    }

    // Respaldo para la primera ejecución de la transacción,
    // cuando Firebase todavía puede proporcionar null.
    let primeraEjecucion = true;

    const resultado = await referencia.transaction((actual) => {
      const programacionActual =
        actual ??
        (primeraEjecucion ? lecturaInicial.val() : null);

      primeraEjecucion = false;

      if (!programacionActual) {
        return;
      }

      if (
        !esAdministrador(perfil) &&
        programacionActual.user_id !== req.usuario.uid
      ) {
        return;
      }

      if (programacionActual.status !== 'scheduled') {
        return;
      }

      if (
        programacionActual.overdue_alert_status === 'processing'
      ) {
        return;
      }

      return {
        ...programacionActual,
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: req.usuario.uid,
      };
    });

    if (!resultado.committed) {
      const actual = resultado.snapshot.val();

      if (!actual) {
        return res.status(404).json({
          mensaje: 'La programación no existe.',
        });
      }

      if (
        !esAdministrador(perfil) &&
        actual.user_id !== req.usuario.uid
      ) {
        return res.status(403).json({
          mensaje:
            'No tienes permiso para cancelar esta programación.',
        });
      }

      if (actual.overdue_alert_status === 'processing') {
        return res.status(409).json({
          mensaje:
            'La programación está siendo procesada. Intenta cancelarla nuevamente en unos momentos.',
        });
      }

      return res.status(409).json({
        mensaje: 'Esta programación ya no se encuentra pendiente.',
      });
    }

    const programacionCancelada = resultado.snapshot.val();

    // Liberar la reserva únicamente si todavía pertenece
    // a la programación que acabamos de cancelar.
    try {
      await liberarReserva(
        programacionCancelada.device_id,
        scheduleId
      );
    } catch (error) {
      console.error(
        'La programación se canceló, pero no se pudo liberar la reserva:',
        error.message
      );
    }

    return res.status(200).json({
      mensaje: 'Programación cancelada correctamente.',
      scheduleId,
    });
  } catch (error) {
    console.error('Error cancelando programación:', error);

    return res.status(500).json({
      mensaje: 'No se pudo cancelar la programación.',
    });
  }
};
