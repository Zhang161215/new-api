/* Synai996 AI 算力幸运大转盘 · 白天 3D 高动效引擎 v4 */
(() => {
  const body = document.body;
  if (!body || body.dataset.page !== 'wheel') return;

  const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;

  const stage = () => document.getElementById('day-stage');
  const wheelStage = () => document.getElementById('wheel-stage');
  const face = () => document.getElementById('wheel-face');

  function isSoundOn() {
    const btn = document.getElementById('bgm-btn');
    if (!btn) return true;
    return !btn.classList.contains('is-off');
  }

  // ================= Web Audio 合成音效 =================
  let audioCtx = null;
  function getAudio() {
    if (!isSoundOn()) return null;
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playLaunchWhoosh() {
    const ctx = getAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(760, now + 0.3);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.055, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.36);
  }

  function playTick(velocity = 1) {
    const ctx = getAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const baseFreq = 920 + Math.min(velocity, 1.8) * 440;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.026);
    gain.gain.setValueAtTime(0.075, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.033);
  }

  function playWinChime(isJackpot) {
    const ctx = getAudio();
    if (!ctx) return;
    const notes = isJackpot
      ? [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98]
      : [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const now = ctx.currentTime + i * 0.07;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = isJackpot ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(isJackpot ? 0.1 : 0.075, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.52);
    });
  }

  // ================= 白天飘浮晶粒 + 能量冲击波 Canvas =================
  const bgFx = { particles: [], waves: [], w: 0, h: 0, ctx: null, spinning: false };

  function initBgFx() {
    if (reducedMotion()) return;
    const canvas = document.getElementById('bg-fx-canvas');
    const host = stage();
    if (!canvas || !host) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      bgFx.w = host.clientWidth;
      bgFx.h = host.clientHeight;
      canvas.width = Math.max(1, Math.round(bgFx.w * dpr));
      canvas.height = Math.max(1, Math.round(bgFx.h * dpr));
      bgFx.ctx = canvas.getContext('2d');
      bgFx.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const colors = ['#3b82f6', '#0ea5e9', '#8b5cf6', '#f59e0b', '#06b6d4'];
    bgFx.particles = Array.from({ length: 58 }, () => ({
      x: Math.random() * (bgFx.w || 1200),
      y: Math.random() * (bgFx.h || 800),
      vx: (Math.random() - 0.5) * 0.4,
      vy: -0.18 - Math.random() * 0.42,
      r: 1.5 + Math.random() * 2.4,
      a: 0.22 + Math.random() * 0.48,
      color: colors[Math.floor(Math.random() * colors.length)],
      phase: Math.random() * Math.PI * 2,
    }));

    function loop() {
      const ctx = bgFx.ctx;
      if (!ctx) return;
      ctx.clearRect(0, 0, bgFx.w, bgFx.h);

      for (let i = bgFx.waves.length - 1; i >= 0; i -= 1) {
        const wv = bgFx.waves[i];
        wv.r += wv.speed;
        wv.alpha *= 0.96;
        if (wv.alpha < 0.015) {
          bgFx.waves.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.beginPath();
        ctx.arc(wv.x, wv.y, wv.r, 0, Math.PI * 2);
        ctx.strokeStyle = wv.color;
        ctx.globalAlpha = wv.alpha;
        ctx.lineWidth = wv.lw;
        ctx.stroke();
        ctx.restore();
      }

      const boost = bgFx.spinning ? 2.5 : 1;
      for (const p of bgFx.particles) {
        p.x += p.vx * boost;
        p.y += p.vy * boost;
        p.phase += 0.032 * boost;
        if (p.y < -10) {
          p.y = bgFx.h + 10;
          p.x = Math.random() * bgFx.w;
        }
        if (p.x < -10) p.x = bgFx.w + 10;
        if (p.x > bgFx.w + 10) p.x = -10;
        const twinkle = 0.5 + 0.5 * Math.sin(p.phase);
        ctx.save();
        ctx.globalAlpha = p.a * twinkle;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  function emitShockwave(color = '#2563eb', count = 2) {
    if (reducedMotion()) return;
    const ws = wheelStage();
    const hs = stage();
    if (!ws || !hs) return;
    const wr = ws.getBoundingClientRect();
    const hr = hs.getBoundingClientRect();
    const cx = wr.left - hr.left + wr.width / 2;
    const cy = wr.top - hr.top + wr.height / 2;
    for (let i = 0; i < count; i += 1) {
      window.setTimeout(() => {
        bgFx.waves.push({
          x: cx,
          y: cy,
          r: Math.max(70, wr.width * 0.2),
          speed: 9.5 + i * 2.4,
          alpha: 0.65,
          lw: 3.6 - i * 0.8,
          color,
        });
      }, i * 130);
    }
  }

  function triggerShake(heavy = false) {
    if (reducedMotion()) return;
    const host = stage();
    if (!host) return;
    const cls = heavy ? 'is-shake-heavy' : 'is-shake';
    host.classList.remove('is-shake', 'is-shake-heavy');
    void host.offsetWidth;
    host.classList.add(cls);
    window.setTimeout(() => host.classList.remove(cls), 540);
  }

  // ================= 卡片手电筒追光 =================
  function initFlashlight() {
    if (reducedMotion()) return;
    if (!window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches) return;
    document.addEventListener(
      'pointermove',
      (e) => {
        document.querySelectorAll('.v4-panel').forEach((card) => {
          const r = card.getBoundingClientRect();
          const pad = 160;
          const near =
            e.clientX >= r.left - pad &&
            e.clientX <= r.right + pad &&
            e.clientY >= r.top - pad &&
            e.clientY <= r.bottom + pad;
          card.style.setProperty('--flash-on', near ? '1' : '0');
          if (near) {
            card.style.setProperty('--fx', `${e.clientX - r.left}px`);
            card.style.setProperty('--fy', `${e.clientY - r.top}px`);
          }
        });
      },
      { passive: true },
    );
  }

  // ================= 24 颗 3D 金珠实时追光跑马灯 =================
  let ledStep = 0;
  let ledTimer = null;

  function syncBulbRadius() {
    const ws = wheelStage();
    if (!ws || !ws.clientWidth) return;
    ws.style.setProperty('--bulb-r', `${(ws.clientWidth * 0.3525).toFixed(1)}px`);
  }

  function initBulbs() {
    const host = document.getElementById('bulb-glow-ring');
    if (!host) return;
    host.innerHTML = Array.from({ length: 24 }, (_, i) => `<span class="v4-bulb" style="--i:${i}"></span>`).join('');
    syncBulbRadius();
    window.addEventListener('resize', syncBulbRadius);
    if (typeof ResizeObserver === 'function' && wheelStage()) {
      new ResizeObserver(syncBulbRadius).observe(wheelStage());
    }
    if (!reducedMotion()) runBulbs('idle');
  }

  function runBulbs(mode = 'idle') {
    window.clearInterval(ledTimer);
    if (reducedMotion()) return;
    const bulbs = [...document.querySelectorAll('.v4-bulb')];
    if (!bulbs.length) return;
    const interval = mode === 'spin' ? 46 : mode === 'jackpot' ? 105 : 165;
    ledTimer = window.setInterval(() => {
      ledStep = (ledStep + 1) % 24;
      bulbs.forEach((el, idx) => {
        el.classList.remove('is-gold', 'is-cyan');
        if (mode === 'jackpot') {
          el.classList.add(idx % 2 === ledStep % 2 ? 'is-gold' : 'is-cyan');
        } else if (mode === 'spin') {
          const m = (idx - ledStep + 24) % 6;
          if (m === 0 || m === 1) el.classList.add('is-gold');
          else if (m === 2) el.classList.add('is-cyan');
        } else {
          const d1 = (idx - ledStep + 24) % 24;
          const d2 = (idx - ledStep + 12 + 24) % 24;
          if (d1 < 3) el.classList.add('is-gold');
          else if (d2 < 2) el.classList.add('is-cyan');
        }
      });
    }, interval);
  }

  // ================= 物理拨片 + 撞钉火花 + 速度线与动态模糊 =================
  const spinWatch = {
    raf: 0,
    segs: 6,
    prevAngle: null,
    prevTime: 0,
    totalDeg: 0,
    lastPeg: 0,
    ptrAngle: 0,
    ptrVel: 0,
  };

  function readFaceAngle() {
    const el = face();
    if (!el) return 0;
    const tr = getComputedStyle(el).transform;
    if (!tr || tr === 'none') return 0;
    const m = tr.match(/matrix\(([^)]+)\)/);
    if (!m) return 0;
    const [a, b] = m[1].split(',').map(Number);
    return ((Math.atan2(b, a) * (180 / Math.PI)) % 360 + 360) % 360;
  }

  function popPointerSpark() {
    const sp = document.getElementById('pointer-spark');
    if (!sp) return;
    sp.classList.remove('is-pop');
    void sp.offsetWidth;
    sp.classList.add('is-pop');
  }

  function watchFrame(now) {
    const el = face();
    const ws = wheelStage();
    if (!el || !bgFx.spinning) {
      spinWatch.raf = 0;
      return;
    }
    const dt = Math.min(Math.max((now - (spinWatch.prevTime || now)) / 1000, 0.008), 0.05);
    spinWatch.prevTime = now;

    const cur = readFaceAngle();
    if (spinWatch.prevAngle !== null) {
      let step = cur - spinWatch.prevAngle;
      if (step < -180) step += 360;
      else if (step > 180) step -= 360;
      spinWatch.totalDeg += step;
      const speed = Math.abs(step) / dt;

      if (speed > 620) {
        el.setAttribute('data-blur', 'fast');
        ws?.classList.add('is-fast');
      } else if (speed > 260) {
        el.setAttribute('data-blur', 'mid');
        ws?.classList.remove('is-fast');
      } else {
        el.removeAttribute('data-blur');
        ws?.classList.remove('is-fast');
      }

      const sliceDeg = 360 / Math.max(1, spinWatch.segs);
      const peg = Math.floor(spinWatch.totalDeg / sliceDeg);
      if (peg !== spinWatch.lastPeg && step > 0.2) {
        spinWatch.lastPeg = peg;
        spinWatch.ptrAngle = Math.min(spinWatch.ptrAngle, -Math.min(30, 12 + speed / 58));
        spinWatch.ptrVel = -110;
        playTick(speed / 650);
        popPointerSpark();
      }
    }
    spinWatch.prevAngle = cur;

    const acc = -440 * spinWatch.ptrAngle - 23 * spinWatch.ptrVel;
    spinWatch.ptrVel += acc * dt;
    spinWatch.ptrAngle += spinWatch.ptrVel * dt;
    if (Math.abs(spinWatch.ptrAngle) < 0.08 && Math.abs(spinWatch.ptrVel) < 0.5) {
      spinWatch.ptrAngle = 0;
      spinWatch.ptrVel = 0;
    }
    const blade = document.getElementById('pointer-blade');
    if (blade) blade.style.transform = `rotate(${spinWatch.ptrAngle.toFixed(2)}deg)`;

    spinWatch.raf = requestAnimationFrame(watchFrame);
  }

  // ================= 礼花 Canvas =================
  function burstConfetti(isJackpot) {
    if (reducedMotion()) return;
    const canvas = document.getElementById('confetti-canvas');
    const host = stage();
    const ws = wheelStage();
    if (!canvas || !host || !ws) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = host.clientWidth;
    const h = host.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const wr = ws.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const ox = wr.left - hr.left + wr.width / 2;
    const oy = wr.top - hr.top + wr.height / 2;

    const colors = isJackpot
      ? ['#f59e0b', '#fbbf24', '#2563eb', '#06b6d4', '#ec4899', '#8b5cf6']
      : ['#2563eb', '#0ea5e9', '#10b981', '#8b5cf6', '#f59e0b'];

    const count = isJackpot ? 110 : 52;
    const parts = Array.from({ length: count }, () => {
      const a = Math.random() * Math.PI * 2;
      const sp = (isJackpot ? 6 : 4) + Math.random() * (isJackpot ? 11 : 7.5);
      return {
        x: ox,
        y: oy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 3.5,
        size: 5 + Math.random() * 6,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.3,
        color: colors[Math.floor(Math.random() * colors.length)],
        isDot: Math.random() < 0.32,
        life: 1,
      };
    });

    function tick() {
      ctx.clearRect(0, 0, w, h);
      let alive = false;
      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.22;
        p.vx *= 0.986;
        p.rot += p.vrot;
        p.life -= isJackpot ? 0.013 : 0.017;
        if (p.life > 0) {
          alive = true;
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          if (p.isDot) {
            ctx.beginPath();
            ctx.arc(0, 0, p.size * 0.45, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillRect(-p.size / 2, -p.size * 0.34, p.size, p.size * 0.68);
          }
          ctx.restore();
        }
      }
      if (alive) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    }
    requestAnimationFrame(tick);
  }

  // ================= 次数飘字 =================
  function showDelta(text, isPlus) {
    const slot = document.getElementById('delta-slot');
    if (!slot || reducedMotion()) return;
    slot.className = `v4-delta ${isPlus ? 'is-plus' : 'is-minus'}`;
    slot.textContent = text;
    void slot.offsetWidth;
  }

  function spend() {
    const el = document.querySelector('#me-stats .v4-ticket-num');
    const val = Number(el?.textContent);
    if (!el || !Number.isFinite(val) || val < 1) return;
    el.textContent = String(val - 1);
    showDelta('-1', false);
  }

  function unspend(tickets) {
    const el = document.querySelector('#me-stats .v4-ticket-num');
    const val = Number(tickets);
    if (el && Number.isFinite(val)) el.textContent = String(val);
  }

  // ================= 暴露标准 LotteryFx API =================
  function clearLand() {
    document.getElementById('wheel-spotlight')?.classList.remove('is-on');
    wheelStage()?.classList.remove('is-jackpot', 'is-fast');
    stage()?.classList.remove('is-jackpot-mode');
    document.querySelectorAll('.v4-odds-chip').forEach((el) => el.classList.remove('is-hit'));
    runBulbs('idle');
  }

  function spinStart(segs = 6) {
    clearLand();
    bgFx.spinning = true;
    spinWatch.segs = Math.max(1, Number(segs) || 6);
    spinWatch.prevAngle = readFaceAngle();
    spinWatch.prevTime = performance.now();
    spinWatch.totalDeg = spinWatch.prevAngle;
    spinWatch.lastPeg = Math.floor(spinWatch.totalDeg / (360 / spinWatch.segs));
    spinWatch.ptrAngle = 0;
    spinWatch.ptrVel = 0;
    runBulbs('spin');
    playLaunchWhoosh();
    emitShockwave('#2563eb', 2);
    triggerShake(false);
    if (!spinWatch.raf && !reducedMotion()) {
      spinWatch.raf = requestAnimationFrame(watchFrame);
    }
  }

  function spinEnd() {
    bgFx.spinning = false;
    if (spinWatch.raf) {
      cancelAnimationFrame(spinWatch.raf);
      spinWatch.raf = 0;
    }
    face()?.removeAttribute('data-blur');
    wheelStage()?.classList.remove('is-fast');
    const blade = document.getElementById('pointer-blade');
    if (blade) blade.style.transform = 'rotate(0deg)';
  }

  function landOn(index, segs, kind, prizeId) {
    const n = Math.max(1, Number(segs) || 6);
    const spot = document.getElementById('wheel-spotlight');
    if (spot) {
      spot.style.setProperty('--n', String(n));
      spot.dataset.kind = kind || 'win';
      spot.classList.add('is-on');
    }
    if (prizeId) {
      document.querySelectorAll('.v4-odds-chip').forEach((el) => {
        el.classList.toggle('is-hit', el.dataset.prizeId === String(prizeId));
      });
    }
    if (kind === 'jackpot') {
      wheelStage()?.classList.add('is-jackpot');
      stage()?.classList.add('is-jackpot-mode');
      runBulbs('jackpot');
      emitShockwave('#f59e0b', 3);
      triggerShake(true);
      playWinChime(true);
      burstConfetti(true);
      return new Promise((r) => window.setTimeout(r, 980));
    }
    runBulbs('idle');
    if (kind === 'win') {
      emitShockwave('#0ea5e9', 2);
      playWinChime(false);
      burstConfetti(false);
      return new Promise((r) => window.setTimeout(r, 680));
    }
    return new Promise((r) => window.setTimeout(r, 420));
  }

  function pulse(strength = 1) {
    if (strength >= 2) emitShockwave('#f59e0b', 2);
    else if (strength > 0) emitShockwave('#2563eb', 1);
  }

  function boot() {
    initBgFx();
    initFlashlight();
    initBulbs();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.LotteryFx = { pulse, spinStart, spinEnd, landOn, clearLand, spend, unspend, showDelta };
})();
