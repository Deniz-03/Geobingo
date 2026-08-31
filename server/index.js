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

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const filePath = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) throw new Error('dir');

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    };
    const gzip = GZIP_TYPES.has(ext)
      && stat.size >= GZIP_MIN_BYTES
      && /\bgzip\b/.test(req.headers['accept-encoding'] || '');

    if (gzip) {
      // Ohne bekannte Endgroesse faellt Content-Length weg - das ist in Ordnung.
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(zlib.createGzip()).pipe(res);
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
