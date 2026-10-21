/* Suivi d'activité : distance GPS, tracé et pas. Fonctions pures, sans dépendance au navigateur. */

// maxSpeed : vitesse plausible maximale (m/s) ; stride : longueur de pas moyenne (m), utilisée seulement
// pour estimer les pas quand le capteur de mouvement n'est pas disponible
export const ACTIVITY_TYPES = [
  { id: 'walk', label: 'Marche', maxSpeed: 3, stride: 0.75, photo: 'media/photos/27899088.jpg', pos: 'center 62%' },
  { id: 'hike', label: 'Randonnée', maxSpeed: 3, stride: 0.7, photo: 'media/photos/3098647.jpg', pos: 'center 40%' },
  { id: 'jog', label: 'Footing', maxSpeed: 6, stride: 1.0, photo: 'media/photos/10157895.jpg', pos: 'center 60%' },
  { id: 'run', label: 'Course', maxSpeed: 12, stride: 1.2, photo: 'media/photos/37718409.jpg', pos: 'center 30%' },
];
export const typeOf = (id) => ACTIVITY_TYPES.find((t) => t.id === id);

const R = 6371008.8; // rayon moyen de la Terre (m)
const rad = (d) => (d * Math.PI) / 180;

/** Distance (m) entre deux points [lat, lon] — formule de haversine. */
export function haversine(a, b) {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const MAX_ACCURACY = 35; // au-delà, la position est ignorée (m)

/**
 * Décide si une nouvelle position GPS compte.
 * `last` = dernière position retenue { lat, lon, t, acc } (ou null) ; `fix` = { lat, lon, t, acc } (t en ms).
 * Retourne { ok, d } : `d` = distance ajoutée en mètres. Une position rejetée ne remplace pas `last`,
 * ce qui permet d'accumuler un déplacement lent au lieu de le perdre dans le bruit.
 */
export function evaluateFix(last, fix, type) {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon) || Math.abs(fix.lat) > 90 || Math.abs(fix.lon) > 180) return { ok: false, d: 0 };
  if (fix.acc > MAX_ACCURACY) return { ok: false, d: 0 };
  if (!last) return { ok: true, d: 0 };
  const dt = (fix.t - last.t) / 1000;
  if (dt <= 0) return { ok: false, d: 0 };
  const d = haversine([last.lat, last.lon], [fix.lat, fix.lon]);
  if (d < Math.max(3, Math.max(fix.acc, last.acc) * 1.0)) return { ok: false, d: 0 };   // simple bruit autour d'un point fixe
  const max = (typeOf(type)?.maxSpeed ?? 12) * 1.5;
  if (d / dt > max) return { ok: false, d: 0 };                                       // saut de position impossible
  return { ok: true, d };
}

/** Réduit un tracé à `max` points au plus (Douglas-Peucker, tolérance croissante). Points [lat, lon, ...]. */
export function simplify(points, max = 800) {
  if (points.length <= max) return points;
  const lat0 = points[0][0];
  const kx = Math.cos(rad(lat0)) * 111320, ky = 110540;
  const xy = points.map((p) => [p[1] * kx, p[0] * ky]);
  const dist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  let tol = 0.5, out = points;
  while (out.length > max && tol < 5000) {
    const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let worst = 0, idx = -1;
      for (let i = s + 1; i < e; i++) { const dd = dist(xy[i], xy[s], xy[e]); if (dd > worst) { worst = dd; idx = i; } }
      if (idx > -1 && worst > tol) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    out = points.filter((_, i) => keep[i]);
    tol *= 2;
  }
  return out;
}

const TILE = 256, MAX_ZOOM = 17, MIN_ZOOM = 2;
// projection Web Mercator : coordonnées « monde » en pixels au zoom z (même repère que les tuiles OpenStreetMap)
const worldXY = (lat, lon, z) => {
  const n = TILE * 2 ** z, la = Math.max(-85.0511, Math.min(85.0511, lat)) * (Math.PI / 180);
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n];
};

/**
 * Cadre un tracé dans une vue w×h (marge `pad`) sur une carte OpenStreetMap.
 * Retourne le zoom retenu, les points du tracé en coordonnées de la vue, et les tuiles à afficher
 * ({ z, x, y, left, top }, left/top en coordonnées de la vue, taille 256).
 */
export function fitMap(points, w, h, pad = 22) {
  if (!points.length) return { z: 0, xy: [], tiles: [] };
  let z = MAX_ZOOM;
  const box = (zz) => {
    const p = points.map((q) => worldXY(q[0], q[1], zz));
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    return { p, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  let b = box(z);
  while (z > MIN_ZOOM && (b.maxX - b.minX > w - 2 * pad || b.maxY - b.minY > h - 2 * pad)) b = box(--z);
  const x0 = (b.minX + b.maxX) / 2 - w / 2, y0 = (b.minY + b.maxY) / 2 - h / 2;   // coin haut-gauche de la vue dans le monde
  const n = 2 ** z, tiles = [];
  for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + h) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + w) / TILE); tx++) {
      tiles.push({ z, x: ((tx % n) + n) % n, y: ty, left: tx * TILE - x0, top: ty * TILE - y0 });
    }
  }
  return { z, xy: b.p.map(([x, y]) => [x - x0, y - y0]), tiles };
}

/**
 * Compteur de pas à partir de l'accéléromètre (DeviceMotion). On retire la composante lente (gravité),
 * on lisse, puis on compte un pas à chaque franchissement montant du seuil, avec un intervalle minimal.
 */
export class StepCounter {
  constructor() { this.count = 0; this.mean = null; this.smooth = 0; this.above = false; this.lastStep = 0; this.events = 0; }
  push(ax, ay, az, t) {
    const m = Math.hypot(ax, ay, az);
    if (!Number.isFinite(m)) return this.count;
    this.events++;
    this.mean = this.mean == null ? m : this.mean + (m - this.mean) * 0.02;
    this.smooth += (m - this.mean - this.smooth) * 0.35;
    if (!this.above && this.smooth > 1.1 && t - this.lastStep > 280) { this.above = true; this.count++; this.lastStep = t; }
    else if (this.above && this.smooth < 0.3) this.above = false;
    return this.count;
  }
}

/* ---------- formats ---------- */
export const fmtDistance = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2).replace('.', ',')} km`);
export const fmtKm = (m) => (m / 1000).toFixed(2).replace('.', ',');
export function fmtDuration(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}
/** Allure en min/km (« 5'42" »), ou « — » si la distance est trop courte pour être significative. */
export function fmtPace(distance, seconds) {
  if (distance < 50 || seconds < 10) return '—';
  const spk = seconds / (distance / 1000);
  if (!Number.isFinite(spk) || spk > 3600) return '—';
  const r = Math.round(spk);
  return `${Math.floor(r / 60)}'${String(r % 60).padStart(2, '0')}"`;
}
export const fmtSpeed = (distance, seconds) => (seconds > 0 && distance > 0 ? ((distance / seconds) * 3.6).toFixed(1).replace('.', ',') : '0,0');
