// ============================================================================
// cobros-recurrentes — el corazón de la suscripción
// ----------------------------------------------------------------------------
// La llama pg_cron una vez al día (ver migraciones/008_cron.sql). Hace tres
// cosas, en este orden:
//
//   1. CONCILIAR   pagos que llevan demasiado tiempo PENDIENTE. Si el webhook
//                  no llegó, preguntamos a Wompi directamente. Va primero para
//                  no reintentar un cobro que en realidad sí se aprobó.
//   2. COBRAR      las suscripciones cuyo periodo vence hoy.
//   3. VENCER      las morosas que ya agotaron sus reintentos.
//
// Es idempotente: lanzarla dos veces el mismo día no cobra dos veces, porque
// la referencia es determinista y hay un índice único por periodo aprobado.
// ============================================================================
import {
  buscarPorReferencia, cobrar, consultarTransaccion, ErrorWompi, estadoInterno, leerConfig,
} from "./_compartido/wompi.ts";
import { ajuste, clienteAdmin, esLlamadaDeConfianza } from "./_compartido/supabase.ts";

interface Resumen {
  conciliados: number;
  cobrados: number;
  rechazados: number;
  vencidos: number;
  errores: string[];
}

Deno.serve(async (req) => {
  // Solo el cron (service_role) o un administrador. Sin esto, cualquiera con la
  // URL podría disparar la tanda de cobros cuando le apeteciera.
  if (!(await esLlamadaDeConfianza(req))) {
    return new Response(JSON.stringify({ ok: false, error: "no autorizado" }), { status: 401 });
  }

  const db = clienteAdmin();
  const r: Resumen = { conciliados: 0, cobrados: 0, rechazados: 0, vencidos: 0, errores: [] };

  // --- Interruptor maestro ---------------------------------------------------
  // Con los cobros apagados esta tanda no hace absolutamente nada, y sale antes
  // de leer la configuración de Wompi: así el cron diario puede estar programado
  // sin que nadie haya puesto todavía una llave, en vez de fallar con un 500
  // cada madrugada.
  //
  // Nadie pierde el servicio mientras está apagado: al no intentarse el cobro,
  // ninguna suscripción se marca morosa ni se vence. Un pago que se quedara en
  // el aire espera a que se vuelva a encender para conciliarse.
  if (!(await ajuste(db, "pagos_activos", false))) {
    return new Response(JSON.stringify({
      ok: true, pagos_activos: false, ...r,
      mensaje: "Los cobros están desactivados en Ajustes. No se hizo nada.",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  let cfg;
  try {
    cfg = leerConfig();
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500 });
  }

  const reintentosMax = Number(await ajuste(db, "reintentos_max", 3));
  const diasReintento = (await ajuste<number[]>(db, "reintento_dias", [1, 3, 5])) ?? [1, 3, 5];
  const minutosConciliar = Number(await ajuste(db, "conciliar_tras_minutos", 30));

  // =========================================================================
  // 1. Conciliar pagos colgados
  // =========================================================================
  const limite = new Date(Date.now() - minutosConciliar * 60_000).toISOString();
  const { data: colgados } = await db.from("pagos")
    .select("id, referencia, wompi_transaction_id, suscripcion_id, periodo_fin, monto_centavos, moneda")
    .eq("estado", "PENDIENTE").lt("creado_en", limite).limit(200);

  for (const pago of colgados ?? []) {
    try {
      // Si tenemos id de transacción preguntamos por él; si no (la llamada se
      // cortó antes de devolvérnoslo), buscamos por nuestra referencia.
      const tx = pago.wompi_transaction_id
        ? await consultarTransaccion(cfg, pago.wompi_transaction_id)
            .then((t) => ({ id: pago.wompi_transaction_id as string, ...t }))
        : await buscarPorReferencia(cfg, pago.referencia);

      if (!tx) {
        // Wompi no conoce la referencia: la petición nunca llegó. El cobro no
        // existe, así que se cierra como error y el periodo podrá reintentarse.
        await db.from("pagos").update({
          estado: "ERROR", codigo_error: "no_llego_a_wompi",
          mensaje_error: "Wompi no tiene ninguna transacción con esta referencia.",
          finalizado_en: new Date().toISOString(),
        }).eq("id", pago.id);
        r.conciliados++;
        continue;
      }

      const interno = estadoInterno(tx.estado);
      if (interno === "PENDIENTE") continue; // sigue en el aire; mañana otra vez

      await db.from("pagos").update({
        estado: interno,
        wompi_transaction_id: tx.id,
        respuesta: tx.datos,
        codigo_error: interno === "APROBADO" ? null : tx.estado,
        finalizado_en: new Date().toISOString(),
      }).eq("id", pago.id);

      if (pago.suscripcion_id) {
        if (interno === "APROBADO") {
          await db.from("suscripciones").update({
            estado: "activa", proximo_cobro_en: pago.periodo_fin, periodo_fin: pago.periodo_fin,
            intentos_fallidos: 0, ultimo_error: null,
          }).eq("id", pago.suscripcion_id);
        } else {
          const { data: s } = await db.from("suscripciones")
            .select("intentos_fallidos").eq("id", pago.suscripcion_id).maybeSingle();
          await db.from("suscripciones").update({
            estado: "morosa", intentos_fallidos: (s?.intentos_fallidos ?? 0) + 1,
            ultimo_error: `Conciliado como ${interno}`,
          }).eq("id", pago.suscripcion_id);
        }
      }
      r.conciliados++;
    } catch (e) {
      r.errores.push(`conciliar ${pago.referencia}: ${(e as Error).message}`);
    }
  }

  // =========================================================================
  // 2. Cobrar lo que vence
  // =========================================================================
  const ahora = new Date();
  const { data: pendientes } = await db.from("suscripciones")
    .select(`id, usuario_id, plan_id, estado, cuotas, intentos_fallidos, ultimo_intento_en,
             wompi_payment_source_id, wompi_customer_email, periodo_fin, cancelar_al_final,
             planes!inner(codigo, intervalo, precio_cop_centavos, activo)`)
    .in("estado", ["activa", "morosa"])
    .lte("proximo_cobro_en", ahora.toISOString())
    .limit(500);

  for (const s of pendientes ?? []) {
    const plan = (s as unknown as { planes: { intervalo: string; precio_cop_centavos: number; activo: boolean } }).planes;
    try {
      // Cancelación programada: se respetó el periodo pagado, ahora se cierra.
      if (s.cancelar_al_final) {
        await db.from("suscripciones").update({
          estado: "cancelada", cancelada_en: ahora.toISOString(),
          motivo_cancelacion: "Cancelada por el usuario al final del periodo",
          proximo_cobro_en: null,
        }).eq("id", s.id);
        r.vencidos++;
        continue;
      }

      if (!s.wompi_payment_source_id) {
        await marcarFallo(db, s.id, "La suscripción no tiene tarjeta guardada.");
        r.errores.push(`${s.id}: sin fuente de pago`);
        continue;
      }
      if (!plan?.activo || !plan.precio_cop_centavos) {
        // Un plan retirado o sin precio no se cobra. Mejor dejar de facturar
        // que cobrar un importe que ya no existe en el catálogo.
        await marcarFallo(db, s.id, "El plan ya no está activo o no tiene precio.");
        r.errores.push(`${s.id}: plan inactivo`);
        continue;
      }

      // Calendario de reintentos: tras un fallo se espera 1, 3 y 5 días.
      const intento = (s.intentos_fallidos ?? 0) + 1;
      if (s.estado === "morosa" && s.ultimo_intento_en) {
        const diasEsperar = diasReintento[Math.min(s.intentos_fallidos - 1, diasReintento.length - 1)] ?? 1;
        const desde = new Date(s.ultimo_intento_en).getTime();
        const anterior = diasReintento[Math.min(s.intentos_fallidos - 2, diasReintento.length - 1)] ?? 0;
        const esperaMs = Math.max(diasEsperar - anterior, 1) * 86_400_000;
        if (Date.now() - desde < esperaMs) continue; // todavía no toca
      }

      const inicio = s.periodo_fin ? new Date(s.periodo_fin) : ahora;
      const fin = new Date(inicio);
      if (plan.intervalo === "mes") fin.setMonth(fin.getMonth() + 1);
      else fin.setFullYear(fin.getFullYear() + 1);

      const { data: refRpc } = await db.rpc("referencia_pago", {
        p_suscripcion: s.id, p_periodo: inicio.toISOString(), p_intento: intento,
      });
      const referencia = refRpc as unknown as string;

      // upsert por referencia: si el intento anterior se quedó a medias, se
      // reutiliza la fila en vez de crear una nueva.
      const { data: pago, error: errPago } = await db.from("pagos")
        .upsert({
          suscripcion_id: s.id, usuario_id: s.usuario_id, plan_id: s.plan_id,
          referencia, estado: "PENDIENTE", monto_centavos: plan.precio_cop_centavos,
          moneda: "COP", cuotas: s.cuotas ?? 1, intento,
          periodo_inicio: inicio.toISOString(), periodo_fin: fin.toISOString(),
        }, { onConflict: "referencia" })
        .select("id").single();

      if (errPago || !pago) {
        r.errores.push(`${s.id}: no se pudo registrar el pago`);
        continue;
      }

      const tx = await cobrar(cfg, {
        referencia,
        montoEnCentavos: plan.precio_cop_centavos,
        moneda: "COP",
        email: s.wompi_customer_email ?? "",
        fuentePagoId: s.wompi_payment_source_id,
        cuotas: s.cuotas ?? 1,
        recurrente: true,
      });

      const interno = estadoInterno(tx.estado);
      await db.from("pagos").update({
        wompi_transaction_id: tx.id, estado: interno, respuesta: tx.datos,
        finalizado_en: interno === "PENDIENTE" ? null : new Date().toISOString(),
      }).eq("id", pago.id);

      if (interno === "APROBADO") {
        await db.from("suscripciones").update({
          estado: "activa", periodo_inicio: inicio.toISOString(), periodo_fin: fin.toISOString(),
          proximo_cobro_en: fin.toISOString(), intentos_fallidos: 0,
          ultimo_error: null, ultimo_intento_en: ahora.toISOString(),
        }).eq("id", s.id);
        r.cobrados++;
      } else if (interno === "PENDIENTE") {
        // Normal: el resultado llegará por webhook. Se marca el intento para
        // que el reintento no salga mañana mismo si el webhook tarda.
        await db.from("suscripciones").update({ ultimo_intento_en: ahora.toISOString() }).eq("id", s.id);
      } else {
        await marcarFallo(db, s.id, (tx.datos.status_message as string) ?? interno);
        r.rechazados++;
      }
    } catch (e) {
      const w = e as ErrorWompi;
      // Un fallo de red no cuenta como rechazo del banco: no gasta reintento.
      // Mañana se vuelve a intentar con la misma referencia.
      if (w.reintentable) {
        r.errores.push(`${s.id}: ${w.message}`);
      } else {
        await marcarFallo(db, s.id, w.message);
        r.rechazados++;
      }
    }
  }

  // =========================================================================
  // 3. Vencer las morosas que agotaron los reintentos
  // =========================================================================
  const { data: agotadas } = await db.from("suscripciones")
    .select("id").eq("estado", "morosa").gte("intentos_fallidos", reintentosMax).limit(500);

  for (const s of agotadas ?? []) {
    // No se borra nada del usuario: baja a Free y conserva su historial. Si
    // vuelve a pagar, recupera todo tal cual lo dejó.
    await db.from("suscripciones").update({
      estado: "expirada", proximo_cobro_en: null,
      motivo_cancelacion: `Cobro fallido tras ${reintentosMax} intentos`,
    }).eq("id", s.id);
    r.vencidos++;
  }

  console.log("Tanda de cobros:", JSON.stringify(r));
  return new Response(JSON.stringify({ ok: true, ...r }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});

async function marcarFallo(db: ReturnType<typeof clienteAdmin>, suscripcionId: string, motivo: string) {
  const { data: s } = await db.from("suscripciones")
    .select("intentos_fallidos").eq("id", suscripcionId).maybeSingle();
  await db.from("suscripciones").update({
    estado: "morosa",
    intentos_fallidos: (s?.intentos_fallidos ?? 0) + 1,
    ultimo_error: motivo.slice(0, 500),
    ultimo_intento_en: new Date().toISOString(),
  }).eq("id", suscripcionId);
}
