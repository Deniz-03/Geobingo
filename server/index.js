import http from 'node:http';
import fs from 'node:fs';
import zlib from 'node:zlib';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { handleMessage, handleClose, registerSocket, unregisterSocket, roomStats } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const CONFIG_FILE = path.join(ROOT, 'config.json');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

// ---------------------------------------------------------------- Config

async function readConfig() {
  const fromEnv = process.env.GOOGLE_MAPS_API_KEY;
  if (fromEnv) return { apiKey: fromEnv.trim(), source: 'env' };
  try {
    const raw = await fsp.readFile(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.apiKey) return { apiKey: String(parsed.apiKey).trim(), source: 'file' };
  } catch {
    /* noch nicht konfiguriert */
  }
  return { apiKey: '', source: 'none' };
}

async function writeConfig(apiKey) {
  await fsp.writeFile(CONFIG_FILE, JSON.stringify({ apiKey }, null, 2) + '\n', 'utf8');
}

// Proxy-Header, die ein Tunnel (Cloudflare, ngrok, ...) setzt. Ohne diese Pruefung
// wuerde jede Anfrage durch den Tunnel wie eine lokale aussehen, weil cloudflared
// selbst vom Host-PC aus auf localhost zugreift.
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'cf-ray'];

function isLocalRequest(req) {
  if (PROXY_HEADERS.some((h) => req.headers[h])) return false;
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

// ---------------------------------------------------------------- Street-View-Standbilder
//
// Die Standbilder werden ueber den Server geholt statt direkt im <img>-Tag.
// Gruende:
//  - Ein auf HTTP-Referrer beschraenkter Key lehnt Bilder ab, sobald jemand
//    ueber eine Tunnel-Adresse spielt. Dann sah genau ein Spieler ein schwarzes
//    bzw. leeres Feld und die anderen nicht.
//  - Der Key steht nicht mehr in jeder Bild-URL.
//  - Jedes Bild wird nur einmal bei Google geholt und dann aus dem Speicher
//    bedient - alle Clients bekommen damit garantiert dasselbe Bild.

const STREETVIEW_ENDPOINT = 'https://maps.googleapis.com/maps/api/streetview';
const IMAGE_CACHE_MAX = 300;
const IMAGE_CACHE_TTL_MS = 60 * 60 * 1000;
const imageCache = new Map(); // key -> { at, type, buffer }

function cacheImage(key, entry) {
  imageCache.set(key, entry);
  // Aeltester Eintrag zuerst raus - Map behaelt die Einfuegereihenfolge.
  while (imageCache.size > IMAGE_CACHE_MAX) {
    imageCache.delete(imageCache.keys().next().value);
  }
}

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Baut aus den Query-Parametern eine saubere Anfrage an die Street View Static API. */
function streetviewParams(url, apiKey) {
  const pano = (url.searchParams.get('pano') || '').slice(0, 200);
  // Achtung: Number(null) waere 0 - eine fehlende Koordinate wuerde sonst als
  // gueltiger Nullpunkt im Atlantik durchgehen.
  const asCoord = (name, limit) => {
    const raw = url.searchParams.get(name);
    if (raw === null || raw.trim() === '') return NaN;
    const n = Number(raw);
    return Number.isFinite(n) && Math.abs(n) <= limit ? n : NaN;
  };
  const lat = asCoord('lat', 90);
  const lng = asCoord('lng', 180);
  if (!pano && (!Number.isFinite(lat) || !Number.isFinite(lng))) return null;

  const params = new URLSearchParams({
    size: `${Math.round(clampNum(url.searchParams.get('w'), 80, 640, 400))}x`
      + `${Math.round(clampNum(url.searchParams.get('h'), 80, 640, 250))}`,
    heading: String(Math.round(clampNum(url.searchParams.get('heading'), -360, 720, 0))),
    pitch: String(Math.round(clampNum(url.searchParams.get('pitch'), -90, 90, 0))),
    fov: String(Math.round(clampNum(url.searchParams.get('fov'), 10, 120, 90))),
    return_error_code: 'true',
    key: apiKey,
  });
  if (pano) params.set('pano', pano);
  else params.set('location', `${lat},${lng}`);
  return params;
}

async function serveStreetview(req, res, url) {
  const cfg = await readConfig();
  if (!cfg.apiKey) return sendJson(res, 503, { error: 'Kein API-Key hinterlegt.' });

  const params = streetviewParams(url, cfg.apiKey);
  if (!params) return sendJson(res, 400, { error: 'Ort fehlt.' });

  // Der Key gehoert nicht in den Cache-Schluessel - sonst waere jeder Wechsel
  // ein kompletter Neuaufbau.
  const key = String(params).replace(/&?key=[^&]*/, '');
  const hit = imageCache.get(key);
  if (hit && Date.now() - hit.at < IMAGE_CACHE_TTL_MS) {
    res.writeHead(200, {
      'Content-Type': hit.type,
      'Content-Length': hit.buffer.length,
      'Cache-Control': 'public, max-age=3600',
    });
    return res.end(hit.buffer);
  }

  try {
    const upstream = await fetch(`${STREETVIEW_ENDPOINT}?${params}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!upstream.ok) {
      // 404 heisst hier meist "an dieser Stelle gibt es kein Bild" - das ist
      // kein Serverfehler, der Client zeigt dann seinen Platzhalter.
      return sendJson(res, upstream.status === 404 ? 404 : 502, {
        error: `Street View antwortet mit ${upstream.status}.`,
      });
    }
    const type = upstream.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (!type.startsWith('image/') || !buffer.length) {
      return sendJson(res, 502, { error: 'Street View lieferte kein Bild.' });
    }
    cacheImage(key, { at: Date.now(), type, buffer });
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(buffer);
  } catch (err) {
    sendJson(res, 504, { error: `Street View nicht erreichbar: ${err.message}` });
  }
}

// ---------------------------------------------------------------- Static files

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// Ab dieser Groesse lohnt sich das Komprimieren - vor allem fuer die
// Laenderkarte (~1,4 MB Text), die sonst ueber WLAN spuerbar bummelt.
const GZIP_MIN_BYTES = 4096;
const GZIP_TYPES = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest']);

// Bis zu dieser Groesse wird eine Datei gzip-t im Speicher behalten. Dadurch
// wird die Laenderkarte genau einmal komprimiert statt bei jedem Abruf, und
// die Antwort bekommt eine echte Content-Length. Das ist durch einen Tunnel
// wichtig: gestueckelte Antworten ohne Laengenangabe brechen dort gern ab.
const GZIP_CACHE_MAX_FILE = 8 * 1024 * 1024;
const gzipCache = new Map(); // filePath -> { tag, buffer }

// /data aendert sich nur, wenn die Karte neu gebaut wird - das darf der
// Browser also laenger behalten. Alles andere wird jedes Mal nachgefragt
// (mit ETag ist das eine winzige 304-Antwort).
const LONG_CACHE = /^[/\\]data[/\\]/;

function etagOf(stat) {
  return `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
}

async function gzipped(filePath, tag) {
  const hit = gzipCache.get(filePath);
  if (hit && hit.tag === tag) return hit.buffer;
  const raw = await fsp.readFile(filePath);
  const buffer = zlib.gzipSync(raw);
  gzipCache.set(filePath, { tag, buffer });
  return buffer;
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const rel = path.normalize(pathname).replace(/^([/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) throw new Error('dir');

    const ext = path.extname(filePath).toLowerCase();
    const tag = etagOf(stat);
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': LONG_CACHE.test(path.sep + rel) ? 'public, max-age=86400' : 'no-cache',
      ETag: tag,
      'Last-Modified': stat.mtime.toUTCString(),
    };

    // Der Browser hat die Datei schon - das spart durch den Tunnel die vollen
    // 1,4 MB der Laenderkarte bei jedem Neuladen.
    if (req.headers['if-none-match'] === tag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    const gzip = GZIP_TYPES.has(ext)
      && stat.size >= GZIP_MIN_BYTES
      && /\bgzip\b/.test(req.headers['accept-encoding'] || '');

    if (gzip) {
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
      if (stat.size <= GZIP_CACHE_MAX_FILE) {
        const buffer = await gzipped(filePath, tag);
        headers['Content-Length'] = buffer.length;
        res.writeHead(200, headers);
        res.end(buffer);
      } else {
        // Zu gross zum Zwischenspeichern - dann eben ohne Laengenangabe.
        res.writeHead(200, headers);
        fs.createReadStream(filePath).pipe(zlib.createGzip()).pipe(res);
      }
    } else {
      headers['Content-Length'] = stat.size;
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 - nicht gefunden');
  }
}

// ---------------------------------------------------------------- HTTP

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/config' && req.method === 'GET') {
      const cfg = await readConfig();
      return sendJson(res, 200, {
        apiKey: cfg.apiKey,
        hasKey: !!cfg.apiKey,
        source: cfg.source,
        canEdit: isLocalRequest(req),
        ...roomStats(),
      });
    }

    if (url.pathname === '/api/streetview' && req.method === 'GET') {
      return serveStreetview(req, res, url);
    }

    if (url.pathname === '/api/config' && req.method === 'POST') {
      if (!isLocalRequest(req)) {
        return sendJson(res, 403, { error: 'Der API-Key kann nur direkt am Host-PC gesetzt werden.' });
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4000) return sendJson(res, 413, { error: 'Zu gross.' });
      }
      let apiKey = '';
      try {
        apiKey = String(JSON.parse(body).apiKey || '').trim();
      } catch {
        return sendJson(res, 400, { error: 'Ungueltige Anfrage.' });
      }
      if (!apiKey) return sendJson(res, 400, { error: 'Kein Key angegeben.' });
      if (process.env.GOOGLE_MAPS_API_KEY) {
        return sendJson(res, 409, { error: 'Key ist bereits per Umgebungsvariable gesetzt.' });
      }
      await writeConfig(apiKey);
      return sendJson(res, 200, { ok: true });
    }

    return serveStatic(req, res);
  } catch (err) {
    console.error('HTTP-Fehler:', err);
    if (!res.headersSent) res.writeHead(500).end('Interner Fehler');
  }
});

// ---------------------------------------------------------------- WebSocket

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.meta = null;
  ws.isAlive = true;
  registerSocket(ws);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data) => {
    if (data.length > 200_000) return;
    try {
      handleMessage(ws, data.toString());
    } catch (err) {
      console.error('Nachrichtenfehler:', err);
    }
  });

  ws.on('close', () => {
    try {
      handleClose(ws);
    } catch (err) {
      console.error('Close-Fehler:', err);
    }
    unregisterSocket(ws);
  });

  ws.on('error', () => {});
});

// Tote Verbindungen erkennen (wichtig hinter Tunneln/Proxys)
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {}
  }
}, 25_000);
heartbeat.unref?.();

// ---------------------------------------------------------------- Start

function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, HOST, async () => {
  const cfg = await readConfig();
  const line = '='.repeat(56);
  console.log('\n' + line);
  console.log('  GeoBingo laeuft!');
  console.log(line);
  console.log(`  Auf diesem PC :  http://localhost:${PORT}`);
  for (const ip of localAddresses()) {
    console.log(`  Im WLAN       :  http://${ip}:${PORT}`);
  }
  console.log(line);
  if (cfg.apiKey) {
    console.log(`  Google Maps API-Key: gesetzt (${cfg.source === 'env' ? 'Umgebungsvariable' : 'config.json'})`);
  } else {
    console.log('  Google Maps API-Key: FEHLT');
    console.log('  -> Oeffne http://localhost:' + PORT + ' und trage ihn dort ein.');
  }
  console.log(line + '\n');
});

process.on('SIGINT', () => {
  console.log('\nGeoBingo wird beendet.');
  process.exit(0);
});
