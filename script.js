/* ============================================================
   Black Holes — cinematic scroll + interactive stages

   1. A reusable WebGL black-hole renderer (gravitational lensing).
   2. A fixed background instance whose camera is driven by scroll,
      with every move chosen to reinforce what each scene says.
   3. An interactive "light experiment": fire beams at a black hole
      and watch them bend, skim the photon sphere, or be swallowed.
   4. A detail stage per real black hole (Sgr A*, M87*, Cygnus X-1,
      Gaia BH1/BH2/BH3) — dormant ones render dark, feeders glow.
   ============================================================ */
import * as THREE from "three";

/* ---------------- shared lensing shader ---------------- */
const VERT = /* glsl */ `void main(){ gl_Position = vec4(position,1.0); }`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec2  uResolution;
  uniform float uTime;
  uniform vec3  uCamPos;
  uniform mat3  uCamBasis;
  uniform float uFocal;
  uniform float uDisk;
  uniform float uHeat;
  uniform float uQuality;

  const float RS = 1.0, DISK_IN = 2.2, DISK_OUT = 6.6;

  float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }

  vec3 starfield(vec3 dir){
    vec3 col = vec3(0.0);
    for (int i=0;i<3;i++){
      float scale = 55.0 + float(i)*75.0;
      vec3 p = dir*scale, ip = floor(p), fp = fract(p);
      float best = 1.0;
      for (int x=-1;x<=1;x++) for (int y=-1;y<=1;y++) for (int z=-1;z<=1;z++){
        vec3 cell = vec3(float(x),float(y),float(z));
        vec3 rnd = vec3(hash(ip+cell+1.0),hash(ip+cell+7.3),hash(ip+cell+3.7));
        best = min(best, length(fp-cell-rnd));
      }
      float star = smoothstep(0.14,0.0,best);
      float tint = hash(ip+float(i)*5.0);
      vec3 sc = mix(vec3(0.85,0.9,1.0), vec3(1.0,0.96,0.9), tint);
      col += star*sc*(0.5+0.5*float(3-i));
    }
    return col;
  }

  vec3 diskColor(vec3 hit){
    float r = length(hit.xz);
    float t = clamp((r-DISK_IN)/(DISK_OUT-DISK_IN),0.0,1.0);
    vec3 hot  = vec3(1.0,0.93,0.82);
    vec3 warm = mix(vec3(1.0,0.84,0.55), vec3(1.0,0.44,0.06), uHeat);
    vec3 edge = mix(vec3(0.9,0.62,0.36), vec3(0.78,0.18,0.02), uHeat);
    vec3 base = mix(mix(hot,warm,smoothstep(0.0,0.5,t)), edge, smoothstep(0.5,1.0,t));
    float ang = atan(hit.z,hit.x);
    float swirl = sin(ang*3.0-r*2.5+uTime*1.1)*sin(ang*5.0+r*1.5-uTime*0.6);
    float bands = 0.78+0.22*swirl;
    float doppler = 0.62+0.7*smoothstep(-1.0,1.0,sin(ang));
    base = mix(base, base*vec3(0.92,0.96,1.08), (doppler-0.62)*0.3);
    float falloff = smoothstep(0.0,0.12,t)*smoothstep(1.0,0.8,t);
    float intensity = bands*doppler*falloff*(1.0/(0.7+r*0.32));
    return base*intensity*0.6;
  }

  void main(){
    vec2 uv = (gl_FragCoord.xy-0.5*uResolution)/uResolution.y;
    vec3 pos = uCamPos;
    vec3 vel = normalize(uCamBasis*vec3(uv,-uFocal));
    vec3 color = vec3(0.0);
    float transmit = 1.0, minR = 1e9;
    bool captured = false;

    int steps = int(170.0*uQuality);
    for (int i=0;i<460;i++){
      if (i>=steps) break;
      float r = length(pos);
      float dt = clamp(r*0.11,0.028,0.5);
      vec3 gdir = -pos/max(r,1e-4);
      vel = normalize(vel + gdir*(1.55*RS/(r*r))*dt);
      vec3 npos = pos + vel*dt;
      minR = min(minR, length(npos));
      if (length(npos)<RS){ captured=true; break; }
      if (pos.y*npos.y < 0.0){
        float k = pos.y/(pos.y-npos.y);
        vec3 hit = mix(pos,npos,k);
        float rr = length(hit.xz);
        if (rr>DISK_IN && rr<DISK_OUT){ color += diskColor(hit)*uDisk*transmit; transmit*=0.5; }
      }
      pos = npos;
      if (r>60.0) break;
    }
    if (!captured){
      color += starfield(normalize(vel))*transmit;
      float ring = exp(-pow((minR-1.5*RS)/0.32,2.0));
      vec3 ringCol = mix(vec3(1.0,0.85,0.6), vec3(1.0,0.55,0.2), uHeat);
      // baseline term keeps the lensed ring visible even for dormant (no-disk) holes
      color += ring*ringCol*(0.55+1.0*uDisk)*transmit;
    }
    color += pow(max(color-0.9,0.0),vec3(1.6))*0.22;
    color = color/(color+vec3(1.0));
    color = pow(color, vec3(1.0/2.2));
    gl_FragColor = vec4(color,1.0);
  }
`;

/* ---------------- reusable renderer ---------------- */
function createBlackHole(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const uniforms = {
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uCamPos: { value: new THREE.Vector3() },
    uCamBasis: { value: new THREE.Matrix3() },
    uFocal: { value: 1.6 },
    uDisk: { value: 0.3 },
    uHeat: { value: 0.2 },
    uQuality: { value: 1.0 },
  };
  scene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, depthWrite: false })
  ));

  const state = { rad: 34, az: 0.15, pol: 1.32, disk: 0.3, foc: 1.75, heat: 0.2 };
  const target = { ...state };
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  let spin = 0, paused = false;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setCamera() {
    const az = state.az + spin + (opts.parallax ? mouse.x * 0.12 : 0);
    const pol = Math.min(Math.PI - 0.12, Math.max(0.12, state.pol + (opts.parallax ? mouse.y * 0.1 : 0)));
    const sinP = Math.sin(pol);
    const camPos = new THREE.Vector3(state.rad * sinP * Math.cos(az), state.rad * Math.cos(pol), state.rad * sinP * Math.sin(az));
    uniforms.uCamPos.value.copy(camPos);
    const fwd = camPos.clone().normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd).normalize();
    const up = new THREE.Vector3().crossVectors(fwd, right).normalize();
    uniforms.uCamBasis.value.set(right.x, up.x, fwd.x, right.y, up.y, fwd.y, right.z, up.z, fwd.z);
    uniforms.uFocal.value = state.foc;
    uniforms.uDisk.value = state.disk;
    uniforms.uHeat.value = state.heat;
  }
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    const pr = renderer.getPixelRatio();
    uniforms.uResolution.value.set(w * pr, h * pr);
    uniforms.uQuality.value = w * h > 1_500_000 ? 0.72 : 1.0;
  }
  if (opts.parallax) {
    window.addEventListener("mousemove", (e) => {
      mouse.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      mouse.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    });
  }
  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    if (paused) return;
    uniforms.uTime.value = clock.getElapsedTime();
    if (opts.onFrame) opts.onFrame(target);
    const s = reduceMotion ? 1 : (opts.ease || 0.08);
    for (const k of ["rad", "az", "pol", "disk", "foc", "heat"]) state[k] += (target[k] - state[k]) * s;
    if (opts.autoRotate && !reduceMotion) spin += 0.0018;
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    setCamera();
    renderer.render(scene, camera);
  }
  resize();
  window.addEventListener("resize", resize);
  setCamera();
  frame();

  return {
    resize,
    setTarget: (t) => Object.assign(target, t),
    jumpTo: (t) => { Object.assign(state, t); Object.assign(target, t); },
    set paused(v) { paused = v; },
    get paused() { return paused; },
  };
}

/* ---------------- scroll keyframes (purposeful camera) ---------------- */
const KEYS = [
  { p: 0.00, rad: 34, az: 0.10, pol: 1.30, disk: 0.28, foc: 1.75, heat: 0.15 }, // intro — establish, far & calm
  { p: 0.17, rad: 24, az: 0.50, pol: 1.24, disk: 0.55, foc: 1.62, heat: 0.40 }, // what is it — push in to examine
  { p: 0.33, rad: 11, az: 0.95, pol: 1.12, disk: 0.68, foc: 1.95, heat: 0.55 }, // horizon — dive to the shadow's edge
  { p: 0.50, rad: 18, az: 1.60, pol: 1.50, disk: 1.00, foc: 1.55, heat: 1.00 }, // disk — swing edge-on as it ignites
  { p: 0.67, rad: 22, az: 2.10, pol: 0.95, disk: 0.95, foc: 1.60, heat: 0.85 }, // strength — high 3/4 look-down
  { p: 0.83, rad: 30, az: 2.60, pol: 1.24, disk: 0.68, foc: 1.55, heat: 0.60 }, // catalogue — pull back so cards read
  { p: 1.00, rad: 40, az: 3.20, pol: 1.30, disk: 0.85, foc: 1.50, heat: 0.70 }, // outro — pull away, leaving
];
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function sampleKeys(p) {
  if (p <= KEYS[0].p) return { ...KEYS[0] };
  const last = KEYS[KEYS.length - 1];
  if (p >= last.p) return { ...last };
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i], b = KEYS[i + 1];
    if (p >= a.p && p <= b.p) {
      const t = smoothstep(a.p, b.p, p), m = (k) => a[k] + (b[k] - a[k]) * t;
      return { rad: m("rad"), az: m("az"), pol: m("pol"), disk: m("disk"), foc: m("foc"), heat: m("heat") };
    }
  }
  return { ...last };
}
function scrollProgress() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
}

/* ---------------- real black-hole data ---------------- */
const BHS = [
  {
    id: "sgrA", name: "Sagittarius A*", type: "Supermassive · Galactic centre",
    stats: [["4.3M", "solar masses"], ["27,000", "light-years"], ["2022", "imaged"]],
    sig: "The supermassive black hole our entire galaxy orbits. Decades of tracking stars whipping around it proved it was there — work that won the 2020 Nobel Prize in Physics — and in 2022 the Event Horizon Telescope imaged its shadow directly.",
    photo: "images/sgr-a-star.jpg", photoCap: "Sagittarius A* · EHT, 2022",
    view: { rad: 20, pol: 1.16, disk: 0.85, heat: 0.72, foc: 1.6 },
  },
  {
    id: "m87", name: "M87*", type: "Supermassive · Galaxy M87",
    stats: [["6.5B", "solar masses"], ["55M", "light-years"], ["2019", "imaged"]],
    sig: "The first black hole ever photographed, unveiled in 2019. A true giant — roughly 1,500 times heavier than Sagittarius A* — it fires a jet of plasma thousands of light-years into space and gave humanity its first real look at an event horizon.",
    photo: "images/m87.jpg", photoCap: "M87* · EHT, 2019",
    view: { rad: 22, pol: 1.24, disk: 1.0, heat: 0.85, foc: 1.6 },
  },
  {
    id: "cygx1", name: "Cygnus X-1", type: "Stellar-mass · Feeding",
    stats: [["~21", "solar masses"], ["7,200", "light-years"], ["1970s", "confirmed"]],
    sig: "The first object widely accepted as a black hole, and the subject of a famous bet between Stephen Hawking and Kip Thorne. It blazes in X-rays as it tears gas from a giant blue companion star and heats it to millions of degrees.",
    photo: null,
    view: { rad: 16, pol: 1.42, disk: 1.0, heat: 1.0, foc: 1.55 },
  },
  {
    id: "gaiabh1", name: "Gaia BH1", type: "Stellar-mass · Dormant",
    stats: [["~10", "solar masses"], ["1,560", "light-years"], ["2022", "discovered"]],
    sig: "The closest known black hole to Earth. It is dormant — not feeding — so it emits no light of its own. It was found only by the gravitational wobble it gives a Sun-like companion star orbiting it.",
    photo: null,
    view: { rad: 20, pol: 1.20, disk: 0.0, heat: 0.0, foc: 1.6 },
  },
  {
    id: "gaiabh2", name: "Gaia BH2", type: "Stellar-mass · Dormant",
    stats: [["~9", "solar masses"], ["3,800", "light-years"], ["2023", "discovered"]],
    sig: "The second-nearest known black hole, orbited by a red giant on an unusually wide, slow path. Like its sibling it is dark and dormant, betrayed only by the motion of the star that circles it.",
    photo: null,
    view: { rad: 21, pol: 1.10, disk: 0.0, heat: 0.0, foc: 1.6 },
  },
  {
    id: "gaiabh3", name: "Gaia BH3", type: "Stellar-mass · Dormant",
    stats: [["~33", "solar masses"], ["2,000", "light-years"], ["2024", "discovered"]],
    sig: "The most massive stellar black hole known in the Milky Way — about 33 times the Sun. It formed from an ancient, metal-poor star and sits surprisingly close, revealed by ESA's Gaia mission in 2024.",
    photo: null,
    view: { rad: 18, pol: 1.30, disk: 0.06, heat: 0.1, foc: 1.65 },
  },
];

/* ---------------- overlay helpers ---------------- */
function lockScroll(v) { document.body.classList.toggle("locked", v); }

/* ---------------- explorer + detail stages ---------------- */
function initExplorer(background) {
  const grid = document.getElementById("bhGrid");
  const overlay = document.getElementById("overlay-bh");
  const canvas = document.getElementById("bh-canvas");
  let detail = null, current = 0;

  BHS.forEach((bh, i) => {
    const card = document.createElement("div");
    card.className = "bh-card";
    const thumb = bh.photo
      ? `<div class="bh-thumb" style="background-image:url('${bh.photo}')"></div>`
      : `<div class="bh-thumb bh-thumb--render"></div>`;
    card.innerHTML = `${thumb}<span class="bh-card-open">Open ›</span>
      <div class="bh-card-body"><div class="bh-card-name">${bh.name}</div>
      <div class="bh-card-type">${bh.type}</div></div>`;
    card.addEventListener("click", () => openBH(i));
    grid.appendChild(card);
  });

  function fill(bh) {
    document.getElementById("bhType").textContent = bh.type;
    document.getElementById("bhName").textContent = bh.name;
    document.getElementById("bhStats").innerHTML = bh.stats
      .map(([n, l]) => `<div><span class="num">${n}</span><span class="lbl">${l}</span></div>`).join("");
    document.getElementById("bhSig").textContent = bh.sig;
    const fig = document.getElementById("bhPhoto");
    if (bh.photo) {
      fig.hidden = false;
      document.getElementById("bhPhotoImg").src = bh.photo;
      document.getElementById("bhPhotoImg").alt = bh.name;
      document.getElementById("bhPhotoCap").textContent = bh.photoCap;
    } else { fig.hidden = true; }
  }

  function openBH(i) {
    current = i;
    const bh = BHS[i];
    fill(bh);
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    lockScroll(true);
    background.paused = true;
    requestAnimationFrame(() => overlay.classList.add("show"));
    if (!detail) detail = createBlackHole(canvas, { autoRotate: true, ease: 0.06 });
    detail.paused = false;
    detail.jumpTo({ az: 0.5, ...bh.view });
    requestAnimationFrame(() => detail.resize());
  }
  function step(dir) { openBH((current + dir + BHS.length) % BHS.length); }
  function close() {
    overlay.classList.remove("show");
    if (detail) detail.paused = true;
    background.paused = false;
    lockScroll(false);
    setTimeout(() => { overlay.hidden = true; overlay.setAttribute("aria-hidden", "true"); }, 380);
  }

  overlay.querySelector("[data-close]").addEventListener("click", close);
  overlay.querySelectorAll("[data-nav]").forEach((b) =>
    b.addEventListener("click", () => step(parseInt(b.dataset.nav, 10))));
  document.addEventListener("keydown", (e) => {
    if (overlay.hidden) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
  });
}

/* ---------------- interactive light experiment ---------------- */
function initLightLab(background) {
  const overlay = document.getElementById("overlay-light");
  const canvas = document.getElementById("light-canvas");
  const ctx = canvas.getContext("2d");
  const statE = document.getElementById("statEscaped");
  const statC = document.getElementById("statCaptured");

  let W = 0, H = 0, dpr = 1, C = { x: 0, y: 0 }, RS = 40;
  let photons = [], raf = 0, running = false, aimY = null, dragging = false;
  let escaped = 0, captured = 0;
  const SPEED = 3.2, GM = 0.09;  // tuned so beams escape at wide impact parameters, capture only near the photon sphere

  function layout() {
    dpr = Math.min(window.devicePixelRatio, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    C = { x: W * 0.6, y: H * 0.5 };
    RS = Math.max(26, Math.min(W, H) * 0.055);
  }

  function fire(y) {
    photons.push({ x: -20, y, vx: SPEED, vy: 0, trail: [[-20, y]], state: "flying" });
    if (photons.length > 60) photons.shift();
  }

  function stepPhoton(p) {
    for (let s = 0; s < 3; s++) {
      const dx = C.x - p.x, dy = C.y - p.y;
      const r = Math.hypot(dx, dy);
      if (r < RS) { p.state = "captured"; captured++; statC.textContent = captured; return; }
      const a = (GM * RS * RS) / (r * r);           // steering strength ∝ 1/r²
      p.vx += (dx / r) * a; p.vy += (dy / r) * a;
      const sp = Math.hypot(p.vx, p.vy);             // photons keep constant speed; gravity only turns them
      p.vx = (p.vx / sp) * SPEED; p.vy = (p.vy / sp) * SPEED;
      p.x += p.vx; p.y += p.vy;
    }
    p.trail.push([p.x, p.y]);
    if (p.trail.length > 260) p.trail.shift();
    if (p.x > W + 40 || p.x < -60 || p.y < -60 || p.y > H + 60) {
      p.state = "escaped"; escaped++; statE.textContent = escaped;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // photon sphere (critical orbit) — dashed
    ctx.setLineDash([5, 7]);
    ctx.strokeStyle = "rgba(255,157,67,0.55)";
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(C.x, C.y, RS * 1.5, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    // event horizon — solid black disk with a faint rim
    const g = ctx.createRadialGradient(C.x, C.y, RS * 0.6, C.x, C.y, RS * 1.15);
    g.addColorStop(0, "#000"); g.addColorStop(0.86, "#000"); g.addColorStop(1, "rgba(255,255,255,0.14)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(C.x, C.y, RS * 1.15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.arc(C.x, C.y, RS, 0, Math.PI * 2); ctx.fill();

    // labels
    ctx.font = "11px Inter, sans-serif"; ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText("event horizon", C.x, C.y - RS - 10);
    ctx.fillStyle = "rgba(255,157,67,0.7)";
    ctx.fillText("photon sphere", C.x, C.y + RS * 1.5 + 18);

    // aim guide
    if (aimY !== null) {
      ctx.strokeStyle = "rgba(255,255,255,0.16)"; ctx.setLineDash([2, 6]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, aimY); ctx.lineTo(C.x, aimY); ctx.stroke(); ctx.setLineDash([]);
    }

    // photon trails
    for (const p of photons) {
      const col = p.state === "captured" ? "255,77,77"
        : p.state === "escaped" ? "143,208,255" : "255,255,255";
      ctx.lineWidth = 1.6; ctx.beginPath();
      for (let i = 0; i < p.trail.length; i++) {
        const [x, y] = p.trail[i];
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${col},0.85)`; ctx.stroke();
      // bright head
      if (p.state === "flying") {
        const [hx, hy] = p.trail[p.trail.length - 1];
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(hx, hy, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function loop() {
    for (const p of photons) if (p.state === "flying") stepPhoton(p);
    // retire fully-resolved trails gradually
    if (photons.length > 45) photons = photons.filter((p, i) => i > photons.length - 45 || p.state === "flying");
    draw();
    raf = requestAnimationFrame(loop);
  }

  // input
  const yFromEvent = (e) => {
    const rect = canvas.getBoundingClientRect();
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return Math.max(0, Math.min(H, cy));
  };
  canvas.addEventListener("mousemove", (e) => { aimY = yFromEvent(e); if (dragging) fire(aimY); });
  canvas.addEventListener("mousedown", (e) => { dragging = true; fire(yFromEvent(e)); });
  window.addEventListener("mouseup", () => { dragging = false; });
  canvas.addEventListener("mouseleave", () => { aimY = null; });
  canvas.addEventListener("touchstart", (e) => { fire(yFromEvent(e)); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchmove", (e) => { fire(yFromEvent(e)); e.preventDefault(); }, { passive: false });

  document.getElementById("lightReset").addEventListener("click", () => {
    photons = []; escaped = 0; captured = 0; statE.textContent = 0; statC.textContent = 0;
  });

  function open() {
    overlay.hidden = false; overlay.setAttribute("aria-hidden", "false");
    lockScroll(true); background.paused = true;
    requestAnimationFrame(() => { overlay.classList.add("show"); layout(); demo(); if (!running) { running = true; loop(); } });
  }
  function close() {
    overlay.classList.remove("show");
    running = false; cancelAnimationFrame(raf);
    background.paused = false; lockScroll(false);
    setTimeout(() => { overlay.hidden = true; overlay.setAttribute("aria-hidden", "true"); }, 380);
  }
  function demo() {
    photons = [];
    // seed beams across a wide range of impact parameters so both outcomes show
    [-4.5, -3.2, -2.0, -1.0, 1.1, 2.2, 3.4, 4.8].forEach((k) => fire(C.y + k * RS));
  }

  document.querySelectorAll('[data-open="light"]').forEach((b) => b.addEventListener("click", open));
  overlay.querySelector("[data-close]").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (!overlay.hidden && e.key === "Escape") close(); });
  window.addEventListener("resize", () => { if (!overlay.hidden) layout(); });
}

/* ---------------- scroll UI ---------------- */
function initUI() {
  const bar = document.getElementById("scrollProgress");
  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + "%";
  };
  window.addEventListener("scroll", update, { passive: true });
  update();

  const panels = document.querySelectorAll(".panel");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.target.classList.toggle("active", e.isIntersecting)),
      { rootMargin: "-25% 0px -25% 0px", threshold: 0 }
    );
    panels.forEach((p) => io.observe(p));
  } else panels.forEach((p) => p.classList.add("active"));
}

/* ---------------- boot ---------------- */
function boot() {
  initUI();
  let background = null;
  try {
    background = createBlackHole(document.getElementById("stage"), {
      parallax: true,
      onFrame: (t) => Object.assign(t, sampleKeys(scrollProgress())),
    });
  } catch (err) {
    console.error("Black-hole renderer failed:", err);
    document.querySelectorAll(".panel").forEach((p) => p.classList.add("active"));
    background = { set paused(v) {}, get paused() { return false; } };
  }
  initExplorer(background);
  initLightLab(background);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
