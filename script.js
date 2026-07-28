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
  { p: 0.000, rad: 34, az: 0.10, pol: 1.30, disk: 0.28, foc: 1.75, heat: 0.15 }, // intro — far & calm
  { p: 0.083, rad: 26, az: 0.40, pol: 1.24, disk: 0.52, foc: 1.66, heat: 0.40 }, // what is it — push in
  { p: 0.167, rad: 24, az: 0.72, pol: 1.22, disk: 0.55, foc: 1.60, heat: 0.50 }, // birth — steady behind the animation
  { p: 0.250, rad: 11, az: 1.10, pol: 1.12, disk: 0.68, foc: 1.95, heat: 0.55 }, // horizon — dive to the shadow's edge
  { p: 0.333, rad: 18, az: 1.60, pol: 1.50, disk: 1.00, foc: 1.55, heat: 1.00 }, // disk — edge-on as it ignites
  { p: 0.417, rad: 30, az: 2.00, pol: 1.26, disk: 0.60, foc: 1.55, heat: 0.55 }, // anatomy — pull back, calm
  { p: 0.500, rad: 22, az: 2.40, pol: 0.98, disk: 0.95, foc: 1.60, heat: 0.85 }, // strength — high 3/4 look-down
  { p: 0.583, rad: 32, az: 2.80, pol: 1.28, disk: 0.55, foc: 1.50, heat: 0.50 }, // scale — pull back behind the viz
  { p: 0.667, rad: 15, az: 3.20, pol: 1.14, disk: 0.90, foc: 1.70, heat: 0.80 }, // fall-in — close & dramatic
  { p: 0.750, rad: 26, az: 3.60, pol: 1.30, disk: 0.70, foc: 1.55, heat: 0.60 }, // merger — wide
  { p: 0.833, rad: 34, az: 3.95, pol: 1.24, disk: 0.50, foc: 1.50, heat: 0.50 }, // hawking — distant, contemplative
  { p: 0.917, rad: 34, az: 4.25, pol: 1.24, disk: 0.55, foc: 1.50, heat: 0.52 }, // catalog — pulled back so cards read
  { p: 1.000, rad: 42, az: 4.60, pol: 1.30, disk: 0.82, foc: 1.50, heat: 0.70 }, // outro — pull away, leaving
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

/* ---------------- Hawking evaporation ---------------- */
function initHawking() {
  const canvas = document.getElementById("hawk-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const stepsEl = document.getElementById("hawkSteps");
  const lifeEl = document.getElementById("hawkLife");
  const descEl = document.getElementById("hawkDesc");

  const MASSES = [
    { key: "Mountain-mass", life: "~14 billion yrs", r: 0.15, rate: 0.9, pop: true,
      desc: "A black hole the mass of a mountain (~10¹¹ kg) is evaporating right now — its final moment a burst of gamma rays. That lifetime is about the current age of the universe." },
    { key: "Stellar (10 Suns)", life: "~10⁷⁰ yrs", r: 0.28, rate: 0.22, pop: false,
      desc: "A star-sized black hole fades so slowly it will outlast every star in the cosmos — roughly 10⁷⁰ years to disappear completely." },
    { key: "Supermassive", life: "~10⁸⁷ yrs", r: 0.42, rate: 0.07, pop: false,
      desc: "A giant like Sagittarius A* needs something like 10⁸⁷ years to evaporate — a span so vast that today's universe has barely begun." },
  ];
  let W = 0, H = 0, dpr = 1, raf = 0, running = false, active = 1, parts = [], frame = 0, pop = 0;

  function layout() {
    dpr = Math.min(window.devicePixelRatio, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function selectM(i) {
    active = i; lifeEl.textContent = MASSES[i].life; descEl.textContent = MASSES[i].desc;
    [...stepsEl.children].forEach((b, k) => b.classList.toggle("active", k === i));
  }
  function spawn(cx, cy, rH, n, burst) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (burst ? 2.5 + Math.random() * 3 : 0.4 + Math.random() * 0.7);
      parts.push({ x: cx + Math.cos(a) * rH, y: cy + Math.sin(a) * rH, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, a: 1, w: Math.random() > 0.5 });
    }
  }
  function draw() {
    frame++;
    ctx.clearRect(0, 0, W, H);
    const cx = W * 0.5, cy = H * 0.5, m = MASSES[active], rH = Math.min(W, H) * m.r;

    // steady Hawking emission
    if (Math.random() < m.rate) spawn(cx, cy, rH + 2, 1, false);
    // final-burst "pop" for the mountain-mass hole
    if (m.pop && frame % 240 === 0) { pop = 1; spawn(cx, cy, rH + 2, 40, true); }
    pop *= 0.92;

    for (const p of parts) { p.x += p.vx; p.y += p.vy; p.a *= 0.972; }
    parts = parts.filter((p) => p.a > 0.04);
    for (const p of parts) {
      ctx.globalAlpha = p.a; ctx.fillStyle = p.w ? "#eaf0ff" : "#ffd9a8";
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, 6.29); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // black hole
    if (pop > 0.02) { ctx.fillStyle = `rgba(255,240,210,${pop * 0.5})`; ctx.fillRect(0, 0, W, H); }
    const gl = ctx.createRadialGradient(cx, cy, rH, cx, cy, rH * 1.7);
    gl.addColorStop(0, "rgba(255,175,90,0.22)"); gl.addColorStop(1, "rgba(255,175,90,0)");
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(cx, cy, rH * 1.7, 0, 6.29); ctx.fill();
    ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(cx, cy, rH, 0, 6.29); ctx.fill();
    ctx.lineWidth = 1.6; ctx.strokeStyle = "rgba(255,190,120,0.85)";
    ctx.beginPath(); ctx.arc(cx, cy, rH, 0, 6.29); ctx.stroke();

    raf = requestAnimationFrame(draw);
  }

  MASSES.forEach((m, i) => {
    const b = document.createElement("button");
    b.className = "hawk-step"; b.textContent = m.key;
    b.addEventListener("click", () => selectM(i));
    stepsEl.appendChild(b);
  });
  window.addEventListener("resize", layout);
  layout(); selectM(1);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting && !running) { running = true; layout(); draw(); }
      else if (!e.isIntersecting && running) { running = false; cancelAnimationFrame(raf); }
    }), { threshold: 0.25 }).observe(canvas);
  } else { running = true; draw(); }
}

/* ---------------- birth animation ---------------- */
function initBirth() {
  const canvas = document.getElementById("birth-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const capEl = document.getElementById("birthCaption");
  const btn = document.getElementById("birthReplay");
  const prevBtn = document.getElementById("birthPrev");

  let W = 0, H = 0, dpr = 1, raf = 0, running = false, seeded = false;
  let stars = [], parts = [], boomed = false, stage = 0, stageT0 = 0;
  const STAGES = [
    "A star many times heavier than our Sun — burning fiercely, and living fast.",
    "Its fuel spent, the core can no longer hold itself up. The star swells into a red supergiant.",
    "In under a second the core collapses and rebounds — a supernova that briefly outshines a galaxy.",
    "The blast clears. Where the star's core once was, a black hole remains.",
  ];

  function layout() {
    dpr = Math.min(window.devicePixelRatio, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!seeded) { seeded = true; for (let i = 0; i < 150; i++) stars.push([Math.random(), Math.random(), Math.random() * 0.5 + 0.3]); }
  }
  const lerp = (a, b, x) => a + (b - a) * Math.min(1, Math.max(0, x));

  function star(cx, cy, r, col) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.5);
    g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},1)`);
    g.addColorStop(0.6, `rgba(${col[0]},${col[1]},${col[2]},0.9)`);
    g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 1.5, 0, 6.29); ctx.fill();
  }
  function blackhole(cx, cy, r, a) {
    const gl = ctx.createRadialGradient(cx, cy, r, cx, cy, r * 1.8);
    gl.addColorStop(0, `rgba(255,170,90,${0.3 * a})`); gl.addColorStop(1, "rgba(255,170,90,0)");
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(cx, cy, r * 1.8, 0, 6.29); ctx.fill();
    ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.29); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = `rgba(255,185,120,${a})`;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.29); ctx.stroke();
  }
  function boom(cx, cy) {
    for (let i = 0; i < 150; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 5.5;
      parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, a: 1, h: Math.random() });
    }
  }

  // Each stage plays a short transition, then holds until the user clicks "Next".
  function draw(st) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    for (const s of stars) { ctx.globalAlpha = s[2] * 0.6; ctx.beginPath(); ctx.arc(s[0] * W, s[1] * H, 0.9, 0, 6.29); ctx.fill(); }
    ctx.globalAlpha = 1;
    const cx = W / 2, cy = H / 2, R0 = Math.min(W, H) * 0.12, pulse = 1 + 0.02 * Math.sin(st * 2.5);

    if (stage === 0) {
      star(cx, cy, R0 * pulse, [200, 220, 255]);
    } else if (stage === 1) {
      const p = lerp(0, 1, st / 1.6);
      star(cx, cy, R0 * (1 + 0.7 * p) * pulse, [255, lerp(210, 120, p), lerp(230, 70, p)]);
    } else if (stage === 2) {
      if (st < 0.5) {
        star(cx, cy, Math.max(1, R0 * lerp(1.7, 0.05, (st / 0.5) ** 2)), [255, 150, 90]);
      } else {
        if (!boomed) { boomed = true; boom(cx, cy); }
        const rt = st - 0.5;
        const flash = Math.max(0, 1 - rt * 2.2);
        if (flash > 0) { ctx.fillStyle = `rgba(255,245,225,${flash})`; ctx.fillRect(0, 0, W, H); }
        const rr = rt * 150;
        if (rr < Math.hypot(W, H)) {
          ctx.strokeStyle = `rgba(255,190,120,${Math.max(0, 0.7 - rt * 0.35)})`; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.29); ctx.stroke();
        }
        for (const pt of parts) { pt.x += pt.vx; pt.y += pt.vy; pt.a *= 0.99; }
        for (const pt of parts) {
          ctx.globalAlpha = Math.max(0, pt.a); ctx.fillStyle = pt.h > 0.5 ? "#ffd9a0" : "#ff9a5a";
          ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.6, 0, 6.29); ctx.fill();
        }
        ctx.globalAlpha = 1;
        // lingering hot core so the held frame isn't empty
        const core = 0.32 + 0.22 * Math.sin(st * 3);
        const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R0 * 0.9);
        cg.addColorStop(0, `rgba(255,220,170,${Math.max(0, core)})`); cg.addColorStop(1, "rgba(255,180,120,0)");
        ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, R0 * 0.9, 0, 6.29); ctx.fill();
      }
    } else {
      blackhole(cx, cy, R0 * 0.5, lerp(0, 1, st / 1.2));
    }
  }

  function loop() { draw(performance.now() / 1000 - stageT0); raf = requestAnimationFrame(loop); }
  const LAST = STAGES.length - 1;
  function goto(s) {
    stage = s; stageT0 = performance.now() / 1000;
    if (stage === 2) { boomed = false; parts = []; }
    capEl.textContent = STAGES[stage];
    prevBtn.hidden = stage === 0;                 // no "Prev" on the first stage
    btn.textContent = stage >= LAST ? "↺ Replay" : "Next →"; // last stage offers Replay, not Next
  }
  btn.addEventListener("click", () => goto(stage >= LAST ? 0 : stage + 1));
  prevBtn.addEventListener("click", () => goto(Math.max(0, stage - 1)));
  window.addEventListener("resize", layout);
  layout(); goto(0);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting && !running) { running = true; loop(); }
    }), { threshold: 0.3 }).observe(canvas);
  } else { running = true; loop(); }
}

/* ---------------- anatomy diagram ---------------- */
function initAnatomy() {
  const canvas = document.getElementById("anat-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const partsEl = document.getElementById("anatParts");
  const nameEl = document.getElementById("anatName");
  const descEl = document.getElementById("anatDesc");

  const PARTS = [
    { key: "horizon", name: "Event horizon", desc: "The point of no return — the surface of the black hole. Cross it and no path leads back out; not even light can escape." },
    { key: "singularity", name: "Singularity", desc: "The very center, where all the mass is crushed into a point of infinite density. Here our known laws of physics break down." },
    { key: "photon", name: "Photon sphere", desc: "A thin shell where gravity is so strong that light itself can orbit the black hole before escaping or falling in." },
    { key: "disk", name: "Accretion disk", desc: "Gas and dust spiralling inward, compressed and heated to millions of degrees until it blazes — often the only part we can see." },
    { key: "ergosphere", name: "Ergosphere", desc: "Around a spinning black hole, space itself is dragged along. Inside this region you cannot stay still — you are forced to rotate with it." },
  ];
  let W = 0, H = 0, dpr = 1, active = "horizon";

  function layout() {
    dpr = Math.min(window.devicePixelRatio, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const dim = (k) => (active === k ? 1 : 0.3);

  function diskArc(cx, cy, rH, a0, a1) {
    ctx.globalAlpha = dim("disk"); ctx.lineWidth = rH * 0.5;
    ctx.strokeStyle = active === "disk" ? "rgba(255,178,95,0.95)" : "rgba(255,150,80,0.85)";
    if (active === "disk") { ctx.shadowColor = "rgba(255,160,70,0.8)"; ctx.shadowBlur = 18; }
    ctx.beginPath(); ctx.ellipse(cx, cy, rH * 2.5, rH * 0.72, 0, a0, a1); ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
  function draw() {
    layout(); ctx.clearRect(0, 0, W, H);
    const cx = W * 0.5, cy = H * 0.52, rH = Math.min(H * 0.17, W * 0.12);
    const singOn = active === "singularity";

    diskArc(cx, cy, rH, Math.PI, 2 * Math.PI);        // disk behind

    // ergosphere (oblate, dashed)
    ctx.globalAlpha = dim("ergosphere"); ctx.setLineDash([3, 5]); ctx.lineWidth = 1.5;
    ctx.strokeStyle = active === "ergosphere" ? "rgba(150,190,255,0.95)" : "rgba(120,150,210,0.55)";
    ctx.beginPath(); ctx.ellipse(cx, cy, rH * 1.95, rH * 1.28, 0, 0, 2 * Math.PI); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    // photon sphere (dashed circle)
    ctx.globalAlpha = dim("photon"); ctx.setLineDash([2, 6]); ctx.lineWidth = 1.4;
    ctx.strokeStyle = active === "photon" ? "rgba(255,232,185,0.95)" : "rgba(255,220,160,0.5)";
    ctx.beginPath(); ctx.arc(cx, cy, rH * 1.5, 0, 2 * Math.PI); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    // event horizon (black body)
    if (active === "horizon") { ctx.shadowColor = "rgba(255,190,120,0.9)"; ctx.shadowBlur = 22; }
    ctx.globalAlpha = singOn ? 0.5 : 1;               // let the singularity show through
    ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(cx, cy, rH, 0, 2 * Math.PI); ctx.fill();
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    ctx.lineWidth = active === "horizon" ? 2.4 : 1.4;
    ctx.strokeStyle = active === "horizon" ? "rgba(255,195,130,0.95)" : "rgba(255,255,255,0.3)";
    ctx.beginPath(); ctx.arc(cx, cy, rH, 0, 2 * Math.PI); ctx.stroke();

    diskArc(cx, cy, rH, 0, Math.PI);                  // disk front (over horizon)

    // singularity marker (only when selected — otherwise hidden inside)
    if (singOn) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rH * 0.55);
      g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rH * 0.55, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, 2 * Math.PI); ctx.fill();
    }
  }
  function select(key) {
    active = key;
    const p = PARTS.find((x) => x.key === key);
    nameEl.textContent = p.name; descEl.textContent = p.desc;
    [...partsEl.children].forEach((b) => b.classList.toggle("active", b.dataset.k === key));
    draw();
  }
  PARTS.forEach((p) => {
    const b = document.createElement("button");
    b.className = "anat-part"; b.textContent = p.name; b.dataset.k = p.key;
    b.addEventListener("click", () => select(p.key));
    partsEl.appendChild(b);
  });
  window.addEventListener("resize", draw);
  select("horizon");
}

/* ---------------- scale comparison ---------------- */
function initScale() {
  const canvas = document.getElementById("scale-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const stepsEl = document.getElementById("scaleSteps");
  const blurbEl = document.getElementById("scaleBlurb");

  const STEPS = [
    { key: "Sun",
      big: { label: "The Sun", d: 1.39e6, dl: "1.39 million km", bh: false },
      small: { label: "Earth", d: 12742, dl: "12,742 km", bh: false, blue: true },
      blurb: "Our Sun is 109 Earths wide — and just an ordinary star." },
    { key: "Stellar black hole",
      big: { label: "The Sun", d: 1.39e6, dl: "1.39 million km", bh: false },
      small: { label: "10-solar-mass black hole", d: 60, dl: "~60 km", bh: true },
      blurb: "Collapse a giant star and you get a black hole barely 60 km across — a speck beside the Sun, yet far heavier." },
    { key: "Sagittarius A*",
      big: { label: "Sagittarius A*", d: 2.5e7, dl: "~25 million km", bh: true },
      small: { label: "The Sun", d: 1.39e6, dl: "1.39 million km", bh: false },
      blurb: "Our galaxy's black hole is about 17 Suns wide — it would sit comfortably inside Mercury's orbit." },
    { key: "M87*",
      big: { label: "M87*", d: 3.83e10, dl: "~38 billion km", bh: true },
      small: { label: "Neptune's orbit", d: 9.0e9, dl: "~9 billion km (60 AU)", bh: false, blue: true },
      blurb: "M87* is wider than our entire solar system — light itself needs days just to cross it." },
  ];

  let W = 0, H = 0, dpr = 1, idx = 0, anim = 0, raf = 0;

  function layout() {
    dpr = Math.min(window.devicePixelRatio, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function orb(x, y, r, o, t) {
    r = Math.max(r, o.bh ? 3 : 2.5);
    if (o.bh) {
      // glow halo first, then opaque black on top (so the interior stays black)
      const gl = ctx.createRadialGradient(x, y, r, x, y, r * 1.4);
      gl.addColorStop(0, `rgba(255,170,90,${0.3 * t})`); gl.addColorStop(1, "rgba(255,170,90,0)");
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, r * 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = Math.max(1.3, r * 0.05);
      ctx.strokeStyle = `rgba(255,180,110,${0.95 * t})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    } else {
      const c = o.blue ? [110, 180, 255] : [255, 210, 130];
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      g.addColorStop(0, `rgba(${c[0]+30},${c[1]+30},${c[2]},${t})`);
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},${t})`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  function label(x, y, name, dl, t) {
    ctx.globalAlpha = t; ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.font = "600 13px Inter, sans-serif";
    ctx.fillText(name, x, y); ctx.fillStyle = "rgba(150,158,172,1)"; ctx.font = "300 12px Inter, sans-serif";
    ctx.fillText(dl, x, y + 17); ctx.globalAlpha = 1;
  }

  function render() {
    layout();
    ctx.clearRect(0, 0, W, H);
    const s = STEPS[idx], cy = H * 0.44;
    const R = Math.min(H * 0.34, W * 0.26);
    const ratio = s.small.d / s.big.d;
    const sr = R * ratio;
    const bx = W * 0.36, sx = W * 0.74;

    // big object
    orb(bx, cy, R, s.big, 1);
    label(bx, cy + R + 26, s.big.label, s.big.dl, 1);
    // small object (animated scale-in)
    orb(sx, cy, sr * anim, s.small, anim);
    label(sx, cy + R + 26, s.small.label, s.small.dl, anim);

    // ratio annotation
    const times = s.big.d / s.small.d;
    const tstr = times >= 1000 ? Math.round(times / 1000) + ",000×" : (times >= 100 ? Math.round(times) + "×" : times.toFixed(times < 10 ? 1 : 0) + "×");
    ctx.globalAlpha = anim; ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,170,90,0.9)"; ctx.font = "500 13px Inter, sans-serif";
    ctx.fillText(`${tstr} wider`, (bx + sx) / 2, cy - R - 8);
    ctx.globalAlpha = 1;
  }

  function tick() {
    anim = Math.min(1, anim + 0.06);
    render();
    if (anim < 1) raf = requestAnimationFrame(tick);
  }
  function select(i) {
    idx = i; anim = 0;
    blurbEl.textContent = STEPS[i].blurb;
    [...stepsEl.children].forEach((b, k) => b.classList.toggle("active", k === i));
    cancelAnimationFrame(raf); tick();
  }

  STEPS.forEach((s, i) => {
    const b = document.createElement("button");
    b.className = "scale-step"; b.textContent = s.key;
    b.addEventListener("click", () => select(i));
    stepsEl.appendChild(b);
  });
  window.addEventListener("resize", render);
  // reveal-triggered first play
  if ("IntersectionObserver" in window) {
    let played = false;
    new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting && !played) { played = true; select(0); }
    }), { threshold: 0.3 }).observe(canvas);
  }
  select(0);
}

/* ---------------- fall-in (dive) overlay ---------------- */
function initDive(background) {
  const overlay = document.getElementById("overlay-dive");
  const canvas = document.getElementById("dive-canvas");
  const tint = document.getElementById("diveTint");
  const capEl = document.getElementById("diveCaption");
  const youEl = document.getElementById("clockYou");
  const outEl = document.getElementById("clockOut");
  const replay = document.getElementById("diveReplay");
  const foot = document.getElementById("diveFoot");
  let dive = null, start = 0, lastT = 0, outAccum = 0, done = false;

  const CAPTIONS = [
    [0.0, "You begin your fall toward the black hole."],
    [2.2, "The accretion disk blazes past. Starlight bends into a ring around the dark."],
    [4.6, "Time itself slows — to the outside universe, you appear to freeze at the edge."],
    [7.2, "You cross the event horizon: the point of no return."],
    [8.9, "Outside, the universe winks out. No signal you send will ever escape."],
  ];
  const DUR = 9.8;
  const es = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  function frameHook(target) {
    if (done) return;                                     // freeze on the final (black) frame
    const now = performance.now() / 1000, t = now - start;
    const dt = Math.min(0.1, Math.max(0, t - lastT)); lastT = t;

    // Camera stays in the visually rich zone (disk + lensing) most of the fall,
    // bottoming out at ~3.2 RS; the *crossing* is conveyed by the redshift/fade.
    target.rad = Math.max(3.2, 30 - 26.8 * es(0, 8.4, t));
    target.foc = 1.6 + 0.72 * es(1, 8.2, t);
    target.disk = 0.3 + 0.7 * es(0, 2.6, t);
    target.heat = 0.4 + 0.6 * es(0, 2.6, t);
    target.pol = 1.35 - 0.16 * es(0, 8, t);
    target.az = 0.3 + 0.5 * t + 2.4 * es(6, 9, t);        // swirl accelerates near the horizon

    // Time dilation uses a separate radius that truly approaches the horizon,
    // so the distant-observer clock diverges toward infinity.
    const rr = Math.max(1.002, 30 - 28.98 * es(0, 9.3, t));
    const gamma = 1 / Math.sqrt(1 - 1 / rr);
    outAccum += dt * gamma;
    youEl.textContent = t.toFixed(1) + " s";
    outEl.textContent = t > 8.8 ? "∞" : (outAccum < 1e4 ? outAccum.toFixed(1) + " s" : Math.round(outAccum).toLocaleString() + " s");

    let cap = CAPTIONS[0][1];
    for (const [tt, c] of CAPTIONS) if (t >= tt) cap = c;
    if (capEl.textContent !== cap) capEl.textContent = cap;

    const red = es(3.2, 8.6, t), black = es(8.6, 9.6, t);
    tint.style.opacity = 1;
    tint.style.background = `radial-gradient(ellipse at center, rgba(120,25,25,${0.3 * red}) 22%, rgba(40,0,0,${0.6 * red}) 66%, rgba(0,0,0,${Math.min(1, black + 0.35 * red)}) 100%)`;

    if (t >= DUR && !done) { done = true; replay.hidden = false; foot.hidden = false; }
  }

  function reset() {
    start = performance.now() / 1000; lastT = 0; outAccum = 0; done = false;
    replay.hidden = true; foot.hidden = true; capEl.textContent = CAPTIONS[0][1];
    tint.style.opacity = 0;
    if (dive) dive.jumpTo({ rad: 30, az: 0.3, pol: 1.35, disk: 0.3, foc: 1.6, heat: 0.4 });
  }
  function open() {
    overlay.hidden = false; overlay.setAttribute("aria-hidden", "false");
    lockScroll(true); background.paused = true;
    if (!dive) dive = createBlackHole(canvas, { ease: 0.28, onFrame: frameHook });
    reset();
    requestAnimationFrame(() => { overlay.classList.add("show"); dive.resize(); dive.paused = false; });
  }
  function close() {
    overlay.classList.remove("show");
    if (dive) dive.paused = true;
    background.paused = false; lockScroll(false);
    setTimeout(() => { overlay.hidden = true; overlay.setAttribute("aria-hidden", "true"); }, 380);
  }

  document.querySelectorAll('[data-open="dive"]').forEach((b) => b.addEventListener("click", open));
  overlay.querySelector("[data-close]").addEventListener("click", close);
  replay.addEventListener("click", reset);
  document.addEventListener("keydown", (e) => { if (!overlay.hidden && e.key === "Escape") close(); });
}

/* ---------------- black-hole merger + gravitational-wave sound ---------------- */
function initMerger(background) {
  const overlay = document.getElementById("overlay-merger");
  const canvas = document.getElementById("merger-canvas");
  const ctx = canvas.getContext("2d");
  const capEl = document.getElementById("mergerCaption");
  const playBtn = document.getElementById("mergerPlay");

  let W = 0, H = 0, dpr = 1, raf = 0, running = false;
  let stars = [], ripples = [], angle = 0, lastT = 0, t0 = 0, playing = false, flashed = false;
  let audio = null;
  const INSPIRAL = 4.8, RING = 2.2, TOTAL = INSPIRAL + RING;

  const CAPS = [
    [0.0, "Two black holes, 1.3 billion light-years away."],
    [0.6, "Locked in a death spiral, circling faster and faster…"],
    [INSPIRAL - 0.15, "They merge — releasing a storm of gravitational waves."],
    [INSPIRAL + 0.4, "A single black hole remains, ringing like a struck bell."],
    [TOTAL - 0.2, "That ripple reached Earth on 14 September 2015."],
  ];

  function layout() {
    dpr = Math.min(window.devicePixelRatio, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!stars.length) for (let i = 0; i < 170; i++) stars.push([Math.random(), Math.random(), Math.random() * 0.55 + 0.3]);
  }
  const CX = () => W / 2, CY = () => H * 0.46;
  const unit = () => Math.min(W, H);

  function drawBH(x, y, r) {
    const gl = ctx.createRadialGradient(x, y, r, x, y, r * 1.8);
    gl.addColorStop(0, "rgba(255,170,90,0.28)"); gl.addColorStop(1, "rgba(255,170,90,0)");
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(1.2, r * 0.12); ctx.strokeStyle = "rgba(255,185,120,0.9)";
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    // stars
    ctx.fillStyle = "#fff";
    for (const s of stars) { ctx.globalAlpha = s[2] * 0.7; ctx.beginPath(); ctx.arc(s[0] * W, s[1] * H, 0.9, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;

    const cx = CX(), cy = CY(), u = unit();
    const inspiral = t < INSPIRAL;
    const p = inspiral ? t / INSPIRAL : 1;
    const sep = inspiral ? (0.26 * u) * Math.pow(1 - p, 0.42) + 0.045 * u : 0;
    const rBH = 0.05 * u;

    // gravitational-wave ripples
    for (const rp of ripples) { rp.r += rp.v; rp.a *= 0.975; }
    ripples = ripples.filter((rp) => rp.a > 0.03 && rp.r < Math.hypot(W, H));
    for (const rp of ripples) {
      ctx.strokeStyle = `rgba(150,190,255,${rp.a * 0.5})`; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(cx, cy, rp.r, 0, Math.PI * 2); ctx.stroke();
    }

    if (inspiral) {
      // two black holes orbiting the common centre
      drawBH(cx + Math.cos(angle) * sep, cy + Math.sin(angle) * sep, rBH);
      drawBH(cx + Math.cos(angle + Math.PI) * sep, cy + Math.sin(angle + Math.PI) * sep, rBH);
    } else {
      if (!flashed) {
        flashed = true;
        ripples.push({ r: sep + rBH, v: 9, a: 1 }, { r: rBH, v: 6, a: 1 });
      }
      // merger flash + single ringing black hole
      const rt = (t - INSPIRAL) / RING;
      const flash = Math.max(0, 1 - rt * 5);
      if (flash > 0) { ctx.fillStyle = `rgba(255,240,220,${flash * 0.9})`; ctx.fillRect(0, 0, W, H); }
      const wob = 1 + 0.18 * Math.sin(t * 34) * Math.exp(-rt * 4);
      drawBH(cx, cy, rBH * 1.4 * wob);
    }
  }

  function spawnRipplesFromOrbit() {
    // emit a ripple twice per orbit (gravitational waves are 2× the orbital frequency)
    if (angle - (spawnRipplesFromOrbit.last || 0) >= Math.PI) {
      spawnRipplesFromOrbit.last = angle;
      ripples.push({ r: unit() * 0.05, v: 3.2, a: 0.9 });
    }
  }

  function loop() {
    const now = performance.now() / 1000;
    let t = playing ? now - t0 : 0;
    const dt = Math.min(0.05, Math.max(0, now - lastT)); lastT = now;

    if (playing && t < INSPIRAL) {
      const sep = 0.26 * unit() * Math.pow(1 - t / INSPIRAL, 0.42) + 0.045 * unit();
      angle += dt * (2.2 + 40 / (sep + 12));   // orbital speed rises as they close in
      spawnRipplesFromOrbit();
    }

    let cap = CAPS[0][1];
    if (playing) for (const [tt, c] of CAPS) if (t >= tt) cap = c;
    if (capEl.textContent !== cap) capEl.textContent = cap;

    draw(playing ? t : 0);

    if (playing && t >= TOTAL) { playing = false; playBtn.hidden = false; playBtn.textContent = "↺ Play again"; }
    raf = requestAnimationFrame(loop);
  }

  function playAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      audio = new AC();
      const now = audio.currentTime;
      const gain = audio.createGain();
      gain.connect(audio.destination);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.28, now + INSPIRAL);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + TOTAL);
      [1, 0.5].forEach((mult, i) => {                 // fundamental + one octave down
        const o = audio.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(38 * mult, now);
        o.frequency.exponentialRampToValueAtTime(260 * mult, now + INSPIRAL);
        o.frequency.exponentialRampToValueAtTime(180 * mult, now + TOTAL); // ringdown settles
        const g = audio.createGain(); g.gain.value = i === 0 ? 1 : 0.5;
        o.connect(g); g.connect(gain);
        o.start(now); o.stop(now + TOTAL + 0.1);
      });
    } catch (e) { /* audio optional */ }
  }

  function play() {
    playBtn.hidden = true; playing = true; flashed = false; ripples = []; angle = 0;
    spawnRipplesFromOrbit.last = 0;
    t0 = performance.now() / 1000;
    playAudio();
  }
  function open() {
    overlay.hidden = false; overlay.setAttribute("aria-hidden", "false");
    lockScroll(true); background.paused = true;
    playing = false; playBtn.hidden = false; playBtn.textContent = "▸ Play the merger";
    capEl.textContent = CAPS[0][1];
    requestAnimationFrame(() => { overlay.classList.add("show"); layout(); lastT = performance.now() / 1000; if (!running) { running = true; loop(); } });
  }
  function close() {
    overlay.classList.remove("show");
    running = false; cancelAnimationFrame(raf);
    if (audio) { try { audio.close(); } catch (e) {} audio = null; }
    playing = false; background.paused = false; lockScroll(false);
    setTimeout(() => { overlay.hidden = true; overlay.setAttribute("aria-hidden", "true"); }, 380);
  }

  document.querySelectorAll('[data-open="merger"]').forEach((b) => b.addEventListener("click", open));
  playBtn.addEventListener("click", play);
  overlay.querySelector("[data-close]").addEventListener("click", close);
  window.addEventListener("resize", () => { if (!overlay.hidden) layout(); });
  document.addEventListener("keydown", (e) => { if (!overlay.hidden && e.key === "Escape") close(); });
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
  initScale();
  initAnatomy();
  initBirth();
  initHawking();
  initDive(background);
  initMerger(background);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
