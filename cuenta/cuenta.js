/* ============================================================================
   Viewifi — área de cliente
   ----------------------------------------------------------------------------
   Este archivo es público: cualquiera puede leerlo. No contiene ni un secreto.

   · La clave anon de Supabase está pensada para el navegador; lo que protege
     los datos son las políticas RLS de migraciones/006.
   · La llave PÚBLICA de Wompi también: sirve para tokenizar tarjetas y no
     permite mover dinero. La privada vive en los secretos de Supabase y no
     aparece aquí ni puede aparecer.

   Los datos de la tarjeta van del navegador a Wompi y a ningún otro sitio.
   Nuestras funciones solo reciben el token que Wompi devuelve.
   ============================================================================ */
(function () {
  'use strict';

  /* ========================== Configuración ========================== */

  var SUPABASE_URL = 'https://gawhrlqhwllpxnhnmksy.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdhd2hybHFod2xscHhuaG5ta3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NzA5NzAsImV4cCI6MjEwNDE0Njk3MH0.e39UdMPv8NyzPSUzB_KZEp3TQrQWo5BqpuMwrTJUf9s';
  var FUNCIONES = SUPABASE_URL + '/functions/v1/';

  // ---------------------------------------------------------------------------
  // WOMPI — rellena estas dos líneas antes de que nadie pueda pagar.
  //
  // La llave pública la encuentras en el panel de Wompi → Desarrolladores.
  // Tiene que ser del MISMO ambiente que el secreto WOMPI_AMBIENTE que
  // configuraste en Supabase, o el cobro fallará al llegar a la función:
  //   sandbox    → pub_test_…
  //   produccion → pub_prod_…
  // ---------------------------------------------------------------------------
  var WOMPI_AMBIENTE = 'sandbox';
  var WOMPI_LLAVE_PUBLICA = 'pub_test_PEGA_AQUI_TU_LLAVE_PUBLICA';

  var WOMPI_API = WOMPI_AMBIENTE === 'produccion'
    ? 'https://production.wompi.co/v1'
    : 'https://sandbox.wompi.co/v1';

  var PAGOS_VISIBLES = 20;

  /* ============================== Idioma ============================== */

  var isEN = (document.documentElement.lang || 'es').slice(0, 2) === 'en';
  var LOCALE = isEN ? 'en-US' : 'es-CO';

  var T = isEN ? {
    entrando: 'Signing in…',
    entrar: 'Sign in',
    creando: 'Creating…',
    crearCuenta: 'Create account',
    credenciales: 'Wrong email or password.',
    correoInvalido: 'Please enter a valid email address.',
    claveCorta: 'The password must be at least 8 characters.',
    claveDistinta: 'The two passwords do not match.',
    registroCerrado: 'New sign-ups are closed right now. Try again later.',
    correoEnUso: 'There is already an account with that email. Sign in instead.',
    revisaCorreo: 'Check your inbox: we sent you a link to confirm your address.',
    cuentaCreada: 'Account created. Welcome.',
    sinSesion: 'Your session expired. Please sign in again.',
    bloqueado: 'This account is blocked. Write to us and we will look into it.',

    planFree: 'Free',
    sinPlan: 'You are on the Free plan: one host, real-time detection and Telegram alerts.',
    estado: 'Status',
    proximoCobro: 'Next charge',
    servicioHasta: 'Service until',
    tarjeta: 'Card',
    importe: 'Amount',
    renovacion: 'Renewal',
    renovacionOn: 'Active',
    renovacionOff: 'Cancelled — it will not renew',
    sinTarjeta: 'None saved',

    activa: 'Active', pendiente: 'Pending', morosa: 'Past due',
    cancelada: 'Cancelled', expirada: 'Expired',

    APROBADO: 'Approved', PENDIENTE: 'Pending', RECHAZADO: 'Declined',
    ERROR: 'Error', ANULADO: 'Voided',

    fecha: 'Date', concepto: 'Concept', total: 'Total', estadoCol: 'Status',
    sinPagos: 'No charges yet.',

    tuPlan: 'Your plan',
    historial: 'Payment history',
    contratar: 'Go Pro',
    contratarTitulo: 'Choose your plan',
    pagar: 'Pay and activate',
    pagando: 'Processing…',
    tokenizando: 'Checking the card…',
    alMes: 'per month', alAnio: 'per year',

    titular: 'Cardholder name',
    numero: 'Card number',
    vence: 'Expires',
    cuotas: 'Instalments',
    unaCuota: '1 instalment',
    nCuotas: ' instalments',
    aceptoLos: 'I accept the ',
    terminos: 'terms of service',
    yEl: ' and the ',
    datos: 'personal data policy',
    aceptaTerminos: 'You have to accept the terms to continue.',
    titularCorto: 'Write the cardholder name as it appears on the card.',
    numeroInvalido: 'That card number does not look right.',
    vencimientoInvalido: 'Check the expiry date.',
    cvcInvalido: 'The security code has 3 or 4 digits.',
    tarjetaRechazadaRed: 'We could not reach the payment gateway. Try again in a moment.',
    pagoSeguro: 'Your card details go straight to Wompi. They never touch our servers.',

    cancelar: 'Cancel subscription',
    cancelando: 'Cancelling…',
    confirmarCancelar: 'You will keep the service until the end of the period you already paid for. Only the renewal is switched off.',
    siCancelar: 'Yes, cancel',
    noCancelar: 'Keep it',
    canceladaOk: 'Renewal switched off.',

    todoGratis: 'Everything is free right now — nothing to pay for.',
    sinPlanesAun: 'Paid plans are not open yet. We will let you know when they are.',
    salir: 'Sign out',
    actualizar: 'Refresh',
    sinLlaveWompi: 'Payments are not set up yet on this site. The public Wompi key is missing from /cuenta/cuenta.js.',
    sinCdn: 'The Supabase library could not load. Check your connection or whether a browser extension is blocking it.',
    errorGenerico: 'Something went wrong. Try again in a moment.'
  } : {
    entrando: 'Entrando…',
    entrar: 'Entrar',
    creando: 'Creando…',
    crearCuenta: 'Crear cuenta',
    credenciales: 'Correo o contraseña incorrectos.',
    correoInvalido: 'Escribe un correo electrónico válido.',
    claveCorta: 'La contraseña tiene que tener 8 caracteres o más.',
    claveDistinta: 'Las dos contraseñas no coinciden.',
    registroCerrado: 'El registro está cerrado ahora mismo. Inténtalo más tarde.',
    correoEnUso: 'Ya hay una cuenta con ese correo. Entra en lugar de registrarte.',
    revisaCorreo: 'Revisa tu correo: te mandamos un enlace para confirmar la dirección.',
    cuentaCreada: 'Cuenta creada. Bienvenido.',
    sinSesion: 'Tu sesión caducó. Vuelve a entrar.',
    bloqueado: 'Esta cuenta está bloqueada. Escríbenos y lo miramos.',

    planFree: 'Free',
    sinPlan: 'Estás en el plan Free: un host, detección en tiempo real y alertas por Telegram.',
    estado: 'Estado',
    proximoCobro: 'Próximo cobro',
    servicioHasta: 'Servicio hasta',
    tarjeta: 'Tarjeta',
    importe: 'Importe',
    renovacion: 'Renovación',
    renovacionOn: 'Activa',
    renovacionOff: 'Cancelada — no se renovará',
    sinTarjeta: 'Ninguna guardada',

    activa: 'Activa', pendiente: 'Pendiente', morosa: 'En mora',
    cancelada: 'Cancelada', expirada: 'Expirada',

    APROBADO: 'Aprobado', PENDIENTE: 'Pendiente', RECHAZADO: 'Rechazado',
    ERROR: 'Error', ANULADO: 'Anulado',

    fecha: 'Fecha', concepto: 'Concepto', total: 'Total', estadoCol: 'Estado',
    sinPagos: 'Todavía no hay cobros.',

    tuPlan: 'Tu plan',
    historial: 'Historial de pagos',
    contratar: 'Pasar a Pro',
    contratarTitulo: 'Elige tu plan',
    pagar: 'Pagar y activar',
    pagando: 'Procesando…',
    tokenizando: 'Comprobando la tarjeta…',
    alMes: 'al mes', alAnio: 'al año',

    titular: 'Titular de la tarjeta',
    numero: 'Número de la tarjeta',
    vence: 'Vence',
    cuotas: 'Cuotas',
    unaCuota: '1 cuota',
    nCuotas: ' cuotas',
    aceptoLos: 'Acepto los ',
    terminos: 'términos del servicio',
    yEl: ' y el ',
    datos: 'tratamiento de datos personales',
    aceptaTerminos: 'Tienes que aceptar los términos para continuar.',
    titularCorto: 'Escribe el titular tal y como aparece en la tarjeta.',
    numeroInvalido: 'Ese número de tarjeta no parece correcto.',
    vencimientoInvalido: 'Revisa la fecha de vencimiento.',
    cvcInvalido: 'El código de seguridad tiene 3 o 4 dígitos.',
    tarjetaRechazadaRed: 'No pudimos conectar con la pasarela. Inténtalo en un momento.',
    pagoSeguro: 'Los datos de tu tarjeta van directos a Wompi. No pasan por nuestros servidores.',

    cancelar: 'Cancelar suscripción',
    cancelando: 'Cancelando…',
    confirmarCancelar: 'Conservas el servicio hasta el final del periodo que ya pagaste. Solo se apaga la renovación.',
    siCancelar: 'Sí, cancelar',
    noCancelar: 'Mantenerla',
    canceladaOk: 'Renovación apagada.',

    todoGratis: 'Ahora mismo todo es gratis: no hay nada que pagar.',
    sinPlanesAun: 'Los planes de pago todavía no están abiertos. Te avisamos cuando lo estén.',
    salir: 'Salir',
    actualizar: 'Actualizar',
    sinLlaveWompi: 'Los pagos todavía no están configurados en este sitio. Falta la llave pública de Wompi en /cuenta/cuenta.js.',
    sinCdn: 'No se pudo cargar la librería de Supabase. Revisa tu conexión o si alguna extensión del navegador la está bloqueando.',
    errorGenerico: 'Algo salió mal. Inténtalo en un momento.'
  };

  /* Mensajes de las Edge Functions traducidos por su código estable. En
     español devolvemos el texto del servidor, que ya viene redactado. */
  var CODIGOS_EN = {
    SIN_SESION: 'Sign in to subscribe.',
    SIN_PERFIL: 'Your account is not ready yet. Sign in again.',
    BLOQUEADO: 'Your account is blocked.',
    ACCESO_CERRADO: 'The service is under maintenance.',
    TERMINOS: 'You have to accept the terms and the data policy.',
    DATOS: 'The plan or the card token is missing.',
    PLAN: 'That plan does not exist or is no longer available.',
    PLAN_GRATIS: 'The free plan is not charged.',
    PLAN_SIN_PRECIO: 'That plan has no valid price.',
    YA_SUSCRITO: 'You already have an active subscription.',
    TARJETA: 'We could not save your card. Check the details or try another one.',
    FUENTE_NO_DISPONIBLE: 'The bank did not authorise saving that card.',
    COBRO_RECHAZADO: 'Your bank declined the payment. Try another card.',
    COBRO_ERROR: 'We could not process the payment. You have not been charged.',
    SIN_SUSCRIPCION: 'There is no active subscription.',
    SIN_PERMISO: 'You cannot cancel someone else’s subscription.',
    PAGOS_DESACTIVADOS: 'Viewifi is free right now: there is no plan to subscribe to.',
    CONFIG: 'The payment gateway is not configured.',
    BD: 'We could not complete the operation. You have not been charged.'
  };

  /* ============================== Utilidades ============================== */

  var $ = function (s, r) { return (r || document).querySelector(s); };

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pesos(centavos) {
    if (centavos === null || centavos === undefined) return '—';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency: 'COP', maximumFractionDigits: 0
    }).format(centavos / 100);
  }

  function dolares(centavos) {
    if (!centavos) return '';
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: 2
    }).format(centavos / 100);
  }

  function fecha(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat(LOCALE, {
      day: '2-digit', month: 'short', year: 'numeric'
    }).format(d);
  }

  function periodoCorto(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat(LOCALE, { month: 'short', year: 'numeric' }).format(d);
  }

  function mostrar(id) {
    var todas = document.querySelectorAll('.pantalla');
    for (var i = 0; i < todas.length; i++) todas[i].classList.remove('visible');
    var el = document.getElementById(id);
    if (el) el.classList.add('visible');
    // El botón de salir solo tiene sentido con la sesión abierta.
    var salir = document.getElementById('btn-salir');
    if (salir) salir.hidden = id !== 'pantalla-cuenta';
  }

  function aviso(el, texto, tipo) {
    if (!el) return;
    if (!texto) { el.hidden = true; el.textContent = ''; return; }
    el.className = 'aviso-caja aviso-' + (tipo || 'error');
    el.textContent = texto;
    el.hidden = false;
  }

  function correoValido(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  }

  /** Luhn. No sustituye a la validación de Wompi: solo evita una llamada de
   *  red por un dígito mal tecleado, que es el error más común. */
  function luhn(num) {
    var suma = 0, alterna = false;
    for (var i = num.length - 1; i >= 0; i--) {
      var d = parseInt(num.charAt(i), 10);
      if (isNaN(d)) return false;
      if (alterna) { d *= 2; if (d > 9) d -= 9; }
      suma += d;
      alterna = !alterna;
    }
    return suma % 10 === 0;
  }

  /* ========================= Arranque y sesión ========================= */

  if (!window.supabase || !window.supabase.createClient) {
    document.addEventListener('DOMContentLoaded', function () {
      mostrar('pantalla-acceso');
      aviso($('#acceso-aviso'), T.sinCdn, 'error');
    });
    return;
  }

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  var yo = null;
  var estado = { perfil: null, suscripcion: null, pagos: [], planes: [], pagosActivos: false };

  function invocar(nombre, cuerpo) {
    return sb.auth.getSession().then(function (r) {
      var token = r.data.session ? r.data.session.access_token : '';
      return fetch(FUNCIONES + nombre, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
          'apikey': SUPABASE_ANON_KEY
        },
        body: JSON.stringify(cuerpo || {})
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok || j.ok === false) {
          var texto = (isEN && j.codigo && CODIGOS_EN[j.codigo])
            ? CODIGOS_EN[j.codigo]
            : (j.mensaje || T.errorGenerico);
          var err = new Error(texto);
          err.codigo = j.codigo || '';
          throw err;
        }
        return j;
      });
    });
  }

  /* ============================== Acceso ============================== */

  function tabAcceso(cual) {
    var esEntrar = cual === 'entrar';
    $('#tab-entrar').setAttribute('aria-selected', String(esEntrar));
    $('#tab-registro').setAttribute('aria-selected', String(!esEntrar));
    $('#form-entrar').hidden = !esEntrar;
    $('#form-registro').hidden = esEntrar;
    aviso($('#acceso-aviso'), '');
  }

  function traducirErrorAuth(e) {
    var m = (e && e.message) || '';
    if (/REGISTRO_CERRADO|registro de nuevos usuarios/i.test(m)) return T.registroCerrado;
    if (/already registered|already been registered|user already exists/i.test(m)) return T.correoEnUso;
    if (/invalid login|invalid credentials|invalid email or password/i.test(m)) return T.credenciales;
    if (/password should be at least/i.test(m)) return T.claveCorta;
    return m || T.errorGenerico;
  }

  function conectarAcceso() {
    $('#tab-entrar').addEventListener('click', function () { tabAcceso('entrar'); });
    $('#tab-registro').addEventListener('click', function () { tabAcceso('registro'); });

    $('#form-entrar').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('#btn-entrar');
      var caja = $('#acceso-aviso');
      var correo = $('#entrar-correo').value.trim();
      aviso(caja, '');

      if (!correoValido(correo)) { aviso(caja, T.correoInvalido); return; }

      btn.disabled = true; btn.textContent = T.entrando;
      sb.auth.signInWithPassword({ email: correo, password: $('#entrar-clave').value })
        .then(function (r) {
          if (r.error) throw r.error;
          return cargarCuenta();
        })
        .catch(function (e2) { aviso(caja, traducirErrorAuth(e2)); })
        .then(function () { btn.disabled = false; btn.textContent = T.entrar; });
    });

    $('#form-registro').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('#btn-registro');
      var caja = $('#acceso-aviso');
      var correo = $('#registro-correo').value.trim();
      var clave = $('#registro-clave').value;
      aviso(caja, '');

      if (!correoValido(correo)) { aviso(caja, T.correoInvalido); return; }
      if (clave.length < 8) { aviso(caja, T.claveCorta); return; }
      if (clave !== $('#registro-clave2').value) { aviso(caja, T.claveDistinta); return; }

      btn.disabled = true; btn.textContent = T.creando;
      sb.auth.signUp({
        email: correo,
        password: clave,
        options: {
          data: {
            nombre: $('#registro-nombre').value.trim(),
            locale: isEN ? 'en' : 'es'
          }
        }
      }).then(function (r) {
        if (r.error) throw r.error;
        // Con la confirmación por correo activada no hay sesión todavía.
        if (!r.data.session) { aviso(caja, T.revisaCorreo, 'ok'); return null; }
        return cargarCuenta();
      }).catch(function (e2) {
        aviso(caja, traducirErrorAuth(e2));
      }).then(function () {
        btn.disabled = false; btn.textContent = T.crearCuenta;
      });
    });
  }

  /* =========================== Cargar la cuenta =========================== */

  function cargarCuenta() {
    return sb.auth.getUser().then(function (r) {
      if (!r.data || !r.data.user) throw new Error('SIN_SESION');
      yo = r.data.user;

      return Promise.all([
        sb.from('perfiles').select('id, email, nombre, bloqueado, locale')
          .eq('id', yo.id).maybeSingle(),
        sb.from('suscripciones')
          .select('id, estado, periodo_inicio, periodo_fin, proximo_cobro_en, cancelar_al_final,' +
                  ' cancelada_en, tarjeta_marca, tarjeta_ultimos4, tarjeta_vence, cuotas,' +
                  ' planes ( codigo, nombre_es, nombre_en, intervalo, precio_cop_centavos, precio_usd_centavos )')
          .eq('usuario_id', yo.id).order('creado_en', { ascending: false }).limit(1).maybeSingle(),
        sb.from('pagos')
          .select('id, estado, monto_centavos, moneda, creado_en, periodo_inicio, periodo_fin, intento')
          .eq('usuario_id', yo.id).order('creado_en', { ascending: false }).limit(PAGOS_VISIBLES),
        sb.from('planes')
          .select('codigo, nombre_es, nombre_en, descripcion_es, descripcion_en, intervalo,' +
                  ' precio_cop_centavos, precio_usd_centavos, orden')
          .neq('intervalo', 'ninguno').order('orden', { ascending: true }),
        // Interruptor maestro de cobros. Sale por la vista ajustes_publicos,
        // que solo expone las claves marcadas como públicas.
        sb.from('ajustes_publicos').select('valor').eq('clave', 'pagos_activos').maybeSingle()
      ]);
    }).then(function (res) {
      estado.perfil = res[0].data || { email: yo.email };
      estado.suscripcion = res[1].data || null;
      estado.pagos = res[2].data || [];
      estado.planes = res[3].data || [];
      estado.pagosActivos = (res[4] && res[4].data && res[4].data.valor) === true;

      if (estado.perfil && estado.perfil.bloqueado) {
        mostrar('pantalla-acceso');
        aviso($('#acceso-aviso'), T.bloqueado);
        return sb.auth.signOut();
      }

      pintarCuenta();
      mostrar('pantalla-cuenta');
    }).catch(function (e) {
      mostrar('pantalla-acceso');
      if (/SIN_SESION/.test(e.message || '')) aviso($('#acceso-aviso'), T.sinSesion, 'info');
      else aviso($('#acceso-aviso'), e.message || T.errorGenerico);
    });
  }

  function nombrePlan(plan) {
    if (!plan) return T.planFree;
    return isEN ? (plan.nombre_en || plan.nombre_es) : (plan.nombre_es || plan.nombre_en);
  }

  function descPlan(plan) {
    if (!plan) return '';
    return isEN ? (plan.descripcion_en || '') : (plan.descripcion_es || '');
  }

  function periodoTexto(plan) {
    if (!plan) return '';
    return plan.intervalo === 'anio' ? T.alAnio : T.alMes;
  }

  function viva(s) {
    return s && (s.estado === 'activa' || s.estado === 'pendiente' || s.estado === 'morosa');
  }

  /* ============================== Pintado ============================== */

  function pintarCuenta() {
    $('#cuenta-correo').textContent = (estado.perfil && estado.perfil.email) || yo.email || '';

    pintarPlan();
    pintarPagos();
    pintarContratar();
  }

  function pintarPlan() {
    var s = estado.suscripcion;
    var caja = $('#ficha-plan');

    if (!viva(s)) {
      var accion = estado.pagosActivos
        ? '<div class="acciones">' +
            '<button class="btn btn-filled" type="button" id="btn-ir-contratar">' + esc(T.contratar) + '</button>' +
          '</div>'
        : '<p class="aviso-caja aviso-info">' + esc(T.todoGratis) + ' ' + esc(T.sinPlanesAun) + '</p>';

      caja.innerHTML =
        '<h2>' + esc(T.tuPlan) + '</h2>' +
        '<p class="vacio">' + esc(T.sinPlan) + '</p>' +
        accion;

      var ir = $('#btn-ir-contratar');
      if (ir) ir.addEventListener('click', function () {
        $('#bloque-contratar').hidden = false;
        $('#bloque-contratar').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return;
    }

    var plan = s.planes || null;
    var filas = '';

    filas += '<div class="dato"><dt>' + esc(T.estado) + '</dt><dd>' +
      '<span class="insignia insignia-' + esc(s.estado) + '">' + esc(T[s.estado] || s.estado) + '</span>' +
      '</dd></div>';

    if (s.cancelar_al_final) {
      filas += '<div class="dato"><dt>' + esc(T.renovacion) + '</dt><dd>' + esc(T.renovacionOff) + '</dd></div>';
      filas += '<div class="dato"><dt>' + esc(T.servicioHasta) + '</dt><dd>' + esc(fecha(s.periodo_fin)) + '</dd></div>';
    } else {
      filas += '<div class="dato"><dt>' + esc(T.renovacion) + '</dt><dd>' + esc(T.renovacionOn) + '</dd></div>';
      filas += '<div class="dato"><dt>' + esc(T.proximoCobro) + '</dt><dd>' + esc(fecha(s.proximo_cobro_en || s.periodo_fin)) + '</dd></div>';
    }

    if (plan && plan.precio_cop_centavos) {
      filas += '<div class="dato"><dt>' + esc(T.importe) + '</dt><dd>' +
        esc(pesos(plan.precio_cop_centavos)) + ' <span class="dato-nota">' + esc(periodoTexto(plan)) + '</span>' +
        '</dd></div>';
    }

    var tarjeta = s.tarjeta_ultimos4
      ? esc((s.tarjeta_marca || '').toUpperCase()) +
        ' <span class="tarjeta-puntos">••••</span> ' + esc(s.tarjeta_ultimos4)
      : esc(T.sinTarjeta);
    filas += '<div class="dato"><dt>' + esc(T.tarjeta) + '</dt><dd><span class="tarjeta-guardada">' + tarjeta + '</span></dd></div>';

    var acciones = '';
    if (!s.cancelar_al_final) {
      acciones =
        '<div class="acciones">' +
          '<button class="btn btn-outline btn-sm" type="button" id="btn-cancelar">' + esc(T.cancelar) + '</button>' +
        '</div>' +
        '<div class="confirmar" id="confirmar-cancelar" hidden>' +
          '<p>' + esc(T.confirmarCancelar) + '</p>' +
          '<div class="confirmar-botones">' +
            '<button class="btn btn-filled btn-sm" type="button" id="btn-cancelar-si">' + esc(T.siCancelar) + '</button>' +
            '<button class="btn btn-outline btn-sm" type="button" id="btn-cancelar-no">' + esc(T.noCancelar) + '</button>' +
          '</div>' +
        '</div>';
    }

    caja.innerHTML =
      '<h2>' + esc(T.tuPlan) + '</h2>' +
      '<p class="ficha-sub">' + esc(nombrePlan(plan)) + '</p>' +
      '<dl>' + filas + '</dl>' +
      '<p class="aviso-caja aviso-ok" id="plan-aviso" hidden></p>' +
      acciones;

    var btnCancelar = $('#btn-cancelar');
    if (btnCancelar) {
      btnCancelar.addEventListener('click', function () {
        $('#confirmar-cancelar').hidden = false;
      });
      $('#btn-cancelar-no').addEventListener('click', function () {
        $('#confirmar-cancelar').hidden = true;
      });
      $('#btn-cancelar-si').addEventListener('click', function () {
        var b = $('#btn-cancelar-si');
        b.disabled = true; b.textContent = T.cancelando;
        invocar('cancelar-suscripcion', { motivo: 'Cancelada por el usuario desde la web' })
          .then(function () { return cargarCuenta(); })
          .then(function () {
            var av = $('#plan-aviso');
            if (av) { av.textContent = T.canceladaOk; av.hidden = false; }
          })
          .catch(function (e) {
            var av = $('#plan-aviso');
            if (av) { av.className = 'aviso-caja aviso-error'; av.textContent = e.message; av.hidden = false; }
            b.disabled = false; b.textContent = T.siCancelar;
          });
      });
    }
  }

  function pintarPagos() {
    var caja = $('#ficha-pagos');
    if (!estado.pagos.length) {
      caja.innerHTML = '<h2>' + esc(T.historial) + '</h2><p class="vacio">' + esc(T.sinPagos) + '</p>';
      return;
    }

    var filas = estado.pagos.map(function (p) {
      // El periodo completo no cabe junto al importe en una tarjeta estrecha, y
      // el importe es lo que la gente viene a mirar. El rango entero queda en
      // el title, a un palmo del ratón.
      var concepto = p.periodo_inicio ? periodoCorto(p.periodo_inicio) : '—';
      if (p.intento > 1) concepto += ' (' + p.intento + ')';
      var completo = p.periodo_inicio ? fecha(p.periodo_inicio) + ' → ' + fecha(p.periodo_fin) : '';
      return '<tr>' +
        '<td>' + esc(fecha(p.creado_en)) + '</td>' +
        '<td title="' + esc(completo) + '">' + esc(concepto) + '</td>' +
        '<td class="num">' + esc(pesos(p.monto_centavos)) + '</td>' +
        '<td>' + esc(T[p.estado] || p.estado) + '</td>' +
        '</tr>';
    }).join('');

    caja.innerHTML =
      '<h2>' + esc(T.historial) + '</h2>' +
      '<div class="tabla-scroll"><table class="tabla-pagos">' +
        '<thead><tr>' +
          '<th>' + esc(T.fecha) + '</th>' +
          '<th>' + esc(T.concepto) + '</th>' +
          '<th class="num">' + esc(T.total) + '</th>' +
          '<th>' + esc(T.estadoCol) + '</th>' +
        '</tr></thead>' +
        '<tbody>' + filas + '</tbody>' +
      '</table></div>';
  }

  /* ============================= Contratar ============================= */

  function pintarContratar() {
    var bloque = $('#bloque-contratar');
    var lista = $('#planes-elegir');

    // Cobros apagados desde el panel: no hay nada que contratar. El servidor
    // lo rechaza igual, esto solo evita enseñar un formulario que no sirve.
    if (!estado.pagosActivos) { bloque.hidden = true; return; }

    // Con una suscripción viva no se puede abrir otra: la función lo rechaza
    // con YA_SUSCRITO, así que ni siquiera enseñamos el formulario.
    if (viva(estado.suscripcion)) { bloque.hidden = true; return; }

    if (!estado.planes.length) { bloque.hidden = true; return; }

    lista.innerHTML = estado.planes.map(function (p, i) {
      var precio = pesos(p.precio_cop_centavos) + ' ' + periodoTexto(p);
      var usd = dolares(p.precio_usd_centavos);
      return '<label class="plan-opcion">' +
        '<input type="radio" name="plan" value="' + esc(p.codigo) + '"' + (i === 0 ? ' checked' : '') + ' />' +
        '<span>' +
          '<span class="plan-opcion-nombre">' + esc(nombrePlan(p)) + '</span>' +
          '<span class="plan-opcion-precio">' + esc(precio) + (usd ? ' <span class="dato-nota">(' + esc(usd) + ')</span>' : '') + '</span>' +
          '<span class="plan-opcion-desc">' + esc(descPlan(p)) + '</span>' +
        '</span>' +
      '</label>';
    }).join('');

    bloque.hidden = false;
  }

  function tokenizarTarjeta(datos) {
    return fetch(WOMPI_API + '/tokens/cards', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + WOMPI_LLAVE_PUBLICA
      },
      body: JSON.stringify(datos)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok || !j.data || !j.data.id) {
          var motivo = (j.error && (j.error.reason || j.error.type)) || '';
          var err = new Error(motivo ? String(motivo) : T.numeroInvalido);
          throw err;
        }
        return j.data.id;
      });
    }, function () {
      throw new Error(T.tarjetaRechazadaRed);
    });
  }

  function conectarContratar() {
    $('#form-tarjeta').addEventListener('submit', function (e) {
      e.preventDefault();

      var caja = $('#contratar-aviso');
      var btn = $('#btn-pagar');
      aviso(caja, '');

      if (WOMPI_LLAVE_PUBLICA.indexOf('PEGA_AQUI') !== -1) {
        aviso(caja, T.sinLlaveWompi); return;
      }

      var plan = document.querySelector('input[name="plan"]:checked');
      if (!plan) return;

      var titular = $('#tar-titular').value.trim();
      var numero = $('#tar-numero').value.replace(/[\s-]/g, '');
      var mes = $('#tar-mes').value.trim();
      var anio = $('#tar-anio').value.trim();
      var cvc = $('#tar-cvc').value.trim();

      if (titular.length < 5) { aviso(caja, T.titularCorto); return; }
      if (!/^[0-9]{12,19}$/.test(numero) || !luhn(numero)) { aviso(caja, T.numeroInvalido); return; }
      if (!/^(0[1-9]|1[0-2])$/.test(mes) || !/^[0-9]{2}$/.test(anio)) { aviso(caja, T.vencimientoInvalido); return; }
      if (!/^[0-9]{3,4}$/.test(cvc)) { aviso(caja, T.cvcInvalido); return; }
      if (!$('#tar-terminos').checked) { aviso(caja, T.aceptaTerminos); return; }

      btn.disabled = true; btn.textContent = T.tokenizando;

      tokenizarTarjeta({
        number: numero,
        cvc: cvc,
        exp_month: mes,
        exp_year: anio,
        card_holder: titular
      }).then(function (token) {
        btn.textContent = T.pagando;
        return invocar('crear-suscripcion', {
          plan_codigo: plan.value,
          token_tarjeta: token,
          cuotas: parseInt($('#tar-cuotas').value, 10) || 1,
          acepta_terminos: true
        });
      }).then(function (r) {
        // En cuanto el token se ha usado, los campos de la tarjeta sobran.
        $('#form-tarjeta').reset();
        aviso(caja, r.mensaje || '', 'ok');
        return cargarCuenta();
      }).catch(function (e2) {
        aviso(caja, e2.message || T.errorGenerico);
      }).then(function () {
        btn.disabled = false; btn.textContent = T.pagar;
      });
    });

    // Agrupa el número en bloques de cuatro mientras se teclea. Solo estética:
    // los espacios se quitan antes de enviarlo.
    $('#tar-numero').addEventListener('input', function () {
      var limpio = this.value.replace(/[^\d]/g, '').slice(0, 19);
      this.value = limpio.replace(/(.{4})/g, '$1 ').trim();
    });
  }

  /* ============================== Arranque ============================== */

  document.addEventListener('DOMContentLoaded', function () {
    conectarAcceso();
    conectarContratar();

    $('#btn-salir').addEventListener('click', function () {
      sb.auth.signOut().then(function () { location.reload(); });
    });
    $('#btn-actualizar').addEventListener('click', function () { cargarCuenta(); });

    sb.auth.getSession().then(function (r) {
      if (r.data && r.data.session) return cargarCuenta();
      mostrar('pantalla-acceso');
    });
  });
})();
