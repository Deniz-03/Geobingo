// Laender-Filter: laedt die Landesgrenzen, sagt welches Land an einer
// Koordinate liegt und wuerfelt Punkte innerhalb erlaubter Laender aus.
//
// Die Grenzdaten liegen in /data/countries.json (Natural Earth, vereinfacht -
// siehe tools/build-countries.mjs). Sie sind auf ein paar hundert Meter genau;
// direkt auf der Grenze kann die Zuordnung also danebenliegen.

const DATA_URL = '/data/countries.json';

// Wie weit darf ein Ort vom Land entfernt liegen und trotzdem dazugehoeren?
// Haefen und Kuestenstrassen liegen in den vereinfachten Umrissen sonst im Meer.
const COAST_SLACK_DEG = 0.045; // ~5 km

let loadPromise = null;
let index = null;

/** Der Filter, so wie er in der Raum-Config steht. */
export const EMPTY_FILTER = { mode: 'off', codes: [] };

export function normalizeFilter(filter) {
  const mode = ['block', 'allow'].includes(filter?.mode) ? filter.mode : 'off';
  const codes = Array.isArray(filter?.codes) ? filter.codes.slice() : [];
  return { mode, codes };
}

/** Ist der Filter ueberhaupt aktiv? Ohne ausgewaehlte Laender ist er es nicht. */
export function filterActive(filter) {
  const f = normalizeFilter(filter);
  return f.mode !== 'off' && f.codes.length > 0;
}

// ---------------------------------------------------------------- Laden

export function loadCountries() {
  if (loadPromise) return loadPromise;
  loadPromise = fetch(DATA_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((geojson) => {
      index = buildIndex(geojson);
      return index;
    })
    .catch((err) => {
      loadPromise = null; // beim naechsten Versuch neu probieren
      throw new Error('Die Länderkarte konnte nicht geladen werden. ' + err.message);
    });
  return loadPromise;
}

/** True, sobald die Grenzdaten im Speicher liegen. */
export function countriesReady() {
  return !!index;
}

function bboxOf(ring) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return Math.abs(sum) / 2;
}

/**
 * Jedes Teilstueck (Festland, Insel, Exklave) bekommt eine eigene Bounding-Box.
 * Eine gemeinsame Box pro Land waere fuer Laender wie Neuseeland oder die USA
 * riesig und fast nur Meer - Zufallspunkte wuerden dann kaum treffen.
 */
function buildIndex(geojson) {
  const list = geojson.features.map((f) => {
    const parts = f.geometry.coordinates.map((rings) => {
      const bbox = bboxOf(rings[0]);
      // Laengengrade werden Richtung Pol schmaler - sonst waere Groenland riesig.
      const latScale = Math.cos(((bbox[1] + bbox[3]) / 2) * Math.PI / 180);
      return { rings, bbox, weight: Math.max(1e-7, ringArea(rings[0]) * latScale) };
    });
    return {
      code: f.properties.code,
      name: f.properties.name,
      parts,
      weight: parts.reduce((n, p) => n + p.weight, 0),
    };
  });
  return { list, byCode: new Map(list.map((c) => [c.code, c])), geojson };
}

// ---------------------------------------------------------------- Nachschlagen

export function allCountries() {
  return index ? index.list : [];
}

export function countryName(code) {
  return index?.byCode.get(code)?.name || code;
}

/** Namen fuer eine Code-Liste, alphabetisch. Unbekannte Codes bleiben stehen. */
export function namesFor(codes) {
  return codes.map(countryName).sort((a, b) => a.localeCompare(b, 'de'));
}

export function countryGeoJson() {
  return index ? index.geojson : null;
}

function inBbox(lng, lat, bbox, slack = 0) {
  return lng >= bbox[0] - slack && lng <= bbox[2] + slack
      && lat >= bbox[1] - slack && lat <= bbox[3] + slack;
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Even-odd ueber alle Ringe eines Teilstuecks: Loecher zaehlen so automatisch raus. */
function pointInPart(lng, lat, part) {
  if (!inBbox(lng, lat, part.bbox)) return false;
  let inside = false;
  for (const ring of part.rings) {
    if (pointInRing(lng, lat, ring)) inside = !inside;
  }
  return inside;
}

function pointInCountry(lng, lat, country) {
  return country.parts.some((part) => pointInPart(lng, lat, part));
}

/** Quadrierter Abstand (in Grad) vom Punkt zur Strecke a-b. */
function segDistSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  let t = 0;
  if (dx || dy) t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const ex = px - (ax + t * dx);
  const ey = py - (ay + t * dy);
  return ex * ex + ey * ey;
}

/** Kuerzester Abstand des Punktes zum Umriss - nur der aeussere Ring zaehlt. */
function distanceToPart(lng, lat, part) {
  const ring = part.rings[0];
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const d = segDistSq(lng, lat, ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1]);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * Landescode an dieser Position - oder null (offenes Meer, unbekannt).
 * Liegt der Punkt knapp daneben (Hafen, Kuestenstrasse, Bruecke), wird das
 * naechstgelegene Land genommen: die Umrisse sind vereinfacht, echte
 * Street-View-Orte liegen aber fast immer an Land.
 */
export function countryAt(lat, lng) {
  if (!index || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  for (const c of index.list) {
    if (pointInCountry(lng, lat, c)) return c.code;
  }

  let bestCode = null;
  let bestDist = COAST_SLACK_DEG;
  for (const c of index.list) {
    for (const part of c.parts) {
      if (!inBbox(lng, lat, part.bbox, bestDist)) continue;
      const d = distanceToPart(lng, lat, part);
      if (d < bestDist) {
        bestDist = d;
        bestCode = c.code;
      }
    }
  }
  return bestCode;
}

/**
 * Darf hier gespielt werden?
 * Ohne aktiven Filter - oder solange die Grenzdaten fehlen - immer ja.
 * Der Filter ist optional und soll niemandem im Weg stehen.
 */
export function isAllowed(lat, lng, filter) {
  if (!filterActive(filter) || !index) return true;
  const f = normalizeFilter(filter);
  const code = countryAt(lat, lng);
  if (f.mode === 'block') return !code || !f.codes.includes(code);
  return !!code && f.codes.includes(code);
}

/** Warum ist der Ort nicht erlaubt? Fuer die Meldung an den Spieler. */
export function rejectionReason(lat, lng, filter) {
  const f = normalizeFilter(filter);
  const code = index ? countryAt(lat, lng) : null;
  const where = code ? countryName(code) : null;
  if (f.mode === 'block') {
    return where ? `${where} ist für diese Runde gesperrt.` : 'Dieser Ort ist für diese Runde gesperrt.';
  }
  return where
    ? `${where} gehört nicht zu den erlaubten Ländern.`
    : 'Dieser Ort liegt außerhalb der erlaubten Länder.';
}

// ---------------------------------------------------------------- Zufallspunkte

/**
 * Zufallspunkt irgendwo in einem der Laender. Erst ein Teilstueck nach Flaeche
 * ziehen, dann in dessen Bounding-Box wuerfeln, bis der Punkt wirklich drin liegt.
 */
export function randomPointInCountries(codes) {
  if (!index) return null;
  const parts = [];
  for (const code of codes) {
    const country = index.byCode.get(code);
    if (country) parts.push(...country.parts);
  }
  if (!parts.length) return null;

  const total = parts.reduce((n, p) => n + p.weight, 0);
  let roll = Math.random() * total;
  let part = parts[parts.length - 1];
  for (const p of parts) {
    roll -= p.weight;
    if (roll <= 0) { part = p; break; }
  }

  const [minLng, minLat, maxLng, maxLat] = part.bbox;
  for (let i = 0; i < 200; i++) {
    const lng = minLng + Math.random() * (maxLng - minLng);
    const lat = minLat + Math.random() * (maxLat - minLat);
    if (pointInPart(lng, lat, part)) return { lat, lng };
  }
  // Sehr schmale Teilstuecke (Atolle, Fjorde): irgendein Punkt vom Umriss.
  const ring = part.rings[0];
  const [lng, lat] = ring[Math.floor(Math.random() * ring.length)];
  return { lat, lng };
}
