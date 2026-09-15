// ============================================================================
// Utilidades HTTP compartidas por las Edge Functions
// ============================================================================

/** Orígenes que pueden llamar a las funciones desde el navegador.
 *  Se configura con ORIGENES_PERMITIDOS (separados por comas). Sin comodín:
 *  un "*" aquí permitiría que cualquier página ajena lanzara cobros con la
 *  sesión del usuario que la visita. */
function origenesPermitidos(): string[] {
  const crudo = (Deno.env.get("ORIGENES_PERMITIDOS") ?? "").trim();
  if (crudo) return crudo.split(",").map((s) => s.trim()).filter(Boolean);
  return ["https://viewifi.tech", "https://www.viewifi.tech"];
}

export function cabecerasCors(origen: string | null): Record<string, string> {
  const permitidos = origenesPermitidos();
  const elegido = origen && permitidos.includes(origen) ? origen : permitidos[0];
  return {
    "Access-Control-Allow-Origin": elegido,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export function json(
  cuerpo: unknown,
  estado = 200,
  origen: string | null = null,
): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...cabecerasCors(origen), "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Respuesta de error con un código estable que el front puede traducir.
 *  El `detalle` es para nuestros registros; al usuario se le enseña el mensaje. */
export function error(
  codigo: string,
  mensaje: string,
  estado = 400,
  origen: string | null = null,
  detalle?: unknown,
): Response {
  if (detalle !== undefined) {
    console.error(`[${codigo}] ${mensaje}`, JSON.stringify(detalle).slice(0, 1500));
  }
  return json({ ok: false, codigo, mensaje }, estado, origen);
}

export function responderPreflight(origen: string | null): Response {
  return new Response(null, { status: 204, headers: cabecerasCors(origen) });
}

/** Lee el cuerpo JSON sin dejar que un cuerpo gigante o roto tumbe la función. */
export async function leerJson<T>(req: Request, maxBytes = 64 * 1024): Promise<T> {
  const texto = await req.text();
  if (texto.length > maxBytes) throw new Error("El cuerpo de la petición es demasiado grande.");
  if (!texto.trim()) throw new Error("El cuerpo de la petición está vacío.");
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new Error("El cuerpo de la petición no es JSON válido.");
  }
}
