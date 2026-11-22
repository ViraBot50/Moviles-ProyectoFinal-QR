
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';

import './config/firebase.js';
import './config/supabase.js';

import storageRoutes from './routes/storage.routes.js';
import adminRoutes from './routes/admin.routes.js';
import devicesRoutes from './routes/devices.routes.js';
import schedulesRoutes from './routes/schedules.routes.js';

const app = express();
const PORT = process.env.PORT || 3000;

const origins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(helmet());

app.use(cors({
  origin: (origin, callback) => {
    // Las aplicaciones móviles nativas pueden no enviar Origin.
    if (!origin || origins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Origen no permitido por CORS'));
  },
  credentials: true
}));

app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    mensaje: 'Backend de Control Aires ITC funcionando',
    estado: 'OK'
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    servidor: 'OK',
    firebase: 'Configurado',
    supabase: 'Configurado'
  });
});

app.use('/api/storage', storageRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/schedules', schedulesRoutes);

// Manejo centralizado de errores.
app.use((error, req, res, next) => {
  console.error('Error:', error.message);

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      mensaje: 'Error al procesar el archivo.',
      detalle: error.message
    });
  }

  if (error.message === 'Origen no permitido por CORS') {
    return res.status(403).json({
      mensaje: error.message
    });
  }

  return res.status(400).json({
    mensaje: error.message || 'Error en la solicitud.'
  });
});

app.listen(PORT, () => {
  console.log('================================');
  console.log(' CONTROL AIRES ITC - BACKEND');
  console.log('================================');
  console.log(`Servidor: http://localhost:${PORT}`);
  console.log(`Entorno: ${process.env.NODE_ENV}`);
});
