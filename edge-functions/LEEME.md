# Edge Functions de Viewifi

Seis funciones que corren en Supabase. Ninguna vive en el sitio estático:
todas necesitan la llave privada de Wompi o la `service_role` de Supabase, y
esas no pueden estar en un navegador.

| Función | Quién la llama | JWT |
|---|---|---|
| `crear-suscripcion` | La web, cuando el usuario contrata | Sí |
| `wompi-webhook` | Wompi, al resolverse una transacción | **No** |
| `cobros-recurrentes` | `pg_cron`, una vez al día | Sí (service_role) |
| `cancelar-suscripcion` | La web o el panel | Sí |
| `admin-usuarios` | El panel de administración | Sí |
| `sincronizar-admins` | El panel, o el cron | Sí |

## Orden de instalación

Primero las tablas, luego los secretos, luego las funciones y al final el cron.
Saltarse el orden hace que la primera ejecución falle con errores que no
apuntan a la causa real.

### 1. Las tablas

En el **SQL Editor** de Supabase, ejecuta los archivos de `migraciones/` en
orden numérico, del `001` al `007`. Cada uno es idempotente: si dudas de si ya
lo lanzaste, vuelve a lanzarlo.

El `008_cron.sql` va al final del todo, cuando las funciones ya estén desplegadas.

### 2. Nombrarte administrador

Regístrate por la web con tu correo y luego, en el SQL Editor:

```sql
update public.perfiles set rol = 'admin' where lower(email) = lower('tu@correo.com');
```

Sin esto el panel no deja entrar a nadie: las políticas RLS bloquean todo lo
que no venga de un administrador, y eso incluye a quien acaba de instalarlo.

Este `UPDATE` solo hace falta la primera vez. A partir de ahí los
administradores se gestionan desde el secreto `ADMINS_PERMITIDOS`, como
explica el apartado siguiente.

### 3. Los secretos

Copia `.env.ejemplo` a `.env`, rellena las cuatro llaves de Wompi y súbelas:

```bash
supabase secrets set --env-file .env
supabase secrets list          # comprueba que llegaron
```

`.env` está en `.gitignore`. Este repositorio se publica con GitHub Pages:
cualquier cosa que entre queda accesible en internet.

### 4. Desplegar

```bash
supabase functions deploy crear-suscripcion
supabase functions deploy cancelar-suscripcion
supabase functions deploy admin-usuarios
supabase functions deploy cobros-recurrentes
supabase functions deploy sincronizar-admins

# Wompi no manda ningún token de Supabase: si se despliega con verificación
# de JWT, todos los webhooks rebotan con 401 y los cobros se quedan colgados
# en PENDIENTE para siempre.
supabase functions deploy wompi-webhook --no-verify-jwt
```

Si prefieres subirlas desde el panel de Supabase (Edge Functions → Deploy),
sube cada carpeta con su `index.ts` y copia también `_compartido/`, porque las
seis importan de ahí.

### 5. Registrar el webhook en Wompi

Panel de Wompi → Desarrolladores → Eventos → URL de eventos:

```
https://TU_PROYECTO.supabase.co/functions/v1/wompi-webhook
```

### 6. El cron

Con las funciones ya desplegadas, edita `migraciones/008_cron.sql` (sustituye
`TU_PROYECTO` y `TU_SERVICE_ROLE_KEY`) y ejecútalo.

## Quién puede entrar al panel

Hay dos cerraduras y conviene entender por qué, porque la pregunta obvia
—«¿puedo poner los correos de los administradores en un secreto?»— tiene una
respuesta con matiz.

Los secretos de Edge Functions **solo se leen desde dentro de una función**,
con `Deno.env.get()`. PostgreSQL no los ve. Y quien decide si el panel puede
leer la tabla de pagos no es una función: son las políticas RLS, que corren en
la base de datos y consultan `perfiles.rol`. Un secreto, por sí solo, no puede
gobernar eso.

Así que el reparto queda:

| Capa | Qué gobierna | Dónde vive |
|---|---|---|
| `perfiles.rol = 'admin'` | Lo que RLS deja leer y escribir | Base de datos |
| `ADMINS_PERMITIDOS` | Crear y borrar cuentas, cambiar contraseñas, cancelar suscripciones ajenas | Secreto de Edge Functions |

`sincronizar-admins` mantiene las dos alineadas: lee la lista del secreto,
asciende a quien esté en ella y degrada a quien tenga el rol sin estarlo.

Que sean dos capas separadas no es un apaño, es lo que hace el sistema más
difícil de romper: si alguien consiguiera cambiar un rol directamente en la
base de datos, las funciones que mueven dinero y cuentas seguirían negándose
porque su correo no está en el secreto.

### Dar de alta a un administrador

1. Añade su correo a `ADMINS_PERMITIDOS` y sube el secreto.
2. Esa persona se registra por la web con **ese mismo correo**.
3. Pulsa **Sincronizar con ADMINS_PERMITIDOS** en Ajustes, o lanza la función.

Si te saltas el paso 2, la sincronización te avisa: devuelve ese correo en
`en_la_lista_sin_cuenta`. Un secreto no crea cuentas.

### Quitar a alguien

Bórralo del secreto y vuelve a sincronizar. Las acciones privilegiadas le
quedan cerradas en cuanto subes el secreto, aunque su rol tarde en bajar.

### Si dejas `ADMINS_PERMITIDOS` vacío

La comprobación se desactiva y manda solo `perfiles.rol`. Es el
comportamiento hasta que configures el secreto por primera vez, para que
desplegar esto no deje a nadie fuera sin avisar.

### Si te quedas fuera

Si sincronizas con una lista mal escrita y pierdes el acceso, se arregla
desde el SQL Editor con el `UPDATE` del paso 2. La función avisa en su
respuesta cuando la sincronización deja cero administradores activos.

## Probar antes de cobrar de verdad

Con `WOMPI_AMBIENTE=sandbox` y llaves `pub_test_` / `prv_test_`:

| Tarjeta | Resultado |
|---|---|
| `4242 4242 4242 4242` | Aprobada |
| `4111 1111 1111 1111` | Rechazada |
| Cualquier otra | Error |

Cualquier fecha futura y cualquier CVV de tres dígitos sirven.

Prueba estos cuatro caminos, no solo el feliz:

1. **Pago aprobado.** La suscripción pasa a `activa` y `proximo_cobro_en` queda
   un mes más adelante.
2. **Pago rechazado.** La suscripción se cancela y el usuario ve un mensaje
   claro. No debe quedar ninguna fila `activa`.
3. **Webhook repetido.** Reenvía el mismo evento desde el panel de Wompi. La
   segunda vez debe contestar `{"ok":true,"duplicado":true}` sin cambiar nada.
4. **Renovación fallida.** Pon `proximo_cobro_en` en el pasado con una tarjeta
   rechazada y lanza el cron a mano tres veces: la cuenta debe acabar en
   `expirada`, conservando su historial de pagos.

En el panel, la pestaña **Registro** muestra todos los webhooks recibidos, con
su firma válida o no. Es el primer sitio donde mirar cuando algo no cuadra.

## Pruebas automáticas

```bash
deno test --allow-env --allow-net edge-functions/_compartido/
```

36 pruebas: firmas de integridad, verificación de checksums (incluidos intentos
de manipular el importe y el estado), validación de configuración y capa de red
contra un Wompi simulado, y la lista de administradores. No hacen falta llaves
reales ni conexión con Wompi.

## Cosas que conviene tener claras

**Las referencias son deterministas.** `referencia_pago(suscripcion, periodo,
intento)` da siempre la misma cadena. Si la red se corta después de que Wompi
acepte un cobro pero antes de que nos conteste, el reintento manda la misma
referencia y Wompi la rechaza como duplicada. Es la protección principal contra
el doble cobro; por debajo hay además un índice único que impide dos pagos
aprobados del mismo periodo.

**El webhook es la única fuente de verdad.** La respuesta a `POST /transactions`
suele llegar en `PENDING`. Una suscripción no se activa hasta que el webhook
confirma `APPROVED`, o hasta que el cron pregunta directamente a Wompi.

**Un fallo de red no gasta un reintento.** Solo cuentan los rechazos del banco.
Reintentar tres veces por un problema de conexión dejaría al usuario en Free
sin que su tarjeta tuviera nada malo.

**Cancelar no corta el servicio.** El usuario pagó hasta el final del periodo y
lo conserva; solo se apaga la renovación.

**Cambiar un precio no afecta a lo ya pagado.** El importe se lee del plan en el
momento de cobrar, así que el cambio entra en la siguiente renovación.
