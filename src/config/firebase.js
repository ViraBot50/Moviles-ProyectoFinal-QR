import 'dotenv/config';

import { setDefaultResultOrder } from 'node:dns';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// WSL no tiene una ruta IPv6 funcional hacia Google.
// Priorizar IPv4 evita los tiempos de espera de OAuth.
setDefaultResultOrder('ipv4first');

const serviceAccountPath = resolve(
  process.cwd(),
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH
);

const serviceAccount = JSON.parse(
  readFileSync(serviceAccountPath, 'utf8')
);

const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });

export const firebaseAuth = getAuth(app);
export const auth = firebaseAuth;
export const database = getDatabase(app);
export const messaging = getMessaging(app);

console.log('Firebase Admin inicializado correctamente');

export default app;
