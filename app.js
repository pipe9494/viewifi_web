/* Viewifi — landing interactions
   Radar canvas · scroll reveal · mobile nav · billing switch · waitlist forms */

(function () {
  'use strict';

  /* ==================== Config ==================== */

  var SUPABASE_URL = 'https://gawhrlqhwllpxnhnmksy.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdhd2hybHFod2xscHhuaG5ta3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NzA5NzAsImV4cCI6MjEwNDE0Njk3MH0.e39UdMPv8NyzPSUzB_KZEp3TQrQWo5BqpuMwrTJUf9s';
  var WAITLIST_TABLE = 'waitlist';

  var isEN = (document.documentElement.lang || 'es').slice(0, 2) === 'en';

  var T = isEN ? {
    invalid: 'Please enter a valid email address.',
    sending: 'Sending…',
    ok: 'You are on the list. We will write when it launches.',
    dupe: 'You were already on the list — nothing else to do.',
    fail: 'Could not save it. Please try again in a moment.',
    sent: 'Sent. We will get back to you shortly.',
    btnSending: 'Sending…'
  } : {
    invalid: 'Escribe un correo electrónico válido.',
    sending: 'Enviando…',
    ok: 'Ya estás en la lista. Te escribimos cuando salga.',
    dupe: 'Ya estabas en la lista — no hace falta nada más.',
    fail: 'No se pudo guardar. Inténtalo de nuevo en un momento.',
    sent: 'Enviado. Te respondemos en breve.',
    btnSending: 'Enviando…'
  };

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ==================== Radar canvas ==================== */

  var canvas = document.getElementById('radar');

  if (canvas && canvas.getContext) {
    var ctx = canvas.getContext('2d');
    var size = canvas.width;
    var c = size / 2;
    var radius = c - 8;
    var angle = 0;
    var blips = [];
    var nextBlipAt = 0;

    var drawGrid = function () {
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
    };

    var drawSweep = function () {
      var grad = ctx.createConicGradient ? ctx.createConicGradient(angle, c, c) : null;
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

      ctx.strokeStyle = 'rgba(0, 230, 118, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + Math.cos(angle) * radius, c + Math.sin(angle) * radius);
      ctx.stroke();
    };

    var spawnBlip = function (now) {
      if (now < nextBlipAt) return;
      nextBlipAt = now + 1200 + Math.random() * 2400;
      var a = Math.random() * Math.PI * 2;
      var r = radius * (0.25 + Math.random() * 0.65);
      blips.push({ x: c + Math.cos(a) * r, y: c + Math.sin(a) * r, born: now });
    };

    var drawBlips = function (now) {
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
    };

    var frame = function (now) {
      drawGrid();
      drawBlips(now || 0);
      drawSweep();
      if (!reduceMotion) {
        angle += 0.016;
        spawnBlip(now || 0);
        requestAnimationFrame(frame);
      }
    };

    if (reduceMotion) {
      blips.push({ x: c + radius * 0.4, y: c - radius * 0.3, born: -1000 });
      angle = -Math.PI / 4;
      frame(0);
    } else {
      requestAnimationFrame(frame);
    }
  }

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

  /* ==================== Billing cycle switch ==================== */

  var cycleBtns = document.querySelectorAll('.billing-opt');
  if (cycleBtns.length) {
    var applyCycle = function (cycle) {
      cycleBtns.forEach(function (b) {
        var active = b.getAttribute('data-cycle') === cycle;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      document.querySelectorAll('[data-price-' + cycle + ']').forEach(function (el) {
        el.innerHTML = el.getAttribute('data-price-' + cycle);
      });
      document.querySelectorAll('[data-period-' + cycle + ']').forEach(function (el) {
        el.innerHTML = el.getAttribute('data-period-' + cycle);
      });
      document.querySelectorAll('[data-equiv-' + cycle + ']').forEach(function (el) {
        el.innerHTML = el.getAttribute('data-equiv-' + cycle);
      });
    };

    cycleBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyCycle(btn.getAttribute('data-cycle'));
      });
    });
  }

  /* ==================== Docs: highlight the current section ==================== */

  var toc = document.getElementById('docs-toc');
  var docSections = document.querySelectorAll('.docs-body > section[id]');

  if (toc && docSections.length) {
    var tocLinks = {};
    toc.querySelectorAll('a[href^="#"]').forEach(function (a) {
      tocLinks[a.getAttribute('href').slice(1)] = a;
    });

    var currentId = null;

    var syncToc = function () {
      var line = 110;              // reading line, just under the fixed top bar
      var found = docSections[0].id;

      for (var i = 0; i < docSections.length; i++) {
        if (docSections[i].getBoundingClientRect().top <= line) found = docSections[i].id;
        else break;
      }

      // At the very bottom, always light up the last section
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
        found = docSections[docSections.length - 1].id;
      }

      if (found === currentId) return;
      currentId = found;
      Object.keys(tocLinks).forEach(function (id) {
        tocLinks[id].classList.toggle('is-current', id === found);
      });
    };

    var ticking = false;
    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { syncToc(); ticking = false; });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    syncToc();
  }

  /* ==================== Waitlist / contact forms ==================== */

  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

  document.querySelectorAll('[data-vw-form]').forEach(function (form) {
    var msg = form.querySelector('[data-form-msg]');
    var button = form.querySelector('button[type="submit"]');
    var emailInput = form.querySelector('input[type="email"]');
    var buttonLabel = button ? button.textContent : '';

    var say = function (text, state) {
      if (!msg) return;
      msg.textContent = text;
      msg.classList.remove('is-ok', 'is-error');
      if (state) msg.classList.add(state);
    };

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();

      var email = (emailInput && emailInput.value || '').trim().toLowerCase();

      if (!EMAIL_RE.test(email)) {
        if (emailInput) {
          emailInput.setAttribute('aria-invalid', 'true');
          emailInput.focus();
        }
        say(T.invalid, 'is-error');
        return;
      }
      if (emailInput) emailInput.removeAttribute('aria-invalid');

      var interest = form.getAttribute('data-interest') || 'pro';
      var companyEl = form.querySelector('[name="company"]');
      var messageEl = form.querySelector('[name="message"]');

      var payload = {
        email: email,
        interest: interest,
        locale: isEN ? 'en' : 'es',
        company: companyEl ? (companyEl.value || '').trim().slice(0, 200) || null : null,
        message: messageEl ? (messageEl.value || '').trim().slice(0, 2000) || null : null,
        source: window.location.pathname
      };

      if (button) { button.disabled = true; button.textContent = T.btnSending; }
      say(T.sending);

      fetch(SUPABASE_URL + '/rest/v1/' + WAITLIST_TABLE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(payload)
      }).then(function (res) {
        if (res.ok) {
          say(interest === 'b2b' ? T.sent : T.ok, 'is-ok');
          form.reset();
        } else if (res.status === 409) {
          say(T.dupe, 'is-ok');
          form.reset();
        } else {
          say(T.fail, 'is-error');
        }
      }).catch(function () {
        say(T.fail, 'is-error');
      }).then(function () {
        if (button) { button.disabled = false; button.textContent = buttonLabel; }
      });
    });
  });
})();
