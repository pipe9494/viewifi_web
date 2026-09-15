// ============================================================================
// Acceso a la base de datos desde las Edge Functions
// ============================================================================
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { autorizadoComoAdmin } from "./admins.ts";

/** Cliente con service_role: se salta RLS. Solo para el servidor.
 *  Por eso ninguna política de 006 concede escritura sobre pagos ni
 *  suscripciones: el único camino para tocarlos es este cliente. */
export function clienteAdmin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const clave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !clave) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  }
  return createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Identifica al usuario a partir del Authorization de la petición.
 *  Devuelve null si no hay sesión válida: la función que llama decide si eso
 *  es un 401 o un caso legítimo. */
export async function usuarioDeLaPeticion(
  req: Request,
): Promise<{ id: string; email: string } | null> {
  const cabecera = req.headers.get("Authorization") ?? "";
  const token = cabecera.toLowerCase().startsWith("bearer ") ? cabecera.slice(7).trim() : "";
  if (!token) return null;

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) throw new Error("Faltan SUPABASE_URL o SUPABASE_ANON_KEY en el entorno.");

  const cliente = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await cliente.auth.getUser();
  if (error || !data?.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}

/** Comprueba que quien llama es el cron o un administrador, no un curioso.
 *  El cron manda la service_role key; un administrador, su propio token. */
export async function esLlamadaDeConfianza(req: Request): Promise<boolean> {
  const cabecera = req.headers.get("Authorization") ?? "";
  const token = cabecera.toLowerCase().startsWith("bearer ") ? cabecera.slice(7).trim() : "";
  if (!token) return false;

  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (service && token === service) return true;

  const usuario = await usuarioDeLaPeticion(req);
  if (!usuario) return false;

  const { data } = await clienteAdmin()
    .from("perfiles").select("rol, bloqueado, email").eq("id", usuario.id).maybeSingle();
  return autorizadoComoAdmin(data?.rol, data?.bloqueado, data?.email ?? usuario.email).ok;
}

/** Lee un ajuste con valor por defecto. Los ajustes viven en la base de datos
 *  para que el panel pueda cambiarlos sin volver a desplegar nada. */
export async function ajuste<T>(
  db: SupabaseClient,
  clave: string,
  defecto: T,
): Promise<T> {
  const { data, error } = await db.from("ajustes").select("valor").eq("clave", clave).maybeSingle();
  if (error || data?.valor === undefined || data?.valor === null) return defecto;
  return data.valor as T;
}
