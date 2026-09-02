// Baut public/data/countries.json aus dem Natural-Earth-Datensatz (Public Domain).
//
//   node tools/build-countries.mjs [pfad/zu/ne_50m_admin_0_countries.geojson]
//
// Quelle: https://github.com/nvkelso/natural-earth-vector
//         geojson/ne_50m_admin_0_countries.geojson
//
// Das Ergebnis enthaelt pro Land genau ein Feature mit { code, name } und
// auf 3 Nachkommastellen gerundeten Koordinaten (~110 m) - genau genug, um
// Street-View-Orte einem Land zuzuordnen, und klein genug fuers Browser-Laden.

import { readFileSync, writeFileSync } from 'node:fs';

const SRC = process.argv[2];
const OUT = new URL('../public/data/countries.json', import.meta.url);
const PRECISION = 1000;      // 3 Nachkommastellen (~110 m)
const TOLERANCE = 0.004;     // Douglas-Peucker, ~450 m - Kuestenstaedte liegen sonst im Meer
const MIN_ISLAND = 0.06;     // Inseln unter dieser Bbox-Kante fliegen raus (ausser der groessten)
const SKIP = new Set(['AQ', 'XATA']); // Antarktis: kein Street View, aber viele Punkte

if (!SRC) {
  console.error('Bitte den Pfad zur ne_50m_admin_0_countries.geojson angeben.');
  process.exit(1);
}

const src = JSON.parse(readFileSync(SRC, 'utf8'));

function codeOf(p) {
  for (const key of ['ISO_A2', 'ISO_A2_EH']) {
    if (p[key] && p[key] !== '-99') return p[key];
  }
  return `X${p.ADM0_A3}`; // Kosovo, Somaliland & Co. haben keinen ISO-Code
}

/** Senkrechter Abstand von p zur Strecke a-b (in Grad, reicht fuer den Vergleich). */
function perpDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const cx = a[0] + Math.max(0, Math.min(1, t)) * dx;
  const cy = a[1] + Math.max(0, Math.min(1, t)) * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

/** Douglas-Peucker, iterativ (rekursiv knallt es bei Russland). */
function simplify(points, tolerance) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let maxDist = -1;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDistance(points[i], points[lo], points[hi]);
      if (d > maxDist) { maxDist = d; idx = i; }
    }
    if (idx > 0 && maxDist > tolerance) {
      keep[idx] = 1;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function ringExtent(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.max(maxX - minX, maxY - minY);
}

/** Rundet einen Ring und wirft doppelte Punkte weg. */
function thinRing(ring) {
  const out = [];
  for (const [lng, lat] of ring) {
    const p = [Math.round(lng * PRECISION) / PRECISION, Math.round(lat * PRECISION) / PRECISION];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  if (out.length < 4) return null;
  const first = out[0];
  const last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  return out;
}

function thinPolygon(poly) {
  const rings = [];
  for (const raw of poly) {
    // Der aeussere Ring (Index 0) entscheidet ueber das Polygon. Bei winzigen
    // Inseln frisst die Vereinfachung sonst das ganze Land - deshalb notfalls
    // mit feinerer Toleranz nochmal ran.
    let ring = null;
    for (const tol of [TOLERANCE, TOLERANCE / 5, 0]) {
      ring = thinRing(tol ? simplify(raw, tol) : raw);
      if (ring || rings.length) break;
    }
    if (!ring) {
      if (!rings.length) return null;
      continue;
    }
    rings.push(ring);
  }
  return rings.length ? rings : null;
}

const byCode = new Map();

for (const f of src.features) {
  const p = f.properties;
  const code = codeOf(p);
  if (SKIP.has(code)) continue;
  const name = p.NAME_DE || p.NAME_EN || p.NAME;
  const geom = f.geometry;
  if (!geom) continue;

  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const thinned = polys.map(thinPolygon).filter(Boolean);
  if (!thinned.length) continue;

  const entry = byCode.get(code);
  if (entry) entry.polys.push(...thinned);
  else byCode.set(code, { code, name, polys: thinned });
}

// Winzige Inseln raus - aber nie das groesste Teilstueck eines Landes,
// sonst verschwinden Malta, Monaco & Co. komplett von der Karte.
for (const entry of byCode.values()) {
  if (entry.polys.length < 2) continue;
  const sized = entry.polys.map((p) => ({ p, size: ringExtent(p[0]) })).sort((a, b) => b.size - a.size);
  entry.polys = sized.filter((s, i) => i === 0 || s.size >= MIN_ISLAND).map((s) => s.p);
}

const features = [...byCode.values()]
  .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  .map((c) => ({
    type: 'Feature',
    id: c.code,
    properties: { code: c.code, name: c.name },
    geometry: { type: 'MultiPolygon', coordinates: c.polys },
  }));

const out = { type: 'FeatureCollection', features };
writeFileSync(OUT, JSON.stringify(out));
console.log(`${features.length} Laender -> ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
