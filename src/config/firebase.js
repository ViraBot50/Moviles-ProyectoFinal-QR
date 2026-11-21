import 'dotenv/config';

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Obtener la ruta de las credenciales
const serviceAccountPath = resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH
);

// Leer el archivo JSON
const serviceAccount = JSON.parse(
    readFileSync(serviceAccountPath, 'utf8')
);

// Inicializar Firebase una sola vez
const app = getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
    });

// Servicios de Firebase
export const firebaseAuth = getAuth(app);
export const auth = firebaseAuth;
export const database = getDatabase(app);

console.log('Firebase Admin inicializado correctamente');

export default app;
