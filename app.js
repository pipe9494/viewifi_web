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

  /* ==================== i18n removed: static ES page at / and EN page at /en/,
     linked with hreflang. The toggle in the nav is a plain anchor now. ==================== */

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
