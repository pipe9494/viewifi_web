/* ============================================================================
   Panel de administración de Viewifi
   ----------------------------------------------------------------------------
   Este archivo es público: cualquiera puede leerlo. No contiene ni un secreto.
   La clave anon de abajo está pensada para ir en el navegador; lo que impide
   que un curioso lea o toque nada son las políticas RLS de migraciones/006.
   Si borras esas políticas, este panel se convierte en un agujero.

   Crear y borrar cuentas sí necesita privilegios que no pueden vivir aquí: eso
   pasa por la Edge Function admin-usuarios.
   ============================================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://gawhrlqhwllpxnhnmksy.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdhd2hybHFod2xscHhuaG5ta3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NzA5NzAsImV4cCI6MjEwNDE0Njk3MH0.e39UdMPv8NyzPSUzB_KZEp3TQrQWo5BqpuMwrTJUf9s';
  var FUNCIONES = SUPABASE_URL + '/functions/v1/';
  var POR_PAGINA = 25;

  // Si el CDN está caído o bloqueado por una extensión, es mejor decirlo que
  // dejar una pantalla de acceso que no responde al pulsar Entrar.
  if (!window.supabase || !window.supabase.createClient) {
    document.addEventListener('DOMContentLoaded', function () {
      var e = document.getElementById('login-error');
      if (e) {
        e.textContent = 'No se pudo cargar la librería de Supabase desde el CDN. ' +
          'Revisa tu conexión o si alguna extensión del navegador la está bloqueando.';
        e.hidden = false;
      }
    });
    return;
  }

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  var yo = null;
  var estado = { usuarios: [], pagina: 0, total: 0, planes: [], ajustes: {} };

  // ---------------------------------------------------------------- utilidades

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /** Escapa SIEMPRE lo que venga de la base de datos antes de meterlo en el
   *  DOM. Un nombre de usuario con <script> dentro no debe ejecutarse en el
   *  panel del administrador, que es justo la sesión más valiosa que hay. */
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
    if (!centavos) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(centavos / 100);
  }

  function fecha(iso, conHora) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    var o = { year: 'numeric', month: 'short', day: '2-digit' };
    if (conHora) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return d.toLocaleDateString('es-CO', o);
  }

  function toast(mensaje, tipo) {
    var d = document.createElement('div');
    d.className = 'toast ' + (tipo || '');
    d.textContent = mensaje;
    $('#avisos').appendChild(d);
    setTimeout(function () {
      d.style.opacity = '0';
      d.style.transition = 'opacity .25s';
      setTimeout(function () { d.remove(); }, 260);
    }, tipo === 'mal' ? 6500 : 3200);
  }

  /** Llama a una Edge Function con la sesión del administrador. */
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
        body: JSON.stringify(cuerpo)
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok || j.ok === false) throw new Error(j.mensaje || ('Error ' + res.status));
        return j;
      });
    });
  }

  // -------------------------------------------------------------------- acceso

  $('#form-login').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('#btn-login');
    var err = $('#login-error');
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Entrando…';

    sb.auth.signInWithPassword({
      email: $('#login-email').value.trim(),
      password: $('#login-clave').value
    }).then(function (r) {
      if (r.error) throw r.error;
      return comprobarAdmin();
    }).catch(function (e2) {
      // Mensaje deliberadamente vago: decir "esa cuenta no es admin" le
      // confirmaría a un desconocido que el correo existe.
      err.textContent = /invalid|credentials/i.test(e2.message || '')
        ? 'Correo o contraseña incorrectos.'
        : (e2.message || 'No se pudo entrar.');
      err.hidden = false;
      sb.auth.signOut();
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = 'Entrar';
    });
  });

  $('#btn-salir').addEventListener('click', function () {
    sb.auth.signOut().then(function () { location.reload(); });
  });

  function comprobarAdmin() {
    return sb.auth.getUser().then(function (r) {
      if (!r.data || !r.data.user) throw new Error('Sin sesión.');
      return sb.from('perfiles')
        .select('id, email, nombre, rol, bloqueado')
        .eq('id', r.data.user.id).maybeSingle();
    }).then(function (r) {
      if (r.error) throw r.error;
      if (!r.data || r.data.rol !== 'admin' || r.data.bloqueado) {
        throw new Error('Esta cuenta no tiene permisos de administrador.');
      }
      yo = r.data;
      $('#pantalla-login').hidden = true;
      $('#pantalla-panel').hidden = false;
      $('#quien-soy').textContent = yo.email;
      return cargarTodo();
    });
  }

  // --------------------------------------------------------------------- tabs

  $('#tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.tab');
    if (!b) return;
    $$('.tab').forEach(function (t) { t.classList.toggle('activo', t === b); });
    $$('.panel').forEach(function (p) {
      p.classList.toggle('activo', p.id === 'panel-' + b.dataset.panel);
    });
    if (b.dataset.panel === 'registro') cargarRegistro();
  });

  function cargarTodo() {
    return Promise.all([cargarResumen(), cargarPlanes(), cargarUsuarios(), cargarAnuncios(), cargarAjustes()])
      .catch(function (e) { toast('No se pudo cargar: ' + e.message, 'mal'); });
  }

  // ------------------------------------------------------------------ resumen

  function cargarResumen() {
    var inicioMes = new Date();
    inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);

    return Promise.all([
      sb.from('perfiles').select('id', { count: 'exact', head: true }),
      sb.from('suscripciones').select('id', { count: 'exact', head: true }).eq('estado', 'activa'),
      sb.from('suscripciones').select('id', { count: 'exact', head: true }).eq('estado', 'morosa'),
      sb.from('pagos').select('monto_centavos').eq('estado', 'APROBADO').gte('creado_en', inicioMes.toISOString()),
      sb.from('pagos').select('id', { count: 'exact', head: true }).eq('estado', 'PENDIENTE'),
      sb.from('pagos').select('id, referencia, estado, monto_centavos, creado_en, usuario_id, perfiles(email)')
        .order('creado_en', { ascending: false }).limit(12)
    ]).then(function (r) {
      var ingresos = (r[3].data || []).reduce(function (a, p) { return a + Number(p.monto_centavos || 0); }, 0);

      $('#metricas').innerHTML = [
        tarjeta(r[0].count || 0, 'Usuarios registrados', ''),
        tarjeta(r[1].count || 0, 'Suscripciones activas', 'verde'),
        tarjeta(r[2].count || 0, 'En mora (reintentando)', (r[2].count ? 'rojo' : '')),
        tarjeta(pesos(ingresos), 'Cobrado este mes', 'verde'),
        tarjeta(r[4].count || 0, 'Pagos sin resolver', (r[4].count ? 'rojo' : ''))
      ].join('');

      pintarTabla('#tabla-ultimos-pagos',
        ['Fecha', 'Usuario', 'Referencia', 'Importe', 'Estado'],
        (r[5].data || []).map(function (p) {
          return [
            fecha(p.creado_en, true),
            esc(p.perfiles ? p.perfiles.email : '—'),
            '<code>' + esc(p.referencia) + '</code>',
            pesos(p.monto_centavos),
            chipEstado(p.estado)
          ];
        }), 'Todavía no hay cobros.');
    });
  }

  function tarjeta(valor, etiqueta, clase) {
    return '<div class="metrica ' + clase + '"><div class="valor">' + esc(valor) +
      '</div><div class="etiqueta">' + esc(etiqueta) + '</div></div>';
  }

  function chipEstado(e) {
    var m = {
      APROBADO: 'ok', activa: 'ok',
      RECHAZADO: 'mal', ERROR: 'mal', morosa: 'mal', expirada: 'mal',
      PENDIENTE: 'espera', pendiente: 'espera',
      ANULADO: '', cancelada: ''
    };
    return '<span class="chip ' + (m[e] || '') + '">' + esc(e) + '</span>';
  }

  function pintarTabla(sel, cabeceras, filas, vacio) {
    var t = $(sel);
    if (!filas.length) {
      t.innerHTML = '<tbody><tr><td class="vacio">' + esc(vacio) + '</td></tr></tbody>';
      return;
    }
    t.innerHTML =
      '<thead><tr>' + cabeceras.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead>' +
      '<tbody>' + filas.map(function (f) {
        var attrs = f.attrs || '';
        var celdas = f.celdas || f;
        return '<tr ' + attrs + '>' + celdas.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody>';
  }

  // -------------------------------------------------------------------- planes

  function cargarPlanes() {
    return sb.from('planes').select('*').order('orden').then(function (r) {
      if (r.error) throw r.error;
      estado.planes = r.data || [];
      $('#lista-planes').innerHTML = estado.planes.map(function (p) {
        var dePago = p.intervalo !== 'ninguno';
        return '' +
          '<div class="plan-fila" data-id="' + esc(p.id) + '">' +
            '<div>' +
              '<div class="plan-nombre">' + esc(p.nombre_es) + '</div>' +
              '<div class="plan-codigo">' + esc(p.codigo) + ' · ' +
                esc(p.intervalo === 'mes' ? 'mensual' : p.intervalo === 'anio' ? 'anual' : 'gratuito') +
              '</div>' +
            '</div>' +
            (dePago
              ? '<div>' +
                  '<label>Precio COP (lo que se cobra)</label>' +
                  '<input type="number" min="0" step="100" class="pcop" value="' + (p.precio_cop_centavos / 100) + '" />' +
                  '<div class="equivale">' + pesos(p.precio_cop_centavos) + '</div>' +
                '</div>' +
                '<div>' +
                  '<label>Precio USD (solo se muestra)</label>' +
                  '<input type="number" min="0" step="0.01" class="pusd" value="' + (p.precio_usd_centavos / 100) + '" />' +
                  '<div class="equivale">' + dolares(p.precio_usd_centavos) + '</div>' +
                '</div>'
              : '<div class="equivale">Gratuito, no se cobra.</div><div></div>') +
            // El plan gratuito no tiene nada que guardar: un botón que no hace
            // nada al pulsarlo se lee como una avería.
            (dePago
              ? '<div><label>&nbsp;</label>' +
                  '<button class="btn btn-filled btn-sm guardar-plan">Guardar</button></div>'
              : '<div></div>') +
          '</div>';
      }).join('');
    });
  }

  $('#lista-planes').addEventListener('click', function (e) {
    var b = e.target.closest('.guardar-plan');
    if (!b) return;
    var fila = b.closest('.plan-fila');
    var cop = $('.pcop', fila), usd = $('.pusd', fila);
    if (!cop) return;

    var copCent = Math.round(parseFloat(cop.value || '0') * 100);
    var usdCent = Math.round(parseFloat(usd.value || '0') * 100);

    if (!(copCent > 0)) { toast('El precio en pesos tiene que ser mayor que cero.', 'mal'); return; }
    // Un precio absurdo suele ser un cero de más al teclear. Preguntar cuesta
    // menos que explicarle a un cliente por qué le cobraste diez veces.
    if (copCent > 100000000 && !confirm('Vas a poner ' + pesos(copCent) + ' por periodo. ¿Es correcto?')) return;

    b.disabled = true;
    sb.from('planes').update({ precio_cop_centavos: copCent, precio_usd_centavos: usdCent })
      .eq('id', fila.dataset.id)
      .then(function (r) {
        if (r.error) throw r.error;
        toast('Precio actualizado. Se aplica en la próxima renovación.', 'ok');
        return cargarPlanes();
      })
      .catch(function (err) { toast('No se pudo guardar: ' + err.message, 'mal'); })
      .finally(function () { b.disabled = false; });
  });

  // ------------------------------------------------------------------ usuarios

  function cargarUsuarios() {
    var q = sb.from('perfiles')
      .select('id, email, nombre, rol, bloqueado, locale, creado_en, ultimo_acceso_en', { count: 'exact' })
      .order('creado_en', { ascending: false })
      .range(estado.pagina * POR_PAGINA, estado.pagina * POR_PAGINA + POR_PAGINA - 1);

    var busca = $('#buscar-usuario').value.trim();
    if (busca) {
      var s = busca.replace(/[%,()]/g, '');
      q = q.or('email.ilike.%' + s + '%,nombre.ilike.%' + s + '%');
    }
    if ($('#filtro-estado').value === 'bloqueados') q = q.eq('bloqueado', true);
    if ($('#filtro-estado').value === 'activos') q = q.eq('bloqueado', false);

    return q.then(function (r) {
      if (r.error) throw r.error;
      estado.usuarios = r.data || [];
      estado.total = r.count || 0;
      var ids = estado.usuarios.map(function (u) { return u.id; });
      if (!ids.length) return { data: [] };
      return sb.from('suscripciones')
        .select('usuario_id, estado, periodo_fin, planes(codigo, nombre_es)')
        .in('usuario_id', ids).in('estado', ['pendiente', 'activa', 'morosa']);
    }).then(function (r) {
      var porUsuario = {};
      (r.data || []).forEach(function (s) { porUsuario[s.usuario_id] = s; });

      var filtroPlan = $('#filtro-plan').value;
      var filas = estado.usuarios.filter(function (u) {
        if (filtroPlan === 'pro') return !!porUsuario[u.id];
        if (filtroPlan === 'free') return !porUsuario[u.id];
        return true;
      }).map(function (u) {
        var s = porUsuario[u.id];
        return {
          attrs: 'data-id="' + esc(u.id) + '" style="cursor:pointer"',
          celdas: [
            esc(u.email) + (u.rol === 'admin' ? ' <span class="chip info">admin</span>' : ''),
            esc(u.nombre || '—'),
            s ? '<span class="chip ' + (s.estado === 'activa' ? 'ok' : 'mal') + '">' +
                esc(s.planes ? s.planes.nombre_es : 'Pro') + '</span>'
              : '<span class="chip">Free</span>',
            s ? chipEstado(s.estado) : '—',
            fecha(u.creado_en),
            u.bloqueado ? '<span class="chip mal">bloqueado</span>' : '<span class="chip ok">activo</span>'
          ]
        };
      });

      pintarTabla('#tabla-usuarios',
        ['Correo', 'Nombre', 'Plan', 'Suscripción', 'Alta', 'Acceso'],
        filas, 'No hay usuarios que coincidan.');

      var paginas = Math.max(1, Math.ceil(estado.total / POR_PAGINA));
      $('#paginacion-usuarios').innerHTML =
        '<button class="btn btn-outline btn-sm" id="pg-ant"' + (estado.pagina === 0 ? ' disabled' : '') + '>Anterior</button>' +
        '<span>Página ' + (estado.pagina + 1) + ' de ' + paginas + ' · ' + estado.total + ' usuarios</span>' +
        '<button class="btn btn-outline btn-sm" id="pg-sig"' + (estado.pagina + 1 >= paginas ? ' disabled' : '') + '>Siguiente</button>';
    });
  }

  var temporizador;
  ['#buscar-usuario', '#filtro-plan', '#filtro-estado'].forEach(function (sel) {
    $(sel).addEventListener('input', function () {
      clearTimeout(temporizador);
      temporizador = setTimeout(function () { estado.pagina = 0; cargarUsuarios(); }, 280);
    });
  });

  $('#paginacion-usuarios').addEventListener('click', function (e) {
    if (e.target.id === 'pg-ant') { estado.pagina--; cargarUsuarios(); }
    if (e.target.id === 'pg-sig') { estado.pagina++; cargarUsuarios(); }
  });

  $('#tabla-usuarios').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-id]');
    if (tr) abrirUsuario(tr.dataset.id);
  });

  function abrirUsuario(id) {
    Promise.all([
      sb.from('perfiles').select('*').eq('id', id).maybeSingle(),
      sb.from('suscripciones').select('*, planes(codigo, nombre_es, intervalo, precio_cop_centavos)')
        .eq('usuario_id', id).order('creado_en', { ascending: false }),
      sb.from('pagos').select('*').eq('usuario_id', id).order('creado_en', { ascending: false }).limit(50)
    ]).then(function (r) {
      var u = r[0].data;
      if (!u) throw new Error('Usuario no encontrado.');
      var subs = r[1].data || [];
      var pagos = r[2].data || [];
      var viva = subs.filter(function (s) {
        return ['pendiente', 'activa', 'morosa'].indexOf(s.estado) >= 0;
      })[0];

      var totalPagado = pagos.filter(function (p) { return p.estado === 'APROBADO'; })
        .reduce(function (a, p) { return a + Number(p.monto_centavos); }, 0);

      $('#dlg-usuario-titulo').textContent = u.email;
      $('#dlg-usuario-cuerpo').innerHTML = '' +
        '<dl class="datos">' +
          dato('Alta', fecha(u.creado_en, true)) +
          dato('Último acceso', fecha(u.ultimo_acceso_en, true)) +
          dato('Idioma', u.locale === 'en' ? 'Inglés' : 'Español') +
          dato('Total pagado', pesos(totalPagado)) +
        '</dl>' +

        '<label for="u-nombre">Nombre</label>' +
        '<input type="text" id="u-nombre" value="' + esc(u.nombre || '') + '" maxlength="120" />' +

        '<div class="rejilla-2">' +
          '<div><label for="u-rol">Rol</label><select id="u-rol">' +
            '<option value="usuario"' + (u.rol === 'usuario' ? ' selected' : '') + '>Usuario</option>' +
            '<option value="admin"' + (u.rol === 'admin' ? ' selected' : '') + '>Administrador</option>' +
          '</select></div>' +
          '<div><label for="u-bloqueado">Acceso</label><select id="u-bloqueado">' +
            '<option value="no"' + (!u.bloqueado ? ' selected' : '') + '>Permitido</option>' +
            '<option value="si"' + (u.bloqueado ? ' selected' : '') + '>Bloqueado</option>' +
          '</select></div>' +
        '</div>' +

        '<label for="u-notas">Notas internas</label>' +
        '<textarea id="u-notas" maxlength="2000">' + esc(u.notas_admin || '') + '</textarea>' +

        '<h3 style="margin-top:22px">Suscripción</h3>' +
        (viva
          ? '<dl class="datos">' +
              dato('Plan', esc(viva.planes ? viva.planes.nombre_es : '—')) +
              dato('Estado', chipEstado(viva.estado)) +
              dato('Periodo hasta', fecha(viva.periodo_fin)) +
              dato('Próximo cobro', fecha(viva.proximo_cobro_en)) +
              dato('Tarjeta', viva.tarjeta_marca
                ? esc(viva.tarjeta_marca) + ' ····' + esc(viva.tarjeta_ultimos4 || '') : '—') +
              dato('Intentos fallidos', String(viva.intentos_fallidos || 0)) +
            '</dl>' +
            (viva.ultimo_error ? '<p class="aviso">' + esc(viva.ultimo_error) + '</p>' : '') +
            '<button class="btn btn-outline btn-sm" id="btn-cancelar-sus" style="margin-top:12px">' +
              'Cancelar al final del periodo</button>'
          : '<p class="nota">Sin suscripción activa: está en el plan Free.</p>') +

        '<h3 style="margin-top:22px">Historial de compras</h3>' +
        (pagos.length
          ? '<div class="tabla-scroll"><table class="tabla"><thead><tr>' +
              '<th>Fecha</th><th>Referencia</th><th>Importe</th><th>Int.</th><th>Estado</th></tr></thead><tbody>' +
              pagos.map(function (p) {
                return '<tr><td>' + fecha(p.creado_en, true) + '</td>' +
                  '<td><code>' + esc(p.referencia) + '</code></td>' +
                  '<td>' + pesos(p.monto_centavos) + '</td>' +
                  '<td>' + esc(p.intento) + '</td>' +
                  '<td>' + chipEstado(p.estado) +
                    (p.mensaje_error ? '<br><small>' + esc(p.mensaje_error.slice(0, 90)) + '</small>' : '') +
                  '</td></tr>';
              }).join('') + '</tbody></table></div>'
          : '<p class="nota">Todavía no ha hecho ningún pago.</p>') +

        '<div class="peligro">' +
          '<label for="u-clave">Nueva contraseña (déjalo vacío para no cambiarla)</label>' +
          '<input type="password" id="u-clave" minlength="8" autocomplete="new-password" />' +
          '<button class="btn btn-sm btn-peligro" id="btn-borrar-usuario" style="margin-top:14px">' +
            'Eliminar cuenta</button>' +
          '<p class="pista">Una cuenta con cobros aprobados no se puede eliminar: su ' +
            'historial es contabilidad. Bloquéala en su lugar.</p>' +
        '</div>';

      $('#dlg-usuario').dataset.id = id;
      $('#dlg-usuario').showModal();
    }).catch(function (e) { toast(e.message, 'mal'); });
  }

  function dato(k, v) {
    return '<div class="dato"><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>';
  }

  $('#btn-guardar-usuario').addEventListener('click', function () {
    var id = $('#dlg-usuario').dataset.id;
    var clave = $('#u-clave') ? $('#u-clave').value : '';

    // No dejamos que el último administrador se quite el rol a sí mismo: el
    // panel quedaría inaccesible y habría que arreglarlo desde el SQL Editor.
    if (id === yo.id && $('#u-rol').value !== 'admin') {
      toast('No puedes quitarte a ti mismo el rol de administrador.', 'mal');
      return;
    }
    if (id === yo.id && $('#u-bloqueado').value === 'si') {
      toast('No puedes bloquear tu propia cuenta.', 'mal');
      return;
    }

    sb.from('perfiles').update({
      nombre: $('#u-nombre').value.trim() || null,
      rol: $('#u-rol').value,
      bloqueado: $('#u-bloqueado').value === 'si',
      notas_admin: $('#u-notas').value.trim() || null
    }).eq('id', id).then(function (r) {
      if (r.error) throw r.error;
      if (clave) return invocar('admin-usuarios', { accion: 'restablecer_clave', usuario_id: id, password: clave });
    }).then(function () {
      toast('Usuario actualizado.', 'ok');
      $('#dlg-usuario').close();
      return cargarUsuarios();
    }).catch(function (e) { toast('No se pudo guardar: ' + e.message, 'mal'); });
  });

  $('#dlg-usuario').addEventListener('click', function (e) {
    var id = $('#dlg-usuario').dataset.id;

    if (e.target.id === 'btn-borrar-usuario') {
      if (!confirm('Se eliminará la cuenta y todos sus datos. Esto no se puede deshacer.')) return;
      invocar('admin-usuarios', { accion: 'eliminar', usuario_id: id })
        .then(function () {
          toast('Cuenta eliminada.', 'ok');
          $('#dlg-usuario').close();
          return cargarUsuarios();
        })
        .catch(function (err) { toast(err.message, 'mal'); });
    }

    if (e.target.id === 'btn-cancelar-sus') {
      if (!confirm('La suscripción no se renovará. El usuario conserva Pro hasta el final del periodo ya pagado.')) return;
      invocar('cancelar-suscripcion', { usuario_id: id, motivo: 'Cancelada desde el panel' })
        .then(function (r) {
          toast(r.mensaje || 'Cancelada.', 'ok');
          $('#dlg-usuario').close();
          return cargarUsuarios();
        })
        .catch(function (err) { toast(err.message, 'mal'); });
    }
  });

  $('#btn-nuevo-usuario').addEventListener('click', function () {
    $('#dlg-usuario').dataset.id = '';
    $('#dlg-usuario-titulo').textContent = 'Crear usuario';
    $('#dlg-usuario-cuerpo').innerHTML =
      '<label for="n-email">Correo</label><input type="email" id="n-email" required />' +
      '<label for="n-nombre">Nombre</label><input type="text" id="n-nombre" maxlength="120" />' +
      '<label for="n-clave">Contraseña (mínimo 8 caracteres)</label>' +
      '<input type="password" id="n-clave" minlength="8" autocomplete="new-password" required />' +
      '<div class="rejilla-2">' +
        '<div><label for="n-rol">Rol</label><select id="n-rol">' +
          '<option value="usuario">Usuario</option><option value="admin">Administrador</option>' +
        '</select></div>' +
        '<div><label for="n-locale">Idioma</label><select id="n-locale">' +
          '<option value="es">Español</option><option value="en">Inglés</option>' +
        '</select></div>' +
      '</div>' +
      '<p class="pista">La cuenta se crea con el correo ya confirmado: la estás dando ' +
        'de alta tú a mano.</p>';
    $('#dlg-usuario').showModal();
  });

  // ------------------------------------------------------------------ anuncios

  function cargarAnuncios() {
    return sb.from('anuncios').select('*').order('prioridad', { ascending: false })
      .order('creado_en', { ascending: false })
      .then(function (r) {
        if (r.error) throw r.error;
        var lista = r.data || [];
        if (!lista.length) {
          $('#lista-anuncios').innerHTML = '<p class="nota">No hay ningún anuncio todavía.</p>';
          return;
        }
        $('#lista-anuncios').innerHTML = lista.map(function (a) {
          var vigente = a.activo &&
            (!a.inicia_en || new Date(a.inicia_en) <= new Date()) &&
            (!a.termina_en || new Date(a.termina_en) > new Date());
          return '' +
            '<div class="anuncio-fila" data-id="' + esc(a.id) + '">' +
              '<span class="chip ' + (a.tipo === 'alerta' ? 'mal' : a.tipo === 'aviso' ? 'espera' : 'info') + '">' +
                esc(a.tipo) + '</span>' +
              '<div class="cuerpo">' +
                '<div class="titulo">' + esc(a.titulo_es) + '</div>' +
                '<div class="texto">' + esc(a.mensaje_es) + '</div>' +
              '</div>' +
              '<span class="chip ' + (vigente ? 'ok' : '') + '">' +
                (vigente ? 'visible ahora' : a.activo ? 'programado' : 'apagado') + '</span>' +
              '<div class="acciones">' +
                '<button class="btn btn-outline btn-sm editar-anuncio">Editar</button>' +
                '<button class="btn btn-outline btn-sm alternar-anuncio">' +
                  (a.activo ? 'Apagar' : 'Encender') + '</button>' +
                '<button class="btn btn-sm btn-peligro borrar-anuncio">Borrar</button>' +
              '</div>' +
            '</div>';
        }).join('');
      });
  }

  function paraInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    // datetime-local necesita hora local sin zona; toISOString daría UTC y el
    // administrador vería una hora distinta de la que escribió.
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function editorAnuncio(a) {
    a = a || { tipo: 'noticia', activo: true, descartable: true, prioridad: 0, rutas: ['*'] };
    $('#dlg-anuncio').dataset.id = a.id || '';
    $('#dlg-anuncio-titulo').textContent = a.id ? 'Editar anuncio' : 'Nuevo anuncio';
    $('#dlg-anuncio-cuerpo').innerHTML = '' +
      '<div class="rejilla-2">' +
        '<div><label for="a-tipo">Tipo</label><select id="a-tipo">' +
          ['noticia', 'aviso', 'alerta', 'mantenimiento'].map(function (t) {
            return '<option value="' + t + '"' + (a.tipo === t ? ' selected' : '') + '>' + t + '</option>';
          }).join('') +
        '</select></div>' +
        '<div><label for="a-prioridad">Prioridad</label>' +
          '<input type="number" id="a-prioridad" value="' + (a.prioridad || 0) + '" min="0" max="100" /></div>' +
      '</div>' +

      '<label for="a-titulo-es">Título (español)</label>' +
      '<input type="text" id="a-titulo-es" maxlength="120" value="' + esc(a.titulo_es || '') + '" />' +
      '<label for="a-mensaje-es">Mensaje (español)</label>' +
      '<textarea id="a-mensaje-es" maxlength="400">' + esc(a.mensaje_es || '') + '</textarea>' +

      '<label for="a-titulo-en">Título (inglés)</label>' +
      '<input type="text" id="a-titulo-en" maxlength="120" value="' + esc(a.titulo_en || '') + '" />' +
      '<label for="a-mensaje-en">Mensaje (inglés)</label>' +
      '<textarea id="a-mensaje-en" maxlength="400">' + esc(a.mensaje_en || '') + '</textarea>' +

      '<div class="rejilla-2">' +
        '<div><label for="a-enlace">Enlace (opcional)</label>' +
          '<input type="text" id="a-enlace" placeholder="/kit/ o https://…" value="' + esc(a.enlace_url || '') + '" /></div>' +
        '<div><label for="a-boton-es">Texto del botón (ES / EN)</label>' +
          '<input type="text" id="a-boton-es" maxlength="40" value="' + esc(a.enlace_texto_es || '') + '" />' +
          '<input type="text" id="a-boton-en" maxlength="40" style="margin-top:6px" value="' + esc(a.enlace_texto_en || '') + '" /></div>' +
      '</div>' +

      '<div class="rejilla-2">' +
        '<div><label for="a-inicia">Empieza (vacío = ya)</label>' +
          '<input type="datetime-local" id="a-inicia" value="' + paraInput(a.inicia_en) + '" /></div>' +
        '<div><label for="a-termina">Termina (vacío = sin fin)</label>' +
          '<input type="datetime-local" id="a-termina" value="' + paraInput(a.termina_en) + '" /></div>' +
      '</div>' +

      '<label for="a-rutas">Rutas donde aparece</label>' +
      '<input type="text" id="a-rutas" value="' + esc((a.rutas || ['*']).join(', ')) + '" />' +
      '<p class="pista">* para todas. O rutas concretas separadas por comas: /kit/, /en/kit/</p>' +

      '<label class="interruptor"><input type="checkbox" id="a-activo"' + (a.activo ? ' checked' : '') + ' />' +
        '<span><strong>Activo</strong></span></label>' +
      '<label class="interruptor"><input type="checkbox" id="a-descartable"' + (a.descartable ? ' checked' : '') + ' />' +
        '<span><strong>El visitante puede cerrarlo</strong>' +
        '<em>Si lo cierra, no se lo volvemos a enseñar salvo que edites el anuncio.</em></span></label>' +

      '<div class="previa"><span>Vista previa</span><div id="previa-caja"></div></div>';

    ['a-tipo', 'a-titulo-es', 'a-mensaje-es', 'a-enlace', 'a-boton-es', 'a-descartable']
      .forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', pintarPrevia);
      });
    pintarPrevia();
    $('#dlg-anuncio').showModal();
  }

  function pintarPrevia() {
    var tipo = $('#a-tipo').value;
    var enlace = $('#a-enlace').value.trim();
    var boton = $('#a-boton-es').value.trim();
    $('#previa-caja').innerHTML =
      '<div class="vw-anuncio vw-' + esc(tipo) + '" style="position:static;margin-top:8px">' +
        '<div class="vw-anuncio-inner">' +
          '<span class="vw-anuncio-punto"></span>' +
          '<p><strong>' + esc($('#a-titulo-es').value || 'Título') + '</strong> ' +
            esc($('#a-mensaje-es').value || 'Mensaje del anuncio.') + '</p>' +
          (enlace && boton ? '<a class="vw-anuncio-cta" href="#">' + esc(boton) + '</a>' : '') +
          ($('#a-descartable').checked ? '<button class="vw-anuncio-x" aria-label="Cerrar">×</button>' : '') +
        '</div>' +
      '</div>';
  }

  $('#btn-nuevo-anuncio').addEventListener('click', function () { editorAnuncio(null); });

  $('#lista-anuncios').addEventListener('click', function (e) {
    var fila = e.target.closest('.anuncio-fila');
    if (!fila) return;
    var id = fila.dataset.id;

    if (e.target.classList.contains('editar-anuncio')) {
      sb.from('anuncios').select('*').eq('id', id).maybeSingle().then(function (r) {
        if (r.data) editorAnuncio(r.data);
      });
    }
    if (e.target.classList.contains('alternar-anuncio')) {
      sb.from('anuncios').select('activo').eq('id', id).maybeSingle().then(function (r) {
        return sb.from('anuncios').update({ activo: !r.data.activo }).eq('id', id);
      }).then(function () { toast('Anuncio actualizado.', 'ok'); return cargarAnuncios(); })
        .catch(function (err) { toast(err.message, 'mal'); });
    }
    if (e.target.classList.contains('borrar-anuncio')) {
      if (!confirm('¿Borrar este anuncio?')) return;
      sb.from('anuncios').delete().eq('id', id)
        .then(function () { toast('Anuncio borrado.', 'ok'); return cargarAnuncios(); })
        .catch(function (err) { toast(err.message, 'mal'); });
    }
  });

  $('#btn-guardar-anuncio').addEventListener('click', function () {
    var id = $('#dlg-anuncio').dataset.id;
    var enlace = $('#a-enlace').value.trim();

    var datos = {
      tipo: $('#a-tipo').value,
      titulo_es: $('#a-titulo-es').value.trim(),
      titulo_en: $('#a-titulo-en').value.trim(),
      mensaje_es: $('#a-mensaje-es').value.trim(),
      mensaje_en: $('#a-mensaje-en').value.trim(),
      enlace_url: enlace || null,
      enlace_texto_es: $('#a-boton-es').value.trim() || null,
      enlace_texto_en: $('#a-boton-en').value.trim() || null,
      activo: $('#a-activo').checked,
      descartable: $('#a-descartable').checked,
      prioridad: parseInt($('#a-prioridad').value || '0', 10),
      inicia_en: $('#a-inicia').value ? new Date($('#a-inicia').value).toISOString() : null,
      termina_en: $('#a-termina').value ? new Date($('#a-termina').value).toISOString() : null,
      rutas: $('#a-rutas').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
    };

    // Los dos idiomas son obligatorios: media web se quedaría con un hueco.
    if (!datos.titulo_es || !datos.titulo_en || !datos.mensaje_es || !datos.mensaje_en) {
      toast('Hacen falta título y mensaje en los dos idiomas.', 'mal');
      return;
    }
    if (enlace && !/^(https?:\/\/|\/)/.test(enlace)) {
      toast('El enlace debe empezar por / o por https://', 'mal');
      return;
    }
    if (datos.inicia_en && datos.termina_en && datos.termina_en <= datos.inicia_en) {
      toast('La fecha de fin tiene que ser posterior a la de inicio.', 'mal');
      return;
    }
    if (!datos.rutas.length) datos.rutas = ['*'];

    var op = id
      ? sb.from('anuncios').update(datos).eq('id', id)
      : sb.from('anuncios').insert(Object.assign({ creado_por: yo.id }, datos));

    op.then(function (r) {
      if (r.error) throw r.error;
      toast('Anuncio guardado.', 'ok');
      $('#dlg-anuncio').close();
      return cargarAnuncios();
    }).catch(function (err) { toast('No se pudo guardar: ' + err.message, 'mal'); });
  });

  // ------------------------------------------------------------------- ajustes

  function cargarAjustes() {
    return sb.from('ajustes').select('clave, valor').then(function (r) {
      if (r.error) throw r.error;
      var a = {};
      (r.data || []).forEach(function (f) { a[f.clave] = f.valor; });
      estado.ajustes = a;

      $('#sw-pagos').checked = a.pagos_activos === true;
      $('#sw-registro').checked = a.registro_abierto !== false;
      $('#sw-acceso').checked = a.acceso_abierto !== false;
      $('#msg-es').value = a.mensaje_cerrado_es || '';
      $('#msg-en').value = a.mensaje_cerrado_en || '';
      $('#aj-reintentos').value = a.reintentos_max || 3;
      $('#aj-dias').value = (a.reintento_dias || [1, 3, 5]).join(', ');
      $('#aj-conciliar').value = a.conciliar_tras_minutos || 30;
      $('#aj-ambiente').value = a.wompi_ambiente || 'sandbox';
    });
  }

  $('#btn-guardar-ajustes').addEventListener('click', function () {
    var dias = $('#aj-dias').value.split(',')
      .map(function (s) { return parseInt(s.trim(), 10); })
      .filter(function (n) { return !isNaN(n) && n > 0; });

    if (!dias.length) { toast('Pon al menos un día de reintento.', 'mal'); return; }
    if (!$('#sw-acceso').checked &&
        !confirm('Vas a cerrar la entrada a todos los usuarios. Los administradores seguiréis pudiendo entrar. ¿Seguro?')) {
      return;
    }

    if ($('#sw-pagos').checked && !estado.ajustes.pagos_activos &&
        !confirm('Vas a activar los cobros. A partir de ahora los usuarios podrán ' +
                 'contratar planes de pago y el cron cobrará las renovaciones. ' +
                 '¿Está Wompi configurado y probado?')) {
      return;
    }

    var cambios = [
      { clave: 'pagos_activos', valor: $('#sw-pagos').checked },
      { clave: 'registro_abierto', valor: $('#sw-registro').checked },
      { clave: 'acceso_abierto', valor: $('#sw-acceso').checked },
      { clave: 'mensaje_cerrado_es', valor: $('#msg-es').value.trim() },
      { clave: 'mensaje_cerrado_en', valor: $('#msg-en').value.trim() },
      { clave: 'reintentos_max', valor: parseInt($('#aj-reintentos').value, 10) || 3 },
      { clave: 'reintento_dias', valor: dias },
      { clave: 'conciliar_tras_minutos', valor: parseInt($('#aj-conciliar').value, 10) || 30 },
      { clave: 'wompi_ambiente', valor: $('#aj-ambiente').value }
    ];

    Promise.all(cambios.map(function (c) {
      return sb.from('ajustes')
        .update({ valor: c.valor, actualizado_por: yo.id })
        .eq('clave', c.clave);
    })).then(function (rs) {
      var fallo = rs.filter(function (r) { return r.error; })[0];
      if (fallo) throw fallo.error;
      toast('Ajustes guardados.', 'ok');
      return cargarAjustes();
    }).catch(function (e) { toast('No se pudo guardar: ' + e.message, 'mal'); });
  });

  $('#btn-sincronizar-admins').addEventListener('click', function () {
    var b = this;
    var caja = $('#resultado-admins');
    b.disabled = true;
    b.textContent = 'Sincronizando…';
    caja.innerHTML = '';

    invocar('sincronizar-admins', {}).then(function (r) {
      var lineas = [];
      if (r.ascendidos && r.ascendidos.length) lineas.push('Ascendidos: ' + r.ascendidos.join(', '));
      if (r.degradados && r.degradados.length) lineas.push('Degradados: ' + r.degradados.join(', '));
      if (r.en_la_lista_sin_cuenta && r.en_la_lista_sin_cuenta.length) {
        lineas.push('En la lista pero sin cuenta todavía: ' + r.en_la_lista_sin_cuenta.join(', '));
      }
      if (!lineas.length) lineas.push('Todo estaba ya en orden. Nada que cambiar.');
      lineas.push('Administradores activos: ' + r.administradores_activos);

      caja.innerHTML = '<p class="' + (r.aviso ? 'aviso' : 'pista') + '" style="margin-top:14px">' +
        lineas.map(esc).join('<br>') + (r.aviso ? '<br><br><strong>' + esc(r.aviso) + '</strong>' : '') + '</p>';
      toast('Roles sincronizados.', 'ok');
      return cargarUsuarios();
    }).catch(function (e) {
      caja.innerHTML = '<p class="aviso" style="margin-top:14px">' + esc(e.message) + '</p>';
      toast('No se pudo sincronizar.', 'mal');
    }).finally(function () {
      b.disabled = false;
      b.textContent = 'Sincronizar con ADMINS_PERMITIDOS';
    });
  });

  // ------------------------------------------------------------------ registro

  function cargarRegistro() {
    Promise.all([
      sb.from('admin_auditoria').select('*, perfiles(email)')
        .order('creado_en', { ascending: false }).limit(60),
      sb.from('eventos_wompi')
        .select('recibido_en, evento, transaccion_id, firma_valida, procesado, error')
        .order('recibido_en', { ascending: false }).limit(60)
    ]).then(function (r) {
      pintarTabla('#tabla-auditoria',
        ['Cuándo', 'Quién', 'Acción', 'Tabla', 'Registro'],
        (r[0].data || []).map(function (a) {
          return [
            fecha(a.creado_en, true),
            esc(a.perfiles ? a.perfiles.email : 'sistema'),
            esc(a.accion),
            esc(a.tabla),
            '<code>' + esc(String(a.registro_id || '').slice(0, 18)) + '</code>'
          ];
        }), 'Sin movimientos todavía.');

      pintarTabla('#tabla-eventos',
        ['Cuándo', 'Evento', 'Transacción', 'Firma', 'Procesado'],
        (r[1].data || []).map(function (e) {
          return [
            fecha(e.recibido_en, true),
            esc(e.evento),
            '<code>' + esc(e.transaccion_id || '—') + '</code>',
            e.firma_valida ? '<span class="chip ok">válida</span>' : '<span class="chip mal">INVÁLIDA</span>',
            e.procesado ? '<span class="chip ok">sí</span>'
                        : '<span class="chip espera">' + esc(e.error ? 'con nota' : 'no') + '</span>'
          ];
        }), 'Todavía no ha llegado ningún webhook.');
    }).catch(function (e) { toast(e.message, 'mal'); });
  }

  // ---------------------------------------------------------------- arranque

  sb.auth.getSession().then(function (r) {
    if (r.data.session) {
      comprobarAdmin().catch(function () {
        sb.auth.signOut();
        $('#pantalla-login').hidden = false;
      });
    } else {
      $('#pantalla-login').hidden = false;
    }
  });
})();
