// ============================================================================
// Lista de administradores por variable de entorno
// ----------------------------------------------------------------------------
// POR QUÉ ESTO NO SUSTITUYE AL ROL EN LA BASE DE DATOS
//
// Los secretos de Edge Functions solo se leen con Deno.env.get(), es decir,
// desde dentro de una función. PostgreSQL no los ve. Y quien decide si el
// panel puede leer la tabla de pagos no es una función: son las políticas RLS,
// que corren en la base de datos y consultan perfiles.rol.
//
// Así que el reparto es:
//
//   perfiles.rol = 'admin'   → gobierna lo que RLS deja LEER y ESCRIBIR.
//   ADMINS_PERMITIDOS        → gobierna las acciones privilegiadas que pasan
//                              por Edge Functions (crear y borrar cuentas,
//                              cambiar contraseñas, cancelar suscripciones
//                              ajenas).
//
// Las dos capas se mantienen alineadas con la función sincronizar-admins, que
// lee esta lista y ajusta los roles. La ventaja de tenerla en un secreto es
// que quitar a alguien es editar una variable, no acordarse de correr un
// UPDATE; y que si alguien consigue cambiar un rol en la base de datos, las
// funciones que mueven dinero o cuentas siguen negándose.
// ============================================================================

/** Correos autorizados, ya normalizados. Lista vacía = no hay lista definida. */
export function listaAdmins(): string[] {
  const crudo = (Deno.env.get("ADMINS_PERMITIDOS") ?? "").trim();
  if (!crudo) return [];
  // La comprobación pide algo antes de la arroba, algo después y un punto en
  // el dominio. Un "@" suelto o un "admin" a secas son erratas al editar el
  // secreto, y colarlos aquí solo sirve para que la lista parezca más larga
  // de lo que es.
  const pareceCorreo = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;
  return crudo
    .split(/[,;\s]+/)
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length <= 254 && pareceCorreo.test(c));
}

/** ¿Está definida la lista? Si no lo está, manda solo perfiles.rol.
 *  Se deja así a propósito para no dejar fuera a nadie el día que se despliega
 *  esto sin haber configurado todavía el secreto. */
export function hayListaAdmins(): boolean {
  return listaAdmins().length > 0;
}

/** Comparación normalizada: correos con mayúsculas o espacios de sobra son el
 *  motivo más habitual de "pero si lo puse en la lista". */
export function correoEnLista(email: string | null | undefined): boolean {
  if (!email) return false;
  return listaAdmins().includes(email.trim().toLowerCase());
}

/**
 * Comprueba que quien llama puede hacer una acción de administrador.
 *
 * Exige las dos cosas cuando hay lista: rol de administrador en la base de
 * datos Y correo en el secreto. Con una sola no basta, y ese es justamente el
 * punto: son dos cerraduras con llaves distintas.
 */
export function autorizadoComoAdmin(
  rolEnBaseDeDatos: string | null | undefined,
  bloqueado: boolean | null | undefined,
  email: string | null | undefined,
): { ok: true } | { ok: false; motivo: string } {
  if (bloqueado) return { ok: false, motivo: "La cuenta está bloqueada." };
  if (rolEnBaseDeDatos !== "admin") {
    return { ok: false, motivo: "La cuenta no tiene rol de administrador." };
  }
  if (hayListaAdmins() && !correoEnLista(email)) {
    return {
      ok: false,
      motivo: "El correo no está en ADMINS_PERMITIDOS, aunque tenga el rol en la base de datos.",
    };
  }
  return { ok: true };
}
