// Duenne WebSocket-Schicht mit automatischem Reconnect.

const handlers = new Map();
let socket = null;
let queue = [];
let reconnectDelay = 500;
let manualClose = false;
let helloPayload = null;

// Durch einen Tunnel (oder im Handy-Netz) stirbt eine Verbindung gern still:
// der Socket bleibt "open", es kommt aber nichts mehr an. Deshalb schickt der
// Client regelmaessig ein ping und erwartet Antwort. Bleibt sie aus, wird die
// Verbindung selbst gekappt - dann greift der normale Reconnect.
const PING_EVERY_MS = 15000;
const SILENCE_LIMIT_MS = 40000;
let pingTimer = null;
let lastMessageAt = 0;

function startHeartbeat() {
  stopHeartbeat();
  lastMessageAt = Date.now();
  pingTimer = setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastMessageAt > SILENCE_LIMIT_MS) {
      socket.close(); // loest 'close' aus -> Reconnect
      return;
    }
    socket.send(JSON.stringify({ t: 'ping' }));
  }, PING_EVERY_MS);
}

function stopHeartbeat() {
  clearInterval(pingTimer);
  pingTimer = null;
}

export function on(type, fn) {
  handlers.set(type, fn);
}

function emit(type, msg) {
  const fn = handlers.get(type);
  if (fn) fn(msg);
}

function url() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export function connect() {
  manualClose = false;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  socket = new WebSocket(url());

  socket.addEventListener('open', () => {
    reconnectDelay = 500;
    startHeartbeat();
    emit('open');
    if (helloPayload) socket.send(JSON.stringify(helloPayload));
    queue.forEach((m) => socket.send(m));
    queue = [];
  });

  socket.addEventListener('message', (ev) => {
    lastMessageAt = Date.now();
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.t === 'pong') return; // reines Lebenszeichen
    emit(msg.t, msg);
  });

  socket.addEventListener('close', () => {
    stopHeartbeat();
    emit('close');
    if (manualClose) return;
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(8000, reconnectDelay * 1.7);
  });

  socket.addEventListener('error', () => {});
}

/**
 * Zurueck am Geraet oder wieder im Netz? Dann sofort nachsehen, statt auf den
 * naechsten Reconnect-Versuch zu warten. Handys kappen die Verbindung, sobald
 * der Bildschirm aus geht - ohne das hier haengt man nach dem Aufwecken.
 */
function wakeUp() {
  if (manualClose) return;
  if (socket && socket.readyState === WebSocket.OPEN) {
    lastMessageAt = Date.now();
    socket.send(JSON.stringify({ t: 'ping' }));
    return;
  }
  reconnectDelay = 500;
  connect();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') wakeUp();
});
window.addEventListener('online', wakeUp);
window.addEventListener('pageshow', wakeUp);

/** Das hello wird bei jedem Reconnect automatisch erneut geschickt. */
export function setHello(payload) {
  helloPayload = payload;
}

export function send(msg) {
  const data = JSON.stringify(msg);
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(data);
  else queue.push(data);
}

export function isOpen() {
  return !!socket && socket.readyState === WebSocket.OPEN;
}

export function disconnect() {
  manualClose = true;
  socket?.close();
}
