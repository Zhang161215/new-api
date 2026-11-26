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
      // 绑定生成时的那批颗粒：波纹途中若重排（面板重绘、提示条出现）会换新颗粒，长度和 dist 对不上
      grains: topo.grains,
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
    const g = p.grains;
    const buckets = ALPHA_BUCKETS.map(() => []);
    for (let i = 0; i < g.x.length; i += 1) {
      const phase = (front - p.dist[i]) / p.band;
      if (!(phase > 0 && phase < 2.2)) continue;
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

  // ---------------- 转盘本体动效 ----------------
  // 拨片：盘面每转过一条分隔线，指针被顶一下并“嗒”一声；慢下来时拨动幅度更大。
  // 速度模糊：快转时奖品图标和文字发虚，慢下来逐级清晰。
  // 落点：中奖扇区闪亮、其余扇区压暗、奖品图标弹起；外圈流光在待机 / 转动 / 开奖三种状态下不同。
  // 次数：点下去立刻 −1 并滚动，避免等开奖完才变。
  // 音效跟随右上角音乐开关（关掉就全静音），用 WebAudio 现合成，不加载额外文件。
  const SOUND_KEY = 'synai996.lottery.bgm';
  const ornament = document.querySelector('.lz-w-ornament');
  const disc = document.querySelector('.lz-w-disc');
  const outer = document.querySelector('.lz-w-wheel-outer');
  const hubArt = document.querySelector('.lz-w-spin-art');
  const face = () => document.getElementById('wheel-face');

  let rim = null;
  let land = null;
  if (ornament && outer) {
    rim = document.createElement('div');
    rim.className = 'lz-w-rim';
    rim.setAttribute('aria-hidden', 'true');
    rim.innerHTML = '<i class="lz-w-rim-idle"></i><i class="lz-w-rim-fast"></i><i class="lz-w-rim-all"></i>';
    outer.after(rim);
  }
  if (disc) {
    land = document.createElement('div');
    land.className = 'lz-w-land';
    land.setAttribute('aria-hidden', 'true');
    land.innerHTML = '<i class="lz-w-land-dim"></i><i class="lz-w-land-hit"></i>';
    disc.append(land);
  }

  // ---- 音效 ----
  let actx = null;
  function soundOn() {
    try {
      return localStorage.getItem(SOUND_KEY) !== 'off';
    } catch (e) {
      return true;
    }
  }
  function audio() {
    if (!soundOn()) return null;
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        actx = new AC();
      } catch (e) {
        return null;
      }
    }
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  }
  function tone(freq, { at = 0, dur = 0.3, gain = 0.08, type = 'sine', slide = 0 } = {}) {
    const ctx = audio();
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }
  const sfx = {
    tick(speed) {
      // 越慢越低、越响一点，像拨片被顶得更狠
      const slow = Math.max(0, Math.min(1, 1 - speed / 700));
      tone(2300 - slow * 700, { dur: 0.035, gain: 0.035 + slow * 0.035, type: 'triangle', slide: 0.7 });
    },
    start() {
      tone(330, { dur: 0.32, gain: 0.05, type: 'triangle', slide: 2.2 });
    },
    win() {
      [1046.5, 1318.5, 1568].forEach((f, i) => tone(f, { at: i * 0.085, dur: 0.38, gain: 0.07 }));
    },
    jackpot() {
      [784, 1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone(f, { at: i * 0.075, dur: 0.5, gain: 0.075 }));
      tone(2093, { at: 0.42, dur: 0.9, gain: 0.05, type: 'triangle' });
    },
    miss() {
      tone(523, { dur: 0.22, gain: 0.05 });
      tone(392, { at: 0.13, dur: 0.34, gain: 0.05 });
    },
  };

  // ---- 转动监视：读盘面实时角度，算速度、过线 ----
  const spin = { raf: 0, prev: null, prevT: 0, turned: 0, vel: 0, lastTick: 0, segs: 6, speed: '', until: 0 };

  function faceAngle(el) {
    const m = getComputedStyle(el).transform;
    const v = m && m.startsWith('matrix(') ? m.slice(7, -1).split(',') : null;
    return v ? (Math.atan2(Number(v[1]), Number(v[0])) * 180) / Math.PI : 0;
  }

  function setSpeed(el, level) {
    if (spin.speed === level) return;
    spin.speed = level;
    if (level) el.dataset.speed = level;
    else delete el.dataset.speed;
  }

  function flick(speed) {
    if (!hubArt || speed > 520) return;
    const deg = 2.5 + 4 * (1 - speed / 520);
    hubArt.animate(
      [{ transform: 'rotate(0deg)' }, { transform: `rotate(${deg.toFixed(1)}deg)`, offset: 0.3 }, { transform: 'rotate(0deg)' }],
      { duration: 210, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
    );
  }

  function watch(now) {
    const el = face();
    if (!el || now > spin.until) {
      stopWatch();
      return;
    }
    const a = faceAngle(el);
    if (spin.prev !== null) {
      const d = ((a - spin.prev + 540) % 360) - 180;
      const dt = Math.max(1, now - spin.prevT);
      const seg = 360 / spin.segs;
      const before = spin.turned;
      spin.turned += d;
      spin.vel = spin.vel * 0.55 + Math.abs((d / dt) * 1000) * 0.45;
      if (Math.floor(spin.turned / seg) !== Math.floor(before / seg) && now - spin.lastTick > 38) {
        spin.lastTick = now;
        sfx.tick(spin.vel);
        flick(spin.vel);
      }
    }
    spin.prev = a;
    spin.prevT = now;
    setSpeed(el, spin.vel > 560 ? 'fast' : spin.vel > 280 ? 'mid' : '');
    spin.raf = requestAnimationFrame(watch);
  }

  function stopWatch() {
    cancelAnimationFrame(spin.raf);
    spin.raf = 0;
    const el = face();
    if (el) {
      spin.speed = 'x';
      setSpeed(el, '');
    }
  }

  function clearLand() {
    window.clearTimeout(clearLand.tid);
    land?.classList.remove('is-on', 'is-fade');
    rim?.classList.remove('is-blink', 'is-gold');
    face()?.querySelectorAll('.lz-w-css-prize.is-won').forEach((node) => node.classList.remove('is-won'));
  }

  function spinStart(segs) {
    clearLand();
    if (reducedMotion()) return;
    audio();
    sfx.start();
    spin.segs = Math.max(1, Number(segs) || 6);
    spin.prev = null;
    spin.turned = 0;
    spin.vel = 0;
    spin.until = performance.now() + 20000;
    if (!spin.raf) spin.raf = requestAnimationFrame(watch);
  }

  function spinEnd() {
    stopWatch();
  }

  // kind: 'jackpot' | 'win' | 'miss'；返回的 Promise 在“让人看清落点”的时间后结束
  function landOn(index, segs, kind) {
    clearLand();
    const n = Math.max(1, Number(segs) || 6);
    if (land) {
      land.style.setProperty('--n', String(n));
      land.dataset.kind = kind;
      void land.offsetWidth;
      land.classList.add('is-on');
      clearLand.tid = window.setTimeout(() => land.classList.add('is-fade'), 3600);
    }
    if (reducedMotion()) return Promise.resolve();
    face()?.querySelectorAll('.lz-w-css-prize')[index]?.classList.add('is-won');
    if (kind !== 'miss' && rim) {
      void rim.offsetWidth;
      rim.classList.add('is-blink');
      rim.classList.toggle('is-gold', kind === 'jackpot');
    }
    sfx[kind]?.();
    const hold = kind === 'jackpot' ? 0 : kind === 'miss' ? 420 : 640;
    return new Promise((resolve) => window.setTimeout(resolve, hold));
  }

  // ---- 次数滚动 ----
  const ticketView = { last: null, observer: null };

  function balanceStrong() {
    return document.querySelector('#me-stats .lz-w-balance-v strong');
  }

  function rollTicket(el, from, to) {
    if (!el || from === to || reducedMotion()) return;
    const holder = el.parentElement;
    el.classList.remove('is-roll-up', 'is-roll-down');
    void el.offsetWidth;
    el.classList.add(to < from ? 'is-roll-down' : 'is-roll-up');
    if (!holder) return;
    holder.querySelector('.lz-w-balance-delta')?.remove();
    const chip = document.createElement('i');
    chip.className = `lz-w-balance-delta ${to < from ? 'is-minus' : 'is-plus'}`;
    chip.textContent = `${to < from ? '−' : '+'}${Math.abs(to - from)}`;
    chip.setAttribute('aria-hidden', 'true');
    holder.append(chip);
    chip.addEventListener('animationend', () => chip.remove(), { once: true });
  }

  function watchTickets() {
    const root = document.getElementById('me-stats');
    if (!root || ticketView.observer) return;
    const read = () => {
      const el = balanceStrong();
      if (!el) return;
      const value = Number(el.textContent);
      if (!Number.isFinite(value)) return;
      if (ticketView.last !== null && value !== ticketView.last) rollTicket(el, ticketView.last, value);
      ticketView.last = value;
    };
    ticketView.observer = new MutationObserver(read);
    ticketView.observer.observe(root, { childList: true });
    read();
  }

  // 点下去就先扣 1，开奖后面板重绘时数字一致就不会再滚一次
  function spend() {
    const el = balanceStrong();
    const value = Number(el?.textContent);
    if (!el || !Number.isFinite(value) || value < 1) return;
    el.textContent = String(value - 1);
    rollTicket(el, value, value - 1);
    ticketView.last = value - 1;
  }

  // 抽奖失败：把乐观扣掉的数字悄悄还原
  function unspend(tickets) {
    const el = balanceStrong();
    const value = Number(tickets);
    if (!el || !Number.isFinite(value)) return;
    el.classList.remove('is-roll-up', 'is-roll-down');
    el.parentElement?.querySelector('.lz-w-balance-delta')?.remove();
    el.textContent = String(value);
    ticketView.last = value;
  }

  watchTickets();
  if (!ticketView.observer) document.addEventListener('DOMContentLoaded', watchTickets, { once: true });

  initTopo();
  initPointer();
  window.LotteryFx = { pulse, spinStart, spinEnd, landOn, spend, unspend };
})();
