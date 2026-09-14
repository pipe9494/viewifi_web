// ============================================================================
// cancelar-suscripcion — baja voluntaria
// ----------------------------------------------------------------------------
// Cancelar NO corta el servicio en el momento: el usuario pagó hasta el final
// del periodo y lo conserva. Solo se apaga la renovación. Cortar el día que
// alguien cancela es quedarse con dinero por un servicio no prestado.
//
// Un administrador puede cancelar la de cualquiera pasando usuario_id.
// ============================================================================
import { anularFuentePago, leerConfig } from "../_compartido/wompi.ts";
import { autorizadoComoAdmin } from "../_compartido/admins.ts";
import { error, json, leerJson, responderPreflight } from "../_compartido/http.ts";
import { clienteAdmin, usuarioDeLaPeticion } from "../_compartido/supabase.ts";

Deno.serve(async (req) => {
  const origen = req.headers.get("Origin");
  if (req.method === "OPTIONS") return responderPreflight(origen);
  if (req.method !== "POST") return error("METODO", "Usa POST.", 405, origen);

  const db = clienteAdmin();
  const solicitante = await usuarioDeLaPeticion(req);
  if (!solicitante) return error("SIN_SESION", "Inicia sesión.", 401, origen);

  let cuerpo: { usuario_id?: string; motivo?: string; retirar_tarjeta?: boolean } = {};
  try {
    cuerpo = await leerJson(req);
  } catch {
    cuerpo = {};
  }

  // Solo un administrador puede cancelar la suscripción de otra persona.
  let objetivo = solicitante.id;
  if (cuerpo.usuario_id && cuerpo.usuario_id !== solicitante.id) {
    const { data: quien } = await db.from("perfiles")
      .select("rol, bloqueado, email").eq("id", solicitante.id).maybeSingle();
    const permiso = autorizadoComoAdmin(quien?.rol, quien?.bloqueado, quien?.email ?? solicitante.email);
    if (!permiso.ok) {
      return error("SIN_PERMISO", "No puedes cancelar la suscripción de otra persona.",
                   403, origen, permiso.motivo);
    }
    objetivo = cuerpo.usuario_id;
  }

  const { data: suscripcion } = await db.from("suscripciones")
    .select("id, estado, periodo_fin, wompi_payment_source_id")
    .eq("usuario_id", objetivo).in("estado", ["pendiente", "activa", "morosa"]).maybeSingle();

  if (!suscripcion) return error("SIN_SUSCRIPCION", "No hay ninguna suscripción activa.", 404, origen);

  const sigueVigente = suscripcion.periodo_fin && new Date(suscripcion.periodo_fin) > new Date();

  await db.from("suscripciones").update({
    cancelar_al_final: true,
    motivo_cancelacion: (cuerpo.motivo ?? "Cancelada por el usuario").slice(0, 300),
    // Si el periodo ya pasó (una morosa que nunca llegó a cobrarse), se cierra ya.
    ...(sigueVigente
      ? {}
      : { estado: "cancelada", cancelada_en: new Date().toISOString(), proximo_cobro_en: null }),
  }).eq("id", suscripcion.id);

  // Retirar la tarjeta es opcional y no se hace por defecto: si el usuario
  // cambia de idea antes de que acabe el periodo, reactivar no le obliga a
  // volver a teclearla.
  if (cuerpo.retirar_tarjeta && suscripcion.wompi_payment_source_id) {
    try {
      await anularFuentePago(leerConfig(), suscripcion.wompi_payment_source_id);
      await db.from("suscripciones")
        .update({ wompi_payment_source_id: null }).eq("id", suscripcion.id);
    } catch (e) {
      // Que Wompi no pueda anular la fuente no debe romper la cancelación:
      // lo importante, no volver a cobrar, ya está hecho.
      console.error("No se pudo anular la fuente de pago:", (e as Error).message);
    }
  }

  return json({
    ok: true,
    estado: sigueVigente ? "cancelara_al_final" : "cancelada",
    servicio_hasta: sigueVigente ? suscripcion.periodo_fin : null,
    mensaje: sigueVigente
      ? "Tu suscripción no se renovará. Conservas Pro hasta el final del periodo ya pagado."
      : "Suscripción cancelada.",
  }, 200, origen);
});
