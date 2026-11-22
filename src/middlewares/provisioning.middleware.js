import { timingSafeEqual } from 'node:crypto';

export const verificarAprovisionamiento = (req, res, next) => {
  const claveConfigurada = process.env.PROVISIONING_SECRET;
  const claveRecibida = req.headers['x-provisioning-key'];

  if (
    typeof claveConfigurada !== 'string' ||
    claveConfigurada.length < 32
  ) {
    console.error('PROVISIONING_SECRET no está configurada correctamente.');

    return res.status(503).json({
      mensaje: 'El servicio de aprovisionamiento no está disponible.'
    });
  }

  if (typeof claveRecibida !== 'string') {
    return res.status(401).json({
      mensaje: 'Credenciales de aprovisionamiento no proporcionadas.'
    });
  }

  const claveEsperada = Buffer.from(claveConfigurada);
  const claveEnviada = Buffer.from(claveRecibida);

  if (
    claveEsperada.length !== claveEnviada.length ||
    !timingSafeEqual(claveEsperada, claveEnviada)
  ) {
    return res.status(401).json({
      mensaje: 'Credenciales de aprovisionamiento incorrectas.'
    });
  }

  next();
};
