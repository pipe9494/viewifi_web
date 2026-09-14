// ============================================================================
// sincronizar-admins — aplica ADMINS_PERMITIDOS a los roles de la base de datos
// ----------------------------------------------------------------------------
// Las políticas RLS no pueden leer los secretos de las Edge Functions, así que
// alguien tiene que traducir la lista del secreto a perfiles.rol. Eso hace esta
// función:
//
//   · Los correos de la lista que ya tengan cuenta pasan a rol 'admin'.
//   · Los que tengan rol 'admin' y NO estén en la lista vuelven a 'usuario'.
//   · Los correos de la lista que todavía no tengan cuenta se informan, para
//     que sepas que esa persona aún debe registrarse.
//
// Lánzala a mano después de tocar el secreto, o déjala en el cron para que se
// aplique sola cada día.
//
// Desplegar con verificación de JWT (por defecto). La llama el cron con la
// service_role, o un administrador desde el panel.
// ============================================================================
import { correoEnLista, hayListaAdmins, listaAdmins } from "../_compartido/admins.ts";
import { error, json, responderPreflight } from "../_compartido/http.ts";
import { clienteAdmin, esLlamadaDeConfianza } from "../_compartido/supabase.ts";

Deno.serve(async (req) => {
  const origen = req.headers.get("Origin");
  if (req.method === "OPTIONS") return responderPreflight(origen);
  if (req.method !== "POST") return error("METODO", "Usa POST.", 405, origen);

  if (!(await esLlamadaDeConfianza(req))) {
    return error("SIN_PERMISO", "No autorizado.", 401, origen);
  }

  if (!hayListaAdmins()) {
    return error(
      "SIN_LISTA",
      "No hay ningún correo en ADMINS_PERMITIDOS. Configúralo antes de sincronizar: " +
        "con la lista vacía esta función quitaría el rol a todo el mundo y te dejaría fuera.",
      409, origen,
    );
  }

  const db = clienteAdmin();
  const lista = listaAdmins();

  const { data: perfiles, error: errLectura } = await db
    .from("perfiles").select("id, email, rol, bloqueado");
  if (errLectura) return error("BD", "No se pudieron leer los perfiles.", 500, origen, errLectura);

  const ascendidos: string[] = [];
  const degradados: string[] = [];
  const yaEstaban: string[] = [];
  const conCuenta = new Set((perfiles ?? []).map((p) => (p.email ?? "").trim().toLowerCase()));

  for (const p of perfiles ?? []) {
    const deberiaSerAdmin = correoEnLista(p.email);
    const esAdmin = p.rol === "admin";

    if (deberiaSerAdmin && !esAdmin) {
      await db.from("perfiles").update({ rol: "admin" }).eq("id", p.id);
      ascendidos.push(p.email);
    } else if (!deberiaSerAdmin && esAdmin) {
      await db.from("perfiles").update({ rol: "usuario" }).eq("id", p.id);
      degradados.push(p.email);
    } else if (deberiaSerAdmin) {
      yaEstaban.push(p.email);
    }
  }

  // Una lista con correos que no tienen cuenta no es un error, pero es la
  // explicación de "lo puse en el secreto y sigue sin poder entrar".
  const sinCuenta = lista.filter((c) => !conCuenta.has(c));

  // Comprobación final: si tras sincronizar no queda ningún administrador
  // utilizable, el panel se vuelve inaccesible y solo se arregla desde el SQL
  // Editor. Se avisa en la respuesta en vez de dejarlo pasar en silencio.
  const { count: adminsVivos } = await db.from("perfiles")
    .select("id", { count: "exact", head: true }).eq("rol", "admin").eq("bloqueado", false);

  if ((adminsVivos ?? 0) === 0) {
    console.error("Sincronización dejó cero administradores activos.");
  }

  const resumen = {
    ok: true,
    ascendidos,
    degradados,
    sin_cambios: yaEstaban,
    en_la_lista_sin_cuenta: sinCuenta,
    administradores_activos: adminsVivos ?? 0,
    aviso: (adminsVivos ?? 0) === 0
      ? "ATENCIÓN: no queda ningún administrador activo. Nadie puede entrar al panel. " +
        "Arréglalo desde el SQL Editor con: update public.perfiles set rol='admin' where lower(email)=lower('tu@correo.com');"
      : sinCuenta.length
      ? `Estos correos están en la lista pero todavía no tienen cuenta: ${sinCuenta.join(", ")}. ` +
        "Tienen que registrarse por la web y luego volver a sincronizar."
      : null,
  };

  console.log("sincronizar-admins:", JSON.stringify(resumen));
  return json(resumen, 200, origen);
});
