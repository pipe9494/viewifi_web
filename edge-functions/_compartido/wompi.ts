// ============================================================================
// Cliente de Wompi
// ----------------------------------------------------------------------------
// Wompi no tiene suscripciones. El modelo es:
//   1. El navegador tokeniza la tarjeta con la llave PÚBLICA (la tarjeta nunca
//      pasa por nuestro servidor).
//   2. Nosotros cambiamos ese token por una "fuente de pago" permanente con la
//      llave PRIVADA.
//   3. Cada mes cobramos contra esa fuente de pago.
//
// La llave privada y los dos secretos solo existen aquí, en variables de
// entorno de la Edge Function. Nunca en el HTML ni en el JavaScript del sitio.
// ============================================================================

export interface ConfigWompi {
  baseUrl: string;
  llavePublica: string;
  llavePrivada: string;
  secretoIntegridad: string;
  secretoEventos: string;
}

/** Lee y valida la configuración. Falla de inmediato y con un mensaje claro:
 *  descubrir a las tres de la mañana que faltaba una variable, con un cobro a
 *  medias, es mucho peor que no arrancar. */
export function leerConfig(): ConfigWompi {
  const falta: string[] = [];
  const leer = (clave: string): string => {
    const v = Deno.env.get(clave);
    if (!v || !v.trim()) falta.push(clave);
    return (v ?? "").trim();
  };

  const ambiente = (Deno.env.get("WOMPI_AMBIENTE") ?? "sandbox").trim().toLowerCase();
  const llavePublica = leer("WOMPI_LLAVE_PUBLICA");
  const llavePrivada = leer("WOMPI_LLAVE_PRIVADA");
  const secretoIntegridad = leer("WOMPI_SECRETO_INTEGRIDAD");
  const secretoEventos = leer("WOMPI_SECRETO_EVENTOS");

  if (falta.length) {
    throw new Error(
      `Faltan variables de entorno de Wompi: ${falta.join(", ")}. ` +
        `Configúralas con: supabase secrets set --env-file .env`,
    );
  }
  if (ambiente !== "sandbox" && ambiente !== "produccion") {
    throw new Error(`WOMPI_AMBIENTE debe ser "sandbox" o "produccion", no "${ambiente}".`);
  }

  // Un despiste caro: llaves de pruebas apuntando a producción cobra de verdad
  // en cuanto alguien mete una tarjeta buena, o al revés, deja de cobrar sin
  // que nadie se entere. Comprobar el prefijo cuesta cuatro líneas.
  const esProd = ambiente === "produccion";
  const prefijoEsperado = esProd ? "prod" : "test";
  for (const [nombre, valor] of [
    ["WOMPI_LLAVE_PUBLICA", llavePublica],
    ["WOMPI_LLAVE_PRIVADA", llavePrivada],
  ] as const) {
    if (!valor.includes(`_${prefijoEsperado}_`)) {
      throw new Error(
        `${nombre} no parece del ambiente "${ambiente}": se esperaba que ` +
          `contuviera "_${prefijoEsperado}_". Revisa que no estés mezclando llaves.`,
      );
    }
  }

  return {
    baseUrl: (Deno.env.get("WOMPI_API_URL") ?? "").trim() ||
      (esProd ? "https://production.wompi.co/v1" : "https://sandbox.wompi.co/v1"),
    llavePublica,
    llavePrivada,
    secretoIntegridad,
    secretoEventos,
  };
}

// ----------------------------------------------------------------------------
// Firmas
// ----------------------------------------------------------------------------

async function sha256Hex(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto);
  const hash = await crypto.subtle.digest("SHA-256", datos);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Firma de integridad de una transacción.
 *  Concatenación exacta que exige Wompi: referencia + monto + moneda + secreto. */
export function firmaIntegridad(
  referencia: string,
  montoEnCentavos: number,
  moneda: string,
  secretoIntegridad: string,
): Promise<string> {
  return sha256Hex(`${referencia}${montoEnCentavos}${moneda}${secretoIntegridad}`);
}

/** Comparación en tiempo constante. Un `===` normal sale antes en el primer
 *  byte distinto, y eso deja medir a ciegas cuántos bytes acertaste. */
function igualdadSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

export interface EventoWompi {
  event: string;
  data: Record<string, unknown>;
  sent_at?: string;
  timestamp?: number;
  signature?: { properties: string[]; checksum: string };
}

/** Saca un valor anidado con notación de puntos: "transaction.amount_in_cents". */
function valorAnidado(objeto: unknown, ruta: string): unknown {
  return ruta.split(".").reduce<unknown>(
    (acc, parte) =>
      acc && typeof acc === "object" ? (acc as Record<string, unknown>)[parte] : undefined,
    objeto,
  );
}

/** Verifica que el webhook viene de Wompi y no de alguien que descubrió la URL.
 *
 *  El checksum es SHA256 de los valores que enumera signature.properties, en su
 *  orden, seguidos del timestamp y del secreto de eventos. Si esto no cuadra,
 *  la petición se descarta: sin esta comprobación cualquiera podría mandarnos
 *  un "transacción aprobada" falso y regalarse una suscripción Pro. */
export async function verificarChecksum(
  evento: EventoWompi,
  secretoEventos: string,
): Promise<{ valido: boolean; motivo?: string }> {
  const firma = evento.signature;
  if (!firma?.checksum || !Array.isArray(firma.properties)) {
    return { valido: false, motivo: "El evento no trae objeto signature." };
  }
  if (evento.timestamp === undefined || evento.timestamp === null) {
    return { valido: false, motivo: "El evento no trae timestamp." };
  }

  let concatenado = "";
  for (const prop of firma.properties) {
    const valor = valorAnidado(evento.data, prop);
    if (valor === undefined || valor === null) {
      return { valido: false, motivo: `Falta en data la propiedad firmada "${prop}".` };
    }
    concatenado += String(valor);
  }
  concatenado += String(evento.timestamp) + secretoEventos;

  const calculado = await sha256Hex(concatenado);
  return igualdadSegura(calculado.toLowerCase(), firma.checksum.toLowerCase())
    ? { valido: true }
    : { valido: false, motivo: "El checksum no coincide." };
}

// ----------------------------------------------------------------------------
// Llamadas HTTP
// ----------------------------------------------------------------------------

export class ErrorWompi extends Error {
  constructor(
    message: string,
    readonly estadoHttp: number,
    readonly cuerpo: unknown,
    readonly reintentable: boolean,
  ) {
    super(message);
    this.name = "ErrorWompi";
  }
}

/** Petición con tiempo límite y clasificación del error.
 *
 *  `reintentable` separa lo que puede salir bien más tarde (caída de red, 5xx,
 *  429) de lo que va a fallar siempre (tarjeta rechazada, datos mal). Reintentar
 *  lo segundo solo gasta llamadas y confunde el histórico. */
async function pedir<T>(
  cfg: ConfigWompi,
  ruta: string,
  opciones: { metodo?: string; cuerpo?: unknown; llave?: string; timeoutMs?: number } = {},
): Promise<T> {
  const { metodo = "GET", cuerpo, llave = cfg.llavePrivada, timeoutMs = 25_000 } = opciones;
  const control = new AbortController();
  const alarma = setTimeout(() => control.abort(), timeoutMs);

  try {
    const respuesta = await fetch(`${cfg.baseUrl}${ruta}`, {
      method: metodo,
      headers: {
        "Authorization": `Bearer ${llave}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: control.signal,
    });

    const texto = await respuesta.text();
    let datos: unknown = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      datos = { raw: texto.slice(0, 2000) };
    }

    if (!respuesta.ok) {
      throw new ErrorWompi(
        `Wompi respondió ${respuesta.status} a ${metodo} ${ruta}`,
        respuesta.status,
        datos,
        respuesta.status >= 500 || respuesta.status === 429 || respuesta.status === 408,
      );
    }
    return datos as T;
  } catch (e) {
    if (e instanceof ErrorWompi) throw e;
    // Abortos y fallos de red: puede que la petición SÍ llegara a Wompi. Por eso
    // las referencias son deterministas — al reintentar no se cobra dos veces.
    const esTimeout = e instanceof DOMException && e.name === "AbortError";
    throw new ErrorWompi(
      esTimeout
        ? `Wompi no contestó en ${timeoutMs} ms a ${metodo} ${ruta}`
        : `No se pudo contactar con Wompi: ${(e as Error).message}`,
      0,
      null,
      true,
    );
  } finally {
    clearTimeout(alarma);
  }
}

/** Los tokens de aceptación (términos y tratamiento de datos) son obligatorios
 *  para crear una fuente de pago y caducan, así que se piden en cada alta. */
export async function tokensAceptacion(cfg: ConfigWompi): Promise<{
  terminos: string;
  datosPersonales: string;
  urlTerminos: string;
  urlDatos: string;
}> {
  const r = await pedir<{
    data: {
      presigned_acceptance: { acceptance_token: string; permalink: string };
      presigned_personal_data_auth: { acceptance_token: string; permalink: string };
    };
  }>(cfg, `/merchants/${cfg.llavePublica}`, { llave: cfg.llavePublica });

  return {
    terminos: r.data.presigned_acceptance.acceptance_token,
    datosPersonales: r.data.presigned_personal_data_auth.acceptance_token,
    urlTerminos: r.data.presigned_acceptance.permalink,
    urlDatos: r.data.presigned_personal_data_auth.permalink,
  };
}

export async function crearFuentePago(cfg: ConfigWompi, params: {
  tokenTarjeta: string;
  email: string;
  aceptacionTerminos: string;
  aceptacionDatos: string;
}): Promise<{ id: number; estado: string; public_data: Record<string, unknown> }> {
  const r = await pedir<{ data: { id: number; status: string; public_data: Record<string, unknown> } }>(
    cfg,
    "/payment_sources",
    {
      metodo: "POST",
      cuerpo: {
        type: "CARD",
        token: params.tokenTarjeta,
        customer_email: params.email,
        acceptance_token: params.aceptacionTerminos,
        accept_personal_auth: params.aceptacionDatos,
      },
    },
  );
  return { id: r.data.id, estado: r.data.status, public_data: r.data.public_data ?? {} };
}

export async function cobrar(cfg: ConfigWompi, params: {
  referencia: string;
  montoEnCentavos: number;
  moneda: string;
  email: string;
  fuentePagoId: number;
  cuotas: number;
  recurrente: boolean;
}): Promise<{ id: string; estado: string; datos: Record<string, unknown> }> {
  const firma = await firmaIntegridad(
    params.referencia,
    params.montoEnCentavos,
    params.moneda,
    cfg.secretoIntegridad,
  );

  const r = await pedir<{ data: { id: string; status: string } & Record<string, unknown> }>(
    cfg,
    "/transactions",
    {
      metodo: "POST",
      cuerpo: {
        amount_in_cents: params.montoEnCentavos,
        currency: params.moneda,
        signature: firma,
        customer_email: params.email,
        reference: params.referencia,
        payment_source_id: params.fuentePagoId,
        // `recurrent` marca el cobro como "credential on file" ante la franquicia.
        // Sin esto, los bancos rechazan más cobros automáticos por sospechosos.
        recurrent: params.recurrente,
        payment_method: { installments: params.cuotas },
      },
    },
  );
  return { id: r.data.id, estado: r.data.status, datos: r.data };
}

/** Consulta el estado real de una transacción. Es la red de seguridad para
 *  cuando el webhook no llega: Wompi reintenta, pero puede rendirse. */
export async function consultarTransaccion(
  cfg: ConfigWompi,
  transaccionId: string,
): Promise<{ estado: string; datos: Record<string, unknown> }> {
  const r = await pedir<{ data: { status: string } & Record<string, unknown> }>(
    cfg,
    `/transactions/${transaccionId}`,
    { llave: cfg.llavePublica },
  );
  return { estado: r.data.status, datos: r.data };
}

/** Busca por nuestra referencia. Se usa cuando un cobro se cortó a media
 *  petición y no llegamos a guardar el id de la transacción. */
export async function buscarPorReferencia(
  cfg: ConfigWompi,
  referencia: string,
): Promise<{ id: string; estado: string; datos: Record<string, unknown> } | null> {
  const r = await pedir<{ data: Array<{ id: string; status: string } & Record<string, unknown>> }>(
    cfg,
    `/transactions?reference=${encodeURIComponent(referencia)}`,
    { llave: cfg.llavePublica },
  );
  const t = r.data?.[0];
  return t ? { id: t.id, estado: t.status, datos: t } : null;
}

export async function anularFuentePago(cfg: ConfigWompi, fuentePagoId: number): Promise<void> {
  await pedir(cfg, `/payment_sources/${fuentePagoId}/void`, { metodo: "PUT" });
}

/** Traduce el estado de Wompi al que guardamos nosotros. */
export function estadoInterno(estadoWompi: string): "PENDIENTE" | "APROBADO" | "RECHAZADO" | "ERROR" | "ANULADO" {
  switch (estadoWompi?.toUpperCase()) {
    case "APPROVED": return "APROBADO";
    case "DECLINED": return "RECHAZADO";
    case "VOIDED":   return "ANULADO";
    case "ERROR":    return "ERROR";
    default:         return "PENDIENTE";
  }
}
