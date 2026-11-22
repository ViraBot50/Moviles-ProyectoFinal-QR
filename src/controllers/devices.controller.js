import { database } from '../config/firebase.js';
import QRCode from 'qrcode';

const devicesRef = database.ref('devices');
const salonsRef = database.ref('salones');

const normalizarMac = (mac) => {
  if (typeof mac !== 'string') return null;

  const normalizada = mac.replace(/[:-]/g, '').toUpperCase();

  if (!/^[0-9A-F]{12}$/.test(normalizada)) {
    return null;
  }

  // Rechazar direcciones multicast y MAC nulas.
  const primerByte = parseInt(normalizada.substring(0, 2), 16);

  if (
    normalizada === '000000000000' ||
    (primerByte & 1) !== 0
  ) {
    return null;
  }

  return normalizada;
};

const esIdValido = (id) =>
  typeof id === 'string' &&
  /^[A-Za-z0-9_-]{1,128}$/.test(id);

const comprobarSalon = async (salonId) => {
  if (salonId === null || salonId === undefined || salonId === '') {
    return true;
  }

  if (!esIdValido(salonId)) return false;

  const snapshot = await salonsRef.child(salonId).once('value');

  return snapshot.exists();
};

const generarQrData = (deviceId) =>
  `CONTROL-AIRES:DEVICE:${deviceId}`;

// ======================================================
// REGISTRAR DISPOSITIVO
// ======================================================

export const registrarDispositivo = async (req, res) => {
  try {
    const {
      macAddress,
      salonId = null,
      firmwareVersion = null
    } = req.body;

    const mac = normalizarMac(macAddress);

    if (!mac) {
      return res.status(400).json({
        mensaje: 'La dirección MAC no es válida.'
      });
    }

    if (
      firmwareVersion !== null &&
      (
        typeof firmwareVersion !== 'string' ||
        firmwareVersion.length > 50
      )
    ) {
      return res.status(400).json({
        mensaje: 'La versión del firmware no es válida.'
      });
    }

    if (!(await comprobarSalon(salonId))) {
      return res.status(404).json({
        mensaje: 'El salón indicado no existe.'
      });
    }

    const deviceRef = devicesRef.child(mac);

    const resultado = await deviceRef.transaction((actual) => {
      if (actual !== null) return;

      return {
        mac_address: mac,
        salon_id: salonId,
        firmware_version: firmwareVersion,
        fecha_registro: new Date().toISOString(),
        estado: 'registrado',
        qr_data: generarQrData(mac)
      };
    });

    if (!resultado.committed) {
      return res.status(409).json({
        mensaje: 'Ya existe un dispositivo registrado con esta MAC.'
      });
    }

    const qr = await QRCode.toDataURL(generarQrData(mac));

    return res.status(201).json({
      mensaje: 'Dispositivo registrado correctamente.',
      dispositivo: {
        deviceId: mac,
        ...resultado.snapshot.val()
      },
      qr
    });

  } catch (error) {
    console.error('Error registrando dispositivo:', error);

    return res.status(500).json({
      mensaje: 'No se pudo registrar el dispositivo.'
    });
  }
};

// ======================================================
// LISTAR DISPOSITIVOS
// ======================================================

export const listarDispositivos = async (req, res) => {
  try {
    const snapshot = await devicesRef.once('value');

    const dispositivos = snapshot.val() || {};

    return res.status(200).json({
      dispositivos: Object.entries(dispositivos).map(
        ([deviceId, datos]) => ({
          deviceId,
          ...datos
        })
      )
    });

  } catch (error) {
    console.error('Error listando dispositivos:', error);

    return res.status(500).json({
      mensaje: 'No se pudieron consultar los dispositivos.'
    });
  }
};

// ======================================================
// CONSULTAR UN DISPOSITIVO
// ======================================================

export const obtenerDispositivo = async (req, res) => {
  try {
    const { deviceId } = req.params;

    if (!normalizarMac(deviceId) || normalizarMac(deviceId) !== deviceId) {
      return res.status(400).json({
        mensaje: 'El identificador del dispositivo no es válido.'
      });
    }

    const snapshot = await devicesRef.child(deviceId).once('value');

    if (!snapshot.exists()) {
      return res.status(404).json({
        mensaje: 'El dispositivo no existe.'
      });
    }

    return res.status(200).json({
      dispositivo: {
        deviceId,
        ...snapshot.val()
      }
    });

  } catch (error) {
    console.error('Error consultando dispositivo:', error);

    return res.status(500).json({
      mensaje: 'No se pudo consultar el dispositivo.'
    });
  }
};

// ======================================================
// ASIGNAR DISPOSITIVO A UN SALÓN
// ======================================================

export const asignarSalon = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { salonId } = req.body;

    if (!normalizarMac(deviceId) || normalizarMac(deviceId) !== deviceId) {
      return res.status(400).json({
        mensaje: 'El identificador del dispositivo no es válido.'
      });
    }

    if (salonId !== null && !esIdValido(salonId)) {
      return res.status(400).json({
        mensaje: 'El identificador del salón no es válido.'
      });
    }

    if (!(await comprobarSalon(salonId))) {
      return res.status(404).json({
        mensaje: 'El salón indicado no existe.'
      });
    }

    const deviceRef = devicesRef.child(deviceId);
    const snapshot = await deviceRef.once('value');

    if (!snapshot.exists()) {
      return res.status(404).json({
        mensaje: 'El dispositivo no existe.'
      });
    }

    await deviceRef.update({
      salon_id: salonId || null
    });

    return res.status(200).json({
      mensaje: 'Asignación actualizada correctamente.',
      deviceId,
      salonId: salonId || null
    });

  } catch (error) {
    console.error('Error asignando salón:', error);

    return res.status(500).json({
      mensaje: 'No se pudo asignar el salón.'
    });
  }
};

// ======================================================
// ELIMINAR DISPOSITIVO
// ======================================================

export const eliminarDispositivo = async (req, res) => {
  try {
    const { deviceId } = req.params;

    if (!normalizarMac(deviceId) || normalizarMac(deviceId) !== deviceId) {
      return res.status(400).json({
        mensaje: 'El identificador del dispositivo no es válido.'
      });
    }

    const deviceRef = devicesRef.child(deviceId);
    const snapshot = await deviceRef.once('value');

    if (!snapshot.exists()) {
      return res.status(404).json({
        mensaje: 'El dispositivo no existe.'
      });
    }

    await deviceRef.remove();

    return res.status(200).json({
      mensaje: 'Dispositivo eliminado correctamente.',
      deviceId
    });

  } catch (error) {
    console.error('Error eliminando dispositivo:', error);

    return res.status(500).json({
      mensaje: 'No se pudo eliminar el dispositivo.'
    });
  }
};

// ======================================================
// GENERAR QR DE UN DISPOSITIVO
// ======================================================

export const obtenerQr = async (req, res) => {
  try {
    const { deviceId } = req.params;

    if (!normalizarMac(deviceId) || normalizarMac(deviceId) !== deviceId) {
      return res.status(400).json({
        mensaje: 'El identificador del dispositivo no es válido.'
      });
    }

    const snapshot = await devicesRef.child(deviceId).once('value');

    if (!snapshot.exists()) {
      return res.status(404).json({
        mensaje: 'El dispositivo no existe.'
      });
    }

    const qr = await QRCode.toDataURL(generarQrData(deviceId));

    return res.status(200).json({
      deviceId,
      qr
    });

  } catch (error) {
    console.error('Error generando QR:', error);

    return res.status(500).json({
      mensaje: 'No se pudo generar el código QR.'
    });
  }
};
