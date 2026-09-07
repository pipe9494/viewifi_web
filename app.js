/* Viewifi — landing interactions: radar canvas, i18n (ES/EN), scroll reveal, mobile nav */

(function () {
  'use strict';

  /* ==================== Radar canvas ==================== */

  var canvas = document.getElementById('radar');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (canvas && canvas.getContext) {
    var ctx = canvas.getContext('2d');
    var size = canvas.width;
    var c = size / 2;
    var radius = c - 8;
    var angle = 0;
    var blips = [];
    var nextBlipAt = 0;

    function drawGrid() {
      ctx.clearRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(0, 230, 118, 0.14)';
      ctx.lineWidth = 1;

      for (var i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(c, c, (radius / 3) * i, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(c - radius, c); ctx.lineTo(c + radius, c);
      ctx.moveTo(c, c - radius); ctx.lineTo(c, c + radius);
      ctx.strokeStyle = 'rgba(0, 230, 118, 0.09)';
      ctx.stroke();
    }

    function drawSweep() {
      var grad = ctx.createConicGradient
        ? ctx.createConicGradient(angle, c, c)
        : null;
      if (grad) {
        grad.addColorStop(0, 'rgba(0, 230, 118, 0.28)');
        grad.addColorStop(0.12, 'rgba(0, 230, 118, 0.0)');
        grad.addColorStop(1, 'rgba(0, 230, 118, 0.0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.arc(c, c, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Sweep leading edge
      ctx.strokeStyle = 'rgba(0, 230, 118, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + Math.cos(angle) * radius, c + Math.sin(angle) * radius);
      ctx.stroke();
    }

    function spawnBlip(now) {
      if (now < nextBlipAt) return;
      nextBlipAt = now + 1200 + Math.random() * 2400;
      var a = Math.random() * Math.PI * 2;
      var r = radius * (0.25 + Math.random() * 0.65);
      blips.push({ x: c + Math.cos(a) * r, y: c + Math.sin(a) * r, born: now });
    }

    function drawBlips(now) {
      blips = blips.filter(function (b) { return now - b.born < 3600; });
      blips.forEach(function (b) {
        var age = (now - b.born) / 3600;
        var alpha = 1 - age;
        ctx.fillStyle = 'rgba(0, 229, 255, ' + (alpha * 0.9).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 229, 255, ' + (alpha * 0.35).toFixed(3) + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4 + age * 22, 0, Math.PI * 2);
        ctx.stroke();
      });
    }

    function frame(now) {
      drawGrid();
      drawBlips(now || 0);
      drawSweep();
      if (!reduceMotion) {
        angle += 0.016;
        spawnBlip(now || 0);
        requestAnimationFrame(frame);
      }
    }

    if (reduceMotion) {
      // Static frame: one blip, sweep at a fixed angle
      blips.push({ x: c + radius * 0.4, y: c - radius * 0.3, born: -1000 });
      angle = -Math.PI / 4;
      frame(0);
    } else {
      requestAnimationFrame(frame);
    }
  }

  /* ==================== i18n ==================== */

  var STR = {
    en: {
      nav_features: 'Features', nav_how: 'How it works', nav_modes: 'Modes', nav_faq: 'FAQ',
      nav_download: 'Download',
      hero_badge: 'WiFi motion detection',
      hero_title: 'Your WiFi already knows\nwhen someone walks in.',
      hero_sub: 'Viewifi turns your home WiFi signal into a presence sensor. Get alerts with photo, audio and 3D evidence on Telegram — no cameras, no extra hardware, no subscriptions.',
      hero_apk: 'Download APK', hero_play: 'Google Play',
      fact_hardware: 'extra hardware', fact_privacy: 'on-device processing', fact_alerts: 'alert on Telegram',
      radar_live: 'Watching live',
      feat_title: 'Everything you need to watch your space',
      feat_sub: 'One phone with WiFi is enough. Viewifi does the rest.',
      f1_t: 'WiFi sensing', f1_d: 'Measures how a human body distorts the WiFi signal to detect motion through walls. Works in total darkness.',
      f2_t: 'Photo + audio evidence', f2_d: 'Every alert reaches Telegram with a photo, an audio clip and the signal waveform. You know what happened, not just that something did.',
      f3_t: 'Telegram alerts', f3_d: 'Your own bot, your own chat. Alerts in seconds, optional daily digest and commands to arm or disarm remotely.',
      f4_t: '3D activity', f4_d: 'An interactive 3D surface shows the intensity of every event over time. Explore it with a finger, just like the app.',
      f5_t: 'Automatic geofence', f5_d: 'Leave home and the system arms itself. Come back and it disarms. Pick which host gets the order: one or all.',
      f6_t: 'Many hosts, one account', f6_d: 'Home, office, shop: register as many host devices as you want under one user and watch them from anywhere.',
      f7_t: 'Learns your routine', f7_d: 'Spots changes in your activity patterns and warns you when something happens out of the ordinary, protected hours or not.',
      f8_t: 'Real privacy', f8_d: 'All signal analysis runs on the phone. No audio or signal ever leaves your home — only the alerts you configured.',
      how_title: 'Up and running in 3 steps',
      how_sub: 'From zero to watching in under 10 minutes.',
      h1_t: 'Install the host', h1_d: 'Leave any Android phone with the app in Host mode where you want coverage. Connect it to WiFi and forget about it.',
      h2_t: 'Connect Telegram', h2_d: 'Create a bot with @BotFather, paste the token and your chat ID. Your alerts travel through Telegram from anywhere.',
      h3_t: 'Get evidence', h3_d: 'Every detection arrives with photo, audio and signal chart. Reply to the bot to confirm false alarms and sensitivity tunes itself.',
      modes_title: 'Two modes, one app',
      modes_sub: 'The old phone watches. Yours keeps you informed.',
      mode_host_t: 'Host mode',
      mode_host_d: 'Runs silently on the phone you leave at home: it detects, captures evidence and alerts. Optimized for battery and auto-restart.',
      mh_1: 'Continuous WiFi sensing', mh_2: 'Photo + audio + RSSI waveform evidence',
      mh_3: 'Protected schedule and local alarm', mh_4: 'Re-arms itself after a power cut',
      mode_user_t: 'User mode',
      mode_user_d: 'On your everyday phone: live events, the 3D radar, and geofence arming control from anywhere.',
      mu_1: 'Live events dashboard', mu_2: 'Interactive radar and 3D surface',
      mu_3: 'Geofence: automatic arm/disarm', mu_4: 'Multiple hosts in one view',
      faq_title: 'Frequently asked questions',
      q1: 'Do I need to buy any device?', a1: 'No. Viewifi uses the WiFi signal you already have at home. Any Android phone with WiFi works as a host.',
      q2: 'Does it work in the dark or through walls?', a2: 'Yes. The system senses how bodies distort WiFi radio waves, so it needs neither light nor line of sight.',
      q3: 'Is my data safe?', a3: 'Signal analysis runs entirely on the host phone. Only the alerts you configured leave towards your own Telegram bot — no third-party servers hold your data.',
      q4: 'Can I watch more than one place?', a4: 'Yes. Register several devices in Host mode under the same account and choose which one gets each command, or send them to all.',
      q5: 'Is the app free?', a5: 'Download the APK for free. Full functionality is available without subscriptions; optional premium features are coming soon.',
      cta_title: 'Start watching today',
      cta_sub: 'An old phone, your WiFi and five minutes of setup.',
      cta_note: 'Android 8.0+ · ~21 MB · No sign-up required',
      footer_tag: 'Your WiFi, your guardian.',
      footer_releases: 'Releases'
    },
    es: {
      nav_features: 'Funciones', nav_how: 'Cómo funciona', nav_modes: 'Modos', nav_faq: 'FAQ',
      nav_download: 'Descargar',
      hero_badge: 'Detección de movimiento por WiFi',
      hero_title: 'Tu WiFi ya sabe\ncuando alguien entra.',
      hero_sub: 'Viewifi convierte la señal WiFi de tu casa en un sensor de presencia. Recibe alertas con foto, audio y evidencia 3D en Telegram — sin cámaras, sin hardware extra, sin suscripciones.',
      hero_apk: 'Descargar APK', hero_play: 'Google Play',
      fact_hardware: 'hardware extra', fact_privacy: 'procesamiento local', fact_alerts: 'alerta en Telegram',
      radar_live: 'Vigilando en vivo',
      feat_title: 'Todo lo que necesitas para vigilar tu espacio',
      feat_sub: 'Un teléfono con WiFi es suficiente. Viewifi hace el resto.',
      f1_t: 'Detección por WiFi', f1_d: 'Mide cómo el cuerpo de una persona altera la señal WiFi para detectar movimiento a través de paredes. Funciona en la oscuridad total.',
      f2_t: 'Evidencia foto + audio', f2_d: 'Cada alerta llega a Telegram con una foto, un clip de audio y la forma de onda de la señal. Sabrás qué pasó, no solo que pasó algo.',
      f3_t: 'Alertas Telegram', f3_d: 'Tu propio bot, tu propio chat. Alertas en segundos, resumen diario opcional y comandos para armar o desarmar a distancia.',
      f4_t: 'Actividad 3D', f4_d: 'Una superficie tridimensional muestra la intensidad de cada evento en el tiempo. Explórala con el dedo, como en la app.',
      f5_t: 'Geofence automático', f5_d: 'Sales de casa y el sistema se arma solo. Vuelves y se desarma. Decide qué host recibe la orden: uno o todos.',
      f6_t: 'Varios hosts, una cuenta', f6_d: 'Casa, oficina, local: registra tantos dispositivos host como quieras bajo el mismo usuario y míralos desde cualquier lugar.',
      f7_t: 'Aprende tu rutina', f7_d: 'Detecta cambios en tus patrones de actividad y avisa cuando algo ocurre fuera de lo normal, dentro o fuera del horario protegido.',
      f8_t: 'Privacidad real', f8_d: 'El análisis ocurre en el teléfono. Nada de audio ni señal sale de tu casa: solo las alertas que tú configuraste.',
      how_title: 'Funciona en 3 pasos',
      how_sub: 'De cero a vigilando en menos de 10 minutos.',
      h1_t: 'Instala el host', h1_d: 'Coloca un teléfono Android con la app en modo Host donde quieras vigilar. Conéctalo al WiFi y olvídate de él.',
      h2_t: 'Conecta Telegram', h2_d: 'Crea un bot con @BotFather, pega el token y tu chat ID. Tus alertas viajan cifradas por Telegram, desde cualquier lugar.',
      h3_t: 'Recibe evidencia', h3_d: 'Cada detección llega con foto, audio y gráfica de señal. Responde al bot para confirmar falsas alarmas y la sensibilidad se ajusta sola.',
      modes_title: 'Dos modos, una misma app',
      modes_sub: 'El teléfono viejo vigila. El tuyo te mantiene informado.',
      mode_host_t: 'Modo Host',
      mode_host_d: 'Corre en silencio en el teléfono que dejas en casa: detecta, captura evidencia y alerta. Optimizado para batería y reinicio automático.',
      mh_1: 'Detección continua por WiFi', mh_2: 'Evidencia foto + audio + onda RSSI',
      mh_3: 'Horario protegido y alarma local', mh_4: 'Se rearma solo tras un apagón',
      mode_user_t: 'Modo Usuario',
      mode_user_d: 'En tu teléfono de todos los días: ve eventos en tiempo real, el radar 3D, y controla el armado por geofence estés donde estés.',
      mu_1: 'Panel con eventos en vivo', mu_2: 'Radar y superficie 3D interactiva',
      mu_3: 'Geofence: armar/desarmar automático', mu_4: 'Varios hosts en una sola vista',
      faq_title: 'Preguntas frecuentes',
      q1: '¿Necesito comprar algún dispositivo?', a1: 'No. Viewifi usa la señal WiFi que ya tienes en casa. Cualquier teléfono Android con WiFi sirve como host.',
      q2: '¿Funciona en la oscuridad o a través de paredes?', a2: 'Sí. El sistema detecta cómo los cuerpos alteran las ondas de radio WiFi, así que no depende de luz ni de línea de vista.',
      q3: '¿Mis datos están seguros?', a3: 'El análisis de la señal ocurre íntegramente en el teléfono host. Solo salen las alertas que configuraste hacia tu propio bot de Telegram; ningún servidor de terceros guarda tus datos.',
      q4: '¿Puedo vigilar más de un lugar?', a4: 'Sí. Registra varios dispositivos en modo Host con la misma cuenta y elige a cuál enviar cada comando, o envíalos a todos.',
      q5: '¿La app es gratuita?', a5: 'Descarga el APK gratis. La funcionalidad completa está disponible sin suscripciones; funciones premium opcionales llegarán pronto.',
      cta_title: 'Empieza a vigilar hoy',
      cta_sub: 'Un teléfono viejo, tu WiFi y cinco minutos de configuración.',
      cta_note: 'Android 8.0+ · ~21 MB · Sin registro obligatorio',
      footer_tag: 'Tu WiFi, tu guardián.',
      footer_releases: 'Versiones'
    }
  };

  var langToggle = document.getElementById('lang-toggle');
  var saved = null;
  try { saved = localStorage.getItem('viewifi_lang'); } catch (e) {}
  var current = (saved === 'en' || saved === 'es') ? saved
    : ((navigator.language || '').toLowerCase().indexOf('es') === 0 ? 'es' : 'en');

  function applyLang(lang) {
    current = lang;
    var dict = STR[lang];
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (dict[key] !== undefined) {
        el.innerHTML = dict[key].replace(/\n/g, '<br/>');
      }
    });
    document.documentElement.setAttribute('lang', lang);
    if (langToggle) langToggle.textContent = lang === 'es' ? 'EN' : 'ES';
    try { localStorage.setItem('viewifi_lang', lang); } catch (e) {}
  }

  if (langToggle) {
    langToggle.addEventListener('click', function () {
      applyLang(current === 'es' ? 'en' : 'es');
    });
  }
  applyLang(current);

  /* ==================== Scroll reveal ==================== */

  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('visible'); });
  }

  /* ==================== Mobile nav ==================== */

  var burger = document.getElementById('nav-burger');
  var topbar = document.querySelector('.topbar');
  if (burger && topbar) {
    burger.addEventListener('click', function () {
      var open = topbar.classList.toggle('menu-open');
      burger.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', String(open));
    });
    topbar.querySelectorAll('.nav-links a').forEach(function (a) {
      a.addEventListener('click', function () {
        topbar.classList.remove('menu-open');
        burger.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
      });
    });
  }
})();
