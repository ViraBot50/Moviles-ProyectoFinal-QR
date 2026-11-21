import { supabase, storageBucket } from '../config/supabase.js';

const urlExpiration = Number(
  process.env.STORAGE_SIGNED_URL_EXPIRES || 3600
);

const extensionesPermitidas = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

export const subirFotoPerfil = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        mensaje: 'Debes seleccionar una imagen.'
      });
    }

    const uid = req.usuario.uid;
    const extension = extensionesPermitidas[req.file.mimetype];

    const ruta = `perfiles/${uid}/${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(storageBucket)
      .upload(ruta, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data, error: signedUrlError } =
      await supabase.storage
        .from(storageBucket)
        .createSignedUrl(ruta, urlExpiration);

    if (signedUrlError) {
      throw signedUrlError;
    }

    return res.status(201).json({
      mensaje: 'Imagen subida correctamente.',
      ruta,
      url: data.signedUrl,
      expiraEn: urlExpiration
    });

  } catch (error) {
    console.error('Error al subir imagen:', error.message);

    return res.status(500).json({
      mensaje: 'No se pudo subir la imagen.'
    });
  }
};

export const obtenerUrlImagen = async (req, res) => {
  try {
    const { ruta } = req.body;
    const uid = req.usuario.uid;

    if (
      typeof ruta !== 'string' ||
      !ruta.startsWith(`perfiles/${uid}/`) ||
      ruta.includes('..')
    ) {
      return res.status(403).json({
        mensaje: 'No tienes permiso para consultar esta imagen.'
      });
    }

    const { data, error } = await supabase.storage
      .from(storageBucket)
      .createSignedUrl(ruta, urlExpiration);

    if (error) {
      throw error;
    }

    return res.status(200).json({
      url: data.signedUrl,
      expiraEn: urlExpiration
    });

  } catch (error) {
    console.error('Error generando URL:', error.message);

    return res.status(500).json({
      mensaje: 'No se pudo obtener la imagen.'
    });
  }
};

export const eliminarFotoPerfil = async (req, res) => {
  try {
    const { ruta } = req.body;
    const uid = req.usuario.uid;

    if (
      typeof ruta !== 'string' ||
      !ruta.startsWith(`perfiles/${uid}/`) ||
      ruta.includes('..')
    ) {
      return res.status(403).json({
        mensaje: 'No tienes permiso para eliminar esta imagen.'
      });
    }

    const { error } = await supabase.storage
      .from(storageBucket)
      .remove([ruta]);

    if (error) {
      throw error;
    }

    return res.status(200).json({
      mensaje: 'Imagen eliminada correctamente.'
    });

  } catch (error) {
    console.error('Error eliminando imagen:', error.message);

    return res.status(500).json({
      mensaje: 'No se pudo eliminar la imagen.'
    });
  }
};
