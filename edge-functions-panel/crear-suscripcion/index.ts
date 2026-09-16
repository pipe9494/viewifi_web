// ============================================================================
// crear-suscripcion — alta de un plan de pago
// ----------------------------------------------------------------------------
// El navegador tokeniza la tarjeta contra Wompi con la llave pública y nos
// manda solo el token. Aquí lo convertimos en fuente de pago permanente y
// lanzamos el primer cobro.
//
// Los datos de la tarjeta NUNCA pasan por esta función ni se guardan en la
// base de datos: solo el id de la fuente de pago, la marca y los cuatro
// últimos dígitos, que es lo que hace falta para enseñárselo al usuario.
//
// Desplegar con verificación de JWT activada (es la opción por defecto).
// ============================================================================
import {
  cobrar, crearFuentePago, ErrorWompi, estadoInterno, leerConfig, tokensAceptacion,
} from "./_compartido/wompi.ts";
import { error, json, leerJson, responderPreflight } from "./_compartido/http.ts";
import { ajuste, clienteAdmin, usuarioDeLaPeticion } from "./_compartido/supabase.ts";

interface Peticion {
  plan_codigo: string;
  token_tarjeta: string;
  cuotas?: number;
  acepta_terminos?: boolean;
}

Deno.serve(async (req) => {
  const origen = req.headers.get("Origin");
  if (req.method === "OPTIONS") return responderPreflight(origen);
  if (req.method !== "POST") return error("METODO", "Usa POST.", 405, origen);

  const db = clienteAdmin();

  // --- Interruptor maestro ---------------------------------------------------
  // Va lo PRIMERO, antes incluso de mirar la configuración de Wompi, para que
  // con los cobros apagados esto conteste limpiamente aunque no haya ni una
  // llave puesta. Y va aquí, en el servidor, porque esconder el formulario en
  // el navegador no impide que alguien llame a esta función con curl.
  if (!(await ajuste(db, "pagos_activos", false))) {
    return error(
      "PAGOS_DESACTIVADOS",
      "Ahora mismo Viewifi es gratis: no hay ningún plan que contratar.",
      409, origen,
    );
  }

  let cfg;
  try {
    cfg = leerConfig();
  } catch (e) {
    return error("CONFIG", "La pasarela de pagos no está configurada.", 500, origen, (e as Error).message);
  }

  // --- Quién llama -----------------------------------------------------------
  const usuario = await usuarioDeLaPeticion(req);
  if (!usuario) return error("SIN_SESION", "Inicia sesión para suscribirte.", 401, origen);

  const { data: perfil } = await db
    .from("perfiles").select("id, email, bloqueado, locale").eq("id", usuario.id).maybeSingle();
  if (!perfil) return error("SIN_PERFIL", "Tu cuenta no está lista todavía. Vuelve a entrar.", 403, origen);
  if (perfil.bloqueado) return error("BLOQUEADO", "Tu cuenta está bloqueada.", 403, origen);
  if (!(await ajuste(db, "acceso_abierto", true))) {
    return error("ACCESO_CERRADO", "El servicio está en mantenimiento.", 503, origen);
  }

  // --- Qué pide --------------------------------------------------------------
  let cuerpo: Peticion;
  try {
    cuerpo = await leerJson<Peticion>(req);
  } catch (e) {
    return error("CUERPO", (e as Error).message, 400, origen);
  }
  if (!cuerpo.plan_codigo || !cuerpo.token_tarjeta) {
    return error("DATOS", "Faltan el plan o el token de la tarjeta.", 400, origen);
  }
  if (cuerpo.acepta_terminos !== true) {
    return error("TERMINOS", "Tienes que aceptar los términos y el tratamiento de datos.", 400, origen);
  }
  const cuotas = Math.min(Math.max(Math.trunc(cuerpo.cuotas ?? 1), 1), 36);

  // --- El plan ---------------------------------------------------------------
  const { data: plan } = await db
    .from("planes")
    .select("id, codigo, intervalo, precio_cop_centavos, activo")
    .eq("codigo", cuerpo.plan_codigo).maybeSingle();

  if (!plan || !plan.activo) return error("PLAN", "Ese plan no existe o ya no está disponible.", 404, origen);
  if (plan.intervalo === "ninguno") return error("PLAN_GRATIS", "El plan gratuito no se cobra.", 400, origen);
  if (!plan.precio_cop_centavos || plan.precio_cop_centavos <= 0) {
    return error("PLAN_SIN_PRECIO", "Ese plan no tiene un precio válido.", 409, origen);
  }

  // Nadie con una suscripción viva puede abrir otra: sería un cobro doble.
  const { data: yaTiene } = await db
    .from("suscripciones").select("id, estado")
    .eq("usuario_id", usuario.id).in("estado", ["pendiente", "activa", "morosa"]).maybeSingle();
  if (yaTiene) {
    return error("YA_SUSCRITO", "Ya tienes una suscripción activa. Cámbiala desde tu cuenta.", 409, origen);
  }

  // --- Fuente de pago --------------------------------------------------------
  let fuente;
  try {
    const aceptacion = await tokensAceptacion(cfg);
    fuente = await crearFuentePago(cfg, {
      tokenTarjeta: cuerpo.token_tarjeta,
      email: perfil.email,
      aceptacionTerminos: aceptacion.terminos,
      aceptacionDatos: aceptacion.datosPersonales,
    });
  } catch (e) {
    const w = e as ErrorWompi;
    return error(
      "TARJETA",
      "No pudimos guardar tu tarjeta. Revisa los datos o prueba con otra.",
      w.reintentable ? 503 : 402, origen, w.cuerpo ?? w.message,
    );
  }
  if (fuente.estado !== "AVAILABLE") {
    return error("FUENTE_NO_DISPONIBLE", "El banco no autorizó guardar esa tarjeta.", 402, origen, fuente);
  }

  // --- Suscripción y cobro ---------------------------------------------------
  const ahora = new Date();
  const finPeriodo = new Date(ahora);
  if (plan.intervalo === "mes") finPeriodo.setMonth(finPeriodo.getMonth() + 1);
  else finPeriodo.setFullYear(finPeriodo.getFullYear() + 1);

  const publicos = fuente.public_data as Record<string, string>;

  const { data: suscripcion, error: errSus } = await db
    .from("suscripciones").insert({
      usuario_id: usuario.id,
      plan_id: plan.id,
      estado: "pendiente",
      wompi_payment_source_id: fuente.id,
      wompi_customer_email: perfil.email,
      tarjeta_marca: publicos?.brand ?? publicos?.type ?? null,
      tarjeta_ultimos4: publicos?.last_four ?? null,
      tarjeta_vence: publicos?.exp_month && publicos?.exp_year
        ? `${publicos.exp_month}/${publicos.exp_year}` : null,
      cuotas,
      periodo_inicio: ahora.toISOString(),
      periodo_fin: finPeriodo.toISOString(),
    }).select("id").single();

  if (errSus || !suscripcion) {
    return error("BD", "No pudimos crear tu suscripción. No se te ha cobrado nada.", 500, origen, errSus);
  }

  // La referencia se calcula en la base de datos para que el cron de cobros
  // use exactamente la misma fórmula. Un reintento produce la misma cadena y
  // Wompi la rechaza como duplicada en vez de cobrar dos veces.
  const { data: refFila } = await db.rpc("referencia_pago", {
    p_suscripcion: suscripcion.id, p_periodo: ahora.toISOString(), p_intento: 1,
  });
  const referencia = refFila as unknown as string;

  // El pago se registra ANTES de llamar a Wompi. Si la red se corta justo
  // después, la fila queda PENDIENTE y el cron la concilia contra Wompi.
  const { data: pago, error: errPago } = await db
    .from("pagos").insert({
      suscripcion_id: suscripcion.id,
      usuario_id: usuario.id,
      plan_id: plan.id,
      referencia,
      estado: "PENDIENTE",
      monto_centavos: plan.precio_cop_centavos,
      moneda: "COP",
      cuotas,
      intento: 1,
      periodo_inicio: ahora.toISOString(),
      periodo_fin: finPeriodo.toISOString(),
    }).select("id").single();

  if (errPago || !pago) {
    await db.from("suscripciones").update({
      estado: "cancelada", cancelada_en: ahora.toISOString(),
      motivo_cancelacion: "No se pudo registrar el pago inicial",
    }).eq("id", suscripcion.id);
    return error("BD", "No pudimos registrar el cobro. No se te ha cobrado nada.", 500, origen, errPago);
  }

  try {
    const tx = await cobrar(cfg, {
      referencia,
      montoEnCentavos: plan.precio_cop_centavos,
      moneda: "COP",
      email: perfil.email,
      fuentePagoId: fuente.id,
      cuotas,
      recurrente: true,
    });

    const interno = estadoInterno(tx.estado);
    await db.from("pagos").update({
      wompi_transaction_id: tx.id,
      estado: interno,
      metodo_pago: (tx.datos.payment_method_type as string) ?? null,
      respuesta: tx.datos,
      finalizado_en: interno === "PENDIENTE" ? null : new Date().toISOString(),
    }).eq("id", pago.id);

    if (interno === "APROBADO") {
      // Camino raro pero posible: Wompi contesta APPROVED en la misma llamada.
      // Activamos ya en vez de esperar a un webhook que quizá tarde.
      await db.from("suscripciones").update({
        estado: "activa",
        proximo_cobro_en: finPeriodo.toISOString(),
        intentos_fallidos: 0,
        ultimo_error: null,
      }).eq("id", suscripcion.id);
    } else if (interno === "RECHAZADO" || interno === "ERROR") {
      await db.from("suscripciones").update({
        estado: "cancelada",
        cancelada_en: new Date().toISOString(),
        motivo_cancelacion: "El primer cobro fue rechazado",
        ultimo_error: (tx.datos.status_message as string) ?? interno,
      }).eq("id", suscripcion.id);
      return error("COBRO_RECHAZADO", "Tu banco rechazó el pago. Prueba con otra tarjeta.", 402, origen, tx.datos);
    }

    return json({
      ok: true,
      suscripcion_id: suscripcion.id,
      pago_id: pago.id,
      referencia,
      transaccion_id: tx.id,
      estado: interno,
      // PENDIENTE es lo normal: el resultado definitivo llega por webhook.
      mensaje: interno === "APROBADO"
        ? "Suscripción activada."
        : "Estamos confirmando el pago con tu banco. Te avisamos en cuanto se resuelva.",
    }, 200, origen);
  } catch (e) {
    const w = e as ErrorWompi;
    // Si el fallo es reintentable, la petición pudo haber llegado a Wompi. NO
    // cancelamos la suscripción: la dejamos pendiente y que el cron concilie
    // contra Wompi usando la referencia. Cancelar aquí podría dejar al usuario
    // cobrado y sin servicio.
    await db.from("pagos").update({
      estado: w.reintentable ? "PENDIENTE" : "ERROR",
      codigo_error: String(w.estadoHttp || "red"),
      mensaje_error: w.message.slice(0, 500),
      respuesta: (w.cuerpo as Record<string, unknown>) ?? null,
      finalizado_en: w.reintentable ? null : new Date().toISOString(),
    }).eq("id", pago.id);

    if (!w.reintentable) {
      await db.from("suscripciones").update({
        estado: "cancelada", cancelada_en: new Date().toISOString(),
        motivo_cancelacion: "Error al procesar el primer cobro",
        ultimo_error: w.message.slice(0, 500),
      }).eq("id", suscripcion.id);
      return error("COBRO_ERROR", "No pudimos procesar el pago. No se te ha cobrado.", 402, origen, w.cuerpo);
    }

    return json({
      ok: true,
      suscripcion_id: suscripcion.id,
      pago_id: pago.id,
      referencia,
      estado: "PENDIENTE",
      mensaje: "El pago está en proceso. Te confirmamos por correo en unos minutos.",
    }, 202, origen);
  }
});
