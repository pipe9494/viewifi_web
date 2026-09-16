# Correos de autenticación con Resend

Hasta ahora los correos de alta y recuperación salían por el servidor de pruebas
de Supabase, que tiene dos límites duros: **solo envía a los miembros del
proyecto** y **2 mensajes por hora**. Sirve para probar y para nada más. Esto lo
cambia por Resend.

El cambio es del lado del servidor, así que **la app de Android no necesita
ninguna modificación**: los correos que dispara la app salen por Supabase igual
que los de la web, y al cambiar el SMTP cambian los dos a la vez.

---

## 1 · Verificar el dominio en Resend

Entra a [resend.com](https://resend.com), crea la cuenta y añade el dominio
`viewifi.tech` en **Domains → Add Domain**.

Resend te dará unos registros DNS propios de tu cuenta: uno de DKIM (un TXT en
un subdominio tipo `resend._domainkey`) y normalmente uno de SPF. Cópialos tal
cual al panel de **.tech Domains → DNS → DNS Records**, donde ya pusiste el TXT
de Google.

Comprobado antes de empezar: tu dominio **no tiene MX, ni SPF, ni DMARC**, así
que estos registros entran sin chocar con nada. No toques el registro A ni el
CNAME de `www`, que son los que sirven la web.

Cuando Resend marque el dominio como verificado, crea una **API key** en
**API Keys → Create API Key**. Cópiala: solo se enseña una vez.

## 2 · Configurar el SMTP en Supabase

Panel de Supabase → **Authentication** → ajustes → **SMTP Settings**. Activa el
SMTP propio y rellena:

| Campo | Valor |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | tu API key de Resend |
| Sender email | `noreply@viewifi.tech` |
| Sender name | `Viewifi` |

El puerto 465 va con SSL directo. Si tu red lo bloquea, `587` también funciona
(ahí la conexión empieza en claro y se cifra después).

**Sube el límite de envío.** Al activar SMTP propio, Supabase impone 30 mensajes
por hora. Es poco para producción. Está en **Authentication → Rate Limits**, en
el apartado de correos.

Ojo con el remitente: `noreply@viewifi.tech` no recibe respuestas, porque el
dominio no tiene MX. Es lo normal para correos automáticos, pero si algún día
quieres poder leer lo que la gente conteste, hay que configurar recepción o
reenvío en .tech primero.

## 3 · Pegar las plantillas

Panel de Supabase → **Authentication** → **Email Templates**. Hay una pestaña por
tipo de correo. Pega el contenido de cada archivo en el campo de mensaje:

| Pestaña de Supabase | Archivo | Asunto sugerido |
|---|---|---|
| Confirm sign up | `confirmar-alta.html` | Confirma tu correo · Viewifi |
| Reset password | `restablecer-clave.html` | Restablece tu contraseña · Viewifi |
| Change email address | `cambiar-correo.html` | Confirma tu correo nuevo · Viewifi |
| Magic link | `enlace-de-acceso.html` | Tu enlace de acceso · Viewifi |

Quedan dos plantillas sin tocar, *Invite user* y *Reauthentication*, porque hoy
no las usa nada. Si algún día las necesitas, copia cualquiera de estas cuatro y
cámbiale el texto.

### Cómo están hechas

No las edites a mano si puedes evitarlo: **se generan** con `generar.py`, que
está en esta misma carpeta. El marco del correo —cabecera, botón, pie— es
idéntico en las cuatro, y mantenerlo a mano por cuadruplicado es garantía de que
se desincronicen. Para cambiar un texto, edítalo en `generar.py` y lanza:

```bash
python3 correo/generar.py
```

Son HTML de correo, que no es HTML normal: todo va en tablas y con estilos en
línea porque Gmail elimina los bloques `<style>`, sin `rgba()` ni variables CSS
porque Outlook las ignora, y el botón es una tabla y no un enlace con relleno
porque Outlook de Windows no le respeta el `padding`.

### Son bilingües solas

El alta de `/cuenta/` guarda el idioma de cada persona en sus metadatos, y la
plantilla lo consulta:

```
{{ if eq (printf "%v" .Data.locale) "en" }}…inglés…{{ else }}…español…{{ end }}
```

El `printf` no es adorno: un usuario sin ese dato —creado a mano desde el panel
de Supabase, por ejemplo— haría fallar una comparación directa. Así cae en
español y ya está. Lo comprobé renderizando las cuatro plantillas con el mismo
motor de plantillas que usa Supabase, en cuatro escenarios: español, inglés, sin
metadatos y con un idioma inesperado. Dieciséis casos, todos limpios.

## 4 · Permitir las direcciones de retorno

Panel de Supabase → **Authentication** → **URL Configuration**.

**Site URL**: `https://viewifi.tech`

**Redirect URLs**, añade las tres:

```
https://viewifi.tech/cuenta/
https://viewifi.tech/en/cuenta/
viewifi://auth-callback
```

Las dos primeras son adonde vuelve la gente desde la web. La tercera es el enlace
profundo de la app de Android, que ya está declarado en su `AndroidManifest.xml`.
Sin esa entrada, el enlace del correo no devuelve a nadie a la app.

Esto es lo que hace que **una sola plantilla sirva para web y app**: el botón usa
`{{ .ConfirmationURL }}`, que Supabase construye con el `redirectTo` que pidió
cada cliente. La web pide volver a `/cuenta/` y la app a `viewifi://auth-callback`,
y cada quien acaba donde le toca.

## 5 · Probarlo

Con todo puesto, en `viewifi.tech/cuenta/`:

1. Crea una cuenta con una dirección real. Debe llegar el correo de confirmación
   con el aspecto del sitio, no el genérico de Supabase.
2. En la pantalla de acceso pulsa **¿Olvidaste tu contraseña?**, pide el enlace,
   y ábrelo. Tiene que llevarte a elegir una contraseña nueva, no a la cuenta.
3. Repite el paso 1 desde `viewifi.tech/en/cuenta/` con otra dirección: ese
   correo debe llegar en inglés.

En el panel de Resend, la pestaña de **Emails** muestra todo lo enviado con su
estado. Es el primer sitio donde mirar si algo no llega.

---

## Lo único que conviene revisar en la app

No pude leer el código de autenticación de Android desde aquí —los archivos están
a ocho carpetas de profundidad y la herramienta llega a siete—, así que esto lo
tienes que mirar tú.

Busca en `AuthRepository.kt` o `AuthViewModel.kt` la llamada de recuperación de
contraseña. Tiene que pasar el `redirectTo` apuntando al enlace profundo:

```kotlin
supabase.auth.resetPasswordForEmail(email, redirectUrl = "viewifi://auth-callback")
```

Si no lo pasa, Supabase usará la **Site URL** por defecto y el enlace del correo
abrirá la web en vez de la app. No es que se rompa nada —la persona podría
cambiar su contraseña en el navegador— pero no es la experiencia que quieres
desde el móvil.
