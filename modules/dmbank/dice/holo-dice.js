/**
 * DM Bank: hologram dice (d10 / d6) drawn with a tiny software 3D renderer on a 2D canvas.
 * Adapted from the dice renderer of DM Bank's Grim modules (same author), restyled as a
 * cyberpunk hologram: see-through faces, glowing edges, scan lines and flicker.
 * Screen space: x right, y down, z toward the viewer.
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/* ---------- quaternions [w,x,y,z] ---------- */
const qMul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const qNorm = (q) => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return q.map((v) => v / l);
};
const qAxis = (axis, ang) => {
  const a = norm(axis);
  const s = Math.sin(ang / 2);
  return [Math.cos(ang / 2), a[0] * s, a[1] * s, a[2] * s];
};
function qToMat(q) {
  const [w, x, y, z] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}
function qFromMat(m) {
  const t = m[0][0] + m[1][1] + m[2][2];
  let q;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    q = [s / 4, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s];
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    q = [(m[2][1] - m[1][2]) / s, s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s];
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    q = [(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s];
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    q = [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4];
  }
  return qNorm(q);
}
function qSlerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) {
    b = b.map((v) => -v);
    d = -d;
  }
  if (d > 0.9995) return qNorm(a.map((v, i) => v + (b[i] - v) * t));
  const th = Math.acos(d);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return a.map((v, i) => v * wa + b[i] * wb);
}
const mulMV = (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

/* ---------- geometry (faces may have any number of corners) ---------- */
function finish(verts, faces, textSize, upIndex = 0) {
  const radius = Math.max(...verts.map((v) => Math.hypot(...v)));
  const out = faces.map((idx) => {
    const pts = idx.map((i) => verts[i]);
    const cen = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0]);
    let n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
    if (dot(n, cen) < 0) {
      idx = [...idx].reverse();
      n = [-n[0], -n[1], -n[2]];
    }
    n = norm(n);
    const upRaw = sub(verts[idx.includes(upIndex) ? upIndex : idx[0]] ?? verts[idx[0]], cen);
    // keep "up" inside the face plane
    const up = norm(sub(upRaw, n.map((c) => c * dot(upRaw, n))));
    const right = cross(n, up);
    const land = qFromMat([right, [-up[0], -up[1], -up[2]], n]);
    return { idx, n, cen, up, right, land, value: 0 };
  });
  return { verts, faces: out, radius, textSize };
}

/** Pentagonal trapezohedron (a real d10): 10 kite faces, numbered 1-10. */
function d10() {
  const a = 0.105;
  const H = (a * (1 + Math.cos(Math.PI / 5))) / (1 - Math.cos(Math.PI / 5));
  const v = [[0, 0, H], [0, 0, -H]];
  for (let k = 0; k < 5; k++) {
    const t = (k * 2 * Math.PI) / 5;
    v.push([Math.cos(t), Math.sin(t), a]); // upper ring U_k = 2 + 2k
    const t2 = t + Math.PI / 5;
    v.push([Math.cos(t2), Math.sin(t2), -a]); // lower ring L_k = 3 + 2k
  }
  const U = (k) => 2 + 2 * (((k % 5) + 5) % 5);
  const L = (k) => 3 + 2 * (((k % 5) + 5) % 5);
  const faces = [];
  for (let k = 0; k < 5; k++) faces.push([0, U(k), L(k), U(k + 1)]);
  for (let k = 0; k < 5; k++) faces.push([1, L(k), U(k + 1), L(k + 1)]);
  // up vector of each face points at its own apex
  const poly = { faces: [] };
  const top = finish(v, faces.slice(0, 5), 0.42, 0);
  const bot = finish(v, faces.slice(5), 0.42, 1);
  poly.verts = v;
  poly.radius = top.radius;
  poly.textSize = 0.42;
  poly.faces = [...top.faces, ...bot.faces];
  const upper = [1, 7, 5, 3, 9];
  const lower = [10, 4, 6, 8, 2];
  poly.faces.forEach((f, i) => (f.value = i < 5 ? upper[i] : lower[i - 5]));
  return poly;
}

function d6() {
  const v = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]);
  const id = (x, y, z) => v.findIndex((p) => p[0] === x && p[1] === y && p[2] === z);
  const faces = [
    [id(1, -1, -1), id(1, 1, -1), id(1, 1, 1), id(1, -1, 1)],
    [id(-1, -1, -1), id(-1, -1, 1), id(-1, 1, 1), id(-1, 1, -1)],
    [id(-1, 1, -1), id(-1, 1, 1), id(1, 1, 1), id(1, 1, -1)],
    [id(-1, -1, -1), id(1, -1, -1), id(1, -1, 1), id(-1, -1, 1)],
    [id(-1, -1, 1), id(1, -1, 1), id(1, 1, 1), id(-1, 1, 1)],
    [id(-1, -1, -1), id(-1, 1, -1), id(1, 1, -1), id(1, -1, -1)],
  ];
  const poly = finish(v, faces, 0.75);
  [1, 6, 2, 5, 3, 4].forEach((val, i) => (poly.faces[i].value = val));
  return poly;
}

const POLY = {};
const BUILD = { d10, d6 };
const getPoly = (kind) => (POLY[kind] ??= (BUILD[kind] ?? d10)());

export const TONES = {
  cyan: [62, 242, 255],
  red: [255, 42, 61],
  yellow: [243, 230, 0],
  green: [61, 255, 168],
};
const rgba = (c, a = 1) => `rgba(${c.map((v) => Math.max(0, Math.min(255, Math.round(v)))).join(",")},${a})`;

/* ---------- shared frame loop ---------- */
const actors = new Set();
let raf = 0;
let last = 0;
function frame(now) {
  const dt = Math.min(0.2, (now - last) / 1000 || 0.016);
  last = now;
  for (const a of actors) {
    try {
      a.tick(dt, now / 1000);
    } catch (err) {
      console.error("DM Bank dice |", err);
      actors.delete(a);
    }
  }
  raf = actors.size ? requestAnimationFrame(frame) : 0;
}
const Loop = {
  add(a) {
    actors.add(a);
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  },
  remove(a) {
    actors.delete(a);
  },
};

/**
 * A hologram die. `el` is a <canvas>; size it with CSS.
 *  idle  — slow drift (waiting for a click)
 *  spin  — fast spin in place (rolling, result not known yet)
 *  roll(value) — settle on that face, resolves when at rest
 */
export class HoloDie {
  constructor(kind = "d10", tone = "cyan") {
    this.kind = kind;
    this.poly = getPoly(kind);
    this.tone = TONES[tone] ?? TONES.cyan;
    this.el = document.createElement("canvas");
    this.el.className = `dmb-holo-die dmb-holo-${kind}`;
    this.ctx = this.el.getContext("2d");
    this.q = qNorm([Math.random(), Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
    this.axis = norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
    this.state = "idle";
    this.t = 0;
    this.target = null;
    this.seed = Math.random() * 10;
    this.px = 0;
    Loop.add(this);
  }

  setTone(tone) {
    this.tone = TONES[tone] ?? this.tone;
    this.dirty = true;
    Loop.add(this);
  }

  resize() {
    const css = this.el.clientWidth || 96;
    const px = Math.round(css * Math.min(2, window.devicePixelRatio || 1));
    if (px !== this.px) {
      this.px = px;
      this.el.width = px;
      this.el.height = px;
      this.dirty = true;
    }
  }

  roll(value, { quick = false } = {}) {
    this.target = this.poly.faces.find((f) => f.value === value) ?? this.poly.faces[0];
    this.axis = norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() * 0.4 - 0.2]);
    const fromSpin = this.state === "spin";
    this.state = "tumble";
    this.t = fromSpin || quick ? 0.5 : 0;
    Loop.add(this);
    return new Promise((res) => (this._done = res));
  }

  spin() {
    this.axis = norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() * 0.4 - 0.2]);
    this.state = "spin";
    this.t = 0;
    Loop.add(this);
  }

  idle() {
    this.state = "idle";
    Loop.add(this);
  }

  tick(dt, now) {
    if (!this.el.isConnected && this.state !== "idle") {
      // still finish pending promises when detached
      if (this._done) {
        this._done();
        this._done = null;
      }
    }
    this.resize();
    this.now = now;
    if (this.state === "spin") {
      this.t += dt;
      const wob = [this.axis[0] + Math.sin(this.t * 5) * 0.4, this.axis[1], this.axis[2] + Math.cos(this.t * 4) * 0.4];
      this.q = qNorm(qMul(qAxis(wob, dt * 15), this.q));
    } else if (this.state === "idle") {
      const wob = [Math.sin(now * 0.4 + this.seed) * 0.5, 1, Math.cos(now * 0.31 + this.seed) * 0.5];
      this.q = qNorm(qMul(qAxis(wob, dt * 0.9), this.q));
    } else if (this.state === "tumble") {
      this.t += dt;
      const k = Math.min(1, this.t / 1.1);
      const speed = 18 - 10 * k;
      const wob = [this.axis[0] + Math.sin(this.t * 5) * 0.4, this.axis[1], this.axis[2] + Math.cos(this.t * 4) * 0.4];
      this.q = qNorm(qMul(qAxis(wob, dt * speed), this.q));
      if (k >= 1) {
        this.state = "land";
        this.t = 0;
        this.from = this.q;
      }
    } else if (this.state === "land") {
      this.t += dt;
      const k = Math.min(1, this.t / 0.6);
      const e = 1 - Math.pow(1 - k, 3);
      this.q = qSlerp(this.from, this.target.land, e);
      if (k >= 1) {
        this.q = this.target.land;
        this.state = "rest";
        this.restAt = now;
        this._done?.();
        this._done = null;
      }
    }
    // A resting hologram still flickers a little, so it keeps drawing.
    this.draw();
    if (!this.el.isConnected) Loop.remove(this);
  }

  draw() {
    const { ctx, poly, px, tone } = this;
    if (!px) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    const m = qToMat(this.q);
    const scale = (px * 0.4) / poly.radius;
    const persp = (z) => 1 / (1 - (z / poly.radius) * 0.18);
    const pts = poly.verts.map((v) => {
      const r = mulMV(m, v);
      const p = persp(r[2]) * scale;
      return [px / 2 + r[0] * p, px / 2 + r[1] * p, r[2]];
    });
    const L = norm([-0.4, -0.6, 0.8]);
    const faces = poly.faces.map((f) => ({ f, n: mulMV(m, f.n), c: mulMV(m, f.cen) })).sort((a, b) => a.c[2] - b.c[2]);
    const landed = this.state === "rest" || (this.state === "land" && this.t > 0.35);
    const flick = 0.88 + 0.12 * Math.sin((this.now ?? 0) * 31 + this.seed) * Math.sin((this.now ?? 0) * 7.3);
    const path = (f) => {
      ctx.beginPath();
      f.idx.forEach((i, k) => (k ? ctx.lineTo(pts[i][0], pts[i][1]) : ctx.moveTo(pts[i][0], pts[i][1])));
      ctx.closePath();
    };
    ctx.lineJoin = "round";
    // back faces: faint wireframe, the hologram is see-through
    for (const { f, n } of faces) {
      if (n[2] > -0.02) continue;
      path(f);
      ctx.lineWidth = px * 0.006;
      ctx.strokeStyle = rgba(tone, 0.22 * flick);
      ctx.stroke();
    }
    for (const { f, n, c } of faces) {
      if (n[2] <= -0.02) continue;
      const top = landed && f === this.target;
      const diff = Math.max(0, dot(n, L));
      path(f);
      ctx.fillStyle = rgba(tone, (0.05 + 0.16 * diff + (top ? 0.22 : 0)) * flick);
      ctx.fill();
      ctx.save();
      ctx.shadowColor = rgba(tone, 0.9);
      ctx.shadowBlur = px * (top ? 0.06 : 0.035);
      ctx.lineWidth = px * (top ? 0.02 : 0.012);
      ctx.strokeStyle = rgba(tone.map((v) => v + 60 * diff), 0.95 * flick);
      ctx.stroke();
      ctx.restore();
      const facing = Math.max(0, n[2]);
      if (facing < 0.12) continue;
      const r = mulMV(m, f.right);
      const u = mulMV(m, f.up);
      const p = persp(c[2]) * scale;
      const k = p * 0.01;
      ctx.save();
      ctx.setTransform(r[0] * k, r[1] * k, -u[0] * k, -u[1] * k, px / 2 + c[0] * p, px / 2 + c[1] * p);
      ctx.globalAlpha = Math.min(1, Math.pow(facing, 0.7) * (landed && !top ? 0.45 : 1)) * flick;
      ctx.fillStyle = top ? "#ffffff" : rgba(tone.map((v) => v + 80), 1);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const size = 100 * poly.textSize;
      ctx.font = `700 ${size}px "Tektur", "Jost", sans-serif`;
      ctx.shadowColor = rgba(tone, 1);
      ctx.shadowBlur = top ? px * 0.05 : px * 0.02;
      ctx.fillText(String(f.value), 0, size * 0.08);
      if (f.value === 6 || f.value === 9) ctx.fillRect(-size * 0.2, size * 0.5, size * 0.4, size * 0.06);
      ctx.restore();
    }
    // scan lines cut through the projection
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    const step = Math.max(3, Math.round(px / 60));
    const off = Math.floor(((this.now ?? 0) * 40) % step);
    for (let y = off; y < px; y += step) ctx.fillRect(0, y, px, 1);
    ctx.restore();
  }

  destroy() {
    Loop.remove(this);
    this.el.remove();
  }
}
