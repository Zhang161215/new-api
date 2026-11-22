
export function mountScrollHome(host, userConfig = {}) {
  if (!host) return () => {};
  const CONFIG = {
    launchedAt: '2025-12-03T00:00:00+08:00',
    siteUrl: `${window.location.origin}/`,
    startUrl: '/console',
    rechargeUrl: '/console/topup',
    subscriptionUrl: '/console/topup',
    pricingUrl: '/pricing',
    tutorialUrl: 'https://doc.synai996.space/',
    logo: '/synai-logo.png',
    systemName: 'Synai996',
    backgroundIntensity: 1,
    showDemoSettings: true,
    demoElapsedSeconds: 365 * 86400 + 8 * 3600 + 42 * 60 + 16,
    ...userConfig,
  };
  const navigate =
    typeof CONFIG.navigate === 'function'
      ? CONFIG.navigate
      : (url) => {
          window.location.assign(url);
        };
  const $ = (selector) => host.querySelector(selector);
  const $$ = (selector) => [...host.querySelectorAll(selector)];
  const root = host;
  const cleanups = [];
  const on = (target, type, handler, opts) => {
    target.addEventListener(type, handler, opts);
    cleanups.push(() => target.removeEventListener(type, handler, opts));
  };
  const goUrl = (url) => {
    if (!url) return false;
    if (url.startsWith('/')) {
      navigate(url);
      return true;
    }
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.origin === window.location.origin) {
        navigate(`${parsed.pathname}${parsed.search}${parsed.hash}`);
        return true;
      }
      window.open(parsed.href, '_blank', 'noopener,noreferrer');
      return true;
    } catch (_) {
      return false;
    }
  };

    const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
    const smooth = (a, b, value) => { const x = clamp((value - a) / (b - a)); return x * x * (3 - 2 * x); };
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const storageKey = 'synai-home-scroll-v2';
    const demoStart = Date.now() - CONFIG.demoElapsedSeconds * 1000;
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch (_) { /* file:// 隐私模式可禁用存储 */ }
    let reduced = reducedQuery.matches;
    let paused = Boolean(stored.paused);
    let flowIntensity = clamp(Number(stored.flowIntensity) || CONFIG.backgroundIntensity, .35, 1.3);
    let launchISO = CONFIG.launchedAt;
    if (CONFIG.showDemoSettings && stored.launchedAt) launchISO = stored.launchedAt;
    let launchMs = Date.parse(launchISO);
    if (!Number.isFinite(launchMs) || launchMs > Date.now()) { launchMs = NaN; launchISO = ''; }
    let demo = !Number.isFinite(launchMs);
    let lastClockSecond = -1;
    let clockTimeout = 0;
    let progress = 0;
    let scrollTarget = 0;
    let viewportH = window.innerHeight;
    let scrollSpan = 1;
    let activeChapter = 0;
    let lastFrame = performance.now();
    let lastGLFrame = 0;
    let ambientTime = 0;
    let frameId = 0;
    let pageFrom = 0;
    let pageTo = 0;
    let pageStart = 0;
    let paging = false;
    let queuedChapter = null;
    let wheelLockUntil = 0;
    const pageDuration = 820;
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const panels = $$('.panel');
    const lastPanelIndex = panels.length - 1;
    const chapterButtons = $$('.chapter');
    const miniTime = $('.mini-time');
    const network = $('#network');
    const pageProgress = $('#page-progress');
    const story = $('#story');
    const dialog = $('#settings-dialog');
    const labels = ['STABLE UPTIME.', 'ONE API, MORE POSSIBILITIES.', 'CLEAR PRICING. YOUR CHOICE.', 'THE THINGS THAT MATTER.', 'THE STORY CONTINUES.'];
    const input = $('#launch-date');

    function persist() {
      try { localStorage.setItem(storageKey, JSON.stringify({ paused, launchedAt: launchISO, flowIntensity })); return true; }
      catch (_) { return false; }
    }

    // 每一位独立滚动；9 → 0 向下穿过第二轮数字，不倒转跳回。
    class RollingNumber {
      constructor(element, length) { this.element = element; this.length = length; this.digits = []; this.make(length); }
      make(length) {
        this.digits.forEach(d => clearTimeout(d.timer));
        this.element.replaceChildren();
        this.digits = Array.from({ length }, () => {
          const outer = document.createElement('span'); outer.className = 'digit';
          const track = document.createElement('span'); track.className = 'digit-track';
          for (let i = 0; i < 20; i++) { const n = document.createElement('span'); n.textContent = i % 10; track.append(n); }
          outer.append(track); this.element.append(outer);
          return { track, value: -1, timer: 0 };
        });
      }
      set(value, immediate = false) {
        const text = String(value).padStart(this.length, '0');
        if (text.length !== this.digits.length) this.make(text.length);
        [...text].forEach((char, i) => {
          const d = this.digits[i]; const n = Number(char);
          if (d.value === n) return;
          clearTimeout(d.timer);
          if (immediate || d.value < 0 || reduced) {
            d.track.style.transition = 'none';
            d.track.style.setProperty('--digit', n);
            // 在初始值绘制后才打开过渡。
            requestAnimationFrame(() => requestAnimationFrame(() => { d.track.style.transition = ''; }));
          } else {
            const wrapped = n < d.value;
            const position = wrapped ? n + 10 : n;
            d.track.style.transition = '';
            d.track.style.setProperty('--digit', position);
            if (wrapped) d.timer = setTimeout(() => {
              d.track.style.transition = 'none';
              d.track.style.setProperty('--digit', n);
              requestAnimationFrame(() => requestAnimationFrame(() => { d.track.style.transition = ''; }));
            }, 790);
          }
          d.value = n;
        });
      }
    }
    const days = new RollingNumber($('#day-digits'), 1); // 天数按实际位数显示，不补零。
    const hours = new RollingNumber($('#hours'), 2);
    const minutes = new RollingNumber($('#minutes'), 2);
    const seconds = new RollingNumber($('#seconds'), 2);

    function formattedDate(ms) {
      const date = new Date(ms);
      const z = n => String(n).padStart(2, '0');
      return `${date.getFullYear()}.${z(date.getMonth() + 1)}.${z(date.getDate())}`;
    }
    function setText(id, text) {
      const el = $(id);
      if (el) el.textContent = text;
    }
    function syncDateLabels() {
      setText('#date-note-text', demo ? '演示计时 · 开站日期待配置' : `自 ${formattedDate(launchMs)} 起累计运行`);
      setText('#settings-trigger-text', demo ? '演示设置' : '日期设置');
      setText('#timeline-start', demo ? '从第一天' : formattedDate(launchMs));
      setText('#settings-intro', demo ? '目前的 365 天是演示数据。填入网站实际开设时间，页面就会自动计算天、时、分、秒。' : '当前正在按你设置的开站时间计时。可以在这里修改日期，页面会自动重新计算。');
      host.dataset.demo = String(demo);
    }
    function updateClock(force = false) {
      const start = demo ? demoStart : launchMs;
      const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
      if (elapsed === lastClockSecond && !force) return;
      lastClockSecond = elapsed;
      const d = Math.floor(elapsed / 86400);
      const h = Math.floor(elapsed / 3600) % 24;
      const m = Math.floor(elapsed / 60) % 60;
      const s = elapsed % 60;
      days.set(d, force); hours.set(h, force); minutes.set(m, force); seconds.set(s, force);
      const elapsedEl = $('#elapsed-counter');
      if (elapsedEl) elapsedEl.setAttribute('aria-label', `${demo ? '演示计时' : '站点稳定运行时间'}：${d} 天 ${h} 小时 ${m} 分 ${s} 秒`);
      setText('#mini-days', String(d));
      setText('#timeline-now', `已稳定运行 ${d} 天${demo ? ' · 演示' : ''}`);
      setText('#closing-time', `站点已稳定运行 ${d} 天${demo ? '（演示）' : ''}`);
      // 超过三位时缩放数字，保持天数完整且不溢出。
      const count = String(d).length;
      const dayDigits = $('#day-digits');
      if (dayDigits) dayDigits.style.zoom = count > 3 ? String(3 / count) : '';
    }
    function startClock() {
      clearTimeout(clockTimeout);
      updateClock();
      const offset = (Date.now() - (demo ? demoStart : launchMs)) % 1000;
      clockTimeout = setTimeout(startClock, 1015 - offset);
    }

    const scroller = host;
    const brandLogo = $('#brand-logo');
    const brandName = $('#brand-name');
    const brand = $('.brand');
    if (brandLogo && CONFIG.logo) brandLogo.src = CONFIG.logo;
    if (brandName) brandName.textContent = CONFIG.systemName || 'Synai996';
    if (brand) brand.setAttribute('aria-label', `${CONFIG.systemName || 'Synai996'}，返回首页`);

    function layout() {
      viewportH = scroller.clientHeight || window.innerHeight;
      root.style.setProperty('--screen-h', `${viewportH}px`);
      story.style.height = `${viewportH}px`;
      scrollSpan = 1;
      renderer.resize();
    }
    function easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
    }
    function goToChapter(index, options = {}) {
      if (host.querySelector('dialog[open]')) return;
      const next = clamp(Math.round(Number(index)), 0, lastPanelIndex);
      if (paging && !options.force) {
        queuedChapter = next;
        return;
      }
      if (Math.abs(progress - next) < 0.002 && Math.round(pageTo) === next) return;
      pageFrom = progress;
      pageTo = next;
      pageStart = performance.now();
      paging = true;
      queuedChapter = null;
      scrollTarget = next;
      wheelLockUntil = performance.now() + pageDuration + 260;
      if (reduced) {
        progress = next;
        paging = false;
        updateScenes();
      }
    }
    function setChapter(index) {
      activeChapter = index;
      chapterButtons.forEach((button, i) => {
        if (i === index) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
      const number = String(index + 1).padStart(2, '0');
      $('#chapter-number').textContent = number;
      $('#bottom-index').textContent = number;
      $('#bottom-title').textContent = labels[index];
      $('#scroll-label').textContent = index === lastPanelIndex ? '回到起点，继续同行' : window.matchMedia('(pointer: coarse)').matches ? '向上轻滑，慢慢了解' : '向下滚动，慢慢了解';
      $('#scroll-prompt').setAttribute('aria-label', index === lastPanelIndex ? '返回第一屏' : '继续探索下一屏');
    }
    $$('[data-chapter]').forEach(button => button.addEventListener('click', () => goToChapter(button.dataset.chapter, { force: true })));
    $$('[data-go]').forEach(button => button.addEventListener('click', () => goUrl(button.dataset.go)));
    $('#scroll-prompt').addEventListener('click', () => goToChapter(activeChapter === lastPanelIndex ? 0 : activeChapter + 1, { force: true }));
    $('#skip-link').addEventListener('click', event => { event.preventDefault(); story.focus({ preventScroll: true }); });
    if ($('#start-link')) {
      $('#start-link').href = CONFIG.startUrl;
      $('#start-link').removeAttribute('target');
    }
    if ($('#docs-link')) {
      const docsHref = CONFIG.tutorialUrl || 'https://doc.synai996.space/';
      $('#docs-link').href = docsHref;
      $('#docs-link').target = '_blank';
      $('#docs-link').rel = 'noopener noreferrer';
    }
    if ($('#domain-link')) {
      $('#domain-link').href = CONFIG.siteUrl;
      try { $('#domain-link').textContent = `${new URL(CONFIG.siteUrl).hostname} ↗`; } catch (_) { /* 保留默认域名 */ }
    }

    function sceneMotion(i, distance) {
      const abs = Math.abs(distance);
      const leave = distance > 0 ? smooth(0, 1, Math.min(distance, 1)) : 0;
      const enter = distance < 0 ? smooth(0, 1, Math.min(-distance, 1)) : 0;
      const opacity = 1 - smooth(0.05, 0.68, abs);
      if (i === 0) {
        return {
          opacity,
          x: 0,
          y: -leave * 36 + enter * 18,
          z: -leave * 120,
          scale: 1 - leave * 0.14 + enter * 0.06,
          rx: leave * 8,
          ry: 0,
          blur: leave * 10,
          clip: 'none',
        };
      }
      if (i === 1) {
        return {
          opacity,
          x: -leave * 160 + enter * 180,
          y: 0,
          z: 0,
          scale: 1 - leave * 0.03,
          rx: 0,
          ry: -leave * 12 + enter * 14,
          blur: leave * 4,
          clip: enter > 0.01 ? `inset(0 ${enter * 22}% 0 0)` : 'none',
        };
      }
      if (i === 2) {
        return {
          opacity,
          x: 0,
          y: -leave * 70 + enter * 84,
          z: 0,
          scale: 1 - leave * 0.05 + enter * 0.04,
          rx: -leave * 16 + enter * 12,
          ry: 0,
          blur: 0,
          clip: enter > 0.01
            ? `inset(${enter * 28}% 0 0 0)`
            : leave > 0.01
              ? `inset(0 0 ${leave * 32}% 0)`
              : 'none',
        };
      }
      if (i === 3) {
        return {
          opacity,
          x: 0,
          y: 0,
          z: 0,
          scale: 1 + enter * 0.05 - leave * 0.04,
          rx: 0,
          ry: 0,
          blur: leave * 6,
          clip: enter > 0.01
            ? `inset(0 ${enter * 46}% 0 ${enter * 46}%)`
            : leave > 0.01
              ? `inset(${leave * 24}% 0 ${leave * 24}% 0)`
              : 'none',
        };
      }
      return {
        opacity,
        x: 0,
        y: enter * 24,
        z: leave * 80,
        scale: 1 + leave * 0.22 - enter * 0.16,
        rx: 0,
        ry: 0,
        blur: leave * 8,
        clip: 'none',
      };
    }
    function updateScenes() {
      const focus = document.activeElement;
      const index = Math.round(progress);
      if (index !== activeChapter) setChapter(index);
      panels.forEach((panel, i) => {
        const distance = progress - i;
        const abs = Math.abs(distance);
        const motion = sceneMotion(i, distance);
        const opacity = reduced ? (i === index ? 1 : 0) : motion.opacity;
        const visible = opacity > 0.001;
        panel.style.visibility = visible ? 'visible' : 'hidden';
        panel.style.opacity = opacity.toFixed(4);
        if (reduced) {
          panel.style.transform = 'none';
          panel.style.filter = 'none';
          panel.style.clipPath = 'none';
        } else {
          panel.style.transform = `translate3d(${motion.x.toFixed(2)}px, ${motion.y.toFixed(2)}px, ${motion.z.toFixed(2)}px) rotateX(${motion.rx.toFixed(2)}deg) rotateY(${motion.ry.toFixed(2)}deg) scale(${motion.scale.toFixed(4)})`;
          panel.style.filter = motion.blur > 0.04 ? `blur(${motion.blur.toFixed(2)}px)` : 'none';
          panel.style.clipPath = motion.clip;
        }
        panel.style.zIndex = String(Math.round((1 - abs) * 30));
        const interactive = i === index && opacity > 0.2;
        panel.style.pointerEvents = interactive ? 'auto' : 'none';
        if (!interactive && panel.contains(focus)) story.focus({ preventScroll: true });
        if (panel.inert === interactive) panel.inert = !interactive;
        const aria = interactive ? 'false' : 'true';
        if (panel.getAttribute('aria-hidden') !== aria) panel.setAttribute('aria-hidden', aria);
      });
      const miniOpacity = smooth(0.5, 0.92, progress);
      miniTime.style.opacity = miniOpacity.toFixed(3);
      miniTime.style.transform = `translate(-50%, ${((1 - miniOpacity) * 8).toFixed(2)}px)`;
      pageProgress.style.transform = `scaleX(${(progress / lastPanelIndex).toFixed(5)})`;
      if (network) {
        if (!reduced) network.style.transform = `rotateX(${(-mouse.y * 2.4).toFixed(2)}deg) rotateY(${(mouse.x * 3.2).toFixed(2)}deg)`;
        else network.style.transform = 'none';
      }
      root.style.setProperty('--flow-presence', (1 - smooth(0.1, 1.1, progress) * 0.46).toFixed(3));
    }

    // 一个轻量的丝绸光场。失去 WebGL 时自动保留 CSS 流动渐变。
    function makeRenderer() {
      const canvas = $('#flow');
      const fallback = { resize() {}, render() {} };
      let gl;
      try { gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false }); } catch (_) { return fallback; }
      if (!gl) { canvas.style.display = 'none'; return fallback; }
      const vertex = `attribute vec2 a_position; void main(){gl_Position=vec4(a_position,0.,1.);}`;
      const fragment = `
        precision highp float;
        uniform vec2 u_res;
        uniform float u_time;
        uniform vec2 u_mouse;
        uniform float u_scroll;
        uniform float u_intensity;
        float band(float x,float s){return exp(-x*x/(s*s));}
        float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
        void main(){
          vec2 uv=gl_FragCoord.xy/u_res;
          float t=u_time*(.30+.20*u_intensity);
          vec2 p=uv;
          p+=u_mouse*.036;
          p.x+=.043*sin(p.y*4.2+t*.8);
          p.y+=.035*sin(p.x*5.4-t*.7);
          float s=u_scroll;
          float intensity=u_intensity;
          float presence=mix(1.,.42,smoothstep(.15,1.25,s));
          vec3 paper=vec3(.972,.981,.997);
          vec3 cyan=vec3(.52,.82,.90);
          vec3 blue=vec3(.60,.75,.97);
          vec3 lilac=vec3(.77,.68,.94);
          vec3 col=paper;
          vec2 a=vec2(.16+.13*sin(t*.72),.53+.22*cos(t*.58));
          vec2 b=vec2(.83+.15*cos(t*.53),.61+.25*sin(t*.67));
          float cloud1=exp(-dot((p-a)*vec2(1.1,.85),(p-a)*vec2(1.1,.85))*5.0);
          float cloud2=exp(-dot((p-b)*vec2(.9,1.2),(p-b)*vec2(.9,1.2))*5.2);
          col=mix(col,mix(cyan,blue,.5+.4*sin(t*.32)),cloud1*.53*presence*intensity);
          col=mix(col,mix(lilac,cyan,.45+.4*sin(t*.28)),cloud2*.46*presence*intensity);
          // Fluid ribbons: crest, shaded fold and wide translucent body.
          float q=.06+.55*pow(max(p.x,0.),1.3)+.13*sin(p.x*5.5+t*.84)+.043*cos(p.x*10.-t*.65);
          float d=p.y-q;
          float width=.070+.022*sin(p.x*6.-t*.8);
          col=mix(col,mix(cyan,blue,p.x),band(d+.055,width*1.7)*.42*presence*intensity);
          col=mix(col,blue,band(d+.026,.027)*.51*presence*intensity);
          col=mix(col,vec3(1.),band(d-.006,.010)*.88*presence);
          col=mix(col,vec3(.90,.99,1.),band(d-.036,.046)*.68*presence);
          float q2=.87-.43*pow(abs(1.-p.x),1.5)+.17*sin(p.x*4.0-t*.74)+.034*sin(p.x*12.+t*.46);
          float d2=p.y-q2;
          col=mix(col,lilac,band(d2+.061,.11)*.35*presence*intensity);
          col=mix(col,mix(lilac,cyan,.5+.4*sin(t*.5)),band(d2+.022,.039)*.54*presence*intensity);
          col=mix(col,vec3(1.),band(d2-.006,.010)*.85*presence);
          col=mix(col,vec3(.94,.95,1.),band(d2-.03,.035)*.52*presence);
          float q3=.24+.19*sin(p.x*4.8-t*.57)+.15*p.x;
          float d3=p.y-q3;
          col=mix(col,cyan,band(d3,.085)*.14*presence*intensity);
          col=mix(col,vec3(1.),band(d3-.02,.015)*.43*presence);
          // Keep a soft reading area, not a flat white patch.
          float clear=exp(-pow(abs(p.x-.5)/.32,4.)-pow(abs(p.y-.56)/.36,4.));
          col=mix(col,vec3(.988,.993,1.),clear*.31);
          float grain=(hash(gl_FragCoord.xy)-.5)*.006;
          gl_FragColor=vec4(col+grain,1.);
        }`;
      function shader(type, source) {
        const result = gl.createShader(type); gl.shaderSource(result, source); gl.compileShader(result);
        if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) { gl.deleteShader(result); throw new Error('Shader compilation unavailable'); }
        return result;
      }
      try {
        const program = gl.createProgram();
        const vs = shader(gl.VERTEX_SHADER, vertex); const fs = shader(gl.FRAGMENT_SHADER, fragment);
        gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('WebGL link unavailable');
        gl.useProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
        const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, 'a_position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
        const uniforms = Object.fromEntries(['u_res','u_time','u_mouse','u_scroll','u_intensity'].map(name => [name, gl.getUniformLocation(program, name)]));
        root.classList.add('shader-ready');
        let lost = false;
        canvas.addEventListener('webglcontextlost', () => { lost = true; canvas.style.display = 'none'; root.classList.remove('shader-ready'); });
        return {
          resize() {
            const width = window.innerWidth; const height = window.innerHeight;
            const ratio = Math.min(window.devicePixelRatio || 1, 1.35, Math.sqrt(1150000 / (width * height)));
            canvas.width = Math.max(1, Math.floor(width * ratio)); canvas.height = Math.max(1, Math.floor(height * ratio));
            if (!lost) gl.viewport(0,0,canvas.width,canvas.height);
          },
          render(time, x, y, scroll) {
            if (lost) return;
            gl.uniform2f(uniforms.u_res, canvas.width, canvas.height);
            gl.uniform1f(uniforms.u_time,time);
            gl.uniform2f(uniforms.u_mouse,x,y);
            gl.uniform1f(uniforms.u_scroll,scroll);
            gl.uniform1f(uniforms.u_intensity,flowIntensity);
            gl.drawArrays(gl.TRIANGLES,0,6);
          }
        };
      } catch (_) { canvas.style.display='none'; root.classList.remove('shader-ready'); return fallback; }
    }
    const renderer = makeRenderer();
    let lastRenderedProgress = -100;
    let lastRenderedMouseX = 100;
    let lastRenderedMouseY = 100;
    function frame(now) {
      const dt = Math.min(.05, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
      const previous = progress;
      if (paging && !reduced) {
        const t = clamp((now - pageStart) / pageDuration);
        progress = pageFrom + (pageTo - pageFrom) * easeInOutCubic(t);
        if (t >= 1) {
          progress = pageTo;
          paging = false;
          if (queuedChapter !== null && queuedChapter !== pageTo) {
            const next = queuedChapter;
            queuedChapter = null;
            goToChapter(next, { force: true });
          } else {
            queuedChapter = null;
          }
        }
      } else if (!paging) {
        progress = pageTo;
      }
      if (!paused && !reduced) ambientTime += dt;
      mouse.x += (mouse.tx - mouse.x) * (1 - Math.exp(-5 * dt));
      mouse.y += (mouse.ty - mouse.y) * (1 - Math.exp(-5 * dt));
      const mouseChanged = Math.abs(mouse.x - lastRenderedMouseX) + Math.abs(mouse.y - lastRenderedMouseY) > .001;
      if (Math.abs(progress - lastRenderedProgress) > .00006 || mouseChanged) {
        updateScenes(); lastRenderedProgress = progress; lastRenderedMouseX = mouse.x; lastRenderedMouseY = mouse.y;
      }
      // 背景上限约 30fps；滚动与文字仍保持浏览器刷新率。
      if (now - lastGLFrame > 32 && (!paused && !reduced || Math.abs(progress - previous) > .00001 || lastGLFrame === 0)) {
        renderer.render(ambientTime, reduced ? 0 : mouse.x, reduced ? 0 : mouse.y, progress);
        lastGLFrame = now;
      }
      frameId = requestAnimationFrame(frame);
    }
    function syncMotion() {
      root.classList.toggle('reduced-motion', reduced);
      root.classList.toggle('motion-paused', paused || reduced);
      const isPaused = paused || reduced;
      root.style.setProperty('--flow-intensity', flowIntensity);
      $$('[data-flow]').forEach(b => b.setAttribute('aria-pressed', String(Math.abs(Number(b.dataset.flow) - flowIntensity) < .05)));
      $('#motion-toggle').setAttribute('aria-pressed', String(isPaused));
      const label = reduced ? '当前遵循系统的减少动态效果设置' : paused ? '播放背景动效' : '暂停背景动效';
      $('#motion-toggle').setAttribute('aria-label', label); $('#motion-toggle').title = label;
      lastGLFrame = 0;
    }
    let toastTimeout = 0;
    function toast(message) {
      const node = $('#toast'); node.textContent = message; node.classList.add('is-visible'); clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => node.classList.remove('is-visible'), 3000);
    }
    const motionToggle = $('#motion-toggle');
    if (motionToggle) {
      on(motionToggle, 'click', () => {
        if (reduced) { toast('正在遵循系统的「减少动态效果」设置'); return; }
        paused = !paused; persist(); syncMotion();
      });
    }
    if (reducedQuery.addEventListener) { on(reducedQuery, 'change', event => { reduced = event.matches; syncMotion(); updateScenes(); }); }

    function toLocalInput(ms) {
      const date = new Date(ms); const offset = date.getTimezoneOffset() * 60000;
      return new Date(ms - offset).toISOString().slice(0,19);
    }
    function openSettings() {
      input.value = demo ? '' : toLocalInput(launchMs);
      input.max = toLocalInput(Date.now());
      $('#date-error').textContent = '';
      try { const zone = Intl.DateTimeFormat().resolvedOptions().timeZone; $('#date-help').textContent = `按当前设备时区 ${zone} 输入。只保存在当前浏览器，不会修改线上网站。`; } catch (_) {}
      dialog.showModal();
    }
    $$('[data-settings]').forEach(button => {
      if (!CONFIG.showDemoSettings) {
        button.disabled = true;
        if (button.classList.contains('settings-trigger')) button.style.display = 'none';
        else { button.style.pointerEvents = 'none'; const icon = button.querySelector('svg'); if (icon) icon.style.display = 'none'; }
      } else button.addEventListener('click', openSettings);
    });
    $('#close-dialog').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    $('#date-form').addEventListener('submit', event => {
      event.preventDefault();
      const value = new Date(input.value).getTime();
      if (!Number.isFinite(value) || value > Date.now()) { $('#date-error').textContent = '请填写有效的开站时间，不能晚于现在。'; return; }
      launchMs = value; launchISO = new Date(value).toISOString(); demo = false;
      const saved = persist(); syncDateLabels(); updateClock(true); startClock(); dialog.close();
      toast(saved ? '已应用真实开站时间，并保存在当前浏览器' : '已应用开站时间；当前浏览器不允许本地保存');
    });
    $('#reset-date').addEventListener('click', () => {
      launchISO = ''; launchMs = NaN; demo = true; persist(); syncDateLabels(); updateClock(true); startClock(); dialog.close(); toast('已恢复演示计时');
    });

    function pageBy(delta) {
      const dir = Math.sign(delta);
      if (!dir) return;
      if (paging) {
        queuedChapter = clamp(pageTo + dir, 0, lastPanelIndex);
        return;
      }
      if (performance.now() < wheelLockUntil) return;
      goToChapter(Math.round(progress) + dir);
    }
    on(scroller, 'wheel', (event) => {
      if (host.querySelector('dialog[open]')) return;
      if (event.ctrlKey) return;
      if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
      event.preventDefault();
      if (Math.abs(event.deltaY) < 6) return;
      pageBy(event.deltaY);
    }, { passive: false });
    let touchStartY = 0;
    let touchStartX = 0;
    on(scroller, 'touchstart', (event) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      touchStartY = touch.clientY;
      touchStartX = touch.clientX;
    }, { passive: true });
    on(scroller, 'touchend', (event) => {
      if (host.querySelector('dialog[open]')) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dy = touchStartY - touch.clientY;
      const dx = touchStartX - touch.clientX;
      if (Math.abs(dy) < 42 || Math.abs(dy) < Math.abs(dx)) return;
      pageBy(dy);
    }, { passive: true });
    on(window, 'pointermove', event => {
      if (event.pointerType === 'touch' || paused || reduced) return;
      mouse.tx = clamp(event.clientX / window.innerWidth, 0, 1) * 2 - 1;
      mouse.ty = clamp(event.clientY / viewportH, 0, 1) * 2 - 1;
    }, { passive: true });
    on(document, 'pointerleave', () => { mouse.tx = 0; mouse.ty = 0; });
    let resizeFrame = 0;
    on(window, 'resize', () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => { layout(); lastGLFrame = 0; updateScenes(); });
    }, { passive: true });
    on(window, 'keydown', event => {
      if (host.querySelector('dialog[open]') || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
      if (event.key === 'PageDown' || event.key === 'ArrowDown' || event.key === ' ') { event.preventDefault(); goToChapter(activeChapter + 1, { force: true }); }
      else if (event.key === 'PageUp' || event.key === 'ArrowUp') { event.preventDefault(); goToChapter(activeChapter - 1, { force: true }); }
      else if (event.key === 'Home') { event.preventDefault(); goToChapter(0, { force: true }); }
      else if (event.key === 'End') { event.preventDefault(); goToChapter(lastPanelIndex, { force: true }); }
    });
    on(document, 'visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(frameId); clearTimeout(clockTimeout); }
      else { lastFrame = performance.now(); lastGLFrame = 0; startClock(); frameId = requestAnimationFrame(frame); }
    });

    $$('[data-billing]').forEach(button => button.addEventListener('click', () => { $('.billing').dataset.billingMode = button.dataset.billing; $$('[data-billing]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); }));
    // ── 第二屏的本地模型交互：只切换展示，不发起 API 请求 ──
    const modelDemos = {
      gpt: { label:'GPT', id:'<GPT_MODEL_ID>', answer:'从灵感到应用，只隔着一次连接。\n同一个 API Key，让创造不止一种可能。', tags:['对话交互','应用构建','内容创作'] },
      claude: { label:'Claude', id:'<CLAUDE_MODEL_ID>', answer:'把思考写得更清楚，把想法推进一步。\n无需重复接入，继续你熟悉的工作流。', tags:['文字协作','代码场景','产品构思'] },
      gemini: { label:'Gemini', id:'<GEMINI_MODEL_ID>', answer:'换一个模型，探索另一种表达。\n统一接口，让尝试新的可能更轻松。', tags:['灵感探索','内容生成','应用接入'] },
      deepseek: { label:'DeepSeek', id:'<DEEPSEEK_MODEL_ID>', answer:'把复杂的问题，拆解为下一步行动。\n灵活选择模型，把注意力留给创造。', tags:['问题拆解','代码场景','对话应用'] }
    };
    let selectedModel = 'gpt';
    const modelTabs = $$('.model-tab');
    function selectModel(key) {
      if (!modelDemos[key]) return;
      selectedModel = key;
      const item = modelDemos[key];
      modelTabs.forEach(tab => { const active = tab.dataset.model === key; tab.classList.toggle('is-active',active); tab.setAttribute('aria-selected',String(active)); tab.tabIndex = active ? 0 : -1; });
      $('#model-preview').setAttribute('aria-labelledby',`tab-${key}`);
      $('#answer-model').textContent = item.label;
      $('#model-answer').textContent = item.answer;
      $('#model-code').textContent = `"${item.id}"`;
      $('#model-capabilities').replaceChildren(...item.tags.map(tag => { const span = document.createElement('span'); span.textContent = tag; return span; }));
      if (!reduced) $('#model-preview').animate([{opacity:.4,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:360,easing:'ease-out'});
    }
    modelTabs.forEach((tab,index) => {
      tab.addEventListener('click', () => selectModel(tab.dataset.model));
      tab.addEventListener('keydown', event => {
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % modelTabs.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + modelTabs.length) % modelTabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = modelTabs.length-1;
        else return;
        event.preventDefault(); event.stopPropagation();
        modelTabs[next].focus(); selectModel(modelTabs[next].dataset.model);
      });
    });
    selectModel('gpt');
    $('#copy-code').addEventListener('click', async () => {
      const apiBase = (CONFIG.apiBaseUrl || CONFIG.siteUrl).replace(/\/$/,'');
      const snippet = `# 使用前请替换密钥、模型 ID，并核对站内接口文档\nfrom openai import OpenAI\n\nclient = OpenAI(\n    api_key="YOUR_SYNAI_KEY",\n    base_url="${apiBase}/v1"\n)\n\nresponse = client.chat.completions.create(\n    model="${modelDemos[selectedModel].id}",\n    messages=[{"role": "user", "content": "Hello, SynAI!"}]\n)\nprint(response.choices[0].message.content)`;
      let success = false;
      try { await navigator.clipboard.writeText(snippet); success = true; }
      catch (_) {
        const area = document.createElement('textarea'); area.value = snippet; area.setAttribute('aria-label','接口调用示例'); area.style.cssText='position:fixed;left:-9999px;top:0'; document.body.append(area); area.select();
        try { success = document.execCommand('copy'); } catch (_) {} area.remove(); $('#copy-code').focus({preventScroll:true});
      }
      toast(success ? '已复制示例，请替换 API Key 和模型 ID' : '浏览器禁止复制，请在站内文档查看调用示例');
    });

    // 本地教程 + 明确待配置的真实跳转地址。不构造未知的充值/订阅路径。
    const infoDialog = $('#info-dialog');
    const info = {
      recharge: {title:'余额充值 · 1:1 到账',body:'<p class="info-lead">充值金额按 1:1 到账，用多少扣多少。</p><div class="info-step"><b>01 · 登录账号</b><p>前往 SynAI，进入你的控制台。</p></div><div class="info-step"><b>02 · 选择余额充值</b><p>填写充值金额，并使用站内实际提供的支付方式完成付款。</p></div><div class="info-step"><b>03 · 查看到账与使用记录</b><p>确认余额到账后即可调用模型，扣费明细在站内账单中查看。</p></div><p class="info-note">当前是本地交互原型，不会创建支付订单。充值按钮的正式地址可在 CONFIG.rechargeUrl 中配置。</p>'},
      subscription: {title:'订阅套餐 · 按需选择',body:'<p class="info-lead">有稳定的调用节奏，可以查看订阅套餐。</p><div class="info-step"><b>先看清套餐范围</b><p>核对支持的模型、分组、可用额度与有效期。</p></div><div class="info-step"><b>再选择合适的套餐</b><p>根据实际使用量决定；续费、超额及余额扣费顺序以站内规则为准。</p></div><p class="info-note">尚未提供具体套餐价格和额度，原型不展示虚构数值。正式入口可在 CONFIG.subscriptionUrl 中配置。</p>'},
      pricing: {title:'模型定价与分组倍率',body:'<p class="info-lead">实际扣费 = 模型定价 × 用量 × 分组倍率</p><div class="info-step"><b>模型定价</b><p>查看所选模型的计价方式；定价与用量需要使用相同计量单位。</p></div><div class="info-step"><b>用量</b><p>根据实际请求核算。输入、输出及其他计费项以该模型页面的说明为准。</p></div><div class="info-step"><b>分组倍率</b><p>以当前使用分组的倍率结算，用量和账单在站内查看。</p></div><p class="info-note">原型仅解释你提供的计费方式，不包含实时价格。正式定价页可在 CONFIG.pricingUrl 中配置。</p>'},
      tutorial: {title:'从充值到第一次调用',body:'<div class="info-step"><b>01 · 选择使用方式</b><p>按需使用选择余额充值；有固定使用需求，也可以查看订阅套餐。</p></div><div class="info-step"><b>02 · 准备 API Key</b><p>在站内创建密钥，妥善保存，并查看允许调用的模型与分组。</p></div><div class="info-step"><b>03 · 配置应用</b><p>按照站内文档填写 API 地址、密钥与准确的模型 ID。</p></div><div class="info-step"><b>04 · 发起调用、查看用量</b><p>完成测试后，在控制台查看调用记录与费用明细。</p></div><p class="info-note">以上是接入流程示意。正式教程链接可在 CONFIG.tutorialUrl 中配置。</p>'}
    };
    function openInfo(key) {
      const content = info[key]; if (!content) return;
      const configured = CONFIG[`${key}Url`];
      if (configured) {
        if (goUrl(configured)) return;
        toast('此入口地址无效，正在显示原型说明');
      }
      $('#info-title').textContent = content.title; $('#info-body').innerHTML = content.body;
      $('#info-site-link').href = CONFIG.siteUrl; infoDialog.showModal();
    }
    $$('[data-destination]').forEach(button => button.addEventListener('click', () => openInfo(button.dataset.destination)));
    $$('[data-info]').forEach(button => button.addEventListener('click', () => openInfo(button.dataset.info)));
    $('#close-info').addEventListener('click', () => infoDialog.close());
    $('#dismiss-info').addEventListener('click', () => infoDialog.close());
    infoDialog.addEventListener('click',event=>{ if(event.target !== infoDialog)return; const r=infoDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)infoDialog.close(); });
    $$('[data-flow]').forEach(button => button.addEventListener('click', () => {flowIntensity=clamp(Number(button.dataset.flow),.35,1.3);persist();syncMotion();}));

    // 从头打开原型；不让浏览器在刷新后停留于某个已滚动的章节。
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    scroller.scrollTo(0,0);
    syncDateLabels(); updateClock(true); startClock(); syncMotion(); layout(); setChapter(0); updateScenes();
    renderer.render(0,0,0,0);
    frameId = requestAnimationFrame(frame);
  
  const startLink = $('#start-link');
  if (startLink) {
    startLink.addEventListener('click', (event) => {
      if (!CONFIG.startUrl) return;
      if (CONFIG.startUrl.startsWith('/') || CONFIG.startUrl.startsWith(window.location.origin)) {
        event.preventDefault();
        goUrl(CONFIG.startUrl);
      }
    });
  }
  const docsLink = $('#docs-link');
  if (docsLink) {
    docsLink.addEventListener('click', (event) => {
      const docsHref = CONFIG.tutorialUrl || 'https://doc.synai996.space/';
      if (docsHref.startsWith('/') || docsHref.startsWith(window.location.origin)) {
        event.preventDefault();
        goUrl(docsHref);
      }
    });
  }

  return () => {
    cancelAnimationFrame(frameId);
    clearTimeout(clockTimeout);
    clearTimeout(toastTimeout);
    if ('scrollRestoration' in history) history.scrollRestoration = 'auto';
    root.classList.remove('shader-ready', 'motion-paused', 'reduced-motion');
    cleanups.forEach((fn) => {
      try { fn(); } catch (_) {}
    });
  };
}
