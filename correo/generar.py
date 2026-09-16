#!/usr/bin/env python3
"""
Genera las plantillas de correo de Supabase Auth con el estilo de viewifi.tech.

Por qué un generador y no cuatro archivos escritos a mano: el marco del correo
—cabecera, botón, pie, avisos— es idéntico en los cuatro, y en HTML de correo
ese marco son cien líneas de tablas anidadas. Escribirlo cuatro veces garantiza
que se desincronicen a la primera corrección.

Notas de HTML para correo, que no es HTML normal:
  · Todo va en tablas y con estilos EN LÍNEA. Gmail elimina los bloques <style>,
    así que cualquier regla que viva ahí desaparece en el cliente más usado.
  · Nada de variables CSS ni de rgba(): Outlook las ignora. Colores en hex sólido.
  · El botón se dibuja como una tabla, no como un <a> con padding: Outlook de
    Windows no respeta el padding de un enlace y el botón sale sin cuerpo.
  · El logo es un <img> alojado en el sitio. Un <svg> en línea no se ve en Gmail.

Bilingüe: la plantilla decide el idioma con los metadatos del usuario, que el
alta de /cuenta/ rellena con `locale`. Se compara con printf para que un usuario
sin ese dato —por ejemplo creado a mano desde el panel de Supabase— caiga en
español en vez de romper la plantilla.
"""

import os

# --- paleta, tomada de styles.css y convertida a hex sólido ------------------
FONDO      = '#0A0E14'   # --bg
SUPERFICIE = '#151A26'   # --surface
BORDE      = '#1F2430'   # --line, opacado sobre el fondo
PRIMARIO   = '#1B98E0'   # --primary
CIAN       = '#00E5FF'   # --accent-cyan
TEXTO      = '#E8EAF0'   # --text
TENUE      = '#9AA3B5'   # --text-dim

TIPO = ("-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, "
        "'Helvetica Neue', Arial, sans-serif")

SITIO = 'https://viewifi.tech'


def t(es, en):
    """Bloque bilingüe. Sin el dato de idioma, español."""
    return ('{{ if eq (printf "%v" .Data.locale) "en" }}' + en +
            '{{ else }}' + es + '{{ end }}')


def plantilla(*, asunto_oculto, titulo, cuerpo, boton, nota, aviso):
    """Devuelve el HTML completo de un correo."""
    return f"""<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark light" />
<meta name="supported-color-schemes" content="dark light" />
<title>Viewifi</title>
</head>
<body style="margin:0; padding:0; background-color:{FONDO}; color:{TEXTO}; font-family:{TIPO};">

<!-- Texto de vista previa: lo que se lee en la bandeja antes de abrir.
     Va oculto y seguido de espacios para que no arrastre el cuerpo detrás. -->
<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; height:0; width:0;">
  {asunto_oculto}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background-color:{FONDO}; margin:0; padding:0;">
  <tr>
    <td align="center" style="padding:32px 16px;">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="width:100%; max-width:600px;">

        <!-- marca -->
        <tr>
          <td align="left" style="padding:0 0 24px 0;">
            <a href="{SITIO}/" style="text-decoration:none; color:{TEXTO};">
              <img src="{SITIO}/assets/apple-touch-icon.png" width="32" height="32" alt="Viewifi"
                   style="vertical-align:middle; border:0; border-radius:8px;" />
              <span style="vertical-align:middle; font-size:19px; font-weight:700; color:{TEXTO}; padding-left:10px;">Viewifi</span>
            </a>
          </td>
        </tr>

        <!-- tarjeta -->
        <tr>
          <td style="background-color:{SUPERFICIE}; border:1px solid {BORDE}; border-radius:20px; padding:36px 32px;">

            <h1 style="margin:0 0 16px 0; font-size:23px; line-height:1.25; font-weight:800; color:{TEXTO}; letter-spacing:-0.02em;">
              {titulo}
            </h1>

            <p style="margin:0 0 28px 0; font-size:15px; line-height:1.6; color:{TENUE};">
              {cuerpo}
            </p>

            <!-- botón a prueba de Outlook -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
              <tr>
                <td align="center" bgcolor="{PRIMARIO}" style="border-radius:999px;">
                  <a href="{{{{ .ConfirmationURL }}}}"
                     style="display:inline-block; padding:15px 32px; font-family:{TIPO}; font-size:15px; font-weight:700; color:#04121D; text-decoration:none; border-radius:999px;">
                    {boton}
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 8px 0; font-size:13px; line-height:1.5; color:{TENUE};">
              {t('Si el botón no funciona, copia y pega esta dirección en tu navegador:',
                 'If the button does not work, copy and paste this address into your browser:')}
            </p>
            <p style="margin:0 0 28px 0; font-size:12px; line-height:1.5; word-break:break-all;">
              <a href="{{{{ .ConfirmationURL }}}}" style="color:{CIAN}; text-decoration:underline;">{{{{ .ConfirmationURL }}}}</a>
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top:1px solid {BORDE}; font-size:0; line-height:0; height:1px;">&nbsp;</td></tr>
            </table>

            <p style="margin:20px 0 0 0; font-size:13px; line-height:1.6; color:{TENUE};">
              {nota}
            </p>

          </td>
        </tr>

        <!-- pie -->
        <tr>
          <td align="left" style="padding:24px 4px 0 4px;">
            <p style="margin:0 0 6px 0; font-size:12px; line-height:1.6; color:{TENUE};">
              {aviso}
            </p>
            <p style="margin:0; font-size:12px; line-height:1.6; color:#6B7488;">
              Viewifi · {t('Tu WiFi, tu guardián', 'Your WiFi, your guardian')} ·
              <a href="{SITIO}/" style="color:#6B7488; text-decoration:underline;">viewifi.tech</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>
"""


CORREOS = {

    'confirmar-alta.html': dict(
        asunto_oculto=t('Confirma tu correo para activar tu cuenta de Viewifi.',
                        'Confirm your email to activate your Viewifi account.'),
        titulo=t('Confirma tu correo', 'Confirm your email'),
        cuerpo=t('Bienvenido a Viewifi. Solo falta un paso: confirma que esta dirección '
                 'es tuya y tu cuenta queda lista. Es la misma cuenta que usarás en la '
                 'app de Android y en el host de Linux.',
                 'Welcome to Viewifi. One step left: confirm this address is yours and '
                 'your account is ready. It is the same account you will use in the '
                 'Android app and on the Linux host.'),
        boton=t('Confirmar mi correo', 'Confirm my email'),
        nota=t('El enlace caduca pasado un tiempo por seguridad. Si ha caducado, vuelve '
               'a intentar el registro y te mandamos uno nuevo.',
               'The link expires after a while for security. If it has expired, sign up '
               'again and we will send you a new one.'),
        aviso=t('Si no creaste ninguna cuenta en Viewifi, ignora este mensaje: sin pulsar '
                'el botón no se activa nada.',
                'If you did not create a Viewifi account, ignore this message: nothing is '
                'activated unless the button is clicked.'),
    ),

    'restablecer-clave.html': dict(
        asunto_oculto=t('Crea una contraseña nueva para tu cuenta de Viewifi.',
                        'Set a new password for your Viewifi account.'),
        titulo=t('Restablece tu contraseña', 'Reset your password'),
        cuerpo=t('Pediste crear una contraseña nueva. Pulsa el botón y te llevamos a una '
                 'página donde la eliges. Tu contraseña actual sigue funcionando hasta '
                 'que la cambies.',
                 'You asked to set a new password. Press the button and we will take you '
                 'to a page where you choose it. Your current password keeps working '
                 'until you change it.'),
        boton=t('Crear una contraseña nueva', 'Set a new password'),
        nota=t('El enlace caduca pasado un tiempo y solo se puede usar una vez. Si ha '
               'caducado, pide otro desde la pantalla de acceso.',
               'The link expires after a while and can only be used once. If it has '
               'expired, request another one from the sign-in screen.'),
        aviso=t('Si no pediste cambiar la contraseña, ignora este mensaje. Tu cuenta no '
                'ha cambiado y nadie puede entrar con este enlace sin tu correo.',
                'If you did not ask to change your password, ignore this message. Your '
                'account has not changed and nobody can get in with this link without '
                'your inbox.'),
    ),

    'cambiar-correo.html': dict(
        asunto_oculto=t('Confirma tu dirección de correo nueva en Viewifi.',
                        'Confirm your new email address on Viewifi.'),
        titulo=t('Confirma tu correo nuevo', 'Confirm your new email'),
        cuerpo=t('Pediste cambiar la dirección de tu cuenta a {{ .NewEmail }}. '
                 'Confírmala para que el cambio surta efecto. Hasta entonces seguimos '
                 'usando la anterior.',
                 'You asked to change your account address to {{ .NewEmail }}. '
                 'Confirm it for the change to take effect. Until then we keep using '
                 'the previous one.'),
        boton=t('Confirmar el cambio', 'Confirm the change'),
        nota=t('Si no confirmas, tu cuenta se queda con la dirección de siempre y no '
               'pasa nada más.',
               'If you do not confirm, your account keeps its usual address and nothing '
               'else happens.'),
        aviso=t('Si no pediste este cambio, ignora el mensaje y revisa quién tiene acceso '
                'a tu cuenta.',
                'If you did not request this change, ignore the message and check who has '
                'access to your account.'),
    ),

    'enlace-de-acceso.html': dict(
        asunto_oculto=t('Tu enlace para entrar en Viewifi.',
                        'Your link to sign in to Viewifi.'),
        titulo=t('Tu enlace de acceso', 'Your sign-in link'),
        cuerpo=t('Pulsa el botón para entrar en tu cuenta de Viewifi. No hace falta '
                 'contraseña: este enlace te identifica.',
                 'Press the button to sign in to your Viewifi account. No password '
                 'needed: this link identifies you.'),
        boton=t('Entrar en Viewifi', 'Sign in to Viewifi'),
        nota=t('El enlace caduca pasado un tiempo y solo sirve una vez. No lo reenvíes '
               'a nadie: quien lo tenga entra en tu cuenta.',
               'The link expires after a while and works only once. Do not forward it: '
               'whoever has it gets into your account.'),
        aviso=t('Si no pediste entrar, ignora este mensaje.',
                'If you did not ask to sign in, ignore this message.'),
    ),
}


if __name__ == '__main__':
    destino = os.path.dirname(os.path.abspath(__file__))
    for nombre, partes in CORREOS.items():
        ruta = os.path.join(destino, nombre)
        with open(ruta, 'w', encoding='utf-8') as f:
            f.write(plantilla(**partes))
        print(f'{nombre}: {os.path.getsize(ruta):,} bytes')
