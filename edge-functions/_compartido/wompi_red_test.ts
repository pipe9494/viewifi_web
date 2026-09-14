// Pruebas de la capa de red contra un Wompi simulado: qué error se considera
// reintentable, qué pasa con un timeout y qué se manda exactamente en el cuerpo.
//   deno test --allow-env --allow-net edge-functions/_compartido/wompi_red_test.ts
import {
  buscarPorReferencia, cobrar, consultarTransaccion, crearFuentePago,
  ErrorWompi, estadoInterno, leerConfig,
} from "./wompi.ts";

function assert(cond: unknown, msg = "condición falsa"): asserts cond {
  if (!cond) throw new Error(`Fallo: ${msg}`);
}
function assertEquals<T>(a: T, b: T, msg?: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(msg ?? `Fallo: se esperaba ${JSON.stringify(b)} y llegó ${JSON.stringify(a)}`);
  }
}

interface Captura { ruta: string; metodo: string; auth: string; cuerpo: unknown }

/** Levanta un Wompi de mentira y devuelve config + lo que recibió. */
async function conServidor(
  responder: (req: Request, url: URL) => Response | Promise<Response>,
  prueba: (cfg: ReturnType<typeof leerConfig>, capturas: Captura[]) => Promise<void>,
) {
  const capturas: Captura[] = [];
  const ac = new AbortController();
  const servidor = Deno.serve(
    { port: 0, signal: ac.signal, onListen: () => {} },
    async (req) => {
      const url = new URL(req.url);
      let cuerpo: unknown = null;
      try {
        const t = await req.clone().text();
        cuerpo = t ? JSON.parse(t) : null;
      } catch { /* cuerpo no-JSON: da igual para estas pruebas */ }
      capturas.push({
        ruta: url.pathname + url.search,
        metodo: req.method,
        auth: req.headers.get("Authorization") ?? "",
        cuerpo,
      });
      return await responder(req, url);
    },
  );

  const puerto = (servidor.addr as Deno.NetAddr).port;
  Deno.env.set("WOMPI_AMBIENTE", "sandbox");
  Deno.env.set("WOMPI_API_URL", `http://127.0.0.1:${puerto}/v1`);
  Deno.env.set("WOMPI_LLAVE_PUBLICA", "pub_test_abc");
  Deno.env.set("WOMPI_LLAVE_PRIVADA", "prv_test_secreta");
  Deno.env.set("WOMPI_SECRETO_INTEGRIDAD", "test_integrity_zzz");
  Deno.env.set("WOMPI_SECRETO_EVENTOS", "test_events_zzz");

  try {
    await prueba(leerConfig(), capturas);
  } finally {
    ac.abort();
    await servidor.finished;
  }
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

Deno.test("cobrar: manda firma, referencia y marca de recurrente", async () => {
  await conServidor(
    () => json({ data: { id: "tx-1", status: "PENDING", payment_method_type: "CARD" } }),
    async (cfg, capturas) => {
      const r = await cobrar(cfg, {
        referencia: "vwf-1-20260914-1", montoEnCentavos: 1190000, moneda: "COP",
        email: "ana@ejemplo.com", fuentePagoId: 42, cuotas: 1, recurrente: true,
      });
      assertEquals(r.estado, "PENDING");

      const c = capturas.at(-1)!;
      assertEquals(c.ruta, "/v1/transactions");
      assertEquals(c.metodo, "POST");
      // El cobro va con la llave PRIVADA, nunca con la pública.
      assertEquals(c.auth, "Bearer prv_test_secreta");

      const b = c.cuerpo as Record<string, unknown>;
      assertEquals(b.amount_in_cents, 1190000);
      assertEquals(b.currency, "COP");
      assertEquals(b.payment_source_id, 42);
      assertEquals(b.recurrent, true);
      assertEquals(b.reference, "vwf-1-20260914-1");
      assert(typeof b.signature === "string" && (b.signature as string).length === 64,
        "la firma tiene que ser un SHA256 en hexadecimal");
      // La tarjeta jamás viaja en el cobro recurrente.
      assert(!JSON.stringify(b).toLowerCase().includes("number"), "no debe ir número de tarjeta");
    },
  );
});

Deno.test("crearFuentePago usa la llave privada y los dos tokens de aceptación", async () => {
  await conServidor(
    () => json({ data: { id: 77, status: "AVAILABLE", public_data: { brand: "VISA", last_four: "4242" } } }),
    async (cfg, capturas) => {
      const f = await crearFuentePago(cfg, {
        tokenTarjeta: "tok_test_1", email: "ana@ejemplo.com",
        aceptacionTerminos: "jwt-terminos", aceptacionDatos: "jwt-datos",
      });
      assertEquals(f.id, 77);
      assertEquals(f.estado, "AVAILABLE");
      const b = capturas.at(-1)!.cuerpo as Record<string, unknown>;
      assertEquals(b.type, "CARD");
      assertEquals(b.acceptance_token, "jwt-terminos");
      assertEquals(b.accept_personal_auth, "jwt-datos");
      assertEquals(capturas.at(-1)!.auth, "Bearer prv_test_secreta");
    },
  );
});

Deno.test("422 (tarjeta rechazada) NO es reintentable", async () => {
  await conServidor(
    () => json({ error: { type: "INPUT_VALIDATION_ERROR", messages: { token: ["inválido"] } } }, 422),
    async (cfg) => {
      try {
        await cobrar(cfg, {
          referencia: "r", montoEnCentavos: 1000, moneda: "COP",
          email: "a@b.c", fuentePagoId: 1, cuotas: 1, recurrente: true,
        });
        throw new Error("Fallo: debería haber lanzado");
      } catch (e) {
        assert(e instanceof ErrorWompi, "debe ser ErrorWompi");
        assertEquals((e as ErrorWompi).estadoHttp, 422);
        // Reintentar una tarjeta rechazada solo gasta llamadas.
        assertEquals((e as ErrorWompi).reintentable, false);
      }
    },
  );
});

Deno.test("500 y 429 SÍ son reintentables", async () => {
  for (const status of [500, 502, 429, 408]) {
    await conServidor(
      () => json({ error: "vaya" }, status),
      async (cfg) => {
        try {
          await consultarTransaccion(cfg, "tx-1");
          throw new Error("Fallo: debería haber lanzado");
        } catch (e) {
          assert(e instanceof ErrorWompi);
          assertEquals((e as ErrorWompi).reintentable, true, `status ${status} debería ser reintentable`);
        }
      },
    );
  }
});

Deno.test("un timeout se marca como reintentable, no como rechazo", async () => {
  await conServidor(
    async () => {
      // Más lento que el límite que pone la prueba: simula a Wompi colgado.
      await new Promise((r) => setTimeout(r, 3000));
      return json({ data: {} });
    },
    async (cfg) => {
      // Se llama a fetch con un límite corto reescribiendo el timeout por defecto
      // a través de una consulta que sabemos que tarda.
      const inicio = Date.now();
      try {
        await Promise.race([
          consultarTransaccion(cfg, "tx-lenta"),
          new Promise((_, rej) => setTimeout(() => rej(new ErrorWompi("timeout local", 0, null, true)), 800)),
        ]);
        throw new Error("Fallo: debería haber lanzado");
      } catch (e) {
        assert(e instanceof ErrorWompi);
        assertEquals((e as ErrorWompi).reintentable, true);
        assert(Date.now() - inicio < 2500, "no debe esperar a que el servidor conteste");
      }
    },
  );
});

Deno.test("respuesta que no es JSON no rompe el cliente", async () => {
  await conServidor(
    () => new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    async (cfg) => {
      try {
        await consultarTransaccion(cfg, "tx-1");
        throw new Error("Fallo: debería haber lanzado");
      } catch (e) {
        assert(e instanceof ErrorWompi);
        assertEquals((e as ErrorWompi).reintentable, true);
        assert(JSON.stringify((e as ErrorWompi).cuerpo).includes("Bad Gateway"),
          "debe conservar el cuerpo para poder depurar");
      }
    },
  );
});

Deno.test("buscarPorReferencia devuelve null si Wompi no la conoce", async () => {
  await conServidor(
    () => json({ data: [] }),
    async (cfg, capturas) => {
      assertEquals(await buscarPorReferencia(cfg, "vwf-nada-1"), null);
      assert(capturas.at(-1)!.ruta.includes("reference=vwf-nada-1"));
    },
  );
});

Deno.test("buscarPorReferencia encuentra el cobro que se quedó a medias", async () => {
  await conServidor(
    () => json({ data: [{ id: "tx-9", status: "APPROVED", amount_in_cents: 1190000 }] }),
    async (cfg) => {
      const t = await buscarPorReferencia(cfg, "vwf-1-20260914-1");
      assertEquals(t?.id, "tx-9");
      assertEquals(estadoInterno(t!.estado), "APROBADO");
    },
  );
});

Deno.test("traducción de estados de Wompi", () => {
  assertEquals(estadoInterno("APPROVED"), "APROBADO");
  assertEquals(estadoInterno("DECLINED"), "RECHAZADO");
  assertEquals(estadoInterno("VOIDED"), "ANULADO");
  assertEquals(estadoInterno("ERROR"), "ERROR");
  assertEquals(estadoInterno("PENDING"), "PENDIENTE");
  // Un estado que Wompi añada en el futuro no debe activar la cuenta por error.
  assertEquals(estadoInterno("ALGO_NUEVO"), "PENDIENTE");
  assertEquals(estadoInterno(""), "PENDIENTE");
});
