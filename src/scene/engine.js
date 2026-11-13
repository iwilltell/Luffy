import { createLuffy } from './luffy';
import { mix, css } from './palette';

/*
  Two canvases:
    sky  - gradient, stars, moon/sun, clouds, gulls        (behind the DOM wordmark)
    sea  - ocean, boat, Luffy, lantern, meat, every effect  (in front of the wordmark)
  Luffy and the boat live in "plate" units (the 1280x720 source frame); the
  boat group is translated / rotated as one so he rides the swell with it.
*/

const PLATE_CX = 641.5;     // brim centre of the front pose
const WATERLINE = 760;      // plate y that sits on the water
const TOP = 48;             // plate y of the top of his hat
const HIT = { x: 641, y: 400, rx: 235, ry: 300 };
const MEAT = { x: 978, y: 586 };
const LANTERN = { x: 214, y: 404 };

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function spring(s, target, dt, k = 80, d = 14) {
  const a = (target - s.v) * k - s.d * d;
  s.d += a * dt;
  s.v += s.d * dt;
  return s.v;
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}

export function createEngine({ sky, sea, root, onEvent, reduced = false, theme = 'night' }) {
  const sctx = sky.getContext('2d');
  const fctx = sea.getContext('2d');
  const base = import.meta.env.BASE_URL;
  const M = reduced ? 0 : 1;                 // ambient-motion multiplier

  let w = 0, h = 0, dpr = 1;
  const L = {};
  let dayMix = theme === 'day' ? 1 : 0;
  let dayTarget = dayMix;
  let alive = true;
  let raf = 0;
  let time = 0;
  let last = performance.now();

  // assets
  let meta = null;
  const sheets = { base: null, gust: null };
  let half = false;
  let gustLoading = null;
  let pendingGust = false;
  let reveal = 0;                            // Luffy fades in once his sheet is decoded

  // motion state
  const ptr = { x: 0, y: 0, nx: 0, ny: 0, inside: false, movedAt: -99, type: 'mouse', lx: 0, ly: 0, lt: 0 };
  const look = { v: 0, d: 0 };
  const lean = { v: 0, d: 0 };
  const pop = { v: 1, d: 0 };
  const par = { x: { v: 0, d: 0 }, y: { v: 0, d: 0 } };
  let chop = 0;                              // extra swell after a gust
  let windBoost = 0;
  let hoverTime = 0;
  let lastInteract = performance.now();
  let swipeCooldown = 0;
  let bob = { y: 0, r: 0 };
  let trailAcc = 0;
  let wakeAcc = 0;
  const boatX = { v: 0, d: 0, set: false };
  let boatTarget = 0;
  let boatEase = 0;
  const roll = { v: 0, d: 0 };

  const meat = { visible: true, scale: { v: 1, d: 0 }, respawnAt: 0 };

  // scenery + fx
  let stars = [];
  let clouds = [];
  const birds = [];
  let nextBird = 3;
  const shooting = [];
  let nextShooting = 6;
  const parts = [];
  const streaks = [];
  let focus = null;

  const emit = (type, data) => onEvent && onEvent(type, data);

  const luffy = createLuffy(name => {
    if (name === 'wind') {
      spawnWind();
      chop = 1;
      windBoost = 1;
      emit('wind', toScreen(320, 380));
    } else if (name === 'hatOff') {
      emit('hatOff', toScreen(1040, 120));
    } else if (name === 'stretch') {
      emit('stretch', toScreen(1010, 300));
    } else if (name === 'catch') {
      const p = toScreen(1110, 220);
      burst(p.x, p.y, 14, 'spark');
      emit('catch', p);
    } else if (name === 'don') {
      const p = toScreen(PLATE_CX, 210);
      if (!reduced) focus = { t: 0, dur: 0.9, x: p.x, y: p.y, lines: [], refresh: 0 };
      burst(p.x, p.y - 40 * L.s, 26, 'coin');
      pop.v = 0.9; pop.d = 2;
      emit('don', toScreen(PLATE_CX, 120));
    }
  });

  // ───────────────────────────── layout
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = root.clientWidth;
    h = root.clientHeight;
    for (const [cv, cx] of [[sky, sctx], [sea, fctx]]) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.imageSmoothingQuality = 'high';
    }
    const portrait = h > w * 1.05;
    L.portrait = portrait;
    // fit the whole rig (lantern at plate x≈180 to the stern at ≈1040) and his height
    const topY = h * (portrait ? 0.3 : 0.16);
    const maxWater = h * (portrait ? 0.8 : 0.885);
    L.s = Math.min((maxWater - topY) / (WATERLINE - TOP), (w * 0.96) / 900);
    L.waterY = portrait ? Math.min(maxWater, Math.max(topY + (WATERLINE - TOP) * L.s, h * 0.7)) : maxWater;
    L.horizon = portrait ? L.waterY - 300 * L.s : h * 0.6;
    if (!boatX.set) { boatX.v = boatTarget = boatEase = w / 2; boatX.set = true; }
    L.cx = boatX.v;
    L.mx = w * (portrait ? 0.8 : 0.82);
    L.my = h * (portrait ? 0.12 : 0.19);
    L.mr = Math.max(18, Math.min(w, h) * 0.05);
    root.style.setProperty('--horizon', L.horizon.toFixed(1) + 'px');
    root.style.setProperty('--luffy-top', (L.waterY - (WATERLINE - TOP) * L.s).toFixed(1) + 'px');
    seedSky();
  }

  function seedSky() {
    const n = Math.min(280, Math.round((w * L.horizon) / 5200));
    stars = Array.from({ length: n }, () => ({
      x: Math.random() * w,
      y: Math.pow(Math.random(), 1.4) * L.horizon * 0.96,
      r: rand(0.4, 1.5),
      tw: rand(0.6, 2.6),
      ph: rand(0, 6.3),
      big: Math.random() < 0.07,
    }));
    if (!clouds.length) {
      clouds = Array.from({ length: 7 }, (_, i) => makeCloud(i / 7 * w * 1.3 - w * 0.15));
    }
  }

  function makeCloud(x) {
    const sc = rand(0.6, 1.25);
    const puffs = [];
    const count = 5 + ((Math.random() * 4) | 0);
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1) - 0.5;
      puffs.push({ dx: t * 150 + rand(-12, 12), dy: -Math.cos(t * Math.PI) * rand(18, 34), r: rand(22, 40) * (1 - Math.abs(t) * 0.6) });
    }
    return { x, y: rand(0.08, 0.62), sc, speed: rand(6, 14), puffs, depth: rand(0.3, 1) };
  }

  // plate -> screen, through the boat's bob and roll
  function toScreen(px, py) {
    const dx = (px - PLATE_CX) * L.s;
    const dy = (py - WATERLINE) * L.s;
    const c = Math.cos(bob.r), s = Math.sin(bob.r);
    return { x: L.cx + dx * c - dy * s, y: L.waterY + bob.y + dx * s + dy * c };
  }
  function toPlate(x, y) {
    const dx = x - L.cx;
    const dy = y - (L.waterY + bob.y);
    const c = Math.cos(-bob.r), s = Math.sin(-bob.r);
    return { x: (dx * c - dy * s) / L.s + PLATE_CX, y: (dx * s + dy * c) / L.s + WATERLINE };
  }
  function overHat(x, y) {
    if (luffy.mode === 'gust') return false;
    const p = toPlate(x, y);
    const nx = (p.x - PLATE_CX) / 300, ny = (p.y - 200) / 155;
    return nx * nx + ny * ny <= 1 && p.y < 325;
  }
  function overLuffy(x, y) {
    const p = toPlate(x, y);
    const nx = (p.x - HIT.x) / HIT.rx, ny = (p.y - HIT.y) / HIT.ry;
    return nx * nx + ny * ny <= 1;
  }
  function overMeat(x, y) {
    if (!meat.visible) return false;
    const p = toPlate(x, y);
    return Math.hypot(p.x - MEAT.x, p.y - MEAT.y) < 80;
  }

  // ───────────────────────────── effects
  function burst(x, y, n, kind) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = kind === 'coin' ? rand(160, 420) : rand(60, 260);
      parts.push({
        kind, x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (kind === 'coin' ? 260 : 40),
        life: 0, max: kind === 'coin' ? rand(1.1, 1.6) : rand(0.5, 1),
        r: kind === 'coin' ? rand(5, 9) : rand(3, 7),
        rot: rand(0, 6), spin: rand(-8, 8),
        g: kind === 'coin' ? 900 : kind === 'drop' || kind === 'crumb' ? 700 : 0,
      });
    }
    if (parts.length > 500) parts.splice(0, parts.length - 500);
  }

  function splash(x, y) {
    parts.push({ kind: 'ring', x, y, vx: 0, vy: 0, life: 0, max: 1.2, r: 6, rot: 0, spin: 0, g: 0 });
    parts.push({ kind: 'ring', x, y, vx: 0, vy: 0, life: -0.18, max: 1.2, r: 3, rot: 0, spin: 0, g: 0 });
    for (let i = 0; i < 16; i++) {
      const a = rand(-Math.PI * 0.92, -Math.PI * 0.08);
      const sp = rand(120, 340);
      parts.push({ kind: 'drop', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rand(0.5, 0.9), r: rand(1.6, 3.6), rot: 0, spin: 0, g: 900 });
    }
  }

  function spawnWind() {
    if (reduced) return;
    for (let i = 0; i < 18; i++) {
      streaks.push({
        x: -rand(0, w * 0.8),
        y: rand(h * 0.12, h * 0.9),
        len: rand(160, 520),
        speed: rand(1300, 2300),
        amp: rand(6, 26),
        k: rand(0.008, 0.02),
        ph: rand(0, 6),
        width: rand(1.2, 3.6),
      });
    }
  }

  // ───────────────────────────── sky canvas
  function drawSky(dt) {
    const c = sctx;
    const H = L.horizon;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, css(mix('skyTop', dayMix)));
    g.addColorStop(0.58, css(mix('skyMid', dayMix)));
    g.addColorStop(1, css(mix('skyLow', dayMix)));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);

    const glow = c.createRadialGradient(w * 0.5, H, 0, w * 0.5, H, Math.max(w, h) * 0.55);
    const gc = mix('glow', dayMix);
    glow.addColorStop(0, css(gc, 0.42));
    glow.addColorStop(1, css(gc, 0));
    c.fillStyle = glow;
    c.fillRect(0, 0, w, H + 4);

    const px = par.x.v, py = par.y.v;
    const night = 1 - dayMix;

    // stars
    if (night > 0.02) {
      for (const s of stars) {
        const tw = M ? 0.5 + 0.5 * Math.sin(time * s.tw + s.ph) : 0.8;
        const a = night * (0.25 + 0.75 * tw) * (1 - s.y / H * 0.55);
        const x = s.x - px * 6, y = s.y - py * 4;
        c.fillStyle = `rgba(255,250,235,${a})`;
        c.beginPath();
        c.arc(x, y, s.r, 0, 6.283);
        c.fill();
        if (s.big) {
          c.strokeStyle = `rgba(255,240,200,${a * 0.6})`;
          c.lineWidth = 0.8;
          const k = s.r * 4 * (0.6 + tw * 0.6);
          c.beginPath();
          c.moveTo(x - k, y); c.lineTo(x + k, y);
          c.moveTo(x, y - k); c.lineTo(x, y + k);
          c.stroke();
        }
      }
      // shooting stars
      nextShooting -= dt * M;
      if (nextShooting <= 0) {
        addShootingStar(rand(w * 0.1, w * 0.9), rand(0, H * 0.4));
        nextShooting = rand(5, 12);
      }
    }
    for (let i = shooting.length - 1; i >= 0; i--) {
      const s = shooting[i];
      s.life += dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      const k = s.life / s.max;
      if (k >= 1) { shooting.splice(i, 1); continue; }
      const a = Math.sin(k * Math.PI) * Math.max(night, 0.35);
      const tx = s.x - s.vx * 0.12, ty = s.y - s.vy * 0.12;
      const sg = c.createLinearGradient(s.x, s.y, tx, ty);
      sg.addColorStop(0, `rgba(255,248,220,${a})`);
      sg.addColorStop(1, 'rgba(255,248,220,0)');
      c.strokeStyle = sg;
      c.lineWidth = 2;
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(tx, ty); c.stroke();
    }

    // moon / sun
    const mx = L.mx - px * 10, my = L.my - py * 6, r = L.mr;
    if (night > 0.01) {
      c.globalAlpha = night;
      const halo = c.createRadialGradient(mx, my, r * 0.8, mx, my, r * 4.2);
      halo.addColorStop(0, 'rgba(220,230,255,0.28)');
      halo.addColorStop(1, 'rgba(220,230,255,0)');
      c.fillStyle = halo;
      c.beginPath(); c.arc(mx, my, r * 4.2, 0, 6.283); c.fill();
      const disc = c.createRadialGradient(mx - r * 0.3, my - r * 0.3, r * 0.1, mx, my, r);
      disc.addColorStop(0, '#fffdf2');
      disc.addColorStop(1, '#e6e0c8');
      c.fillStyle = disc;
      c.beginPath(); c.arc(mx, my, r, 0, 6.283); c.fill();
      c.fillStyle = 'rgba(150,140,110,0.18)';
      for (const [ox, oy, rr] of [[-0.3, -0.15, 0.22], [0.28, 0.2, 0.16], [0.05, 0.42, 0.1], [0.35, -0.35, 0.08]]) {
        c.beginPath(); c.arc(mx + ox * r, my + oy * r, rr * r, 0, 6.283); c.fill();
      }
      c.globalAlpha = 1;
    }
    if (dayMix > 0.01) {
      c.globalAlpha = dayMix;
      const sg = c.createRadialGradient(mx, my, r * 0.6, mx, my, r * 5);
      sg.addColorStop(0, 'rgba(255,236,170,0.75)');
      sg.addColorStop(0.35, 'rgba(255,214,120,0.25)');
      sg.addColorStop(1, 'rgba(255,214,120,0)');
      c.fillStyle = sg;
      c.beginPath(); c.arc(mx, my, r * 5, 0, 6.283); c.fill();
      c.fillStyle = '#fff7d6';
      c.beginPath(); c.arc(mx, my, r * 0.95, 0, 6.283); c.fill();
      c.globalAlpha = 1;
    }

    // clouds
    const cloudC = mix('cloud', dayMix), lightC = mix('cloudLight', dayMix);
    const ca = 0.5 + dayMix * 0.42;
    for (const cl of clouds) {
      cl.x += (cl.speed * (1 + windBoost * 14) * cl.depth) * dt * (M || 0.0001);
      const sc = cl.sc * Math.max(0.55, Math.min(1.2, w / 1400));
      if (cl.x - 120 * sc > w) {
        Object.assign(cl, makeCloud(-200 * sc));
      }
      const x = cl.x - px * 14 * cl.depth, y = cl.y * H - py * 6 * cl.depth;
      c.globalAlpha = ca * (0.6 + cl.depth * 0.4);
      c.fillStyle = css(cloudC);
      c.beginPath();
      for (const p of cl.puffs) { c.moveTo(x + p.dx * sc + p.r * sc, y + p.dy * sc); c.arc(x + p.dx * sc, y + p.dy * sc, p.r * sc, 0, 6.283); }
      c.rect(x - 75 * sc, y - 6 * sc, 150 * sc, 18 * sc);
      c.fill();
      c.globalAlpha *= 0.55;
      c.fillStyle = css(lightC);
      c.beginPath();
      for (const p of cl.puffs) { c.moveTo(x + p.dx * sc + p.r * 0.7 * sc, y + (p.dy - p.r * 0.25) * sc); c.arc(x + p.dx * sc, y + (p.dy - p.r * 0.25) * sc, p.r * 0.7 * sc, 0, 6.283); }
      c.fill();
      c.globalAlpha = 1;
    }

    // gulls
    nextBird -= dt * M;
    if (nextBird <= 0) {
      const n = 1 + ((Math.random() * 3) | 0);
      const y0 = rand(H * 0.15, H * 0.6);
      for (let i = 0; i < n; i++) birds.push({ x: -40 - i * rand(30, 60), y: y0 + rand(-25, 25), v: rand(40, 75), sc: rand(0.7, 1.2), ph: rand(0, 6) });
      nextBird = rand(9, 18);
    }
    c.strokeStyle = css(mix('bird', dayMix), 0.75);
    c.lineCap = 'round';
    for (let i = birds.length - 1; i >= 0; i--) {
      const b = birds[i];
      b.x += b.v * (1 + windBoost * 3) * dt;
      if (b.x > w + 60) { birds.splice(i, 1); continue; }
      const f = Math.sin(time * 7 + b.ph);
      const s = 9 * b.sc;
      const y = b.y + Math.sin(time * 1.3 + b.ph) * 4;
      c.lineWidth = 1.8 * b.sc;
      c.beginPath();
      c.moveTo(b.x - s, y - f * s * 0.45);
      c.quadraticCurveTo(b.x - s * 0.45, y - s * 0.55 - f * s * 0.2, b.x, y);
      c.quadraticCurveTo(b.x + s * 0.45, y - s * 0.55 - f * s * 0.2, b.x + s, y - f * s * 0.45);
      c.stroke();
    }
  }

  function addShootingStar(x, y) {
    const a = rand(0.35, 0.65);
    const sp = rand(700, 1000);
    shooting.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rand(0.6, 0.95) });
  }

  // ───────────────────────────── sea canvas
  function waveY(x, base, amp, k1, k2, s1, s2) {
    const kx = x / L.s;
    return base + L.s * amp * (Math.sin(kx * k1 + time * s1) * 0.65 + Math.sin(kx * k2 - time * s2 + 1.3) * 0.35);
  }

  function drawSea(dt) {
    const c = fctx;
    c.clearRect(0, 0, w, h);
    const H = L.horizon;
    const amp = (1 + chop * 1.4) * (M || 0.0001);

    const g = c.createLinearGradient(0, H, 0, h);
    g.addColorStop(0, css(mix('seaTop', dayMix)));
    g.addColorStop(1, css(mix('seaBottom', dayMix)));
    c.fillStyle = g;
    c.fillRect(0, H, w, h - H);
    c.fillStyle = css(mix('shine', dayMix), 0.35);
    c.fillRect(0, H, w, 1.2);

    // moon / sun path on the water
    const shine = mix('shine', dayMix);
    const mx = L.mx - par.x.v * 10;
    for (let i = 0; i < 46; i++) {
      const k = i / 46;
      const y = H + Math.pow(k, 1.5) * (L.waterY - H + 30);
      const spread = 8 + (y - H) * 0.42;
      const x = mx + Math.sin(time * 1.6 * (M || 0.2) + i * 1.7) * spread * 0.45;
      const len = spread * (0.5 + 0.5 * Math.abs(Math.sin(time * 2.1 * (M || 0.2) + i * 0.9)));
      c.fillStyle = css(shine, (0.5 - k * 0.38) * (0.7 + dayMix * 0.3));
      c.fillRect(x - len / 2, y, len, 1.2 + k * 2.2);
    }

    // perspective swell lines
    const sw = mix('swell', dayMix);
    c.lineWidth = 1;
    for (let r = 1; r <= 16; r++) {
      const k = r / 16;
      const y = H + Math.pow(k, 1.9) * (h - H);
      c.strokeStyle = css(sw, 0.05 + k * 0.08);
      c.beginPath();
      for (let x = -10; x <= w + 10; x += 18) {
        const yy = y + Math.sin(x * (0.02 - k * 0.012) + time * (0.8 + k) * (M || 0) + r * 2) * (1 + k * 5) * amp * 0.6;
        x === -10 ? c.moveTo(x, yy) : c.lineTo(x, yy);
      }
      c.stroke();
    }

    // surface fx under the boat (ripple rings)
    drawParts(c, dt, true);

    // a swell behind the hull
    const midBase = L.waterY - 22 * L.s;
    c.fillStyle = css(mix('seaTop', dayMix).map((v, i) => (v + mix('seaFront', dayMix)[i]) / 2));
    c.beginPath();
    c.moveTo(0, h);
    for (let x = 0; x <= w + 12; x += 12) c.lineTo(x, waveY(x, midBase, 7 * amp, 0.009, 0.021, 1.1, 1.7));
    c.lineTo(w, h);
    c.fill();

    drawBoatGroup(dt);

    // front wave over the hull
    const frontBase = L.waterY + 6 * L.s;
    const fg = c.createLinearGradient(0, frontBase - 20 * L.s, 0, h);
    fg.addColorStop(0, css(mix('seaFront', dayMix)));
    fg.addColorStop(1, css(mix('seaFrontDeep', dayMix)));
    c.fillStyle = fg;
    c.beginPath();
    c.moveTo(0, h);
    const crest = [];
    for (let x = 0; x <= w + 10; x += 10) {
      const y = waveY(x, frontBase, 10 * amp, 0.012, 0.027, 1.6, 2.3);
      crest.push(x, y);
      c.lineTo(x, y);
    }
    c.lineTo(w, h);
    c.fill();
    const foam = mix('foam', dayMix);
    c.strokeStyle = css(foam, 0.5);
    c.lineWidth = Math.max(1.5, 2.6 * L.s);
    c.lineJoin = 'round';
    c.beginPath();
    for (let i = 0; i < crest.length; i += 2) i === 0 ? c.moveTo(crest[i], crest[i + 1]) : c.lineTo(crest[i], crest[i + 1]);
    c.stroke();
    // dashed foam below the crest
    c.setLineDash([6 * L.s + 2, 14 * L.s + 4]);
    c.lineDashOffset = -time * 30 * (M || 0);
    c.strokeStyle = css(foam, 0.22);
    c.beginPath();
    for (let i = 0; i < crest.length; i += 2) {
      const y = crest[i + 1] + 16 * L.s;
      i === 0 ? c.moveTo(crest[i], y) : c.lineTo(crest[i], y);
    }
    c.stroke();
    c.setLineDash([]);

    // foam curling at both ends of the hull
    for (const px of [262, 1018]) {
      const p = toScreen(px, WATERLINE - 4);
      for (let i = 0; i < 4; i++) {
        const t = (time * 0.8 * (M || 0.3) + i / 4) % 1;
        c.fillStyle = css(foam, 0.45 * (1 - t));
        c.beginPath();
        c.ellipse(p.x + (px < 600 ? -1 : 1) * t * 40 * L.s, p.y + 4 * L.s, (8 + t * 26) * L.s, (2 + t * 4) * L.s, 0, 0, 6.283);
        c.fill();
      }
    }

    drawParts(c, dt, false);
    drawStreaks(c, dt);
    drawFocus(c, dt);
  }

  // ───────────────────────────── boat + Luffy (plate units)
  function hullPath(c) {
    c.beginPath();
    c.moveTo(250, 615);
    c.quadraticCurveTo(641, 690, 1030, 615);
    c.bezierCurveTo(1016, 700, 900, 815, 641, 822);
    c.bezierCurveTo(382, 815, 266, 700, 250, 615);
    c.closePath();
  }

  function drawBoatGroup(dt) {
    const c = fctx;
    const ink = css(mix('ink', dayMix));
    const wood = mix('wood', dayMix), woodDark = mix('woodDark', dayMix), woodLight = mix('woodLight', dayMix);
    const night = 1 - dayMix;
    const flick = 0.85 + 0.15 * Math.sin(time * 13) * Math.sin(time * 7.3);

    c.save();
    c.translate(L.cx, L.waterY + bob.y);
    c.rotate(bob.r);
    c.scale(L.s, L.s);
    c.translate(-PLATE_CX, -WATERLINE);

    // inside of the hull, behind him
    c.fillStyle = css(woodDark);
    c.beginPath();
    c.moveTo(250, 615);
    c.quadraticCurveTo(641, 556, 1030, 615);
    c.quadraticCurveTo(641, 690, 250, 615);
    c.fill();
    c.strokeStyle = ink;
    c.lineWidth = 4;
    c.stroke();
    c.strokeStyle = css(woodLight, 0.5);
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(262, 612);
    c.quadraticCurveTo(641, 560, 1018, 612);
    c.stroke();

    // lantern pole (behind him, on the port side)
    c.strokeStyle = ink;
    c.lineWidth = 13;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(276, 628); c.lineTo(276, 392); c.lineTo(LANTERN.x - 4, 392); c.stroke();
    c.strokeStyle = css(wood);
    c.lineWidth = 7;
    c.beginPath(); c.moveTo(276, 628); c.lineTo(276, 392); c.lineTo(LANTERN.x - 4, 392); c.stroke();

    // Luffy
    drawLuffy(c, dt);

    // near side of the hull
    const hg = c.createLinearGradient(0, 615, 0, 822);
    hg.addColorStop(0, css(woodLight));
    hg.addColorStop(0.35, css(wood));
    hg.addColorStop(1, css(woodDark));
    hullPath(c);
    c.fillStyle = hg;
    c.fill();
    c.save();
    hullPath(c);
    c.clip();
    c.strokeStyle = css(woodDark, 0.65);
    c.lineWidth = 3.5;
    for (let k = 1; k <= 4; k++) {
      const y0 = 615 + k * 40, cy = 690 + k * 34;
      c.beginPath();
      c.moveTo(230, y0);
      c.quadraticCurveTo(641, cy, 1050, y0);
      c.stroke();
      c.fillStyle = css(woodDark, 0.8);
      for (let i = 1; i < 10; i++) {
        const t = i / 10;
        const x = (1 - t) * (1 - t) * 230 + 2 * t * (1 - t) * 641 + t * t * 1050;
        const y = (1 - t) * (1 - t) * y0 + 2 * t * (1 - t) * cy + t * t * y0 - 18;
        c.beginPath(); c.arc(x, y, 3, 0, 6.283); c.fill();
      }
    }
    // warm lantern light spilling on the hull at night
    if (night > 0.02) {
      const lg = c.createRadialGradient(LANTERN.x + 40, 600, 10, LANTERN.x + 40, 600, 420);
      lg.addColorStop(0, `rgba(255,170,80,${0.32 * night * flick})`);
      lg.addColorStop(1, 'rgba(255,170,80,0)');
      c.fillStyle = lg;
      c.fillRect(200, 600, 600, 240);
    }
    c.restore();
    // gunwale rail + ink outline
    c.strokeStyle = ink;
    c.lineWidth = 22;
    c.beginPath(); c.moveTo(250, 615); c.quadraticCurveTo(641, 690, 1030, 615); c.stroke();
    c.strokeStyle = css(woodLight);
    c.lineWidth = 14;
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.28)';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(262, 611); c.quadraticCurveTo(641, 682, 1018, 611); c.stroke();
    hullPath(c);
    c.strokeStyle = ink;
    c.lineWidth = 5;
    c.stroke();

    drawMeat(c, ink);
    drawLantern(c, ink, night, flick);

    c.restore();
  }

  function drawLuffy(c, dt) {
    if (!meta || !sheets.base) return;
    reveal = Math.min(1, reveal + dt * 2.2);
    const pivotX = PLATE_CX, pivotY = 700;
    c.save();
    c.globalAlpha = reveal;
    c.translate(pivotX + lean.v * 10, pivotY);
    c.rotate(lean.v * 0.03);
    c.scale(pop.v, 2 - pop.v);
    c.translate(-pivotX, -pivotY);
    for (const [f, a] of luffy.layers()) {
      if (a <= 0.004) continue;
      const fr = meta.frames[f];
      const img = sheets[fr.sheet];
      if (!img) continue;
      const [sx, sy, sw, sh] = half ? fr.src_half : fr.src;
      const [dx, dy, dw, dh] = fr.dest;
      c.globalAlpha = a * reveal;
      c.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    }
    c.restore();
  }

  function drawMeat(c, ink) {
    const k = meat.scale.v;
    if (k < 0.02) return;
    c.save();
    c.translate(MEAT.x, MEAT.y + Math.sin(time * 2.4) * 2 * M);
    c.rotate(-0.22);
    c.scale(k, k);
    // bone
    c.lineCap = 'round';
    c.strokeStyle = ink; c.lineWidth = 24;
    c.beginPath(); c.moveTo(-64, 0); c.lineTo(64, 0); c.stroke();
    c.fillStyle = ink;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) { c.beginPath(); c.arc(sx * 68, sy * 9, 15, 0, 6.283); c.fill(); }
    c.strokeStyle = '#f6eedb'; c.lineWidth = 15;
    c.beginPath(); c.moveTo(-64, 0); c.lineTo(64, 0); c.stroke();
    c.fillStyle = '#f6eedb';
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) { c.beginPath(); c.arc(sx * 68, sy * 9, 10.5, 0, 6.283); c.fill(); }
    // the meat
    const mg = c.createLinearGradient(0, -36, 0, 34);
    mg.addColorStop(0, '#e07a42');
    mg.addColorStop(1, '#8e3a1c');
    c.fillStyle = mg;
    c.beginPath(); c.ellipse(4, 0, 44, 34, 0, 0, 6.283); c.fill();
    c.strokeStyle = ink; c.lineWidth = 5; c.stroke();
    c.fillStyle = 'rgba(255,220,170,0.55)';
    c.beginPath(); c.ellipse(-8, -14, 16, 7, -0.35, 0, 6.283); c.fill();
    c.strokeStyle = 'rgba(90,30,10,0.55)'; c.lineWidth = 3;
    c.beginPath(); c.arc(16, 6, 14, 0.2, 1.6); c.stroke();
    c.restore();
  }

  function drawLantern(c, ink, night, flick) {
    const sway = Math.sin(time * 1.7) * 0.1 * M - bob.r * 1.6;
    c.save();
    c.translate(LANTERN.x, LANTERN.y);
    c.rotate(sway);
    if (night > 0.02) {
      c.globalCompositeOperation = 'lighter';
      const g = c.createRadialGradient(0, 62, 6, 0, 62, 210);
      g.addColorStop(0, `rgba(255,190,90,${0.55 * night * flick})`);
      g.addColorStop(0.4, `rgba(255,150,60,${0.16 * night * flick})`);
      g.addColorStop(1, 'rgba(255,150,60,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(0, 62, 210, 0, 6.283); c.fill();
      c.globalCompositeOperation = 'source-over';
    }
    c.strokeStyle = ink; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, -4); c.lineTo(0, 24); c.stroke();
    // paper body
    const lit = 0.35 + 0.65 * night * flick;
    const body = c.createRadialGradient(0, 62, 4, 0, 62, 40);
    body.addColorStop(0, `rgb(255,${200 + 40 * lit | 0},${120 + 60 * lit | 0})`);
    body.addColorStop(1, `rgb(${220 + 20 * lit | 0},${90 + 60 * lit | 0},40)`);
    c.fillStyle = body;
    c.beginPath(); c.ellipse(0, 62, 27, 36, 0, 0, 6.283); c.fill();
    c.strokeStyle = ink; c.lineWidth = 4; c.stroke();
    c.strokeStyle = 'rgba(80,30,10,0.45)'; c.lineWidth = 2;
    for (const k of [-0.5, 0, 0.5]) { c.beginPath(); c.ellipse(0, 62, 27 * Math.abs(Math.cos(k * 1.2)) * 0.75, 36, 0, 0, 6.283); c.stroke(); }
    c.fillStyle = ink;
    c.fillRect(-15, 22, 30, 9);
    c.fillRect(-15, 94, 30, 9);
    c.restore();
  }

  // ───────────────────────────── particles / streaks / focus lines
  function drawParts(c, dt, surface) {
    const foam = css(mix('foam', dayMix));
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if ((p.kind === 'ring') !== surface) continue;
      p.life += dt;
      if (p.life < 0) continue;
      const k = p.life / p.max;
      if (k >= 1) { parts.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - dt * (p.kind === 'spark' ? 2.6 : 0.6);
      if (p.kind === 'spark' || p.kind === 'bubble') p.vy *= 1 - dt * 2.6;
      p.rot += p.spin * dt;
      const a = 1 - k;
      switch (p.kind) {
        case 'ring': {
          const r = p.r + k * 70;
          c.strokeStyle = foam; c.globalAlpha = a * 0.7; c.lineWidth = 2 * (1 - k) + 0.5;
          c.beginPath(); c.ellipse(p.x, p.y, r, r * 0.3, 0, 0, 6.283); c.stroke();
          break;
        }
        case 'drop':
          c.fillStyle = foam; c.globalAlpha = a;
          c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.283); c.fill();
          break;
        case 'bubble':
          c.strokeStyle = foam; c.globalAlpha = a * 0.75; c.lineWidth = 1.2;
          c.beginPath(); c.arc(p.x, p.y, p.r * (0.6 + k * 0.6), 0, 6.283); c.stroke();
          break;
        case 'crumb':
          c.fillStyle = '#b4542a'; c.globalAlpha = a;
          c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.283); c.fill();
          break;
        case 'coin': {
          const sx = Math.abs(Math.cos(p.rot));
          c.globalAlpha = Math.min(1, a * 2);
          c.fillStyle = '#ffd23f'; c.strokeStyle = '#9a6a10'; c.lineWidth = 1.5;
          c.beginPath(); c.ellipse(p.x, p.y, p.r * sx + 0.6, p.r, 0, 0, 6.283); c.fill(); c.stroke();
          break;
        }
        default: { // spark: four-point star
          const r = p.r * (1 - k * 0.5);
          c.fillStyle = p.color || '#ffe27a'; c.globalAlpha = a;
          c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
          c.beginPath();
          c.moveTo(0, -r * 2); c.quadraticCurveTo(0, 0, r * 2, 0); c.quadraticCurveTo(0, 0, 0, r * 2);
          c.quadraticCurveTo(0, 0, -r * 2, 0); c.quadraticCurveTo(0, 0, 0, -r * 2);
          c.fill(); c.restore();
        }
      }
    }
    c.globalAlpha = 1;
  }

  function drawStreaks(c, dt) {
    if (!streaks.length) return;
    c.lineCap = 'round';
    for (let i = streaks.length - 1; i >= 0; i--) {
      const s = streaks[i];
      s.x += s.speed * dt;
      if (s.x - s.len > w + 40) { streaks.splice(i, 1); continue; }
      const head = s.x, tail = s.x - s.len;
      for (const [lw, a] of [[s.width * 2.6, 0.12], [s.width, 0.75]]) {
        c.strokeStyle = `rgba(255,255,255,${a * (dayMix ? 0.9 : 0.8)})`;
        c.lineWidth = lw;
        c.beginPath();
        for (let x = tail; x <= head; x += 14) {
          const y = s.y + Math.sin(x * s.k + s.ph) * s.amp;
          x === tail ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.stroke();
      }
    }
  }

  function drawFocus(c, dt) {
    if (!focus) return;
    focus.t += dt;
    const k = focus.t / focus.dur;
    if (k >= 1) { focus = null; return; }
    focus.refresh -= dt;
    if (focus.refresh <= 0) {
      focus.refresh = 0.05;
      focus.lines = Array.from({ length: 90 }, () => ({ a: rand(0, 6.283), wd: rand(0.004, 0.016), r0: rand(0.85, 1.25) }));
    }
    const R = Math.min(w, h) * 0.34;
    const far = Math.hypot(w, h);
    c.fillStyle = dayMix > 0.5 ? 'rgba(20,24,40,0.75)' : 'rgba(255,255,255,0.8)';
    c.globalAlpha = Math.sin(Math.min(1, k * 4) * Math.PI / 2) * (1 - k);
    c.beginPath();
    for (const l of focus.lines) {
      const r0 = R * l.r0;
      c.moveTo(focus.x + Math.cos(l.a) * r0, focus.y + Math.sin(l.a) * r0);
      c.lineTo(focus.x + Math.cos(l.a - l.wd) * far, focus.y + Math.sin(l.a - l.wd) * far);
      c.lineTo(focus.x + Math.cos(l.a + l.wd) * far, focus.y + Math.sin(l.a + l.wd) * far);
      c.closePath();
    }
    c.fill();
    c.globalAlpha = 1;
  }

  // ───────────────────────────── loop
  function frame(now) {
    if (!alive) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    time += dt;

    dayMix += (dayTarget - dayMix) * Math.min(1, dt * 2.2);
    if (Math.abs(dayTarget - dayMix) < 0.002) dayMix = dayTarget;
    chop = Math.max(0, chop - dt * 0.35);
    windBoost = Math.max(0, windBoost - dt * 0.55);
    swipeCooldown = Math.max(0, swipeCooldown - dt);

    // the boat sails after the cursor, staying fully on screen
    let lo = 470 * L.s + 12, hi = w - 410 * L.s - 12;
    if (lo > hi) lo = hi = w / 2;
    if (ptr.inside) boatTarget = ptr.x;
    // ease the target first, then a critically damped spring: soft start, soft stop, no overshoot
    boatEase += (clamp(boatTarget, lo, hi) - boatEase) * (1 - Math.exp(-dt * 2.6));
    spring(boatX, boatEase, dt, 9, 6);
    L.cx = boatX.v;
    const vel = boatX.d;
    spring(roll, clamp(vel * 0.00009, -0.06, 0.06), dt, 30, 11);

    // the boat rides the swell, and leans into its own motion
    bob.y = L.s * (6 * Math.sin(time * 1.25) + 2.5 * Math.sin(time * 2.1 + 1)) * (1 + chop * 2) * M;
    bob.r = (0.02 * Math.sin(time * 0.95 + 0.5) + 0.006 * Math.sin(time * 2.3)) * (1 + chop * 2.4) * M
      + roll.v;

    // foam wake off the stern while sailing
    if (!reduced && Math.abs(vel) > 25) {
      wakeAcc += Math.abs(vel) * dt;
      while (wakeAcc > 9) {
        wakeAcc -= 9;
        const p = toScreen(vel > 0 ? 262 : 1018, WATERLINE + rand(-6, 10));
        parts.push({
          kind: Math.random() < 0.7 ? 'bubble' : 'drop',
          x: p.x + rand(-6, 6), y: p.y,
          vx: -Math.sign(vel) * rand(20, 70), vy: rand(-40, -5),
          life: 0, max: rand(0.5, 1), r: rand(1.5, 4), rot: 0, spin: 0, g: 120,
        });
      }
    }

    // where he looks
    const idleLook = now / 1000 - ptr.movedAt > 4.5 || !ptr.inside;
    let u = 0;
    if (!idleLook) {
      const head = toScreen(PLATE_CX, 300);
      u = clamp((ptr.x - head.x) / Math.max(220, w * 0.3), -1, 1);
    }
    spring(look, u, dt, 60, 13);
    spring(lean, idleLook ? 0 : clamp((ptr.x - L.cx) / (w * 0.5), -1, 1), dt, 50, 12);
    spring(pop, 1, dt, 190, 15);
    spring(par.x, ptr.inside ? ptr.nx : 0, dt, 20, 9);
    spring(par.y, ptr.inside ? ptr.ny : 0, dt, 20, 9);
    root.style.setProperty('--px', par.x.v.toFixed(4));
    root.style.setProperty('--py', par.y.v.toFixed(4));

    // linger on him and he gets shy
    if (meta && ptr.inside && ptr.type === 'mouse' && overLuffy(ptr.x, ptr.y)) {
      hoverTime += dt;
      if (hoverTime > 1.1 && luffy.mode === 'idle') luffy.blush(true);
    } else {
      hoverTime = 0;
      if (luffy.mode === 'blush') luffy.blush(false);
    }

    // meat
    if (!meat.visible && meat.respawnAt && now > meat.respawnAt) {
      meat.visible = true;
      meat.scale.v = 0; meat.scale.d = 0;
      meat.respawnAt = 0;
    }
    spring(meat.scale, meat.visible ? 1 : 0, dt, 160, 11);

    // a sea breeze if nobody has played for a while
    if (meta && luffy.mode === 'idle' && now - lastInteract > 40000) {
      lastInteract = now;
      api.gust();
    }

    luffy.update(dt, look.v);
    drawSky(dt);
    drawSea(dt);
    raf = requestAnimationFrame(frame);
  }

  // ───────────────────────────── input
  function onMove(e) {
    const r = root.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const now = performance.now();
    ptr.type = e.pointerType || 'mouse';

    // a fast swipe across him calls up a gust
    const dtm = now - ptr.lt;
    if (meta && dtm > 0 && dtm < 90 && swipeCooldown <= 0) {
      const vx = (x - ptr.lx) / dtm, vy = (y - ptr.ly) / dtm;
      const cx = toScreen(PLATE_CX, 400).x;
      const top = toScreen(PLATE_CX, TOP).y, bottom = toScreen(PLATE_CX, 700).y;
      if (Math.abs(vx) > 1.7 && Math.abs(vx) > Math.abs(vy) * 1.4 &&
          (ptr.lx - cx) * (x - cx) <= 0 && y > top && y < bottom) {
        swipeCooldown = 1.5;
        api.gust();
      }
    }

    // trail: foam bubbles over water, sparkles in the sky
    if (!reduced) {
      trailAcc += Math.hypot(x - ptr.lx, y - ptr.ly);
      while (trailAcc > 16) {
        trailAcc -= 16;
        const water = y > L.horizon;
        parts.push({
          kind: water ? 'bubble' : 'spark',
          x: x + rand(-4, 4), y: y + rand(-4, 4),
          vx: rand(-20, 20), vy: water ? rand(-50, -20) : rand(-15, 15),
          life: 0, max: rand(0.5, 0.95), r: water ? rand(2, 5) : rand(1.4, 2.8),
          rot: rand(0, 6), spin: rand(-4, 4), g: 0,
          color: dayMix > 0.5 ? '#fff2b0' : '#ffe27a',
        });
      }
      if (parts.length > 500) parts.splice(0, parts.length - 500);
    }

    if (Math.abs(x - ptr.x) + Math.abs(y - ptr.y) > 0.5) ptr.movedAt = now / 1000;
    ptr.x = x; ptr.y = y;
    ptr.nx = (x / w - 0.5) * 2;
    ptr.ny = (y / h - 0.5) * 2;
    ptr.inside = true;
    ptr.lx = x; ptr.ly = y; ptr.lt = now;
    sea.style.cursor = meta && (overLuffy(x, y) || overMeat(x, y) || overHat(x, y)) ? 'pointer' : 'default';
  }
  function onLeave() { ptr.inside = false; }

  function onDown(e) {
    const r = root.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    ptr.type = e.pointerType || 'mouse';
    ptr.lx = x; ptr.ly = y; ptr.lt = performance.now();
    lastInteract = performance.now();
    if (!meta) return;
    if (overMeat(x, y)) { api.feed(); return; }
    if (overHat(x, y)) { api.gust(); return; }
    if (overLuffy(x, y)) { api.laugh(); return; }
    if (y > L.horizon) {
      splash(x, y);
      emit('splash', { x, y });
    } else {
      if (dayMix < 0.5) addShootingStar(x, y);
      burst(x, y, 10, 'spark');
      emit('star', { x, y });
    }
  }

  function onVisibility() {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf && alive) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  // ───────────────────────────── boot
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  window.addEventListener('pointermove', onMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
  sea.addEventListener('pointerdown', onDown);
  document.addEventListener('visibilitychange', onVisibility);
  raf = requestAnimationFrame(frame);

  (async () => {
    const m = await (await fetch(base + 'frames/luffy.json')).json();
    if (!alive) return;
    half = L.s * dpr < 0.75;
    const pick = s => base + 'frames/' + (half ? m.sheets[s].file_half : m.sheets[s].file);
    sheets.base = await loadImage(pick('base'));
    if (!alive) return;
    meta = m;
    emit('ready');
    // fetch the gust sheet once the page has settled
    setTimeout(() => loadGust(pick), 700);
    api._pick = pick;
  })().catch(err => console.error('[luffy] failed to load frames', err));

  function loadGust(pick) {
    if (!gustLoading) {
      gustLoading = loadImage(pick('gust')).then(img => {
        sheets.gust = img;
        if (pendingGust) { pendingGust = false; api.gust(); }
      });
    }
    return gustLoading;
  }

  const api = {
    setTheme(t) { dayTarget = t === 'day' ? 1 : 0; },
    laugh() {
      if (!meta) return;
      lastInteract = performance.now();
      if (luffy.mode === 'blush') luffy.state.mode = 'idle';
      if (luffy.laugh()) {
        pop.v = 0.92; pop.d = 1.8;
        const p = toScreen(PLATE_CX, 220);
        burst(p.x, p.y, 10, 'spark');
        emit('laugh', toScreen(PLATE_CX + rand(-260, 260), rand(150, 300)));
      }
    },
    gust() {
      if (!meta) return;
      lastInteract = performance.now();
      if (!sheets.gust) {
        pendingGust = true;
        if (api._pick) loadGust(api._pick);
        return;
      }
      if (luffy.mode === 'blush') luffy.state.mode = 'idle';
      if (luffy.mode === 'laugh') luffy.state.seq = null, luffy.state.mode = 'idle';
      luffy.gust();
    },
    feed() {
      if (!meta || !meat.visible || luffy.mode === 'gust') return;
      lastInteract = performance.now();
      meat.visible = false;
      meat.respawnAt = performance.now() + 7000;
      const p = toScreen(MEAT.x, MEAT.y);
      burst(p.x, p.y, 16, 'crumb');
      burst(p.x, p.y, 8, 'spark');
      emit('meat', toScreen(PLATE_CX + 180, 200));
      if (luffy.mode === 'blush') luffy.state.mode = 'idle';
      luffy.laugh();
      pop.v = 0.9; pop.d = 2;
    },
    /** sepia head-and-shoulders for the wanted poster */
    portrait(size = 280) {
      if (!meta || !sheets.base) return null;
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const c = cv.getContext('2d');
      const fr = meta.frames[12];
      const [sx, sy, sw, sh] = half ? fr.src_half : fr.src;
      const [dx, dy, dw, dh] = fr.dest;
      const box = { x: 371, y: 30, s: 540 };          // plate square around his head
      const k = size / box.s;
      c.fillStyle = '#d9c39a';
      c.fillRect(0, 0, size, size);
      c.filter = 'sepia(0.55) saturate(0.85) contrast(1.05)';
      c.drawImage(sheets.base, sx, sy, sw, sh, (dx - box.x) * k, (dy - box.y) * k, dw * k, dh * k);
      c.filter = 'none';
      return cv.toDataURL('image/png');
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      sea.removeEventListener('pointerdown', onDown);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
  return api;
}
