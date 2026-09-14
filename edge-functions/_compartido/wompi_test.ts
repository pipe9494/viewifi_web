// Pruebas de la lógica que no toca la red: firmas, checksums y configuración.
//   deno test --allow-env edge-functions/_compartido/wompi_test.ts
// Aserciones propias: JSR no siempre es alcanzable y estas pruebas deben poder
// ejecutarse sin red, con solo `deno test --allow-env`.
function assert(cond: unknown, msg = "condición falsa"): asserts cond {
  if (!cond) throw new Error(`Fallo: ${msg}`);
}
function assertEquals<T>(actual: T, esperado: T, msg?: string) {
  const a = JSON.stringify(actual), b = JSON.stringify(esperado);
  if (a !== b) throw new Error(msg ?? `Fallo: se esperaba ${b} y llegó ${a}`);
}
function assertThrows(fn: () => unknown, _tipo: unknown, contiene: string) {
  try {
    fn();
  } catch (e) {
    const m = (e as Error).message;
    if (!m.includes(contiene)) throw new Error(`Fallo: el error "${m}" no menciona "${contiene}"`);
    return;
  }
  throw new Error(`Fallo: se esperaba una excepción que mencionara "${contiene}"`);
}
import { firmaIntegridad, leerConfig, verificarChecksum } from "./wompi.ts";

const SECRETO_INTEGRIDAD = "prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6";
const SECRETO_EVENTOS = "prod_events_2PDUmhMywUkvL1ZKM7fMLDcsBSTuMEvS";

async function sha256(texto: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("firma de integridad: referencia + monto + moneda + secreto", async () => {
  const ref = "sk8-438k4-xmxm392-sn2m24";
  const firma = await firmaIntegridad(ref, 90000, "COP", SECRETO_INTEGRIDAD);
  // Es exactamente el ejemplo que publica Wompi en su documentación.
  assertEquals(firma, await sha256(`${ref}90000COP${SECRETO_INTEGRIDAD}`));
  assertEquals(firma.length, 64);
});

Deno.test("firma de integridad: cambiar un céntimo cambia la firma", async () => {
  const a = await firmaIntegridad("ref-1", 1190000, "COP", SECRETO_INTEGRIDAD);
  const b = await firmaIntegridad("ref-1", 1190001, "COP", SECRETO_INTEGRIDAD);
  assert(a !== b, "un importe distinto tiene que dar una firma distinta");
});

// --- Webhooks --------------------------------------------------------------

async function eventoFirmado(estado = "APPROVED", monto = 1190000) {
  const data = {
    transaction: {
      id: "01-1532941443-49201",
      reference: "vwf-abc-20260914-1",
      amount_in_cents: monto,
      currency: "COP",
      status: estado,
    },
  };
  const timestamp = 1530291411;
  const properties = ["transaction.id", "transaction.status", "transaction.amount_in_cents"];
  const concatenado = `${data.transaction.id}${data.transaction.status}` +
    `${data.transaction.amount_in_cents}${timestamp}${SECRETO_EVENTOS}`;
  return {
    event: "transaction.updated",
    data,
    timestamp,
    signature: { properties, checksum: await sha256(concatenado) },
  };
}

Deno.test("checksum válido se acepta", async () => {
  const ev = await eventoFirmado();
  assertEquals((await verificarChecksum(ev, SECRETO_EVENTOS)).valido, true);
});

Deno.test("checksum en MAYÚSCULAS también se acepta", async () => {
  const ev = await eventoFirmado();
  ev.signature.checksum = ev.signature.checksum.toUpperCase();
  assertEquals((await verificarChecksum(ev, SECRETO_EVENTOS)).valido, true);
});

Deno.test("secreto equivocado se rechaza", async () => {
  const ev = await eventoFirmado();
  const r = await verificarChecksum(ev, "otro_secreto");
  assertEquals(r.valido, false);
  assert(r.motivo?.includes("checksum"));
});

Deno.test("importe manipulado se rechaza", async () => {
  // El ataque evidente: firmar 1.000 pesos y cambiar el importe a 1.000.000.
  const ev = await eventoFirmado("APPROVED", 1190000);
  ev.data.transaction.amount_in_cents = 100;
  assertEquals((await verificarChecksum(ev, SECRETO_EVENTOS)).valido, false);
});

Deno.test("estado manipulado se rechaza", async () => {
  const ev = await eventoFirmado("DECLINED");
  ev.data.transaction.status = "APPROVED";
  assertEquals((await verificarChecksum(ev, SECRETO_EVENTOS)).valido, false);
});

Deno.test("evento sin firma se rechaza", async () => {
  const ev = await eventoFirmado();
  const sinFirma = { ...ev, signature: undefined } as unknown as Parameters<typeof verificarChecksum>[0];
  const r = await verificarChecksum(sinFirma, SECRETO_EVENTOS);
  assertEquals(r.valido, false);
  assert(r.motivo?.includes("signature"));
});

Deno.test("evento sin timestamp se rechaza", async () => {
  const ev = await eventoFirmado();
  const sinTs = { ...ev, timestamp: undefined } as unknown as Parameters<typeof verificarChecksum>[0];
  assertEquals((await verificarChecksum(sinTs, SECRETO_EVENTOS)).valido, false);
});

Deno.test("propiedad firmada que no existe en data se rechaza", async () => {
  const ev = await eventoFirmado();
  ev.signature.properties = ["transaction.no_existe"];
  const r = await verificarChecksum(ev, SECRETO_EVENTOS);
  assertEquals(r.valido, false);
  assert(r.motivo?.includes("no_existe"));
});

Deno.test("el orden de las propiedades importa", async () => {
  const ev = await eventoFirmado();
  ev.signature.properties = ["transaction.status", "transaction.id", "transaction.amount_in_cents"];
  assertEquals((await verificarChecksum(ev, SECRETO_EVENTOS)).valido, false);
});

// --- Configuración ----------------------------------------------------------

function ponerEntorno(vars: Record<string, string | undefined>) {
  for (const k of [
    "WOMPI_AMBIENTE", "WOMPI_LLAVE_PUBLICA", "WOMPI_LLAVE_PRIVADA",
    "WOMPI_SECRETO_INTEGRIDAD", "WOMPI_SECRETO_EVENTOS", "WOMPI_API_URL",
  ]) Deno.env.delete(k);
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) Deno.env.set(k, v);
}

Deno.test("configuración de sandbox correcta", () => {
  ponerEntorno({
    WOMPI_AMBIENTE: "sandbox",
    WOMPI_LLAVE_PUBLICA: "pub_test_abc", WOMPI_LLAVE_PRIVADA: "prv_test_abc",
    WOMPI_SECRETO_INTEGRIDAD: "test_integrity_x", WOMPI_SECRETO_EVENTOS: "test_events_x",
  });
  assertEquals(leerConfig().baseUrl, "https://sandbox.wompi.co/v1");
});

Deno.test("configuración de producción correcta", () => {
  ponerEntorno({
    WOMPI_AMBIENTE: "produccion",
    WOMPI_LLAVE_PUBLICA: "pub_prod_abc", WOMPI_LLAVE_PRIVADA: "prv_prod_abc",
    WOMPI_SECRETO_INTEGRIDAD: "prod_integrity_x", WOMPI_SECRETO_EVENTOS: "prod_events_x",
  });
  assertEquals(leerConfig().baseUrl, "https://production.wompi.co/v1");
});

Deno.test("llaves de prueba en producción se detectan", () => {
  // El error caro: creer que estás cobrando de verdad y estar en sandbox, o al revés.
  ponerEntorno({
    WOMPI_AMBIENTE: "produccion",
    WOMPI_LLAVE_PUBLICA: "pub_test_abc", WOMPI_LLAVE_PRIVADA: "prv_test_abc",
    WOMPI_SECRETO_INTEGRIDAD: "x", WOMPI_SECRETO_EVENTOS: "y",
  });
  assertThrows(() => leerConfig(), Error, "_prod_");
});

Deno.test("falta una variable y lo dice por su nombre", () => {
  ponerEntorno({
    WOMPI_AMBIENTE: "sandbox",
    WOMPI_LLAVE_PUBLICA: "pub_test_abc", WOMPI_LLAVE_PRIVADA: "prv_test_abc",
    WOMPI_SECRETO_INTEGRIDAD: "test_integrity_x",
  });
  assertThrows(() => leerConfig(), Error, "WOMPI_SECRETO_EVENTOS");
});

Deno.test("ambiente inventado se rechaza", () => {
  ponerEntorno({
    WOMPI_AMBIENTE: "casi_produccion",
    WOMPI_LLAVE_PUBLICA: "pub_test_abc", WOMPI_LLAVE_PRIVADA: "prv_test_abc",
    WOMPI_SECRETO_INTEGRIDAD: "x", WOMPI_SECRETO_EVENTOS: "y",
  });
  assertThrows(() => leerConfig(), Error, "sandbox");
});

Deno.test("WOMPI_API_URL manda sobre el ambiente", () => {
  ponerEntorno({
    WOMPI_AMBIENTE: "sandbox", WOMPI_API_URL: "https://uat.wompi.co/v1",
    WOMPI_LLAVE_PUBLICA: "pub_test_abc", WOMPI_LLAVE_PRIVADA: "prv_test_abc",
    WOMPI_SECRETO_INTEGRIDAD: "x", WOMPI_SECRETO_EVENTOS: "y",
  });
  assertEquals(leerConfig().baseUrl, "https://uat.wompi.co/v1");
});

Deno.test("verificarChecksum nunca lanza con basura", async () => {
  for (const basura of [{}, { signature: {} }, { signature: { properties: "no-es-array" } }]) {
    const r = await verificarChecksum(basura as never, SECRETO_EVENTOS);
    assertEquals(r.valido, false);
  }
});
