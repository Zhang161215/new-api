/*
 * 抽奖转盘页氛围效果（只在 data-page="wheel" 生效）：
 * 1. 等高线背景：以转盘为山顶的高度场，三角剖分求等值线；鼠标附近局部提亮；
 *    抽奖 / 中奖时从转盘中心推出一圈波，沿等高线采样的颗粒被冲开再回位。
 * 2. 卡片手电筒：一个指针照亮附近卡片的表面和最近一段边框，缝隙两侧同时受光。
 * 思路参考 MengTo/Skills（MIT）的 interactive-topography、gradient-border-flashlight，代码按本页重写。
 * 减弱动效：等高线静态、不发波、去掉过渡；触屏和强制配色不启用手电筒与悬停提亮。
 */
(() => {
  const body = document.body;
  if (!body || body.dataset.page !== 'wheel') return;

  const media = (q) => window.matchMedia?.(q);
  const reducedMotion = () => media('(prefers-reduced-motion: reduce)')?.matches === true;
  const finePointer = media('(hover: hover) and (pointer: fine)')?.matches === true;
  const forcedColors = media('(forced-colors: active)')?.matches === true;
  const supportsCanvas = !!document.createElement('canvas').getContext;

  const FLASH_SELECTOR = '.lz-w-panel, .lz-w-balance, .lz-w-meta li, .lz-w-note';
  const FLASH_RADIUS = 255;
  const HOVER_RADIUS = 220;

  // ---------------- 高度场 ----------------
  function hash2(ix, iy) {
    let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  function valueNoise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy);
    const b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1);
    const d = hash2(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  function makeHeight(width, height, cx, cy) {
    const span = Math.max(width, Math.min(height, width * 1.4), 640);
    const summit = span * 0.36;
    return (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      let h = 1.15 * Math.exp(-(dx * dx + dy * dy) / (summit * summit));
      const lx = x - width * 0.08;
      const ly = y - Math.min(height, span) * 0.86;
      h += 0.32 * Math.exp(-(lx * lx + ly * ly) / ((span * 0.26) ** 2));
      const rx = x - width * 0.94;
      const ry = y - span * 0.12;
      h += 0.26 * Math.exp(-(rx * rx + ry * ry) / ((span * 0.22) ** 2));
      h += 0.34 * valueNoise(x / 260, y / 260);
      h += 0.16 * valueNoise(x / 118 + 11.3, y / 118 + 5.7);
      h += 0.05 * valueNoise(x / 52 + 3.1, y / 52 + 9.4);
      return h;
    };
  }

  // 三角形逐条求等值线：每格两个三角形，避免四边鞍点歧义。
  function buildContours(width, height, heightAt) {
    const step = width < 720 ? 9 : 11;
    const cols = Math.ceil(width / step) + 1;
    const rows = Math.ceil(height / step) + 1;
    const field = new Float32Array(cols * rows);
    let minH = Infinity;
    let maxH = -Infinity;
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        const h = heightAt(i * step, j * step);
        field[j * cols + i] = h;
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
    }
    const levelCount = 26;
    const interval = (maxH - minH) / levelCount;
    const minor = new Path2D();
    const index = new Path2D();
    const segments = [];
    const tri = (ax, ay, ah, bx, by, bh, cxp, cyp, ch) => {
      const lo = Math.min(ah, bh, ch);
      const hi = Math.max(ah, bh, ch);
      const first = Math.ceil((lo - minH) / interval);
      const last = Math.floor((hi - minH) / interval);
      for (let k = Math.max(1, first); k <= Math.min(levelCount - 1, last); k += 1) {
        const level = minH + k * interval + 1e-7;
        const pts = [];
        const edge = (px, py, ph, qx, qy, qh) => {
          if ((ph - level) * (qh - level) < 0) {
            const t = (level - ph) / (qh - ph);
            pts.push(px + (qx - px) * t, py + (qy - py) * t);
          }
        };
        edge(ax, ay, ah, bx, by, bh);
        edge(bx, by, bh, cxp, cyp, ch);
        edge(cxp, cyp, ch, ax, ay, ah);
        if (pts.length < 4) continue;
        const isIndex = k % 5 === 0;
        const path = isIndex ? index : minor;
        path.moveTo(pts[0], pts[1]);
        path.lineTo(pts[2], pts[3]);
        segments.push(pts[0], pts[1], pts[2], pts[3], isIndex ? 1 : 0);
      }
    };
    for (let j = 0; j < rows - 1; j += 1) {
      for (let i = 0; i < cols - 1; i += 1) {
        const x0 = i * step;
        const y0 = j * step;
        const x1 = x0 + step;
        const y1 = y0 + step;
        const h00 = field[j * cols + i];
        const h10 = field[j * cols + i + 1];
        const h01 = field[(j + 1) * cols + i];
        const h11 = field[(j + 1) * cols + i + 1];
        tri(x0, y0, h00, x1, y0, h10, x1, y1, h11);
        tri(x0, y0, h00, x1, y1, h11, x0, y1, h01);
      }
    }
    return { minor, index, segments };
  }

  // 沿等高线等距撒颗粒，给波用。按 65% / 26% / 9% 分近、中、远三档位移。
  function sampleGrains(segments) {
    const total = segments.length / 5;
    let length = 0;
    for (let s = 0; s < total; s += 1) {
      const o = s * 5;
      length += Math.hypot(segments[o + 2] - segments[o], segments[o + 3] - segments[o + 1]);
    }
    const spacing = Math.max(7, length / 7000);
    const xs = [];
    const ys = [];
    const amp = [];
    let carry = 0;
    let seed = 0;
    for (let s = 0; s < total; s += 1) {
      const o = s * 5;
      const x1 = segments[o];
      const y1 = segments[o + 1];
      const segLen = Math.hypot(segments[o + 2] - x1, segments[o + 3] - y1);
      let at = spacing - carry;
      while (at <= segLen) {
        const t = segLen ? at / segLen : 0;
        xs.push(x1 + (segments[o + 2] - x1) * t);
        ys.push(y1 + (segments[o + 3] - y1) * t);
        const r = hash2(seed, 7919);
        seed += 1;
        amp.push((r < 0.65 ? 0.6 : r < 0.91 ? 1.05 : 1.9) * (segments[o + 4] ? 1.15 : 1));
        at += spacing;
      }
      carry = segLen - (at - spacing);
    }
    return { x: Float32Array.from(xs), y: Float32Array.from(ys), amp: Float32Array.from(amp) };
  }

  // ---------------- 等高线画布 ----------------
  const topo = {
    ready: false,
    width: 0,
    height: 0,
    base: null,
    bright: null,
    wave: null,
    grains: null,
    pulse: null,
    resizeTimer: 0,
  };

  function makeCanvas(className) {
    const canvas = document.createElement('canvas');
    canvas.className = `lz-topo ${className}`;
    canvas.setAttribute('aria-hidden', 'true');
    body.prepend(canvas);
    return canvas;
  }

  function wheelCenter() {
    const el = document.getElementById('draw-btn') || document.querySelector('.lz-w-wheel-core');
    if (!el) return { x: window.innerWidth / 2 + window.scrollX, y: window.innerHeight * 0.45 + window.scrollY };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 + window.scrollX, y: r.top + r.height / 2 + window.scrollY };
  }

  function sizeCanvas(canvas, width, height, dpr) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function strokeContours(ctx, contours, minorStyle, indexStyle, minorWidth, indexWidth) {
    ctx.clearRect(0, 0, topo.width, topo.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = minorStyle;
    ctx.lineWidth = minorWidth;
    ctx.stroke(contours.minor);
    ctx.strokeStyle = indexStyle;
    ctx.lineWidth = indexWidth;
    ctx.stroke(contours.index);
  }

  function layoutTopo() {
    // 先把画布高度归零再量文档高度，否则画布自己会把页面撑住、窗口变矮后缩不回去。
    const canvases = [topo.base, topo.bright, topo.wave].filter(Boolean);
    const prevHeights = canvases.map((c) => c.style.height);
    canvases.forEach((c) => {
      c.style.height = '0px';
    });
    const width = Math.max(document.documentElement.clientWidth, 320);
    const height = Math.max(document.documentElement.scrollHeight, window.innerHeight);
    if (topo.ready && width === topo.width && height === topo.height) {
      canvases.forEach((c, i) => {
        c.style.height = prevHeights[i];
      });
      return;
    }
    topo.width = width;
    topo.height = height;
    const center = wheelCenter();
    const contours = buildContours(width, height, makeHeight(width, height, center.x, center.y));
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const baseCtx = sizeCanvas(topo.base, width, height, dpr);
    strokeContours(baseCtx, contours, 'rgba(47, 109, 255, 0.11)', 'rgba(47, 109, 255, 0.19)', 0.65, 1);
    if (topo.bright) {
      const brightCtx = sizeCanvas(topo.bright, width, height, dpr);
      strokeContours(brightCtx, contours, 'rgba(37, 99, 235, 0.42)', 'rgba(14, 116, 144, 0.6)', 0.85, 1.2);
    }
    topo.waveCtx = sizeCanvas(topo.wave, width, height, 1);
    topo.grains = sampleGrains(contours.segments);
    topo.ready = true;
  }

  function scheduleLayout() {
    window.clearTimeout(topo.resizeTimer);
    topo.resizeTimer = window.setTimeout(layoutTopo, 220);
  }

  // 波：前沿约 1.5 s 扫过最远角；颗粒在波峰被向外推一下，紧随一个小回弹，之后回到原位。
  function pulse(strength = 1) {
    if (!topo.ready || !topo.grains || strength <= 0 || reducedMotion()) return;
    const origin = wheelCenter();
    const vx = window.scrollX;
    const vy = window.scrollY;
    const corners = [
      [vx, vy],
      [vx + window.innerWidth, vy],
      [vx, vy + window.innerHeight],
      [vx + window.innerWidth, vy + window.innerHeight],
    ];
    const maxR = Math.max(...corners.map(([x, y]) => Math.hypot(x - origin.x, y - origin.y)));
    const g = topo.grains;
    const count = g.x.length;
    const dist = new Float32Array(count);
    const ux = new Float32Array(count);
    const uy = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const dx = g.x[i] - origin.x;
      const dy = g.y[i] - origin.y;
      const d = Math.hypot(dx, dy) || 1;
      dist[i] = d;
      ux[i] = dx / d;
      uy[i] = dy / d;
    }
    const restart = Boolean(topo.pulse);
    topo.pulse = {
      start: performance.now(),
      duration: 1500 + 260 * Math.min(strength, 2.5),
      band: 70 + 26 * strength,
      amplitude: 6 + 4 * strength,
      maxR,
      dist,
      ux,
      uy,
      strength,
    };
    if (!restart) requestAnimationFrame(drawPulse);
  }

  const ALPHA_BUCKETS = [0.18, 0.34, 0.52, 0.72];

  function drawPulse(now) {
    const p = topo.pulse;
    const ctx = topo.waveCtx;
    if (!p || !ctx) return;
    ctx.clearRect(0, 0, topo.width, topo.height);
    const t = (now - p.start) / p.duration;
    if (t >= 1) {
      topo.pulse = null;
      return;
    }
    const eased = 1 - (1 - t) ** 2.2;
    const front = eased * (p.maxR + p.band * 2.4);
    const fade = 1 - t * 0.55;
    const g = topo.grains;
    const buckets = ALPHA_BUCKETS.map(() => []);
    for (let i = 0; i < g.x.length; i += 1) {
      const phase = (front - p.dist[i]) / p.band;
      if (phase <= 0 || phase >= 2.2) continue;
      let disp;
      let glow;
      if (phase <= 1) {
        const s = Math.sin(phase * Math.PI);
        disp = s * p.amplitude * g.amp[i];
        glow = s;
      } else {
        const q = (phase - 1) / 1.2;
        disp = -Math.sin(q * Math.PI) * p.amplitude * 0.35 * g.amp[i];
        glow = (1 - q) * 0.4;
      }
      const alpha = glow * fade;
      if (alpha < 0.06) continue;
      const level = Math.min(ALPHA_BUCKETS.length - 1, Math.floor(alpha * ALPHA_BUCKETS.length));
      buckets[level].push(g.x[i] + p.ux[i] * disp, g.y[i] + p.uy[i] * disp);
    }
    const size = p.strength > 1.6 ? 2 : 1.6;
    buckets.forEach((pts, level) => {
      if (!pts.length) return;
      ctx.fillStyle = p.strength > 1.6
        ? `rgba(14, 116, 144, ${ALPHA_BUCKETS[level]})`
        : `rgba(37, 99, 235, ${ALPHA_BUCKETS[level]})`;
      ctx.beginPath();
      for (let k = 0; k < pts.length; k += 2) ctx.rect(pts[k] - size / 2, pts[k + 1] - size / 2, size, size);
      ctx.fill();
    });
    requestAnimationFrame(drawPulse);
  }

  function initTopo() {
    if (!supportsCanvas) return;
    topo.wave = makeCanvas('lz-topo-wave');
    if (finePointer && !forcedColors) topo.bright = makeCanvas('lz-topo-bright');
    topo.base = makeCanvas('lz-topo-base');
    body.classList.add('has-topo');
    layoutTopo();
    window.addEventListener('resize', scheduleLayout);
    if ('ResizeObserver' in window) new ResizeObserver(scheduleLayout).observe(document.querySelector('.lz-w-board') || body);
  }

  // ---------------- 指针：手电筒 + 等高线悬停 ----------------
  const pointer = { x: 0, y: 0, active: false, frame: 0 };

  function modalOpen() {
    return Boolean(document.querySelector('.lz-modal:not([hidden])'));
  }

  function clearFlash() {
    document.querySelectorAll('.is-flash-lit').forEach((el) => el.classList.remove('is-flash-lit'));
    topo.bright?.classList.remove('is-on');
  }

  function renderPointer() {
    pointer.frame = 0;
    if (!pointer.active || modalOpen()) {
      clearFlash();
      return;
    }
    const hosts = Array.from(document.querySelectorAll(FLASH_SELECTOR));
    const rects = hosts.map((el) => el.getBoundingClientRect());
    hosts.forEach((el, i) => {
      const r = rects[i];
      const x = pointer.x - r.left;
      const y = pointer.y - r.top;
      const dx = Math.max(0, -x, x - r.width);
      const dy = Math.max(0, -y, y - r.height);
      const lit = r.width > 0 && Math.hypot(dx, dy) < FLASH_RADIUS;
      if (lit) {
        el.style.setProperty('--fx', `${x.toFixed(1)}px`);
        el.style.setProperty('--fy', `${y.toFixed(1)}px`);
      }
      el.classList.toggle('is-flash-lit', lit);
    });
    if (topo.bright) {
      topo.bright.style.setProperty('--mx', `${(pointer.x + window.scrollX).toFixed(1)}px`);
      topo.bright.style.setProperty('--my', `${(pointer.y + window.scrollY).toFixed(1)}px`);
      topo.bright.classList.add('is-on');
    }
  }

  function schedulePointer() {
    if (!pointer.frame) pointer.frame = requestAnimationFrame(renderPointer);
  }

  function initPointer() {
    if (!finePointer || forcedColors) return;
    body.classList.add('has-flash');
    body.style.setProperty('--flash-r', `${FLASH_RADIUS}px`);
    body.style.setProperty('--topo-r', `${HOVER_RADIUS}px`);
    document.addEventListener('pointermove', (event) => {
      if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
      schedulePointer();
    }, { passive: true });
    const release = () => {
      pointer.active = false;
      schedulePointer();
    };
    document.documentElement.addEventListener('pointerleave', release);
    document.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    window.addEventListener('scroll', () => {
      if (pointer.active) schedulePointer();
    }, { passive: true });
  }

  initTopo();
  initPointer();
  window.LotteryFx = { pulse };
})();
