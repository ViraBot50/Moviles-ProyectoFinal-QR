const liberarReserva = async (deviceId, scheduleId) => {
  if (
    typeof deviceId !== 'string' ||
    !deviceId.trim() ||
    typeof scheduleId !== 'string' ||
    !scheduleId.trim()
  ) {
    return;
  }

  const referencia = locksRef.child(deviceId);

  // Leer primero la reserva actual.
  const lecturaInicial = await referencia.once('value');
  const reservaInicial = lecturaInicial.val();

  // No modificar una reserva que pertenezca a otra programación.
  if (reservaInicial !== scheduleId) {
    return;
  }

  let primeraEjecucion = true;

  await referencia.transaction((actual) => {
    const reservaActual =
      actual ?? (primeraEjecucion ? reservaInicial : null);

    primeraEjecucion = false;

    if (reservaActual === scheduleId) {
      return null;
    }

    return;
  });
};