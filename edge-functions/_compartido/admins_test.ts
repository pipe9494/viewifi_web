// Pruebas de la lista de administradores por secreto.
//   deno test --allow-env edge-functions/_compartido/admins_test.ts
import { autorizadoComoAdmin, correoEnLista, hayListaAdmins, listaAdmins } from "./admins.ts";

function assert(c: unknown, m = "condición falsa"): asserts c {
  if (!c) throw new Error(`Fallo: ${m}`);
}
function assertEquals<T>(a: T, b: T, m?: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(m ?? `Fallo: se esperaba ${JSON.stringify(b)} y llegó ${JSON.stringify(a)}`);
  }
}
const poner = (v?: string) =>
  v === undefined ? Deno.env.delete("ADMINS_PERMITIDOS") : Deno.env.set("ADMINS_PERMITIDOS", v);

Deno.test("separa por comas, punto y coma o espacios", () => {
  poner("a@x.com, b@x.com;c@x.com  d@x.com");
  assertEquals(listaAdmins(), ["a@x.com", "b@x.com", "c@x.com", "d@x.com"]);
});

Deno.test("normaliza mayúsculas y espacios sobrantes", () => {
  // El motivo más común de "pero si lo puse en la lista".
  poner("  ROOT@Viewifi.TECH ,  Ana@Ejemplo.com  ");
  assertEquals(listaAdmins(), ["root@viewifi.tech", "ana@ejemplo.com"]);
  assert(correoEnLista("Root@VIEWIFI.tech"));
  assert(correoEnLista("  ana@ejemplo.com  "));
});

Deno.test("descarta entradas que no son correos", () => {
  poner("a@x.com, basura, , @, admin, x@y, b@y.com");
  assertEquals(listaAdmins(), ["a@x.com", "b@y.com"]);
});

Deno.test("lista vacía o sin definir desactiva la comprobación", () => {
  poner(undefined);
  assertEquals(hayListaAdmins(), false);
  poner("   ");
  assertEquals(hayListaAdmins(), false);
  poner(",,, ;");
  assertEquals(hayListaAdmins(), false);
});

Deno.test("sin lista, manda solo el rol de la base de datos", () => {
  poner(undefined);
  assertEquals(autorizadoComoAdmin("admin", false, "cualquiera@x.com").ok, true);
  assertEquals(autorizadoComoAdmin("usuario", false, "cualquiera@x.com").ok, false);
});

Deno.test("con lista hacen falta las dos cosas", () => {
  poner("root@viewifi.tech");

  assertEquals(autorizadoComoAdmin("admin", false, "root@viewifi.tech").ok, true);

  // Rol de admin en la base de datos pero fuera de la lista: se deniega.
  // Este es el caso que protege de que alguien manipule el rol directamente.
  const r1 = autorizadoComoAdmin("admin", false, "intruso@x.com");
  assertEquals(r1.ok, false);
  assert(!r1.ok && r1.motivo.includes("ADMINS_PERMITIDOS"));

  // En la lista pero sin el rol: tampoco. Falta sincronizar.
  const r2 = autorizadoComoAdmin("usuario", false, "root@viewifi.tech");
  assertEquals(r2.ok, false);
  assert(!r2.ok && r2.motivo.includes("rol"));
});

Deno.test("una cuenta bloqueada no pasa aunque esté en la lista", () => {
  poner("root@viewifi.tech");
  const r = autorizadoComoAdmin("admin", true, "root@viewifi.tech");
  assertEquals(r.ok, false);
  assert(!r.ok && r.motivo.includes("bloqueada"));
});

Deno.test("valores nulos no cuelan", () => {
  poner("root@viewifi.tech");
  assertEquals(autorizadoComoAdmin(null, false, null).ok, false);
  assertEquals(autorizadoComoAdmin("admin", false, null).ok, false);
  assertEquals(autorizadoComoAdmin(undefined, undefined, undefined).ok, false);
  assertEquals(correoEnLista(null), false);
  assertEquals(correoEnLista(""), false);
});

Deno.test("un correo parecido no cuenta como el mismo", () => {
  poner("root@viewifi.tech");
  assertEquals(correoEnLista("root@viewifi.tech.attacker.com"), false);
  assertEquals(correoEnLista("xroot@viewifi.tech"), false);
  assertEquals(correoEnLista("root@viewifi.tec"), false);
});
