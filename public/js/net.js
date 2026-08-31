// Duenne WebSocket-Schicht mit automatischem Reconnect.

const handlers = new Map();
let socket = null;
let queue = [];
let reconnectDelay = 500;
let manualClose = false;
let helloPayload = null;

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
  socket = new WebSocket(url());

  socket.addEventListener('open', () => {
    reconnectDelay = 500;
    emit('open');
    if (helloPayload) socket.send(JSON.stringify(helloPayload));
    queue.forEach((m) => socket.send(m));
    queue = [];
  });

  socket.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    emit(msg.t, msg);
  });

  socket.addEventListener('close', () => {
    emit('close');
    if (manualClose) return;
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(8000, reconnectDelay * 1.7);
  });

  socket.addEventListener('error', () => {});
}

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
