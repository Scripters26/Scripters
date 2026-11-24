gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.config({ ignoreMobileResize: true });

const IS_MOBILE = window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;

/* ---------- subtle synthesized click audio feedback ---------- */
let sharedAudioCtx = null;
let lastClickSoundAt = -1e9;
function playClickSound() {
  const now = performance.now();
  if (now - lastClickSoundAt < 45) return;
  lastClickSoundAt = now;
  try {
    if (!sharedAudioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx && sharedAudioCtx.state === "suspended") sharedAudioCtx.resume();
    if (sharedAudioCtx) {
      const t = sharedAudioCtx.currentTime;
      const osc = sharedAudioCtx.createOscillator();
      const gain = sharedAudioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.exponentialRampToValueAtTime(260, t + 0.03);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.014, t + 0.0025);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      osc.connect(gain);
      gain.connect(sharedAudioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.032);
    }
  } catch (_) {}
}

document.addEventListener(
  "click",
  (e) => {
    if (!e.isTrusted) return;
    const target = e.target;
    if (!target || typeof target.closest !== "function") return;
    if (target.closest(".logo")) return;
    const btn = target.closest(
      'button, [role="button"], header.nav nav a, .cta, .proj-inspect-btn, .link-btn, .modal-btn, .proj-hit, .proj .cap h3 a.t, footer#contact a'
    );
    if (!btn || btn.disabled || btn.getAttribute("aria-disabled") === "true") return;
    playClickSound();
  },
  true
);

/* ---------- smooth scroll (Lenis) ---------- */
const lenis = new Lenis({ lerp: 0.08, wheelMultiplier: 1.15, syncTouch: false });
lenis.on("scroll", ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
lenis.stop();
let navScrollActive = false;
let navScrollToken = 0;
let navScrollTimer = 0;
document.querySelectorAll('a[href^="#"]:not([href="#"])').forEach((a) =>
  a.addEventListener("click", (e) => {
    const href = a.getAttribute("href");
    if (!href || href === "#" || !href.startsWith("#")) return;
    const target = document.querySelector(href);
    if (!target) return;
    e.preventDefault();
    if (lenis.isStopped) lenis.start();
    const token = ++navScrollToken;
    navScrollActive = true;
    clearTimeout(navScrollTimer);
    navScrollTimer = setTimeout(() => {
      if (token === navScrollToken) navScrollActive = false;
    }, 1800);
    const dest = href === "#top" ? 0 : target;
    lenis.scrollTo(dest, {
      duration: 1.35,
      force: true,
      onComplete: () => {
        if (token === navScrollToken) {
          clearTimeout(navScrollTimer);
          navScrollActive = false;
        }
      },
    });
  })
);

/* ---------- frame sequence ---------- */
const TOTAL = 153, FIRST = 48;
const FRAME_STEP = 1;
const cv = document.getElementById("cv"), ctx = cv.getContext("2d", { alpha: false });
const frames = new Array(TOTAL);
const inflight = new Array(TOTAL);
const decoded = new Uint8Array(TOTAL);
const decodingPromises = new Array(TOTAL);
let current = 0, loaded = 0, lastPainted = null;
let drawGeom = null, lastSrcW = 0, lastSrcH = 0;
let lastCvWinW = 0, lastCvWinH = 0;

const src = (i) => `frames/f${String(i + 1).padStart(4, "0")}.webp?v=8`;

const decodeFrame = (i) => {
  if (i < 0 || i >= TOTAL) return Promise.resolve();
  if (decoded[i]) return Promise.resolve();
  const im = frames[i];
  if (!im) return Promise.resolve();
  if (decodingPromises[i]) return decodingPromises[i];
  if (typeof im.decode === "function") {
    decodingPromises[i] = im.decode().then(
      () => { decoded[i] = 1; decodingPromises[i] = null; },
      () => { decoded[i] = 1; decodingPromises[i] = null; }
    );
    return decodingPromises[i];
  }
  decoded[i] = 1;
  return Promise.resolve();
};

const loadFrame = (i, decodeNow = false) => {
  if (i < 0 || i >= TOTAL) return Promise.resolve();
  if (frames[i]) return decodeNow ? decodeFrame(i) : Promise.resolve();
  if (inflight[i]) return decodeNow ? inflight[i].then(() => decodeFrame(i)) : inflight[i];
  inflight[i] = new Promise((res) => {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => {
      frames[i] = im;
      loaded++;
      if (decodeNow) {
        decodeFrame(i).then(res);
      } else {
        decodeFrame(i);
        res();
      }
    };
    im.onerror = () => res();
    im.src = src(i);
  });
  return inflight[i];
};

// Warm and pre-decode a sliding lookahead window around the playhead so ctx.drawImage never blocks on synchronous WebP decode
let lastWarmIdx = -999;
function warmLookahead(idx) {
  if (Math.abs(idx - lastWarmIdx) < (IS_MOBILE ? 4 : 3)) return;
  lastWarmIdx = idx;
  const span = IS_MOBILE ? 16 : 30;
  const end = Math.min(TOTAL - 1, idx + span);
  for (let k = idx; k <= end; k += FRAME_STEP) {
    if (!frames[k]) {
      loadFrame(k, true);
    } else if (!decoded[k]) {
      decodeFrame(k);
    }
  }
}

function computeDrawGeom(srcW, srcH) {
  const sw = srcW, sh = srcH;
  const sx = 0, sy = 0;
  const s = Math.max(cv.width / sw, cv.height / sh);
  const w = sw * s, h = sh * s;
  drawGeom = { sx, sy, sw, sh, dx: (cv.width - w) * 0.5, dy: (cv.height - h) * 0.5, dw: w, dh: h };
  lastSrcW = srcW;
  lastSrcH = srcH;
}

function size(force) {
  // Ignore mobile browser address-bar height-only resize jitter while scrolling
  if (
    force !== true &&
    IS_MOBILE &&
    lastCvWinW > 0 &&
    Math.abs(innerWidth - lastCvWinW) < 2 &&
    Math.abs(innerHeight - lastCvWinH) < 160
  ) {
    return;
  }
  lastCvWinW = innerWidth;
  lastCvWinH = innerHeight;
  // Cap backing-store resolution (854x480 on mobile, 1651x928 on desktop) so GPU blit takes <0.25ms
  const dpr = Math.min(devicePixelRatio || 1, IS_MOBILE ? 1.0 : 1.25);
  const targetW = Math.round(innerWidth * dpr);
  const targetH = Math.round(innerHeight * dpr);
  const maxW = IS_MOBILE ? 854 : 1651;
  const maxH = IS_MOBILE ? 480 : 928;
  const scaleCap = Math.min(1, maxW / Math.max(1, targetW), maxH / Math.max(1, targetH));
  cv.width = Math.max(1, Math.round(targetW * scaleCap));
  cv.height = Math.max(1, Math.round(targetH * scaleCap));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "low";
  drawGeom = null;
  lastPainted = null;
  draw(current);
}

function draw(f) {
  const rawIdx = Math.min(TOTAL - 1, Math.max(0, Math.round(f)));
  const idx = IS_MOBILE ? Math.min(TOTAL - 1, Math.round(rawIdx / FRAME_STEP) * FRAME_STEP) : rawIdx;
  warmLookahead(idx);
  let A = frames[idx];
  if (!A) {
    for (let d = 1; d < TOTAL; d++) {
      if (idx - d >= 0 && frames[idx - d]) { A = frames[idx - d]; break; }
      if (idx + d < TOTAL && frames[idx + d]) { A = frames[idx + d]; break; }
    }
  }
  if (!A || A === lastPainted) return;
  lastPainted = A;
  if (!drawGeom || A.width !== lastSrcW || A.height !== lastSrcH) {
    computeDrawGeom(A.width, A.height);
  }
  const g = drawGeom;
  ctx.drawImage(A, g.sx, g.sy, g.sw, g.sh, g.dx, g.dy, g.dw, g.dh);
}
addEventListener("resize", () => size(false), { passive: true });

/* ---------- studio palette (warm ivory / architectural neutral) ---------- */
const stops = [
  [0.0, [234, 228, 216]],
  [0.5, [226, 220, 208]],
  [1.0, [234, 228, 216]],
];
function accent(p) {
  for (let i = 1; i < stops.length; i++) {
    if (p <= stops[i][0]) {
      const [p0, c0] = stops[i - 1], [p1, c1] = stops[i];
      const t = (p - p0) / (p1 - p0 || 1);
      return c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
    }
  }
  return stops[stops.length - 1][1];
}

/* ---------- scroll story ---------- */
const beats = [...document.querySelectorAll(".beat")].map((el) => ({
  el,
  a: +el.dataset.in,
  o: +el.dataset.out,
  fi: +(el.dataset.fadeIn || 0.035),
  fo: +(el.dataset.fadeOut || 0.035),
  still: el.dataset.still === "1",
  under: el.dataset.under === "1",
  lastV: -1,
  lastPE: "",
}));
const bar = document.getElementById("bar");
const clamp = (v) => Math.min(1, Math.max(0, v));
const state = { f: 0 };
const FADE = 0.035;
const VIDEO_FADE_START_P = 0.68;
const VIDEO_END_P = 0.89;
const smoothstep = (t) => t * t * (3 - 2 * t);
let lastCvOpacity = "";

function update(p) {
  if (bar) bar.style.transform = `scaleX(${p.toFixed(4)})`;
  const fadeT = clamp((p - VIDEO_FADE_START_P) / (VIDEO_END_P - VIDEO_FADE_START_P));
  const cvOpacity = 1 - smoothstep(fadeT);
  const cvOpacityStr = cvOpacity.toFixed(4);
  if (cvOpacityStr !== lastCvOpacity) {
    lastCvOpacity = cvOpacityStr;
    cv.style.opacity = cvOpacityStr;
  }
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    const fadeIn = b.a === 0 ? 1 : smoothstep(clamp((p - b.a) / b.fi));
    const fadeOut = smoothstep(clamp((b.o - p) / b.fo));
    const v = fadeIn * fadeOut;
    if (Math.abs(v - b.lastV) > 0.0005) {
      b.lastV = v;
      b.el.style.opacity = v.toFixed(4);
      if (b.still) {
        b.el.style.transform = "translate3d(0,0,0) scale(1)";
      } else {
        b.el.style.transform = `translate3d(0,${((1 - v) * 40).toFixed(2)}px,0) scale(${(0.96 + 0.04 * v).toFixed(4)})`;
      }
    }
    const pe = v > 0.6 ? "auto" : "none";
    if (pe !== b.lastPE) {
      b.lastPE = pe;
      b.el.style.pointerEvents = pe;
    }
  }
}

let maxContiguous = 0;
function updateContiguous() {
  while (maxContiguous < TOTAL && frames[maxContiguous]) maxContiguous++;
}

function initStory() {
  const c = accent(0);
  document.documentElement.style.setProperty("--accent", `rgb(${c})`);
  gsap.to(state, {
    f: TOTAL - 1, ease: "none",
    scrollTrigger: { trigger: "#story", start: "top top", end: "bottom bottom", scrub: true,
      onUpdate: (s) => {
        const videoProg = Math.min(1, Math.max(0, s.progress / VIDEO_END_P));
        current = videoProg * (TOTAL - 1);
        state.f = current;
        draw(current);
        update(s.progress);
      } },
  });
  update(0);

  initWork();
  initWorkInteractions();
  initTeamExperience();

  /* reveals */
  gsap.utils.toArray(".services li, footer > *").forEach((el) =>
    gsap.from(el, { y: 50, opacity: 0, duration: 1, ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 90%" } })
  );
}

/* ---------- featured work: WebGL card mesh renderer ----------
   One shared transparent canvas draws the six project cards as subdivided quads.
   The vertex shader bends the mesh from scroll velocity, so the image texture itself
   is sheared/bowed (not just clipped). The fragment shader does the rounded corners,
   the bottom-up bloom mask, cover-fit crop, parallax, zoom and directional motion blur.
   It owns no ticker: initWork() adds one callback to the existing gsap.ticker.
   Until a card's texture is uploaded AND a probe render succeeds, its DOM image stays
   visible; on any failure (no WebGL2, context loss, slow device) cards fall back to the
   original DOM images. */
/* GL:BEGIN */
/* Single tunable configuration for Featured Work WebGL2 curvy scroll & curved bloom */
const WORK_GL_CONFIG = {
  bendScale: 1.0,      // Single master multiplier to tune all scroll-bend displacements with one number
  amp: 1.0,            // Desktop scroll-bend amplitude (higher = stronger sheet flex & lag)
  ampMobile: 0.72,     // Mobile / coarse-pointer scroll-bend amplitude
  vref: 1650,          // Reference scroll velocity in px/s for tanh saturation (desktop)
  vrefMobile: 1450,    // Reference scroll velocity in px/s (mobile)
  rise: 16.0,          // How fast bend snaps on when scrolling starts (1/s)
  fall: 5.2,           // How fast bend settles back to flat (~0.5s settle with slight overshoot)
  maxDisp: 36.0,       // Maximum vertex displacement clamp in px (desktop) so image never covers its caption or a neighbor
  maxDispMobile: 22.0, // Maximum vertex displacement clamp in px (mobile)
  blurMax: 12.0,       // Peak directional vertical motion blur in px at high scroll velocity (desktop)
  blurMaxMobile: 6.0,  // Peak directional vertical motion blur in px (mobile)
  bloomArc: 0.14,      // Height of the curved arc on the bottom-up bloom leading edge
  hoverZoom: 0.045,    // Extra zoom factor added via shader uniform (m.hv) on card hover
  dpr: 1.35,           // Max devicePixelRatio for WebGL drawing buffer (desktop)
  dprMobile: 1.15,     // Max devicePixelRatio (mobile)
  mx: 24,              // Horizontal mesh subdivisions per image quad (desktop)
  my: 16,              // Vertical mesh subdivisions per image quad (desktop)
  mxMobile: 14,        // Horizontal mesh subdivisions (mobile)
  myMobile: 9,         // Vertical mesh subdivisions (mobile)
  taps: 5,             // Directional motion-blur kernel taps (desktop)
  tapsMobile: 3,       // Directional motion-blur kernel taps (mobile)
  defaultRadius: 12,   // Fallback corner radius in px (~12px) if getComputedStyle(media).borderRadius is 0
};

function createWorkGL(canvas, onStatus) {
  const VS = `#version 300 es
in vec2 aUv;
uniform vec4 uRect;
uniform vec2 uRes;
uniform float uVel;
uniform float uCol;
uniform float uPhase;
uniform float uMaxDisp;
out vec2 vUv;
void main(){
  vec2 size = uRect.zw;
  float u = aUv.x, v = aUv.y;
  vec2 base = aUv * size;
  vec2 dp = vec2(0.0);
  // Strictly flat when idle: zero vertex displacement below tiny threshold
  if (abs(uVel) >= 0.0005) {
    float a = uVel * (1.0 - 0.12 * abs(uPhase));
    float vc = (v - 0.5) * 2.0; // -1 at top edge (v=0), +1 at bottom edge (v=1)
    float uc = (u - 0.5) * 2.0; // -1 at left edge (u=0), +1 at right edge (u=1)
    // Scroll down (a > 0): bottom edge (v = 1) is trailing; scroll up (a < 0): top edge (v = 0) is trailing
    float dir = 0.5 + 0.5 * tanh(a * 3.0);
    float trail = mix(1.0 - v, v, dir);
    // 1. Top-vs-bottom trapezoid width taper (~10-14% of width at 2000 px/s; top narrows when scrolling down, bottom flares)
    dp.x += uc * vc * a * 0.075 * size.x;
    // 2. Mirrored shear per column (~6-8% of width at 2000 px/s; left & right columns lean in opposite directions)
    dp.x += uCol * a * 0.085 * size.x * (v - 0.5);
    // 3. Side-edge outward bow (~3-4% of width at 2000 px/s; both left and right edges bow outward)
    dp.x += uc * abs(a) * 0.044 * size.x * sin(3.14159265 * v);
    // 4. Top/bottom edge bow (~5-7% of height at 2000 px/s) + trailing edge lag
    dp.y += a * size.y * (0.062 + 0.026 * trail) * sin(3.14159265 * u);
    dp.y += a * size.y * 0.032 * (trail - 0.35);
    dp.y -= (v - 0.5) * size.y * abs(a) * 0.015;
    if (uMaxDisp > 0.0) {
      dp = uMaxDisp * tanh(dp / uMaxDisp);
    }
  }
  vec2 pos = uRect.xy + base + dp;
  gl_Position = vec4(pos.x / uRes.x * 2.0 - 1.0, 1.0 - pos.y / uRes.y * 2.0, 0.0, 1.0);
  vUv = aUv;
}`;
  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uRadius, uReveal, uZoom, uPar, uBlur, uArc;
uniform vec4 uCrop;
uniform int uTaps;
void main(){
  // Rounded-corner image (~12px radius, no panel, no border)
  vec2 q = abs(vUv - 0.5) * uSize - (0.5 * uSize - vec2(uRadius));
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float aa = max(fwidth(sd), 0.0001);
  float rMask = clamp(0.5 - sd / aa, 0.0, 1.0);
  // Curved bottom-up bloom leading edge
  float edge = (1.0 - uReveal) * 1.02 - 0.015 - uArc * sin(3.14159265 * clamp(vUv.x, 0.0, 1.0)) * sin(3.14159265 * uReveal);
  float bMask = smoothstep(edge, edge + 0.02, vUv.y);
  float mask = rMask * bMask;
  if (mask <= 0.0001) discard;
  vec2 b = vec2(vUv.x, (vUv.y + 0.045 - uPar * 0.0109) / 1.09);
  b = (b - 0.5) / uZoom + 0.5;
  vec2 t = vec2(uCrop.z + b.x * uCrop.x, uCrop.w + b.y * uCrop.y);
  vec3 col;
  if (uBlur > 0.25) {
    int hf = max(uTaps / 2, 1);
    float stepV = (uBlur / (max(uSize.y, 1.0) * 1.09)) * uCrop.y / uZoom / float(hf);
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = -3; i <= 3; i++) {
      if (abs(i) > hf) continue;
      float w = exp(-1.15 * float(i * i) / float(hf * hf));
      acc += texture(uTex, vec2(t.x, t.y + float(i) * stepV)).rgb * w;
      wsum += w;
    }
    col = acc / wsum;
  } else {
    col = texture(uTex, t).rgb;
  }
  outColor = vec4(col * mask, mask);
}`;

  let gl = null, prog = null, vao = null, vbo = null, ibo = null, idxCount = 0, U = {};
  let cards = [], enabled = false, cfg = null, dirty = true, lost = false, drewLast = false;
  let vel = 0, velV = 0, lastScroll = null, restoreTimer = 0, lastStatus = "";
  let slowAcc = 0, slowFrames = 0, tier = 0, meshX = 0, meshY = 0;
  let vw = document.documentElement.clientWidth || window.innerWidth || 1;
  let vh = window.innerHeight || 1;
  let probeVerified = false;
  const R = {};
  const status = (s) => { if (s !== lastStatus) { lastStatus = s; onStatus && onStatus(s); } };
  const setReady = (c, v) => {
    if (c.ready !== v) {
      c.ready = v;
      c.onReady && c.onReady(v);
    }
  };

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn("[work-gl] shader:", gl.getShaderInfoLog(s)); return null; }
    return s;
  };
  const buildMesh = (nx, ny) => {
    meshX = nx; meshY = ny;
    const verts = new Float32Array((nx + 1) * (ny + 1) * 2);
    let k = 0;
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { verts[k++] = i / nx; verts[k++] = j / ny; }
    const idx = new Uint16Array(nx * ny * 6);
    k = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    idxCount = idx.length;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  };
  const initGL = () => {
    gl = gl || canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) return false;
    const vs = compile(gl.VERTEX_SHADER, VS), fs = compile(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return false;
    prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "aUv");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn("[work-gl] link:", gl.getProgramInfoLog(prog)); return false; }
    U = {};
    ["uRect", "uRes", "uVel", "uCol", "uPhase", "uMaxDisp", "uTex", "uSize", "uRadius", "uReveal", "uZoom", "uPar", "uBlur", "uArc", "uCrop", "uTaps"]
      .forEach((n) => (U[n] = gl.getUniformLocation(prog, n)));
    vao = gl.createVertexArray(); vbo = gl.createBuffer(); ibo = gl.createBuffer();
    buildMesh(cfg.mx, cfg.my);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return gl.getError() === gl.NO_ERROR;
  };

  const computeCrop = (c) => {
    if (!c.aspect || !c.rect || c.rect.w <= 0 || c.rect.h <= 0) return;
    const Ab = c.rect.w / (c.rect.h * 1.09); // .inner is the media box overscanned by 4.5% top and bottom
    let fu = 1, fv = 1;
    if (c.aspect > Ab) fu = Ab / c.aspect; else fv = c.aspect / Ab;
    c.crop = [fu, fv, (1 - fu) * c.pos[0], (1 - fv) * c.pos[1]];
  };
  const measureCard = (c, sy) => {
    const r = c.wrap.getBoundingClientRect();
    c.rect = { l: r.left, t: r.top + sy, w: r.width, h: r.height };
    if (!c._radiusMeasured) {
      c.radius = parseFloat(getComputedStyle(c.wrap).borderRadius) || WORK_GL_CONFIG.defaultRadius;
      c._radiusMeasured = true;
    }
    computeCrop(c);
  };
  const uploadTexture = (c) => {
    const img = c.img;
    if (!(img && img.naturalWidth)) return false;
    try {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
      if (gl.getError() !== gl.NO_ERROR) { gl.deleteTexture(tex); return false; }
      c.tex = tex; c.aspect = img.naturalWidth / img.naturalHeight;
      computeCrop(c);
      return true;
    } catch (e) { console.warn("[work-gl] texture upload failed:", e && e.message); return false; }
  };
  const setCardUniforms = (c, rectX, rectY, w, h, vVel, col, phase, maxDisp, radius, reveal, zoom, par, blur, arc, taps) => {
    gl.uniform4f(U.uRect, rectX, rectY, w, h);
    gl.uniform2f(U.uSize, w, h);
    gl.uniform1f(U.uVel, vVel); gl.uniform1f(U.uCol, col); gl.uniform1f(U.uPhase, phase); gl.uniform1f(U.uMaxDisp, maxDisp);
    gl.uniform1f(U.uRadius, radius);
    gl.uniform1f(U.uReveal, reveal); gl.uniform1f(U.uZoom, zoom);
    gl.uniform1f(U.uPar, par); gl.uniform1f(U.uBlur, blur); gl.uniform1f(U.uArc, arc);
    gl.uniform1i(U.uTaps, taps);
    gl.uniform4f(U.uCrop, c.crop[0], c.crop[1], c.crop[2], c.crop[3]);
  };
  // Render the image once into a tiny offscreen target; only a clean, non-empty result hands the card over from the DOM image.
  const probe = (c) => {
    let ok = false, fbo = null, ft = null;
    try {
      ft = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, ft);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 8, 8, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ft, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        gl.viewport(0, 0, 8, 8); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog); gl.bindVertexArray(vao);
        gl.uniform2f(U.uRes, 8, 8);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, c.tex); gl.uniform1i(U.uTex, 0);
        setCardUniforms(c, 0, 0, 8, 8, 0, 0, 0, 0, 0, 1, 1, 0, 0, WORK_GL_CONFIG.bloomArc, 1);
        gl.drawElements(gl.TRIANGLES, idxCount, gl.UNSIGNED_SHORT, 0);
        const px = new Uint8Array(4);
        gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        ok = gl.getError() === gl.NO_ERROR && px[3] > 200;
      }
    } catch (e) { ok = false; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    fbo && gl.deleteFramebuffer(fbo); ft && gl.deleteTexture(ft);
    return ok;
  };

  const dropResources = () => { cards.forEach((c) => { c.tex = null; setReady(c, false); }); };
  const failAll = (why) => {
    enabled = false; dropResources(); vel = 0; velV = 0;
    console.info("[work-gl] falling back to the original DOM images (" + why + ")"); /* DIAG */
    status("fallback");
  };
  const degrade = () => {
    tier++;
    if (tier === 1) cfg.taps = 3;
    else if (tier === 2) { cfg.blurMax = 0; buildMesh(12, 8); }
    else failAll("sustained slow frames");
  };

  R.setCards = (list) => {
    cards = list.map((c) => {
      const op = (getComputedStyle(c.img).objectPosition || "50% 0%").split(" ");
      const par = (s) => (s && s.indexOf("%") > -1 ? parseFloat(s) / 100 : 0);
      const o = {
        ...c, pos: [par(op[0]), par(op[1])],
        radius: WORK_GL_CONFIG.defaultRadius,
        tex: null, ready: false, failed: false, imgReady: false, _loggedReady: false,
        rect: null, crop: [1, 1, 0, 0], aspect: 0,
      };
      c.img.removeAttribute("loading");
      c.img.loading = "eager"; // make sure the texture source is fetched even if it is still below the fold
      const onLoaded = () => {
        const done = () => {
          if (c.img.naturalWidth > 0) { o.imgReady = true; dirty = true; }
          else { o.failed = true; console.info(`[work-gl] card "${o.title}" fell back to DOM: naturalWidth is 0`); /* DIAG */ }
        };
        if (c.img.decode) c.img.decode().then(done, done); else done();
      };
      if (c.img.complete && c.img.naturalWidth > 0) {
        onLoaded();
      } else {
        c.img.addEventListener("load", onLoaded, { once: true });
        c.img.addEventListener("error", () => {
          o.failed = true;
          console.info(`[work-gl] card "${o.title}" fell back to DOM: image error event`); /* DIAG */
        }, { once: true });
      }
      return o;
    });
  };
  let workMinTop = 0, workMaxBottom = 1e9;
  R.layout = () => {
    const sy = window.scrollY;
    vw = document.documentElement.clientWidth || window.innerWidth || 1;
    vh = window.innerHeight || 1;
    if (cfg) {
      const d = Math.min(window.devicePixelRatio || 1, cfg.dpr);
      const bw = Math.round(vw * d), bh = Math.round(vh * d);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
    }
    // Batch all DOM reads together before any writes to avoid forced synchronous layout
    const rects = cards.map((c) => c.wrap.getBoundingClientRect());
    let minT = Infinity, maxB = -Infinity;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i], r = rects[i];
      const topDoc = r.top + sy;
      c.rect = { l: r.left, t: topDoc, w: r.width, h: r.height };
      if (r.width > 0 && r.height > 0) {
        if (topDoc < minT) minT = topDoc;
        if (topDoc + r.height > maxB) maxB = topDoc + r.height;
      }
      if (!c._radiusMeasured) {
        c.radius = parseFloat(getComputedStyle(c.wrap).borderRadius) || WORK_GL_CONFIG.defaultRadius;
        c._radiusMeasured = true;
      }
      computeCrop(c);
    }
    if (minT < Infinity) {
      workMinTop = minT;
      workMaxBottom = maxB;
    }
    dirty = true;
  };
  R.markDirty = () => { dirty = true; };
  R.enable = (conf) => {
    cfg = { ...conf };
    tier = 0; slowAcc = 0; slowFrames = 0;
    if (lost) return false;
    if (!gl || !prog) { if (!initGL()) { failAll("WebGL2 unavailable"); return false; } }
    else buildMesh(cfg.mx, cfg.my);
    enabled = true; vel = 0; velV = 0; lastScroll = null; dirty = true;
    R.layout();
    status("on");
    return true;
  };
  R.disable = () => {
    enabled = false; vel = 0; velV = 0;
    cards.forEach((c) => setReady(c, false));
    if (gl && !lost) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    status("off");
  };

  R.tick = (time, dtMs) => {
    if (!enabled || lost || !gl) return;
    const sy = window.scrollY;
    // Stay completely idle while the user is watching the #story intro sequence far above #work
    const nearWork = (sy + vh >= workMinTop - vh * 1.5) && (sy <= workMaxBottom + vh * 1.5);
    if (!nearWork && !drewLast) {
      lastScroll = sy;
      vel = 0;
      velV = 0;
      return;
    }

    const real = Math.min(Math.max((dtMs || 16.7) / 1000, 0.008), 0.1);
    const dt = Math.min(real, 0.05);

    // scroll velocity -> tanh-saturated target in [-1, 1], snaps on with cfg.rise, settles in ~0.5s with slight overshoot via cfg.fall
    if (lastScroll === null) lastScroll = sy;
    const inst = (sy - lastScroll) / real; lastScroll = sy;
    const target = Math.tanh(inst / cfg.vref);
    if (Math.abs(target) > Math.abs(vel) && target * vel >= 0) {
      vel += (target - vel) * (1 - Math.exp(-dt * cfg.rise));
      velV = (target - vel) * cfg.fall * 0.4;
    } else {
      const w = cfg.fall * 1.75; // ~9.1 rad/s for fall=5.2 -> ~0.5s settle with a subtle ~4% elastic overshoot
      const zeta = 0.68;
      const accel = w * w * (target - vel) - 2 * zeta * w * velV;
      velV += accel * dt;
      vel += velV * dt;
    }
    if (Math.abs(vel) < 0.0005 && Math.abs(velV) < 0.005 && Math.abs(target) < 0.0005 && (vel !== 0 || velV !== 0)) {
      vel = 0; velV = 0; dirty = true;
    }
    if (vel !== 0 || velV !== 0 || sy !== R._sy) dirty = true;
    R._sy = sy;

    // Upload newly decoded textures when near #work (at most 1 per frame while scrolling so texture upload never spikes frame time)
    const newlyReadyList = [];
    let uploadsThisTick = 0;
    const maxUploads = Math.abs(vel) > 0.05 ? 1 : 4;
    for (const c of cards) {
      if (c.imgReady && !c.tex && !c.failed) {
        if (c_ok(c, sy)) {
          newlyReadyList.push(c);
          dirty = true;
        }
        if (++uploadsThisTick >= maxUploads) break;
      }
    }

    // frame-time watchdog while the effect is visibly active
    if (Math.abs(vel) > 0.1 && dtMs < 250) {
      slowAcc += dtMs; slowFrames++;
      if (slowFrames >= 45) { if (slowAcc / slowFrames > 45) degrade(); slowAcc = 0; slowFrames = 0; }
    }
    if (!enabled) return;

    if (!dirty) return;
    dirty = false;
    render(sy);
    // Handoff DOM -> WebGL after WebGL has rendered this exact frame (same st.reveal / st.zoom / st.par) so there is zero flash or jump
    for (const nr of newlyReadyList) {
      if (nr.ready && nr.onReady) nr.onReady(true);
    }
  };
  const c_ok = (c, sy) => {
    if (!uploadTexture(c)) {
      c.failed = true; c.tex = null;
      console.info(`[work-gl] card "${c.title}" fell back to DOM: texture upload failed`); /* DIAG */
      return false;
    }
    // Only run the synchronous gl.readPixels FBO probe once to verify the GPU pipeline works, avoiding repeated GPU pipeline stalls
    if (!probeVerified) {
      if (!probe(c)) {
        gl.deleteTexture(c.tex); c.tex = null; c.failed = true;
        console.info(`[work-gl] card "${c.title}" fell back to DOM: offscreen probe render failed`); /* DIAG */
        return false;
      }
      probeVerified = true;
    }
    if (!c.rect || c.rect.w <= 0 || c.rect.h <= 0) {
      measureCard(c, sy !== undefined ? sy : window.scrollY);
    }
    c.ready = true;
    if (!c._loggedReady) {
      c._loggedReady = true;
      console.info(`[work-gl] card ready: "${c.title}" (${c.img.naturalWidth}x${c.img.naturalHeight})`); /* DIAG */
      const readyCount = cards.filter((x) => x.ready).length;
      if (readyCount === cards.length) {
        console.info(`[work-gl] all ${readyCount}/${cards.length} cards ready (active path: WebGL2)`); /* DIAG */
      }
    }
    if (cards.every((x) => x.failed)) failAll("no card could be rendered");
    return true;
  };
  const render = (sy) => {
    const margin = 160;
    // Use cached document-space rects (updated on resize / ResizeObserver / ScrollTrigger refresh) so scrolling has ZERO forced layout reflows
    const vis = [];
    for (const c of cards) {
      if (!c.ready) continue;
      if (!c.rect || c.rect.w <= 0 || c.rect.h <= 0) {
        measureCard(c, sy);
      }
      if (!c.rect || c.rect.w <= 0 || c.rect.h <= 0) continue;
      const top = c.rect.t - sy;
      const bottom = top + c.rect.h;
      if (top < vh + margin && bottom > -margin) {
        // Compute vertical parallax directly from viewport position (replaces 8 separate per-card ScrollTriggers)
        const parProg = Math.max(0, Math.min(1, (vh - top) / Math.max(1, vh + c.rect.h)));
        c.st.par = -3.5 + 7.0 * parProg;
        vis.push(c);
      }
    }
    if (!vis.length && !drewLast) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    drewLast = vis.length > 0;
    if (!vis.length) return;
    gl.useProgram(prog); gl.bindVertexArray(vao);
    gl.uniform2f(U.uRes, vw, vh);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(U.uTex, 0);
    const a = Math.abs(vel);
    const blur = cfg.blurMax > 0 && a >= 0.0005 ? Math.pow(Math.min(1, a), 1.15) * cfg.blurMax : 0;
    const arc = cfg.bloomArc !== undefined ? cfg.bloomArc : WORK_GL_CONFIG.bloomArc;
    const hZoom = cfg.hoverZoom !== undefined ? cfg.hoverZoom : WORK_GL_CONFIG.hoverZoom;
    const bScale = cfg.bendScale !== undefined ? cfg.bendScale : WORK_GL_CONFIG.bendScale;
    const maxDisp = cfg.maxDisp !== undefined ? cfg.maxDisp : WORK_GL_CONFIG.maxDisp;
    const vScaled = vel * cfg.amp * bScale;
    for (const c of vis) {
      const y = c.rect.t - sy;
      const phase = Math.max(-1, Math.min(1, (y + c.rect.h / 2 - vh / 2) / (vh / 2)));
      const col = Math.max(-1, Math.min(1, (c.rect.l + c.rect.w / 2 - vw / 2) / (vw * 0.25)));
      const hv = c.hv ? c.hv.v : 0;
      gl.bindTexture(gl.TEXTURE_2D, c.tex);
      setCardUniforms(c, c.rect.l, y, c.rect.w, c.rect.h, vScaled, col, phase, maxDisp, c.radius,
        c.st.reveal, c.st.zoom * (1 + hZoom * hv), c.st.par, blur, arc, cfg.taps);
      gl.drawElements(gl.TRIANGLES, idxCount, gl.UNSIGNED_SHORT, 0);
    }
    if (R._checked !== true) { R._checked = true; if (gl.getError() !== gl.NO_ERROR) failAll("GL error on first render"); }
  };

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault(); lost = true; prog = null; dropResources(); status("lost");
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => { if (lost) { console.info("[work-gl] context not restored; DOM images stay in use"); status("fallback"); } }, 4000);
  });
  canvas.addEventListener("webglcontextrestored", () => {
    clearTimeout(restoreTimer); lost = false; prog = null; R._checked = false;
    if (cfg && initGL()) { dirty = true; if (enabled) status("on"); } else failAll("context restore failed");
  });
  R.destroy = () => { clearTimeout(restoreTimer); enabled = false; dropResources(); };
  return R;
}
/* GL:END */

/* REEL:BEGIN */
// Arcade/bingo title reel. Every character is a clipped column holding two REAL letters from the same title:
// a neighbouring letter, then the correct one. The drum rolls upward: blank -> neighbour letter (held, readable)
// -> final letter. At rest (no transform) the final letter is showing, so the title is always readable even if
// script never runs. All columns roll the same direction.
function buildTitleReels(titleEl, rawTitle) {
  const letters = [...rawTitle].filter((c) => !/\s/.test(c));
  const n = Math.max(letters.length, 1);
  const drums = [];
  let j = 0;
  rawTitle.split(/\s+/).forEach((word) => {
    const wSpan = document.createElement("span");
    wSpan.className = "t-word";
    wSpan.setAttribute("aria-hidden", "true");
    [...word].forEach((ch) => {
      const k = j++;
      const col = document.createElement("span"); col.className = "reel-col";
      const size = document.createElement("span"); size.className = "reel-size"; size.textContent = ch;
      const drum = document.createElement("span"); drum.className = "reel-drum";
      // the letter shown first: the nearest earlier letter of this title that differs from the final one
      let lead = ch;
      for (let b = 1; b <= n; b++) { const c = letters[(k - b + n * 2) % n]; if (c !== ch) { lead = c; break; } }
      [lead, ch].forEach((s, i) => {
        const it = document.createElement("i");
        it.textContent = s;
        if (i === 1) it.className = "final";
        drum.appendChild(it);
      });
      col.append(size, drum);
      wSpan.appendChild(col);
      drums.push({ drum, k });
    });
    titleEl.appendChild(wSpan);
  });
  return { drums, count: n };
}
/* REEL:END */

/* ---------- featured work: editorial grid + organic section lines ----------
   One system, built inside gsap.matchMedia so breakpoint / reduced-motion changes
   revert every tween, ScrollTrigger and listener it created. It reuses the Lenis
   instance, ScrollTrigger and the single gsap.ticker above (one extra ticker callback,
   added and removed with the matchMedia context). */
function initWork() {
  const mainEl = document.getElementById("top");
  const work = document.getElementById("work"), services = document.getElementById("services"),
    brands = document.getElementById("brands"), team = document.getElementById("team"),
    contact = document.getElementById("contact");
  const svgA = document.getElementById("line-a");
  if (!work || !services || !team || !svgA) return;
  const head = work.querySelector(".work-head"), title = work.querySelector(".work-title");
  const wiWords = gsap.utils.toArray(".wi", title), side = gsap.utils.toArray(".work-intro, .work-caps li", head);
  const projs = gsap.utils.toArray("#work .proj");
  const grid = work.querySelector(".work-grid");
  const glCanvas = document.getElementById("work-gl");
  const abs = (el) => el.getBoundingClientRect().top + window.scrollY;

  const GLYPHS = "+I/F4_<L8X#@7%09ZKW3=";

  // Split heading words into per-character overflow masks (.h-char > .h-glyph)
  const headGlyphs = [];
  wiWords.forEach((wordEl) => {
    const txt = wordEl.textContent || "";
    wordEl.textContent = "";
    [...txt].forEach((ch) => {
      const wrap = document.createElement("span");
      wrap.className = "h-char";
      const g = document.createElement("span");
      g.className = "h-glyph";
      g.textContent = ch;
      wrap.appendChild(g);
      wordEl.appendChild(wrap);
      headGlyphs.push(g);
    });
  });

  // Per-project parts + title reels (real letters only)
  const projMeta = projs.map((p, idx) => {
    const mediaWrap = p.querySelector(".mediaWrap");
    const media = p.querySelector(".media");
    const inner = p.querySelector(".inner");
    const zoom = p.querySelector(".zoom");
    const img = p.querySelector(".zoom img");
    const cap = p.querySelector(".cap");
    const numEl = p.querySelector(".cap-top .n");
    const catEl = p.querySelector(".cap-top .cat");
    const titleEl = p.querySelector(".cap .t");
    const descEl = p.querySelector(".cap .desc");
    const linksEl = p.querySelector(".cap .links");

    const rawTitle = (titleEl && (titleEl.dataset.title || titleEl.childNodes[0]?.nodeValue || titleEl.textContent))
      .replace(/\s*\(opens in a new tab\)\s*/i, "")
      .trim();
    const srEl = titleEl ? titleEl.querySelector(".sr") : null;
    const catFull = catEl ? (catEl.dataset.cat || catEl.textContent).trim() : "";

    let drums = [], count = 1;
    if (titleEl) {
      titleEl.textContent = "";
      ({ drums, count } = buildTitleReels(titleEl, rawTitle));
      const srTitle = document.createElement("span");
      srTitle.className = "sr";
      srTitle.textContent = rawTitle + (srEl ? " " + srEl.textContent : "");
      titleEl.appendChild(srTitle);
    }

    return {
      p, idx, mediaWrap, media, inner, zoom, img, cap, numEl, catEl, catFull,
      titleEl, rawTitle, drums, count, descEl, linksEl,
      st: { reveal: 0, zoom: 1.18, par: -3.5 }, // shared by the DOM fallback and the WebGL renderer
      hv: { v: 0 }, glReady: false, hovered: false,
    };
  });

  // Format Category text with deterministic Lusion-style leading-edge glyph scramble (+I/F4_<L8X)
  const formatCategory = (full, prog, seed) => {
    if (prog <= 0.01) return "";
    if (prog >= 0.99) return full;
    const len = full.length;
    const locked = Math.floor(prog * len);
    const tailLen = Math.min(4, len - locked);
    let out = full.slice(0, locked);
    const step = Math.floor(prog * 28);
    for (let j = 0; j < tailLen; j++) {
      const c = full[locked + j];
      if (c === " ") {
        out += " ";
      } else {
        out += GLYPHS[(seed * 11 + locked * 7 + j * 13 + step * 5) % GLYPHS.length];
      }
    }
    return out;
  };

  // Dense, symmetrical harmonic S-curves across the entire vertical height of the site
  const buildWaypoints = (mobile, H) => {
    const targetHalfWave = mobile ? 310 : 370;
    const halfWaves = Math.max(8, Math.round(H / targetHalfWave));
    const stepY = H / halfWaves;
    const pts = [];
    for (let i = 0; i <= halfWaves; i++) {
      const y = i * stepY;
      let x;
      if (i === 0) {
        x = mobile ? 1.06 : 1.04;
      } else if (i === halfWaves) {
        x = i % 2 === 1 ? (mobile ? -0.06 : -0.04) : (mobile ? 1.06 : 1.04);
      } else {
        const side = i % 2 === 1 ? -1 : 1;
        const amp = (mobile ? 0.41 : 0.40) + 0.035 * Math.sin(i * 0.85);
        x = 0.5 + side * amp;
      }
      pts.push([x, y]);
    }
    return pts;
  };
  // Exact vertical-tangent symmetric S-curve cubic Beziers between crests for clean architectural geometry
  const spline = (pts, W) => {
    const P = pts.map(([x, y]) => [x * W, y]);
    if (P.length < 2) return "";
    const f = (n) => n.toFixed(1);
    const k = 0.46;
    let d = `M${f(P[0][0])},${f(P[0][1])}`;
    for (let i = 0; i < P.length - 1; i++) {
      const [x0, y0] = P[i];
      const [x1, y1] = P[i + 1];
      const dy = y1 - y0;
      d += ` C${f(x0)},${f(y0 + dy * k)} ${f(x1)},${f(y1 - dy * k)} ${f(x1)},${f(y1)}`;
    }
    return d;
  };
  const place = (svg, W, H, pts, sw) => {
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.width = W + "px"; svg.style.height = H + "px";
    const d = spline(pts, W);
    const grads = svg.querySelectorAll("linearGradient");
    grads.forEach((g) => g.setAttribute("y2", H));
    const paths = [...svg.querySelectorAll("path")];
    const mainPath = svg.querySelector(".swoosh-main") || paths[0];
    const widths = new Map([
      ["swoosh-aura", Math.round(sw * 2.1)],
      ["swoosh-main", sw],
    ]);
    paths.forEach((p) => {
      p.setAttribute("d", d);
      const cls = [...p.classList].find((c) => widths.has(c));
      p.style.strokeWidth = (cls ? widths.get(cls) : sw) + "px";
    });
    const L = Math.ceil(mainPath.getTotalLength()) + 2;
    paths.forEach((p) => { p.style.strokeDasharray = `${L} ${L}`; });
    const N = 320;
    const ys = new Float64Array(N + 1);
    const lens = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const s = (i / N) * L;
      const pt = mainPath.getPointAtLength(Math.min(L - 2, s));
      ys[i] = i === 0 ? Math.max(0, pt.y) : Math.max(ys[i - 1], pt.y);
      lens[i] = s;
    }
    return { path: mainPath, paths, L, H, ys, lens };
  };
  const lookupLen = (data, targetY) => {
    const { ys, lens, L } = data;
    const n = ys.length - 1;
    if (targetY <= ys[0]) return 0;
    if (targetY >= ys[n]) return L;
    let lo = 0, hi = n;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (ys[mid] <= targetY) lo = mid; else hi = mid;
    }
    const span = ys[hi] - ys[lo];
    const t = span > 0.001 ? (targetY - ys[lo]) / span : 0;
    return lens[lo] + (lens[hi] - lens[lo]) * t;
  };
  const setRibbonOffset = (data, offset) => {
    if (!data) return;
    const val = typeof offset === "number" ? offset.toFixed(1) : offset;
    data.paths.forEach((p) => { p.style.strokeDashoffset = val; });
  };

  // DOM (original-image) presentation of the bloom state. Used until WebGL has taken a card over, and as the fallback.
  let animating = false;
  const applyDom = (m) => {
    if (!animating || m.glReady) return;
    if (!m._rad) m._rad = parseFloat(getComputedStyle(m.media).borderRadius) || WORK_GL_CONFIG.defaultRadius;
    const rad = m._rad;
    const z = m.st.zoom * (1 + WORK_GL_CONFIG.hoverZoom * (m.hv ? m.hv.v : 0));
    m.media.style.clipPath = `inset(${((1 - m.st.reveal) * 100).toFixed(2)}% 0% 0% 0% round ${rad}px)`;
    m.zoom.style.transform = `scale(${z.toFixed(4)})`;
    m.inner.style.transform = `translate3d(0,${m.st.par.toFixed(3)}%,0)`;
  };
  const clearDom = (m) => { m.media.style.clipPath = ""; m.zoom.style.transform = ""; m.inner.style.transform = ""; };

  const hasGL2 = (() => {
    try { return !!(glCanvas && window.WebGL2RenderingContext && glCanvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false })); }
    catch (_) { return false; }
  })();
  console.info("[work-gl] WebGL2 created:", hasGL2); /* DIAG */
  const renderer = hasGL2 ? createWorkGL(glCanvas, (s) => {
    work.dataset.gl = s;
    work.classList.toggle("gl-on", s === "on");
    console.info(`[work-gl] work.dataset.gl = "${s}" (active path: ${s === "on" ? "WebGL2" : "DOM fallback"})`); /* DIAG */
  }) : null;
  if (!hasGL2) {
    work.dataset.gl = "fallback";
    console.info('[work-gl] work.dataset.gl = "fallback" (reason: WebGL2 context unavailable)'); /* DIAG */
  }
  work._glRenderer = renderer;
  if (renderer) {
    renderer.setCards(projMeta.map((m) => ({
      title: m.rawTitle, card: m.p, wrap: m.media, img: m.img, st: m.st, hv: m.hv,
      onReady: (v) => { m.glReady = v; m.p.classList.toggle("gl-ready", v); v ? clearDom(m) : applyDom(m); },
    })));
  }
  const sync = (m) => { applyDom(m); renderer && renderer.markDirty(); };

  const mm = gsap.matchMedia();
  mm.add({ any: "(min-width: 1px)", calm: "(prefers-reduced-motion: reduce)", mobile: "(max-width: 700px)", coarse: "(pointer: coarse)" }, (c) => {
    const { calm, mobile, coarse } = c.conditions;
    let A;
    const lineProxy = { p: 0 };

    const layout = () => {
      const W = document.documentElement.clientWidth;
      const sw = Math.round(Math.max(16, Math.min(48, W * (mobile ? 0.036 : 0.028))));
      const aTop = abs(services);
      const endEl = contact || team;
      const aEnd = abs(endEl) + endEl.offsetHeight;
      const H = Math.max(400, Math.round(aEnd - aTop));
      const mainTop = mainEl ? abs(mainEl) : 0;
      svgA.style.top = Math.round(aTop - mainTop) + "px";
      const pts = buildWaypoints(mobile, H);
      A = place(svgA, W, H, pts, sw);
      const maskEl = svgA.querySelector("#mLineATeam");
      const maskBg = svgA.querySelector("#mLineABg");
      const maskCut = svgA.querySelector("#mLineACut");
      if (maskEl) {
        maskEl.setAttribute("width", String(W));
        maskEl.setAttribute("height", String(H));
      }
      if (maskBg) {
        maskBg.setAttribute("width", String(W));
        maskBg.setAttribute("height", String(H));
      }
      if (maskCut && team) {
        const teamEl = document.getElementById("team-canvas") || team;
        const teamSmall = window.matchMedia("(max-width: 760px)").matches;
        const teamW = teamEl.clientWidth || W;
        const teamH = teamEl.clientHeight || team.offsetHeight || window.innerHeight;
        const teamTopInSvg = abs(teamEl) - aTop;
        const targetW = Math.min(teamW * (teamSmall ? 0.88 : 0.62), teamSmall ? 520 : 790);
        const targetH = teamH * (teamSmall ? 0.65 : 0.82);
        maskCut.setAttribute("cx", (teamW * (teamSmall ? 0.5 : 0.52)).toFixed(1));
        maskCut.setAttribute("cy", (teamTopInSvg + teamH * 0.48).toFixed(1));
        maskCut.setAttribute("rx", (targetW * 0.58).toFixed(1));
        maskCut.setAttribute("ry", (targetH * 0.60).toFixed(1));
      }
      if (calm) {
        setRibbonOffset(A, 0);
      } else {
        const drawn = lookupLen(A, lineProxy.p * A.H);
        setRibbonOffset(A, A.L - drawn);
      }
    };
    layout();
    ScrollTrigger.addEventListener("refreshInit", layout);
    const glLayout = () => renderer && renderer.layout();
    ScrollTrigger.addEventListener("refresh", glLayout);
    grid && grid.addEventListener("transitionend", glLayout);
    const ro = "ResizeObserver" in window && grid ? new ResizeObserver(() => glLayout()) : null;
    if (ro) ro.observe(grid);

    if (calm) {
      animating = false;
      console.info("[work-gl] prefers-reduced-motion active; disabling WebGL2 and using static DOM images"); /* DIAG */
      renderer && renderer.disable();
      setRibbonOffset(A, 0);
      projMeta.forEach((m) => {
        const { drums, catEl, catFull } = m;
        clearDom(m);
        if (catEl) catEl.textContent = catFull;
        drums.forEach(({ drum }) => gsap.set(drum, { yPercent: 0 })); // final letters showing
      });
      return () => {
        ScrollTrigger.removeEventListener("refreshInit", layout);
        ScrollTrigger.removeEventListener("refresh", glLayout);
        grid && grid.removeEventListener("transitionend", glLayout);
        ro && ro.disconnect();
      };
    }

    animating = true;
    projMeta.forEach((m) => { m.st.reveal = 0; m.st.zoom = 1.18; m.st.par = -3.5; m.hv.v = 0; applyDom(m); });

    // 1. Continuous seamless ribbon: smoothly tracks scroll from Services down to Footer
    gsap.fromTo(lineProxy, { p: 0 }, {
      p: 1, ease: "none",
      scrollTrigger: { trigger: svgA, start: "top 82%", end: "bottom bottom", scrub: 0.75, invalidateOnRefresh: true },
      onUpdate: () => {
        if (!A) return;
        const drawn = lookupLen(A, lineProxy.p * A.H);
        setRibbonOffset(A, A.L - drawn);
      },
    });

    // 2. Featured Work heading: per-character overflow-masked wave reveal + coordinated side paragraph & capabilities
    gsap.set(headGlyphs, { yPercent: 115, rotateZ: 4, transformOrigin: "0% 100%" });
    gsap.set(side, { y: 22, opacity: 0 });
    gsap.timeline({
      defaults: { ease: "power3.out" },
      scrollTrigger: { trigger: head, start: "top 92%", end: "top 42%", scrub: 0.65, invalidateOnRefresh: true },
    })
      .to(headGlyphs, { yPercent: 0, rotateZ: 0, duration: 0.65, stagger: 0.028, ease: "power3.out" }, 0)
      .to(side, { y: 0, opacity: 1, duration: 0.48, stagger: 0.055, ease: "power3.out" }, 0.28);

    // 3. Projects: time-based bottom-up bloom on view (top 88%) -> scale settle -> caption & title reel after ~40% revealed
    projMeta.forEach((item, i) => {
      const { p, numEl, catEl, catFull, drums, count, descEl, linksEl, st } = item;
      const right = !mobile && i % 2 === 1;
      const rowDelay = right ? 0.08 : 0;
      const capStart = rowDelay + 0.44; // ~40% of 1.1s bloom

      if (numEl) gsap.set(numEl, { yPercent: 110, opacity: 0 });
      if (descEl) gsap.set(descEl, { y: 16, opacity: 0 });
      if (linksEl) gsap.set(linksEl, { y: 14, opacity: 0 });

      // Reels start fully below their clipped window (blank, like the reference)
      drums.forEach(({ drum }) => gsap.set(drum, { yPercent: 100 }));

      const catState = { p: 0 };
      if (catEl) catEl.textContent = "";

      const revealTl = gsap.timeline({
        paused: true,
        onUpdate: () => sync(item),
        onReverseComplete: () => {
          st.reveal = 0;
          st.zoom = 1.18;
          if (catEl) catEl.textContent = "";
          sync(item);
        },
      });

      // Step A: ~1.1s bottom-up bloom + 1.18 -> 1 scale settle (same state feeds the WebGL shader or the DOM fallback)
      revealTl
        .fromTo(st, { reveal: 0 }, { reveal: 1, duration: 1.1, ease: "power3.inOut", immediateRender: false }, rowDelay)
        .fromTo(st, { zoom: 1.18 }, { zoom: 1, duration: 1.15, ease: "power3.out", immediateRender: false }, rowDelay);

      // Step B: index & category decode (~40% revealed)
      if (numEl) revealTl.to(numEl, { yPercent: 0, opacity: 0.75, duration: 0.35, ease: "power2.out" }, capStart);
      if (catEl) {
        revealTl.fromTo(catState, { p: 0 }, {
          p: 1, duration: 0.5, ease: "none", immediateRender: false,
          onUpdate: () => {
            const nextTxt = formatCategory(catFull, catState.p, i + 1);
            if (nextTxt !== item._lastCat) {
              item._lastCat = nextTxt;
              catEl.textContent = nextTxt;
            }
          },
        }, capStart + 0.04);
      }

      // Step C: arcade title reel (~40% revealed)
      const TITLE = { rollIn: 0.38, hold: 0.08, rollOut: 0.42 };
      const stagger = count > 1 ? Math.max(0.02, Math.min(0.055, 0.32 / (count - 1))) : 0;
      drums.forEach(({ drum, k }) => {
        const s0 = capStart + 0.06 + k * stagger;
        revealTl
          .to(drum, { yPercent: 50, duration: TITLE.rollIn, ease: "power2.out" }, s0)
          .to(drum, { yPercent: 0, duration: TITLE.rollOut, ease: "power2.inOut" }, s0 + TITLE.rollIn + TITLE.hold);
      });

      // Step D: supporting description and links
      if (descEl) revealTl.to(descEl, { y: 0, opacity: 1, duration: 0.42, ease: "power3.out" }, capStart + 0.24);
      if (linksEl) revealTl.to(linksEl, { y: 0, opacity: 1, duration: 0.38, ease: "power3.out" }, capStart + 0.32);

      // Attach ScrollTrigger AFTER all tweens are populated on revealTl so initial in-view evaluation never runs on a 0-duration timeline
      const syncTriggerState = (self) => {
        if (self.scroll() > self.end) {
          revealTl.progress(1);
          sync(item);
        } else if (self.isActive || self.scroll() >= self.start) {
          revealTl.play();
        } else {
          revealTl.pause(0);
          st.reveal = 0;
          st.zoom = 1.18;
          sync(item);
        }
      };
      const stTrig = ScrollTrigger.create({
        trigger: p,
        start: "top 88%",
        end: "bottom top",
        onEnter: () => revealTl.play(),
        onEnterBack: () => {
          if (revealTl.progress() < 1 && !revealTl.isActive()) revealTl.play();
        },
        onLeaveBack: () => revealTl.reverse(),
        onRefresh: syncTriggerState,
      });
      syncTriggerState(stTrig);
    });

    // 4. WebGL mesh deformation: one extra callback on the existing ticker, driven by scroll velocity
    let glTick = null;
    if (renderer) {
      const small = mobile || coarse;
      const scale = Math.max(0.5, Math.min(1.2, innerWidth / 1908));
      renderer.enable({
        dpr: small ? WORK_GL_CONFIG.dprMobile : WORK_GL_CONFIG.dpr,
        mx: small ? WORK_GL_CONFIG.mxMobile : WORK_GL_CONFIG.mx,
        my: small ? WORK_GL_CONFIG.myMobile : WORK_GL_CONFIG.my,
        taps: small ? WORK_GL_CONFIG.tapsMobile : WORK_GL_CONFIG.taps,
        blurMax: (small ? WORK_GL_CONFIG.blurMaxMobile : WORK_GL_CONFIG.blurMax) * (small ? 1 : scale),
        bendScale: WORK_GL_CONFIG.bendScale,
        amp: small ? WORK_GL_CONFIG.ampMobile : WORK_GL_CONFIG.amp,
        vref: small ? WORK_GL_CONFIG.vrefMobile : WORK_GL_CONFIG.vref,
        rise: WORK_GL_CONFIG.rise,
        fall: WORK_GL_CONFIG.fall,
        maxDisp: small ? WORK_GL_CONFIG.maxDispMobile : WORK_GL_CONFIG.maxDisp,
        bloomArc: WORK_GL_CONFIG.bloomArc,
        hoverZoom: WORK_GL_CONFIG.hoverZoom,
      });
      glTick = (t, dt) => renderer.tick(t, dt);
      gsap.ticker.add(glTick);
    }

    // hover: arrow + title shift stay in CSS; the card tint, border brightening and image zoom run through the shader uniform (m.hv)
    const setHover = (proj) => projMeta.forEach((m) => {
      const on = m.p === proj;
      if (m.hovered === on) return;
      m.hovered = on;
      gsap.to(m.hv, { v: on ? 1 : 0, duration: 1.15, ease: "power3.out", onUpdate: () => sync(m) });
    });
    const onOver = (e) => setHover(e.target.closest && e.target.closest(".proj"));
    const onLeave = () => setHover(null);
    if (!coarse) {
      grid.addEventListener("pointerover", onOver);
      grid.addEventListener("pointerleave", onLeave);
      grid.addEventListener("focusin", onOver);
      grid.addEventListener("focusout", onLeave);
    }

    // Video previews play only while visible
    const vids = work.querySelectorAll("video"), vio = "IntersectionObserver" in window && vids.length
      ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { const r = e.target.play(); r && r.catch && r.catch(() => {}); } else e.target.pause(); }), { threshold: 0.25 }) : null;
    vids.forEach((v) => { v.muted = true; v.loop = true; v.playsInline = true; vio && vio.observe(v); });

    return () => {
      animating = false;
      ScrollTrigger.removeEventListener("refreshInit", layout);
      ScrollTrigger.removeEventListener("refresh", glLayout);
      grid && grid.removeEventListener("transitionend", glLayout);
      ro && ro.disconnect();
      glTick && gsap.ticker.remove(glTick);
      renderer && renderer.disable();
      grid.removeEventListener("pointerover", onOver);
      grid.removeEventListener("pointerleave", onLeave);
      grid.removeEventListener("focusin", onOver);
      grid.removeEventListener("focusout", onLeave);
      vio && vio.disconnect();
      projMeta.forEach((m) => {
        const { catEl, catFull } = m;
        if (catEl) catEl.textContent = catFull;
        clearDom(m);
        m.p.classList.remove("gl-ready"); m.glReady = false; m.hovered = false;
      });
    };
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      ScrollTrigger.refresh();
      renderer && renderer.layout();
    });
  }
}

/* ---------- featured work: interactive filters, layout switcher & quick view / PDF modals ---------- */
function initWorkInteractions() {
  const work = document.getElementById("work");
  if (!work) return;

  const projs = work.querySelectorAll(".proj");
  const controlsBar = work.querySelector(".work-controls-bar");
  const tabsWrap = work.querySelector(".work-filter-tabs");
  const filterTabs = work.querySelectorAll(".filter-tab");
  const pillBg = work.querySelector(".filter-pill-bg");
  const hoverBg = work.querySelector(".filter-hover-bg");
  const viewBtns = work.querySelectorAll(".view-btn");
  const grid = work.querySelector(".work-grid");
  const countEl = document.getElementById("work-visible-count");
  const modal = document.getElementById("work-modal");

  // Sliding active pill & hover ghost pill inside .work-filter-tabs
  const movePillTo = (targetEl, tabEl, immediate = false) => {
    if (!targetEl || !tabEl || !tabsWrap) return;
    const x = tabEl.offsetLeft;
    const y = tabEl.offsetTop;
    const w = tabEl.offsetWidth;
    const h = tabEl.offsetHeight;
    if (immediate || !window.gsap) {
      gsap.set(targetEl, { x, y, width: w, height: h });
    } else {
      gsap.to(targetEl, {
        x,
        y,
        width: w,
        height: h,
        duration: 0.46,
        ease: "expo.out",
        overwrite: "auto",
      });
    }
  };

  const syncActivePill = (immediate = false) => {
    const activeTab = work.querySelector(".filter-tab.is-active") || filterTabs[0];
    if (activeTab && pillBg) {
      filterTabs.forEach((t) => t.classList.add("has-pill"));
      movePillTo(pillBg, activeTab, immediate);
    }
  };

  syncActivePill(true);
  requestAnimationFrame(() => syncActivePill(true));
  window.addEventListener("resize", () => syncActivePill(true), { passive: true });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => syncActivePill(true));
  }
  if (window.ScrollTrigger) {
    window.ScrollTrigger.addEventListener("refresh", () => syncActivePill(true));
  }

  // Entrance reveal on .work-controls-bar (no vertical shift on filterTabs so "All Works" stays strictly inside the bar)
  if (controlsBar && window.gsap && window.ScrollTrigger && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    gsap.fromTo(
      controlsBar,
      { y: 18, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.7,
        ease: "power3.out",
        onComplete: () => syncActivePill(true),
        scrollTrigger: {
          trigger: controlsBar,
          start: "top 92%",
          toggleActions: "play none none reverse",
        },
      }
    );
  }

  // Hover ghost pill on filter tabs (strictly contained, zero x/y drift)
  filterTabs.forEach((tab) => {
    tab.addEventListener("pointerenter", () => {
      if (hoverBg) {
        movePillTo(hoverBg, tab, hoverBg.style.opacity === "0" || !hoverBg.style.opacity);
        gsap.to(hoverBg, { opacity: 1, duration: 0.2, ease: "power2.out" });
      }
    });
  });

  if (tabsWrap && hoverBg) {
    tabsWrap.addEventListener("pointerleave", () => {
      gsap.to(hoverBg, { opacity: 0, duration: 0.22, ease: "power2.out" });
    });
  }

  // Category Filtering (no transform on .proj.card so WebGL rects stay 100% synced)
  let activeFilter = "all";
  filterTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const f = tab.dataset.filter || "all";
      if (f === activeFilter) return;
      activeFilter = f;
      playClickSound();

      filterTabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      });

      syncActivePill(false);
      const badge = tab.querySelector(".tab-badge");
      if (badge && window.gsap) {
        gsap.fromTo(badge, { scale: 0.85 }, { scale: 1, duration: 0.34, ease: "back.out(2)" });
      }

      const matchedCards = [];
      projs.forEach((p) => {
        const cat = p.dataset.category || "";
        const matches = activeFilter === "all" || cat.includes(activeFilter);
        p.classList.toggle("is-filtered-out", !matches);
        if (matches) matchedCards.push(p);
      });

      if (countEl) {
        if (window.gsap) {
          gsap.fromTo(
            countEl,
            { y: -6, opacity: 0, scale: 0.88 },
            {
              y: 0,
              opacity: 1,
              scale: 1,
              duration: 0.3,
              ease: "back.out(2)",
              onStart: () => {
                countEl.textContent = matchedCards.length;
              },
            }
          );
        } else {
          countEl.textContent = matchedCards.length;
        }
      }

      if (window.ScrollTrigger) window.ScrollTrigger.refresh();
      if (work._glRenderer) {
        work._glRenderer.layout();
        requestAnimationFrame(() => work._glRenderer && work._glRenderer.layout());
      }
    });
  });

  // Layout View Switcher (Bento Grid vs Expanded Showcase)
  viewBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.view;
      playClickSound();
      viewBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
      if (grid) {
        grid.classList.toggle("is-showcase-view", v === "showcase");
      }
      if (window.ScrollTrigger) window.ScrollTrigger.refresh();
      if (work._glRenderer) {
        work._glRenderer.layout();
        requestAnimationFrame(() => work._glRenderer && work._glRenderer.layout());
      }
    });
  });

  // Full-Screen Poster PDF Viewer Modal Controller
  const pdfModal = document.getElementById("pdf-modal");
  const pdfFrame = document.getElementById("pdf-viewer-frame");
  const pdfCanvasContainer = document.getElementById("pdf-canvas-container");
  const pdfTitle = document.getElementById("pdf-modal-title");
  const pdfDownload = document.getElementById("pdf-download-link");
  const pdfNewTab = document.getElementById("pdf-newtab-link");
  const pdfStatus = document.getElementById("pdf-modal-status");
  const pdfSpinner = document.getElementById("pdf-status-spinner");
  const pdfStatusText = document.getElementById("pdf-status-text");
  const pdfProgressTrack = document.getElementById("pdf-progress-track");
  const pdfProgressFill = document.getElementById("pdf-progress-fill");
  const pdfStatusActions = document.getElementById("pdf-status-actions");
  const pdfStatusOpenBtn = document.getElementById("pdf-status-open-btn");
  const pdfStatusDownloadBtn = document.getElementById("pdf-status-download-btn");

  const PDFJS_CDN_BASE = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
  let pdfJsPromise = null;
  let pdfWorkerBlobUrl = null;
  let activePdfLoadToken = 0;
  let activePageObserver = null;
  let currentPdfState = { rawUrl: "", verifiedUrl: "", filename: "document.pdf", title: "" };

  // Session cache stores { verifiedUrl, absoluteUrl, filename, bytes, blob, pdfDoc }
  const pdfSessionCache = new Map();

  const ensurePdfJsLoaded = () => {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfJsPromise) return pdfJsPromise;
    pdfJsPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${PDFJS_CDN_BASE}/pdf.min.js`;
      script.async = true;
      script.onload = () => {
        if (window.pdfjsLib) {
          try {
            if (!pdfWorkerBlobUrl) {
              const workerBlob = new Blob(
                [`importScripts("${PDFJS_CDN_BASE}/pdf.worker.min.js");`],
                { type: "application/javascript" }
              );
              pdfWorkerBlobUrl = URL.createObjectURL(workerBlob);
            }
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerBlobUrl;
          } catch (_) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN_BASE}/pdf.worker.min.js`;
          }
          resolve(window.pdfjsLib);
        } else {
          reject(new Error("PDF.js library unavailable"));
        }
      };
      script.onerror = () => {
        pdfJsPromise = null;
        reject(new Error("Failed to load PDF.js script"));
      };
      document.head.appendChild(script);
    });
    return pdfJsPromise;
  };

  // Warm the lightweight PDF.js engine when a visitor hovers/focuses a poster card (never fetches PDFs on load)
  document.querySelectorAll('.proj[data-category="design"]').forEach((card) => {
    const warmEngine = () => { ensurePdfJsLoaded().catch(() => {}); };
    card.addEventListener("pointerenter", warmEngine, { once: true, passive: true });
    card.addEventListener("focusin", warmEngine, { once: true, passive: true });
  });

  // Resolve poster metadata and candidate URLs using window.SCRIPTERS_MEDIA.posters
  const resolvePosterConfig = (rawUrl, titleText) => {
    const cleanRaw = String(rawUrl || "").split("#")[0].split("?")[0].trim();
    const rawFile = cleanRaw.split("/").pop() || "";
    const mediaPosters = (window.SCRIPTERS_MEDIA && window.SCRIPTERS_MEDIA.posters) || {};
    const titleUpper = String(titleText || "").toUpperCase();

    for (const key of Object.keys(mediaPosters)) {
      const entry = mediaPosters[key];
      if (
        entry.url === cleanRaw ||
        entry.filename === rawFile ||
        (entry.fallbacks && entry.fallbacks.includes(cleanRaw)) ||
        (entry.title && titleUpper.includes(entry.title.toUpperCase()))
      ) {
        const candidates = [
          entry.url,
          ...(entry.fallbacks || []),
          cleanRaw,
          entry.filename ? `work/${entry.filename}` : "",
        ].filter(Boolean);
        return {
          filename: entry.filename || rawFile || "poster.pdf",
          primaryUrl: entry.url || cleanRaw,
          candidates: [...new Set(candidates)],
        };
      }
    }

    const normalizedUrl = /^https?:\/\//i.test(cleanRaw) ? cleanRaw : cleanRaw.replace(/^\/+/, "");
    const candidates = [
      normalizedUrl,
      rawFile ? `work/${rawFile}` : "",
    ].filter(Boolean);

    return {
      filename: rawFile || "poster.pdf",
      primaryUrl: normalizedUrl,
      candidates: [...new Set(candidates)],
    };
  };

  const toAbsolutePdfUrl = (pathOrUrl) => {
    try {
      return new URL(pathOrUrl, window.location.href).href;
    } catch (_) {
      return pathOrUrl;
    }
  };

  const setProgressPercent = (pct) => {
    if (!pdfProgressTrack || !pdfProgressFill) return;
    if (pct === null || pct === undefined) {
      pdfProgressTrack.hidden = true;
      pdfProgressFill.style.width = "0%";
      return;
    }
    pdfProgressTrack.hidden = false;
    const clamped = Math.max(4, Math.min(100, Math.round(pct)));
    pdfProgressFill.style.width = `${clamped}%`;
  };

  // Stream & verify actual PDF binary (%PDF- signature), preventing HTML fallback pages from ever being used
  const fetchVerifiedPdfBinary = async (rawUrl, titleText, onProgress) => {
    const cfg = resolvePosterConfig(rawUrl, titleText);
    const cacheKey = cfg.primaryUrl;
    if (pdfSessionCache.has(cacheKey)) {
      return pdfSessionCache.get(cacheKey);
    }

    for (const candidate of cfg.candidates) {
      try {
        const res = await fetch(candidate, { method: "GET", credentials: "same-origin" });
        if (!res.ok) continue;
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("text/html")) continue;

        const total = Number(res.headers.get("content-length")) || 0;
        let bytes;

        if (res.body && typeof res.body.getReader === "function") {
          const reader = res.body.getReader();
          const chunks = [];
          let loaded = 0;
          let firstChunkChecked = false;
          let validMagic = true;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.byteLength) {
              chunks.push(value);
              loaded += value.byteLength;
              if (!firstChunkChecked && loaded >= 5) {
                firstChunkChecked = true;
                const head = chunks[0];
                const magic = String.fromCharCode(head[0], head[1], head[2], head[3], head[4]);
                if (magic !== "%PDF-") {
                  validMagic = false;
                  await reader.cancel().catch(() => {});
                  break;
                }
              }
              if (onProgress && total > 0) {
                onProgress(Math.min(99, Math.round((loaded / total) * 100)));
              }
            }
          }

          if (!validMagic || loaded < 64) continue;
          bytes = new Uint8Array(loaded);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
        } else {
          const buf = await res.arrayBuffer();
          bytes = new Uint8Array(buf);
        }

        if (bytes.byteLength < 64) continue;
        const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
        if (magic !== "%PDF-") continue;

        const actualFilename = candidate.split("/").pop().split("?")[0] || cfg.filename;
        const absoluteUrl = toAbsolutePdfUrl(candidate);
        const blob = new Blob([bytes], { type: "application/pdf" });
        const record = {
          cacheKey,
          verifiedUrl: candidate,
          absoluteUrl,
          filename: cfg.filename || actualFilename,
          bytes,
          blob,
          pdfDoc: null,
        };
        pdfSessionCache.set(cacheKey, record);
        return record;
      } catch (_) {}
    }
    return null;
  };

  // Dedicated download handler guarantees downloading the actual PDF binary with its original filename
  const triggerVerifiedPdfDownload = async (e) => {
    if (!currentPdfState.rawUrl) return;
    e.preventDefault();
    e.stopPropagation();

    const record = await fetchVerifiedPdfBinary(currentPdfState.rawUrl, currentPdfState.title);
    if (!record || !record.blob) {
      const fallbackUrl = toAbsolutePdfUrl(currentPdfState.verifiedUrl || currentPdfState.rawUrl);
      const a = document.createElement("a");
      a.href = fallbackUrl;
      a.download = currentPdfState.filename || "poster.pdf";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }

    const blobUrl = URL.createObjectURL(record.blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = blobUrl;
    a.download = record.filename || currentPdfState.filename || "poster.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
  };

  if (pdfDownload) pdfDownload.addEventListener("click", triggerVerifiedPdfDownload);
  if (pdfStatusDownloadBtn) pdfStatusDownloadBtn.addEventListener("click", triggerVerifiedPdfDownload);

  // Direct click handler on "Open in New Tab" buttons using window.open(pdfUrl, '_blank', 'noopener,noreferrer')
  const triggerOpenPdfInNewTab = (e) => {
    const rawOrVerified = currentPdfState.verifiedUrl || currentPdfState.rawUrl;
    if (!rawOrVerified) return;
    e.preventDefault();
    e.stopPropagation();
    const cfg = resolvePosterConfig(rawOrVerified, currentPdfState.title);
    const pdfUrl = toAbsolutePdfUrl(currentPdfState.verifiedUrl || cfg.primaryUrl || rawOrVerified);
    window.open(pdfUrl, "_blank", "noopener,noreferrer");
  };

  if (pdfNewTab) pdfNewTab.addEventListener("click", triggerOpenPdfInNewTab);
  if (pdfStatusOpenBtn) pdfStatusOpenBtn.addEventListener("click", triggerOpenPdfInNewTab);

  const renderSinglePageToSlot = async (pdfDoc, pageNum, slotEl, token) => {
    if (token !== activePdfLoadToken || slotEl.dataset.rendered === "1") return;
    slotEl.dataset.rendered = "1";
    const page = await pdfDoc.getPage(pageNum);
    if (token !== activePdfLoadToken) return;

    const unscaledViewport = page.getViewport({ scale: 1 });
    const stageWidth = pdfCanvasContainer && pdfCanvasContainer.clientWidth > 100
      ? pdfCanvasContainer.clientWidth - 48
      : Math.min(window.innerWidth - 48, 860);
    const targetCssWidth = Math.min(860, Math.max(280, stageWidth));
    const cssScale = targetCssWidth / unscaledViewport.width;
    const outputScale = Math.min(window.devicePixelRatio || 1, 2.25);
    const viewport = page.getViewport({ scale: cssScale * outputScale });

    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page-canvas";
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.aspectRatio = `${unscaledViewport.width} / ${unscaledViewport.height}`;

    slotEl.style.aspectRatio = `${unscaledViewport.width} / ${unscaledViewport.height}`;
    slotEl.innerHTML = "";
    slotEl.appendChild(canvas);

    const ctx = canvas.getContext("2d", { alpha: false });
    await page.render({ canvasContext: ctx, viewport }).promise;
    if (token !== activePdfLoadToken) return;
    canvas.classList.add("is-rendered");
  };

  const renderPdfProgressively = async (pdfDoc, token) => {
    if (!pdfCanvasContainer || token !== activePdfLoadToken) return;
    if (activePageObserver) {
      activePageObserver.disconnect();
      activePageObserver = null;
    }

    pdfCanvasContainer.innerHTML = "";
    pdfCanvasContainer.hidden = false;
    pdfCanvasContainer.scrollTop = 0;
    if (pdfFrame) pdfFrame.classList.add("is-hidden");

    const totalPages = pdfDoc.numPages || 1;
    const slots = [];

    for (let i = 1; i <= totalPages; i++) {
      const slot = document.createElement("div");
      slot.className = "pdf-page-slot";
      slot.dataset.pageNumber = String(i);
      pdfCanvasContainer.appendChild(slot);
      slots.push(slot);
    }

    // 1. Render Page 1 immediately
    await renderSinglePageToSlot(pdfDoc, 1, slots[0], token);
    if (token !== activePdfLoadToken) return;

    if (pdfStatus) pdfStatus.classList.add("is-hidden");
    setProgressPercent(null);

    // 2. Render subsequent pages progressively via IntersectionObserver
    if (totalPages > 1 && "IntersectionObserver" in window) {
      activePageObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const slot = entry.target;
            const pageNum = Number(slot.dataset.pageNumber);
            if (activePageObserver) activePageObserver.unobserve(slot);
            renderSinglePageToSlot(pdfDoc, pageNum, slot, token).catch(() => {});
          });
        },
        { root: pdfCanvasContainer, rootMargin: "320px 0px" }
      );
      for (let i = 1; i < slots.length; i++) {
        activePageObserver.observe(slots[i]);
      }
    } else if (totalPages > 1) {
      for (let i = 2; i <= totalPages; i++) {
        if (token !== activePdfLoadToken) break;
        await renderSinglePageToSlot(pdfDoc, i, slots[i - 1], token);
      }
    }
  };

  const syncModalControlLinks = (directPdfUrl, originalFilename) => {
    const absUrl = toAbsolutePdfUrl(directPdfUrl);
    if (pdfDownload) {
      pdfDownload.href = absUrl;
      pdfDownload.setAttribute("download", originalFilename);
    }
    if (pdfStatusDownloadBtn) {
      pdfStatusDownloadBtn.href = absUrl;
      pdfStatusDownloadBtn.setAttribute("download", originalFilename);
    }
    if (pdfNewTab) {
      pdfNewTab.href = absUrl;
      pdfNewTab.setAttribute("target", "_blank");
      pdfNewTab.setAttribute("rel", "noopener noreferrer");
    }
    if (pdfStatusOpenBtn) {
      pdfStatusOpenBtn.href = absUrl;
      pdfStatusOpenBtn.setAttribute("target", "_blank");
      pdfStatusOpenBtn.setAttribute("rel", "noopener noreferrer");
    }
  };

  const openPdfModal = async (pdfUrl, titleText) => {
    if (!pdfUrl) return;
    playClickSound();
    if (!pdfModal || !pdfFrame) return;
    if (modal && modal.classList.contains("is-open")) {
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
    }

    const token = ++activePdfLoadToken;
    const cfg = resolvePosterConfig(pdfUrl, titleText);
    currentPdfState = {
      rawUrl: pdfUrl,
      verifiedUrl: cfg.primaryUrl,
      filename: cfg.filename,
      title: titleText || "Poster",
    };

    if (pdfTitle) pdfTitle.textContent = `${titleText || "Poster"} — Full Design PDF`;
    syncModalControlLinks(cfg.primaryUrl, cfg.filename);

    pdfModal.classList.add("is-open");
    pdfModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("has-modal-open");
    document.body.style.overflow = "hidden";
    if (typeof lenis !== "undefined" && lenis) lenis.stop();

    // Fast path: if already cached in session, render immediately with zero network transfers
    const cached = pdfSessionCache.get(cfg.primaryUrl);
    if (cached && cached.pdfDoc) {
      currentPdfState.verifiedUrl = cached.verifiedUrl;
      currentPdfState.filename = cached.filename;
      syncModalControlLinks(cached.verifiedUrl, cached.filename);
      await renderPdfProgressively(cached.pdfDoc, token);
      return;
    }

    // Reset viewer state & display loading indicator
    if (pdfCanvasContainer) {
      pdfCanvasContainer.hidden = true;
      pdfCanvasContainer.innerHTML = "";
    }
    pdfFrame.classList.add("is-loading", "is-hidden");
    pdfFrame.classList.remove("is-error");
    pdfFrame.src = "about:blank";

    if (pdfStatus) pdfStatus.classList.remove("is-hidden");
    if (pdfSpinner) pdfSpinner.style.display = "block";
    if (pdfStatusText) pdfStatusText.textContent = "Loading PDF document…";
    if (pdfStatusActions) pdfStatusActions.hidden = true;
    setProgressPercent(10);

    const [record, pdfjsLib] = await Promise.all([
      fetchVerifiedPdfBinary(pdfUrl, titleText, (pct) => {
        if (token !== activePdfLoadToken) return;
        setProgressPercent(pct);
        if (pdfStatusText) pdfStatusText.textContent = `Loading PDF document… ${pct}%`;
      }),
      ensurePdfJsLoaded().catch(() => null),
    ]);

    if (token !== activePdfLoadToken) return;

    if (!record) {
      setProgressPercent(null);
      if (pdfSpinner) pdfSpinner.style.display = "none";
      if (pdfStatusText) {
        pdfStatusText.textContent = "Unable to load the inline PDF preview. You can open the full poster PDF directly in a new tab or download it:";
      }
      syncModalControlLinks(cfg.primaryUrl, cfg.filename);
      if (pdfStatusActions) pdfStatusActions.hidden = false;
      return;
    }

    currentPdfState.verifiedUrl = record.verifiedUrl;
    currentPdfState.filename = record.filename;
    syncModalControlLinks(record.verifiedUrl, record.filename);

    if (pdfjsLib) {
      try {
        const loadingTask = pdfjsLib.getDocument({
          data: record.bytes.slice(0),
        });
        const pdfDoc = await loadingTask.promise;
        if (token !== activePdfLoadToken) return;

        record.pdfDoc = pdfDoc;
        await renderPdfProgressively(pdfDoc, token);
        return;
      } catch (_) {
        if (token !== activePdfLoadToken) return;
      }
    }

    // Fallback to native iframe viewer using verified Blob URL
    setProgressPercent(null);
    if (pdfCanvasContainer) pdfCanvasContainer.hidden = true;
    const fallbackBlobUrl = URL.createObjectURL(record.blob);
    pdfFrame.classList.remove("is-hidden", "is-loading");
    pdfFrame.onload = () => {
      if (token !== activePdfLoadToken) return;
      if (pdfStatus) pdfStatus.classList.add("is-hidden");
    };
    pdfFrame.src = `${fallbackBlobUrl}#toolbar=1&navpanes=0&view=FitH`;
    if (pdfStatus) pdfStatus.classList.add("is-hidden");
  };

  const closePdfModal = () => {
    if (!pdfModal) return;
    playClickSound();
    activePdfLoadToken++;
    if (activePageObserver) {
      activePageObserver.disconnect();
      activePageObserver = null;
    }
    pdfModal.classList.remove("is-open");
    pdfModal.setAttribute("aria-hidden", "true");
    if (!modal || !modal.classList.contains("is-open")) {
      document.body.classList.remove("has-modal-open");
    }
    setTimeout(() => {
      if (!pdfModal.classList.contains("is-open")) {
        if (pdfFrame) pdfFrame.src = "about:blank";
        setProgressPercent(null);
      }
    }, 280);
    document.body.style.overflow = "";
    if (typeof lenis !== "undefined" && lenis) lenis.start();
  };

  if (pdfModal) {
    pdfModal.querySelectorAll("[data-close-pdf]").forEach((el) => {
      el.addEventListener("click", closePdfModal);
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && pdfModal.classList.contains("is-open")) {
        closePdfModal();
      }
    });
  }

  // Quick View Modal Controller
  if (modal) {
    const modalImg = document.getElementById("modal-img");
    const modalNum = document.getElementById("modal-num");
    const modalCat = document.getElementById("modal-cat");
    const modalTitle = document.getElementById("modal-title");
    const modalSubtitle = document.getElementById("modal-subtitle");
    const modalDesc = document.getElementById("modal-desc");
    const modalBrief = document.getElementById("modal-brief");
    const modalTech = document.getElementById("modal-tech");
    const modalLive = document.getElementById("modal-live-link");
    const modalLiveText = document.getElementById("modal-live-text");
    const modalGithub = document.getElementById("modal-github-link");
    const modalBadge = document.getElementById("modal-badge");

    const openModal = (p) => {
      playClickSound();
      const num = p.querySelector(".cap-top .n")?.textContent?.trim() || "01";
      const cat = p.dataset.cat || p.querySelector(".cap-top .cat")?.dataset.cat || "";
      const rawTitle = p.dataset.title || p.querySelector(".cap h3 a.t")?.dataset.title || "";
      const sub = p.dataset.subtitle || "";
      const desc = p.dataset.desc || p.querySelector(".cap .desc")?.textContent || "";
      const brief = p.dataset.brief || "";
      const techList = (p.dataset.tech || "").split(",").map((s) => s.trim()).filter(Boolean);
      const live = p.dataset.live || "";
      const pdfUrl = p.dataset.pdf || "";
      const liveLabel = p.dataset.liveLabel || "Launch Live Project";
      const github = p.dataset.github || "";
      const badge = p.dataset.badge || "";
      const imgSrc = p.dataset.img || p.querySelector(".zoom img")?.getAttribute("src") || "";

      if (modalImg) {
        modalImg.src = imgSrc;
        modalImg.alt = rawTitle;
      }
      if (modalNum) modalNum.textContent = num;
      if (modalCat) modalCat.textContent = cat;
      if (modalTitle) modalTitle.textContent = rawTitle;
      if (modalSubtitle) modalSubtitle.textContent = sub;
      if (modalDesc) modalDesc.textContent = desc;
      if (modalBrief) modalBrief.textContent = brief;
      if (modalBadge) {
        modalBadge.textContent = badge;
        modalBadge.style.display = badge ? "inline-block" : "none";
      }

      if (modalTech) {
        modalTech.innerHTML = "";
        techList.forEach((t) => {
          const span = document.createElement("span");
          span.textContent = t;
          modalTech.appendChild(span);
        });
      }

      if (modalLive) {
        if (live && live !== "null" && live.trim() !== "") {
          modalLive.href = live;
          modalLive.dataset.pdf = pdfUrl;
          modalLive.dataset.title = rawTitle;
          modalLive.style.display = "inline-flex";
          if (modalLiveText) modalLiveText.textContent = liveLabel;
        } else {
          modalLive.dataset.pdf = "";
          modalLive.style.display = "none";
        }
      }

      if (modalGithub) {
        if (github && github !== "null" && github.trim() !== "") {
          modalGithub.href = github;
          modalGithub.style.display = "inline-flex";
        } else {
          modalGithub.style.display = "none";
        }
      }

      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");
      document.body.classList.add("has-modal-open");
      document.body.style.overflow = "hidden";
      if (typeof lenis !== "undefined" && lenis) lenis.stop();
    };

    if (modalLive) {
      modalLive.addEventListener("click", (e) => {
        const pdfUrl = modalLive.dataset.pdf;
        if (pdfUrl) {
          e.preventDefault();
          openPdfModal(pdfUrl, modalLive.dataset.title || "Poster");
        }
      });
    }

    const closeModal = () => {
      playClickSound();
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      if (!pdfModal || !pdfModal.classList.contains("is-open")) {
        document.body.classList.remove("has-modal-open");
      }
      document.body.style.overflow = "";
      if (typeof lenis !== "undefined" && lenis) lenis.start();
    };

    modal.querySelectorAll("[data-close-modal]").forEach((el) => {
      el.addEventListener("click", closeModal);
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("is-open")) {
        closeModal();
      }
    });

    projs.forEach((p) => {
      const pdfUrl = p.dataset.pdf;
      const cardTitle = p.dataset.title || "Poster";

      const triggerBtn = p.querySelector(".modal-trigger");
      if (triggerBtn) {
        triggerBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          openModal(p);
        });
      }

      const inspectBtn = p.querySelector(".proj-inspect-btn");
      if (inspectBtn) {
        inspectBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (pdfUrl) {
            openPdfModal(pdfUrl, cardTitle);
          } else {
            openModal(p);
          }
        });
      }

      // For Design & Posters cards: clicking any part of the poster card (except Quick Inspect) opens the PDF of that poster
      if (pdfUrl) {
        p.querySelectorAll(".proj-hit, .cap h3 a.t, .link-btn.primary").forEach((linkEl) => {
          linkEl.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            openPdfModal(pdfUrl, cardTitle);
          });
        });

        p.addEventListener("click", (e) => {
          if (e.target.closest(".modal-trigger")) return;
          e.preventDefault();
          openPdfModal(pdfUrl, cardTitle);
        });
      }
    });
  }

  // Interactive glossy CLIENTS reflection & Brands section reveal
  const clientsWrap = document.getElementById("clients-word-wrap");
  const clientsWord = clientsWrap ? clientsWrap.querySelector(".clients-word") : null;
  if (clientsWrap && clientsWord) {
    let sheenTween = null;
    clientsWrap.addEventListener("pointerenter", () => {
      clientsWrap.classList.add("is-hovered");
      if (window.gsap) {
        if (sheenTween) sheenTween.kill();
        const stateObj = { s: 10 };
        sheenTween = gsap.to(stateObj, {
          s: 90,
          duration: 1.35,
          ease: "power2.inOut",
          onUpdate: () => {
            clientsWord.style.setProperty("--sheen", `${stateObj.s.toFixed(1)}%`);
          },
        });
      }
    });

    clientsWrap.addEventListener("pointermove", (e) => {
      const r = clientsWord.getBoundingClientRect();
      const cx = ((e.clientX - r.left) / Math.max(1, r.width)) * 100;
      const cy = ((e.clientY - r.top) / Math.max(1, r.height)) * 100;
      clientsWord.style.setProperty("--cx", `${cx.toFixed(1)}%`);
      clientsWord.style.setProperty("--cy", `${cy.toFixed(1)}%`);
      clientsWord.style.setProperty("--sheen", `${cx.toFixed(1)}%`);
    });

    clientsWrap.addEventListener("pointerleave", () => {
      clientsWrap.classList.remove("is-hovered");
    });
  }

  const brandsSection = document.getElementById("brands");
  if (brandsSection && window.gsap && window.ScrollTrigger && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const bHead = brandsSection.querySelectorAll(".brands-title, .brands-sub");
    const bRows = brandsSection.querySelectorAll(".brands-row");
    gsap.fromTo(
      bHead,
      { y: 32, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.85,
        stagger: 0.12,
        ease: "power3.out",
        scrollTrigger: { trigger: brandsSection, start: "top 85%" },
      }
    );
    gsap.fromTo(
      bRows,
      { y: 28, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.9,
        stagger: 0.14,
        ease: "power3.out",
        scrollTrigger: { trigger: brandsSection, start: "top 75%" },
      }
    );
  }
}

/* ---------- boot: preload first frames & decode, then stream the rest with playhead priority ---------- */
const PRELOAD = window.scrollY > window.innerHeight * 0.8 ? 8 : (IS_MOBILE ? 24 : 48);
const pct = document.getElementById("pct");

let storyStart = 0, storyEnd = 0;
let lastAutoWinW = 0, lastAutoWinH = 0;
function updateAutoBounds(force) {
  if (
    force !== true &&
    IS_MOBILE &&
    lastAutoWinW > 0 &&
    Math.abs(innerWidth - lastAutoWinW) < 2 &&
    Math.abs(innerHeight - lastAutoWinH) < 160
  ) {
    return;
  }
  lastAutoWinW = innerWidth;
  lastAutoWinH = innerHeight;
  const vh = window.innerHeight || 1;
  const story = document.getElementById("story");
  if (story) {
    storyStart = story.offsetTop;
    storyEnd = storyStart + story.offsetHeight - vh;
  }
}
addEventListener("resize", () => updateAutoBounds(false), { passive: true });
if (window.ScrollTrigger) {
  ScrollTrigger.addEventListener("refresh", () => updateAutoBounds(true));
}

(async () => {
  const tick = setInterval(() => (pct.textContent = Math.min(99, Math.round((loaded / PRELOAD) * 100))), 40);
  // Preload and GPU-decode the initial frames so playback starts at 60fps with zero decode stalls
  await Promise.all(
    Array.from({ length: PRELOAD }, (_, i) => {
      const frameIdx = Math.min(TOTAL - 1, i * FRAME_STEP);
      return loadFrame(frameIdx, i < (IS_MOBILE ? 14 : 36));
    })
  );
  updateContiguous();
  clearInterval(tick); pct.textContent = 100;
  size(true); initStory(); updateAutoBounds(true); lenis.start();
  gsap.set("#loader", { pointerEvents: "none" });
  gsap.to("#loader", { opacity: 0, duration: 0.35, delay: 0, onComplete: () => {
    const ld = document.getElementById("loader"); if (ld) ld.remove(); } });

  // Multi-pass priority loader:
  // 1) Always prioritize frames right ahead of the current playhead
  // 2) Fill in keyframes across the timeline (on mobile, skip odd frames so memory stays well under mobile Safari/Chrome limits)
  const order = [];
  const seen = new Uint8Array(TOTAL);
  for (let i = 0; i < PRELOAD; i++) seen[Math.min(TOTAL - 1, i * FRAME_STEP)] = 1;
  const steps = [4, 2, 1];
  for (const step of steps) {
    for (let i = 0; i < TOTAL; i += step) {
      if (!seen[i]) { seen[i] = 1; order.push(i); }
    }
  }

  let cursor = 0;
  const pickNextBatch = (batchSize) => {
    const batch = [];
    const rawCur = Math.min(TOTAL - 1, Math.max(0, Math.round(current)));
    const cur = IS_MOBILE ? Math.min(TOTAL - 1, Math.round(rawCur / FRAME_STEP) * FRAME_STEP) : rawCur;
    const lookSpan = IS_MOBILE ? 16 : 28;
    // First grab any unloaded frames in the immediate lookahead window
    for (let k = cur; k <= Math.min(TOTAL - 1, cur + lookSpan) && batch.length < batchSize; k += FRAME_STEP) {
      if (!frames[k] && !inflight[k]) batch.push(k);
    }
    // Fill remaining slots from the multi-pass stride queue
    while (cursor < order.length && batch.length < batchSize) {
      const idx = order[cursor++];
      if (!frames[idx] && !inflight[idx]) batch.push(idx);
    }
    return batch;
  };

  while (cursor < order.length) {
    const inStory = window.scrollY <= storyEnd + window.innerHeight * 0.5;
    const batchSize = IS_MOBILE ? (inStory ? 6 : 3) : (inStory ? 14 : 6);
    const batch = pickNextBatch(batchSize);
    if (!batch.length) break;
    await Promise.all(batch.map((idx) => loadFrame(idx, false)));
    updateContiguous();
    if (!inStory || IS_MOBILE) {
      await new Promise((r) => setTimeout(r, IS_MOBILE ? 20 : 14));
    }
  }
})();

/* ---------- continuous flow autoplay: blends seamlessly with fast forward scrolling ---------- */
const AUTO = {
  on: true,        // set to false to turn autoplay off
  upPauseMs: 220,  // brief pause only when scrolling UPWARD so backward scroll never fights autoplay
  touchPauseMs: 850, // let native mobile touch & inertia momentum scroll run with zero JS interference
  speed: 0.82      // viewport heights per second (~4.55s for the 4.0s intro video slowed by 0.5s)
};
let lastBackwardInput = -1e9;
let lastTouchActivity = -1e9;
let isTouching = false;
let lastTouchY = 0;
addEventListener("wheel", (e) => {
  navScrollActive = false;
  if (e.deltaY < 0) lastBackwardInput = performance.now();
}, { passive: true });
addEventListener("touchstart", (e) => {
  navScrollActive = false;
  isTouching = true;
  lastTouchActivity = performance.now();
  if (e.touches && e.touches[0]) lastTouchY = e.touches[0].clientY;
}, { passive: true });
addEventListener("touchmove", (e) => {
  isTouching = true;
  lastTouchActivity = performance.now();
  if (e.touches && e.touches[0]) {
    const dy = lastTouchY - e.touches[0].clientY;
    lastTouchY = e.touches[0].clientY;
    if (dy < -1) lastBackwardInput = performance.now();
  }
}, { passive: true });
const onTouchEnd = () => {
  isTouching = false;
  lastTouchActivity = performance.now();
};
addEventListener("touchend", onTouchEnd, { passive: true });
addEventListener("touchcancel", onTouchEnd, { passive: true });
addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp" || e.key === "PageUp") lastBackwardInput = performance.now();
}, { passive: true });

let lastTick = performance.now();
let autoCarry = 0;
gsap.ticker.add(() => {
  const now = performance.now();
  const dt = Math.min((now - lastTick) / 1000, 0.05);
  lastTick = now;

  if (!AUTO.on || lenis.isStopped || document.hidden || navScrollActive) {
    autoCarry = 0;
    return;
  }

  // Never fight active mobile touch gestures or native mobile momentum scrolling
  if (isTouching || now - lastTouchActivity < AUTO.touchPauseMs) {
    autoCarry = 0;
    return;
  }

  // Only pause forward flow if the user is actively scrolling upward/backward
  const scrollingBackward =
    lenis.targetScroll < lenis.animatedScroll - 0.5 ||
    now - lastBackwardInput < AUTO.upPauseMs;
  if (scrollingBackward) {
    autoCarry = 0;
    return;
  }

  if (!storyEnd) updateAutoBounds(true);

  const y = lenis.scroll;
  let activeSpeed = 0;
  let maxEnd = 0;

  if (storyEnd > storyStart && y >= storyStart - 2 && y < storyEnd - 2) {
    const p = clamp((y - storyStart) / Math.max(1, storyEnd - storyStart));
    const openSlow = 1 - smoothstep(clamp((p - 0.03) / 0.19));
    const afterBoost = smoothstep(clamp((p - 0.58) / 0.10)) * (1 - smoothstep(clamp((p - 0.76) / 0.12)));
    const endSlow = smoothstep(clamp((p - 0.76) / 0.24));
    activeSpeed = AUTO.speed * (1 - 0.47 * openSlow + 0.22 * afterBoost - 0.52 * endSlow);
    maxEnd = storyEnd;
  }

  if (!activeSpeed) {
    autoCarry = 0;
    return;
  }

  const step = activeSpeed * innerHeight * dt;

  // If user is currently gliding forward from a wheel/touch flick, advance the glide target
  // continuously by `step` so the fast scroll never decelerates to a stop or pauses!
  if (lenis.animate && lenis.animate.isRunning && lenis.targetScroll >= lenis.animatedScroll && lenis.targetScroll <= maxEnd + 2) {
    const nextTarget = Math.min(maxEnd, lenis.targetScroll + step);
    lenis.targetScroll = nextTarget;
    lenis.animate.to = nextTarget;
    return;
  }

  autoCarry += step;
  const whole = Math.trunc(autoCarry);
  if (whole >= 1) {
    autoCarry -= whole;
    lenis.scrollTo(Math.min(maxEnd, y + whole), { immediate: true, force: true });
  }
});

/* ===== TEAM: real founder photographs rendered as a slow digital point-cloud ===== */
function initTeamExperience() {
  const section = document.getElementById("team");
  const canvas = document.getElementById("team-canvas");
  if (!section || !canvas) return;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const sourceEls = [...section.querySelectorAll("[data-team-source]")];
  const people = [...section.querySelectorAll(".team-person")];
  const counter = section.querySelector(".team-counter");
  const progressBar = section.querySelector(".team-progress i");
  const nextButton = section.querySelector(".team-next");
  const prevButton = section.querySelector(".team-prev");
  const dots = [...section.querySelectorAll("[data-team-go]")];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const small = window.matchMedia("(max-width: 760px)").matches;
  const count = Math.max(1, people.length);
  const state = { from: 0, to: 0, mix: 1 };
  let targetPerson = 0;
  let activeTween = null;

  const images = sourceEls.map((el) => {
    el.loading = "eager";
    const img = new Image();
    img.decoding = "async";
    img.src = el.src;
    return img;
  });
  const glyphs = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/+=*";
  let w = 0, h = 0, dpr = 1, raf = 0, lastT = 0, glyphColumns = [];
  const off = document.createElement("canvas");
  const offCtx = off.getContext("2d", { willReadFrequently: true });
  const portraitCache = new Array(images.length).fill(null);

  function buildPortraitCache(idx) {
    const img = images[idx];
    if (!img || !img.complete || !img.naturalWidth || w <= 0 || h <= 0) return null;
    const targetW = Math.min(w * (small ? 0.88 : 0.62), small ? 520 : 790);
    const targetH = h * (small ? 0.65 : 0.82);
    const scale = Math.min(targetW / img.naturalWidth, targetH / img.naturalHeight);
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    const dx = w * (small ? 0.5 : 0.52) - dw * 0.5, dy = h * 0.48 - dh * 0.5;
    const sampleW = Math.max(180, Math.round(dw * (small ? 0.48 : 0.58)));
    const sampleH = Math.max(220, Math.round(dh * (small ? 0.48 : 0.58)));
    off.width = sampleW; off.height = sampleH;
    offCtx.clearRect(0, 0, sampleW, sampleH);
    offCtx.drawImage(img, 0, 0, sampleW, sampleH);
    let data;
    try { data = offCtx.getImageData(0, 0, sampleW, sampleH).data; } catch (e) { return null; }

    // Pre-render the restrained grayscale photographic underlay once per resize so frames are instantaneous
    const underlay = document.createElement("canvas");
    underlay.width = Math.max(1, Math.round(dw));
    underlay.height = Math.max(1, Math.round(dh));
    const uCtx = underlay.getContext("2d");
    if (uCtx) {
      uCtx.filter = "grayscale(1) contrast(1.18) brightness(.72)";
      uCtx.drawImage(img, 0, 0, underlay.width, underlay.height);
      uCtx.filter = "none";
    }

    const step = small ? 5.2 : 4.0;
    const dot = small ? 1.45 : 1.55;
    const dotsByColor = [[], [], []]; // 0: #e2ded7, 1: #f5f4f0, 2: #787982
    for (let y = 1; y < sampleH - 1; y += step) {
      for (let x = 1; x < sampleW - 1; x += step) {
        const p = (Math.floor(y) * sampleW + Math.floor(x)) * 4;
        const a = data[p + 3] / 255;
        if (a < 0.08) continue;
        const r = data[p], g = data[p + 1], b = data[p + 2];
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        const chroma = (b - r) / 255;
        const visibility = Math.max(0, Math.min(1, (lum - 0.055) * 1.65)) * a;
        if (visibility < 0.035) continue;
        const radius = dot * (0.28 + visibility * 0.85);
        const px = dx + (x / sampleW) * dw, py = dy + (y / sampleH) * dh;
        const cIdx = chroma > 0.06 ? 0 : (lum > 0.68 ? 1 : 2);
        dotsByColor[cIdx].push({ px, py, radius, visibility, phase: x * 0.05 + y * 0.03 });
      }
    }

    const cached = { dx, dy, dw, dh, underlay, dotsByColor };
    portraitCache[idx] = cached;
    return cached;
  }

  let lastTeamW = 0, lastTeamH = 0;
  function resize(force) {
    const nextW = Math.max(1, canvas.clientWidth);
    const nextH = Math.max(1, canvas.clientHeight);
    if (
      force !== true &&
      small &&
      lastTeamW > 0 &&
      Math.abs(nextW - lastTeamW) < 2 &&
      Math.abs(nextH - lastTeamH) < 160
    ) {
      return;
    }
    lastTeamW = nextW;
    lastTeamH = nextH;
    dpr = Math.min(window.devicePixelRatio || 1, small ? 1.15 : 1.6);
    w = nextW; h = nextH;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const step = small ? 36 : 38;
    glyphColumns = [];
    for (let x = 18; x < w; x += step) {
      glyphColumns.push({ x, y: Math.random() * h, speed: 12 + Math.random() * 28, alpha: 0.08 + Math.random() * 0.2, seed: Math.random() * 100 });
    }
    for (let i = 0; i < images.length; i++) {
      portraitCache[i] = null;
      if (teamVisible && images[i] && images[i].complete && images[i].naturalWidth) buildPortraitCache(i);
    }
    if (teamVisible) render(performance.now(), true);
    else syncTeamUI(targetPerson);
  }

  function drawDigitalBackground(t) {
    ctx.clearRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w * 0.56, h * 0.49, 10, w * 0.56, h * 0.49, Math.max(w, h) * 0.62);
    glow.addColorStop(0, "rgba(234,228,216,.045)"); glow.addColorStop(1, "rgba(3,7,18,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.font = `italic 400 ${small ? 10 : 12}px "Cormorant Garamond", Georgia, serif`;
    const glyphRows = small ? 6 : 9;
    glyphColumns.forEach((c, i) => {
      const y = ((c.y + t * c.speed * 0.001) % (h + 120)) - 60;
      for (let k = 0; k < glyphRows; k++) {
        const yy = y - k * 15;
        ctx.globalAlpha = c.alpha * (1 - k / 10);
        ctx.fillStyle = k === 0 ? "#f0eee9" : "#787982";
        const ch = glyphs[(Math.floor(c.seed + k * 7 + t * 0.02) + i) % glyphs.length];
        ctx.fillText(ch, c.x, yy);
      }
    });
    ctx.restore();
    drawContours(t, 0.56);
    // Erase background glyphs & contour lines behind the human portrait and softly at top/bottom edges
    const activeCache = portraitCache[state.to] || portraitCache.find(Boolean);
    const dw = activeCache ? activeCache.dw : Math.min(w * (small ? 0.88 : 0.62), small ? 520 : 790);
    const dh = activeCache ? activeCache.dh : h * (small ? 0.65 : 0.82);
    const px = activeCache ? activeCache.dx + dw * 0.5 : w * (small ? 0.5 : 0.52);
    const py = activeCache ? activeCache.dy + dh * 0.5 : h * 0.48;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(Math.max(1, dw * 0.62), Math.max(1, dh * 0.60));
    const cutout = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    cutout.addColorStop(0, "rgba(0,0,0,1)");
    cutout.addColorStop(0.72, "rgba(0,0,0,1)");
    cutout.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = cutout;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
    const edgeFade = ctx.createLinearGradient(0, 0, 0, h);
    edgeFade.addColorStop(0, "rgba(0,0,0,1)");
    edgeFade.addColorStop(0.18, "rgba(0,0,0,0)");
    edgeFade.addColorStop(0.82, "rgba(0,0,0,0)");
    edgeFade.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = edgeFade;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function drawContours(t, alpha) {
    ctx.save(); ctx.globalAlpha = alpha;
    const lineCount = small ? 10 : 18;
    const xStep = small ? 14 : 8;
    for (let line = 0; line < lineCount; line++) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += xStep) {
        const nx = x / w;
        const base = h * (0.76 + line * 0.012);
        const wave = Math.sin(nx * 7.5 + line * 0.42 + t * 0.00018) * h * 0.025 +
          Math.sin(nx * 17 - line * 0.3 + t * 0.00012) * h * 0.009;
        const y = base + wave + (Math.pow(Math.abs(nx - 0.52), 1.6) * h * 0.12);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = line % 4 === 0 ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.06)";
      ctx.lineWidth = line % 4 === 0 ? 1 : 0.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  const PALETTE = ["#e2ded7", "#f5f4f0", "#787982"];
  function drawPortrait(idx, alpha, t) {
    if (alpha <= 0.001) return;
    const img = images[idx];
    if (!img || !img.complete || !img.naturalWidth) return;
    const cached = portraitCache[idx] || buildPortraitCache(idx);
    if (!cached) return;
    const { dx, dy, dw, dh, underlay, dotsByColor } = cached;
    ctx.save();
    ctx.globalAlpha = alpha * 0.22;
    ctx.drawImage(underlay, dx, dy, dw, dh);
    const tPhase = t * 0.0015;
    for (let c = 0; c < 3; c++) {
      const list = dotsByColor[c];
      if (!list.length) continue;
      ctx.fillStyle = PALETTE[c];
      for (let i = 0, n = list.length; i < n; i++) {
        const d = list[i];
        const shimmer = 0.84 + 0.16 * Math.sin(tPhase + d.phase);
        ctx.globalAlpha = alpha * d.visibility * shimmer;
        const r = d.radius;
        ctx.fillRect(d.px - r, d.py - r, r * 2, r * 2);
      }
    }
    // Sparse moving particles around the silhouette, not over the face.
    ctx.globalAlpha = alpha * 0.35;
    for (let i = 0; i < 110; i++) {
      const seed = i * 91.7;
      const px = dx + ((Math.sin(seed) * 0.5 + 0.5) * dw);
      const py = dy + ((Math.cos(seed * 1.7 + t * 0.0002) * 0.5 + 0.5) * dh);
      if (px > dx + dw * 0.18 && px < dx + dw * 0.82 && py < dy + dh * 0.72) continue;
      ctx.fillStyle = i % 5 === 0 ? "#f0eee9" : "#787982";
      ctx.fillRect(px, py, 1, 1);
    }
    ctx.restore();
  }

  let lastSyncedPerson = -1;
  function syncTeamUI(personIdx) {
    if (personIdx === lastSyncedPerson) return;
    lastSyncedPerson = personIdx;
    people.forEach((el, i) => {
      const active = i === personIdx;
      el.style.opacity = active ? "1" : "0";
      el.style.transform = active ? "translateY(0)" : "translateY(14px)";
    });
    if (counter) counter.textContent = `0${personIdx + 1} — 0${count}`;
    if (progressBar) progressBar.style.width = `${(personIdx / Math.max(1, count - 1)) * 100}%`;
    dots.forEach((dot, i) => {
      const active = i === personIdx;
      dot.classList.toggle("is-active", active);
      if (active) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
  }

  let teamVisible = false;
  function render(now = performance.now(), force = false) {
    if (!ctx || (!teamVisible && !force)) return;
    drawDigitalBackground(now);
    const mix = Math.max(0, Math.min(1, state.mix));
    if (mix < 0.999 && state.from !== state.to) {
      drawPortrait(state.from, 1 - mix, now);
      drawPortrait(state.to, mix, now);
    } else {
      drawPortrait(state.to, 1, now);
    }
    syncTeamUI(targetPerson);
    if (!reduced && teamVisible && !raf) {
      raf = requestAnimationFrame(loop);
    }
  }

  function loop(now) {
    raf = 0;
    if (!teamVisible) return;
    if (now - lastT >= 28) {
      lastT = now;
      render(now);
    }
    if (!reduced && teamVisible && !raf) {
      raf = requestAnimationFrame(loop);
    }
  }

  if ("IntersectionObserver" in window) {
    const teamIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        teamVisible = e.isIntersecting;
        if (teamVisible) {
          render(performance.now(), true);
          if (!reduced && !raf) raf = requestAnimationFrame(loop);
        } else if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      });
    }, { rootMargin: "500px 0px" });
    teamIO.observe(section);
  } else {
    teamVisible = true;
  }

  images.forEach((img, idx) => {
    img.onload = () => {
      if (teamVisible) {
        buildPortraitCache(idx);
        render(performance.now(), true);
      }
    };
    img.onerror = () => { section.classList.add("team-static"); };
  });
  resize();
  window.addEventListener("resize", resize, { passive: true });
  if (teamVisible) render(performance.now(), true);
  else syncTeamUI(targetPerson);

  function goToPerson(index) {
    const nextIndex = ((index % count) + count) % count;
    const prevTarget = targetPerson;
    targetPerson = nextIndex;
    // Immediately update the name, counter, progress bar, and active dot on the exact click event
    syncTeamUI(targetPerson);

    if (activeTween) {
      activeTween.kill();
      activeTween = null;
    }

    // Show the new founder's portrait immediately on click, with a fast, non-blocking settle
    state.from = prevTarget;
    state.to = nextIndex;
    if (window.gsap && !reduced && prevTarget !== nextIndex) {
      state.mix = 0.68; // Jump 68% into the new portrait on frame 0 so the picture visibly switches immediately on every click
      render(performance.now(), true);
      activeTween = gsap.to(state, {
        mix: 1,
        duration: 0.14,
        ease: "power2.out",
        overwrite: true,
        onUpdate: () => render(performance.now(), true),
        onComplete: () => {
          state.from = nextIndex;
          state.mix = 1;
          activeTween = null;
          render(performance.now(), true);
        },
      });
      return;
    }
    state.from = nextIndex;
    state.to = nextIndex;
    state.mix = 1;
    render(performance.now(), true);
  }

  if (nextButton) {
    nextButton.addEventListener("click", (e) => {
      e.preventDefault();
      goToPerson((targetPerson + 1) % count);
    });
  }
  if (prevButton) {
    prevButton.addEventListener("click", (e) => {
      e.preventDefault();
      goToPerson((targetPerson + count - 1) % count);
    });
  }
  dots.forEach((dot) => {
    dot.addEventListener("click", (e) => {
      e.preventDefault();
      goToPerson(Number(dot.dataset.teamGo) || 0);
    });
  });

  if (!reduced && window.gsap && window.ScrollTrigger) {
    const q = (s) => section.querySelectorAll(s);
    gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: { trigger: section, start: "top 90%", end: "top 20%", scrub: 0.6, invalidateOnRefresh: true },
    })
      .fromTo(q(".team-visual"), { opacity: 0, scale: 1.06 }, { opacity: 1, scale: 1 }, 0)
      .fromTo(q(".team-copy"), { opacity: 0, y: 36 }, { opacity: 1, y: 0 }, 0.12)
      .fromTo(q(".team-copy h2"), { clipPath: "inset(-10% -10% -10% 100%)" }, { clipPath: "inset(-10% -10% -10% -10%)" }, 0.12)
      .fromTo(q(".team-topline, .team-bottomline, .team-prev, .team-next, .team-description"), { opacity: 0 }, { opacity: 1 }, 0.5);
  }
}

