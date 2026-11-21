import 'dotenv/config';

import {
    supabase,
    storageBucket,
} from '../src/config/supabase.js';

const testPath = `_pruebas/test-${Date.now()}.png`;

const imageBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
    'base64'
);

let uploaded = false;

async function testSupabase() {
    try {
        console.log('\n--- PRUEBA SUPABASE STORAGE ---');

        // 1. Comprobar que existe el bucket
        const { data: bucket, error: bucketError } =
            await supabase.storage.getBucket(storageBucket);

        if (bucketError) {
            throw new Error(
                `No se pudo consultar el bucket: ${bucketError.message}`
            );
        }

        console.log('1. Bucket encontrado:', bucket.name);

        // 2. Subir imagen
        const { data: uploadData, error: uploadError } =
            await supabase.storage
                .from(storageBucket)
                .upload(testPath, imageBuffer, {
                    contentType: 'image/png',
                    upsert: false,
                });

        if (uploadError) {
            throw new Error(
                `Error al subir imagen: ${uploadError.message}`
            );
        }

        uploaded = true;
        console.log('2. Subida: CORRECTA');
        console.log('Ruta:', uploadData.path);

        // 3. Generar URL firmada
        const expiresIn =
            Number(process.env.STORAGE_SIGNED_URL_EXPIRES) || 60;

        const { data: signedData, error: signedError } =
            await supabase.storage
                .from(storageBucket)
                .createSignedUrl(testPath, expiresIn);

        if (signedError) {
            throw new Error(
                `Error al generar URL: ${signedError.message}`
            );
        }

        if (!signedData?.signedUrl) {
            throw new Error('No se generó una URL firmada');
        }

        console.log('3. URL firmada: CORRECTA');
        console.log(`Expira en ${expiresIn} segundos`);

        // 4. Eliminar imagen
        const { data: removeData, error: removeError } =
            await supabase.storage
                .from(storageBucket)
                .remove([testPath]);

        if (removeError) {
            throw new Error(
                `Error al eliminar imagen: ${removeError.message}`
            );
        }

        if (removeData === null || removeData === undefined) {
    throw new Error('No se recibió confirmación de Supabase');
}

uploaded = false;
console.log('4. Eliminación: CORRECTA');

        console.log(
            '\nSupabase Storage funciona correctamente.'
        );

    } catch (error) {
        console.error('\nError durante la prueba:', error.message);
        process.exitCode = 1;

    } finally {
        // Limpiar si ocurrió un error después de subir la imagen
        if (uploaded) {
            const { error } = await supabase.storage
                .from(storageBucket)
                .remove([testPath]);

            if (error) {
                console.error(
                    'No se pudo limpiar la imagen:',
                    error.message
                );
            } else {
                console.log('Archivo de prueba eliminado durante la limpieza.');
            }
        }
    }
}

await testSupabase();
