// ============================================================================
// wompi-webhook — recibe el resultado definitivo de cada transacción
// ----------------------------------------------------------------------------
// Wompi llama aquí cuando una transacción llega a estado final. Esta función
// es la ÚNICA fuente de verdad sobre si un cobro se aprobó: la respuesta de la
// llamada original puede quedarse en PENDING.
//
// DESPLEGAR SIN VERIFICACIÓN DE JWT:
//     supabase functions deploy wompi-webhook --no-verify-jwt
// Wompi no manda ningún token de Supabase. Lo que autentica la petición es el
// checksum firmado con el secreto de eventos, que se comprueba abajo.
//
// URL a registrar en el panel de Wompi (Desarrolladores → Eventos):
//     https://TU_PROYECTO.supabase.co/functions/v1/wompi-webhook
// ============================================================================
import { type EventoWompi, estadoInterno, leerConfig, verificarChecksum } from "./_compartido/wompi.ts";
import { clienteAdmin } from "./_compartido/supabase.ts";

/** A Wompi siempre se le contesta rápido y con 200 cuando el evento es
 *  legítimo, aunque por dentro algo falle. Un 500 hace que lo reenvíe en
 *  bucle, y el reenvío no arregla un error nuestro de lógica: quedaría
 *  registrado en eventos_wompi con `error` y `procesado = false` para
 *  revisarlo desde el panel. */
const ok = (cuerpo: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ ok: true, ...cuerpo }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Usa POST." }), { status: 405 });
  }

  const db = clienteAdmin();

  let cfg;
  try {
    cfg = leerConfig();
  } catch (e) {
    console.error("Configuración de Wompi inválida:", (e as Error).message);
    // 500 aquí sí: es un fallo nuestro y queremos que Wompi reintente cuando
    // esté arreglado, en vez de dar el evento por entregado.
    return new Response(JSON.stringify({ ok: false, error: "config" }), { status: 500 });
  }

  const crudo = await req.text();
  let evento: EventoWompi;
  try {
    evento = JSON.parse(crudo);
  } catch {
    console.error("Webhook con cuerpo no-JSON:", crudo.slice(0, 300));
    return new Response(JSON.stringify({ ok: false, error: "json" }), { status: 400 });
  }

  // --- ¿Viene de Wompi? ------------------------------------------------------
  const firma = await verificarChecksum(evento, cfg.secretoEventos);
  const checksum = evento.signature?.checksum ??
    req.headers.get("X-Event-Checksum") ?? `sin-firma-${crypto.randomUUID()}`;
  const transaccionId = (evento.data?.transaction as Record<string, unknown>)?.id as string ?? null;

  // Se guarda TODO, válido o no. Una racha de firmas inválidas en el panel es
  // la señal de que alguien encontró la URL y está probando suerte.
  const { error: errInsert } = await db.from("eventos_wompi").insert({
    evento: evento.event ?? "desconocido",
    transaccion_id: transaccionId,
    checksum,
    firma_valida: firma.valido,
    payload: evento,
    enviado_en: evento.sent_at ?? null,
    procesado: false,
    error: firma.valido ? null : firma.motivo,
  });

  // Choque de clave única en checksum = evento repetido. Wompi reenvía si no
  // contestamos a tiempo; procesarlo otra vez podría extender el periodo dos
  // veces. Contestamos 200 y no tocamos nada.
  if (errInsert && (errInsert as { code?: string }).code === "23505") {
    return ok({ duplicado: true });
  }
  if (errInsert) {
    console.error("No se pudo registrar el evento:", errInsert);
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }

  if (!firma.valido) {
    console.warn("Webhook rechazado por firma:", firma.motivo, "tx:", transaccionId);
    return new Response(JSON.stringify({ ok: false, error: "firma" }), { status: 401 });
  }

  // --- Solo nos interesan las transacciones ----------------------------------
  if (evento.event !== "transaction.updated") {
    await marcarProcesado(db, checksum, null);
    return ok({ ignorado: evento.event });
  }

  const tx = evento.data?.transaction as Record<string, unknown> | undefined;
  if (!tx?.reference || !tx?.status) {
    await marcarProcesado(db, checksum, "El evento no trae reference o status.");
    return ok({ incompleto: true });
  }

  const referencia = String(tx.reference);
  const nuevoEstado = estadoInterno(String(tx.status));

  const { data: pago } = await db.from("pagos")
    .select("id, estado, monto_centavos, moneda, suscripcion_id, usuario_id, periodo_fin")
    .eq("referencia", referencia).maybeSingle();

  if (!pago) {
    // Referencia que no conocemos: un cobro hecho a mano desde el panel de
    // Wompi, o de otro sistema que comparte comercio. Ni error ni acción.
    await marcarProcesado(db, checksum, `Referencia desconocida: ${referencia}`);
    return ok({ desconocido: true });
  }

  // Un estado final no vuelve atrás. Si ya está APROBADO y llega un evento
  // viejo diciendo PENDING, mandaría el orden de llegada, no la realidad.
  if (pago.estado !== "PENDIENTE") {
    await marcarProcesado(db, checksum, null);
    return ok({ ya_resuelto: pago.estado });
  }

  // El importe del evento tiene que coincidir con el que registramos. Si no,
  // algo va muy mal: no se toca la suscripción y queda marcado para revisar.
  const montoEvento = Number(tx.amount_in_cents);
  const monedaEvento = String(tx.currency ?? "");
  if (montoEvento !== Number(pago.monto_centavos) || monedaEvento !== pago.moneda) {
    const aviso = `Descuadre: esperábamos ${pago.monto_centavos} ${pago.moneda} y llegó ${montoEvento} ${monedaEvento}`;
    console.error(aviso, "referencia:", referencia);
    await db.from("pagos").update({
      estado: "ERROR", codigo_error: "descuadre_importe",
      mensaje_error: aviso, respuesta: tx, finalizado_en: new Date().toISOString(),
    }).eq("id", pago.id);
    await marcarProcesado(db, checksum, aviso);
    return ok({ descuadre: true });
  }

  // --- Aplicar el resultado --------------------------------------------------
  await db.from("pagos").update({
    estado: nuevoEstado,
    wompi_transaction_id: String(tx.id ?? ""),
    metodo_pago: (tx.payment_method_type as string) ?? null,
    codigo_error: nuevoEstado === "APROBADO" ? null : (tx.status as string),
    mensaje_error: nuevoEstado === "APROBADO" ? null : ((tx.status_message as string) ?? null),
    respuesta: tx,
    finalizado_en: new Date().toISOString(),
  }).eq("id", pago.id);

  if (pago.suscripcion_id) {
    if (nuevoEstado === "APROBADO") {
      await db.from("suscripciones").update({
        estado: "activa",
        proximo_cobro_en: pago.periodo_fin,
        periodo_fin: pago.periodo_fin,
        intentos_fallidos: 0,
        ultimo_error: null,
        ultimo_intento_en: new Date().toISOString(),
      }).eq("id", pago.suscripcion_id);
    } else if (nuevoEstado === "RECHAZADO" || nuevoEstado === "ERROR") {
      // No se decide aquí si la cuenta baja a Free: de eso se encarga el cron,
      // que es quien lleva la cuenta de los reintentos. Aquí solo se anota.
      const { data: s } = await db.from("suscripciones")
        .select("intentos_fallidos").eq("id", pago.suscripcion_id).maybeSingle();
      await db.from("suscripciones").update({
        estado: "morosa",
        intentos_fallidos: (s?.intentos_fallidos ?? 0) + 1,
        ultimo_error: ((tx.status_message as string) ?? String(tx.status)).slice(0, 500),
        ultimo_intento_en: new Date().toISOString(),
      }).eq("id", pago.suscripcion_id);
    }
  }

  await marcarProcesado(db, checksum, null);
  return ok({ referencia, estado: nuevoEstado });
});

async function marcarProcesado(
  db: ReturnType<typeof clienteAdmin>, checksum: string, nota: string | null,
) {
  await db.from("eventos_wompi").update({
    procesado: true, procesado_en: new Date().toISOString(), error: nota,
  }).eq("checksum", checksum);
}
