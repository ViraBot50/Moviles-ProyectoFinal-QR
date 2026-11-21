import { database } from '../src/config/firebase.js';

const testId = `prueba_${Date.now()}`;
const testRef = database.ref(`_pruebas/${testId}`);

async function testFirebase() {
    try {
        console.log('\n--- PRUEBA FIREBASE REALTIME DATABASE ---');

        // 1. Escribir información
        const testData = {
            mensaje: 'Conexión exitosa',
            proyecto: 'Control Aires ITC',
            fecha: new Date().toISOString(),
        };

        await testRef.set(testData);
        console.log('1. Escritura: CORRECTA');

        // 2. Leer información
        const snapshot = await testRef.once('value');

        if (!snapshot.exists()) {
            throw new Error('No se encontró el registro');
        }

        console.log('2. Lectura: CORRECTA');
        console.log(snapshot.val());

        // 3. Eliminar información
        await testRef.remove();
        console.log('3. Eliminación: CORRECTA');

        console.log('\nFirebase Realtime Database funciona correctamente.');

    } catch (error) {
        console.error('\nError durante la prueba:', error.message);
        process.exitCode = 1;

        try {
            await testRef.remove();
        } catch (cleanupError) {
            console.error('No se pudo limpiar la prueba:', cleanupError.message);
        }
    }
}

await testFirebase();
