// Kompletter Spielzustand. Alles liegt im RAM - kein DB-Setup noetig.
// Ein Raum durchlaeuft: lobby -> playing -> voting -> results -> (lobby)

import { drawRandomWords, WORD_POOL } from './words.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne I/O/0/1
const MAX_WORDS = 40;
const MAX_PLAYERS = 16;
const MAX_COUNTRIES = 250; // mehr Laender gibt der Datensatz nicht her
const POINTS_ACCEPTED = 100;
const POINTS_UNANIMOUS_BONUS = 25;

// Stadt-Land-Fluss-Wertung: ein Wort, das sonst niemand gefunden hat, ist mehr
// wert als eins, das mehrere abgehakt haben.
const POINTS_UNIQUE = 20;
const POINTS_SHARED = 10;
const SCORE_MODES = ['auto', 'classic', 'unique'];
// Ab so vielen Mitspielern lohnt sich die Duplikat-Wertung - darunter gaebe es
// ohnehin fast nie ein doppeltes Wort.
const UNIQUE_MIN_PLAYERS = 3;

const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // leere Raeume nach 6h aufraeumen

/** @type {Map<string, Room>} */
const rooms = new Map();

let idCounter = 0;
const nextId = (prefix) => `${prefix}_${(++idCounter).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// ---------------------------------------------------------------- Raum-Setup

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const room = {
    code: makeCode(),
    createdAt: Date.now(),
    hostId: null,
    // Wer den Raum aufgemacht hat. Waehrend eines Reloads springt die
    // Host-Rolle kurz weiter - kommt der Gruender zurueck, bekommt er sie
    // wieder. Sonst koennte er das Voting nicht mehr beenden.
    ownerId: null,
    players: new Map(),
    phase: 'lobby',
    config: {
      words: [], // [{ id, text }]
      durationSec: 600,
      votingSec: 30,
      mapTravel: true, // Karte waehrend der Runde erlaubt
      sameStart: true,
      // 'random'  = Zufallsort fuer alle
      // 'pick'    = Host waehlt einen Ort auf der Karte
      // 'freemap' = kein Startort, jeder sucht sich selbst einen aus
      startMode: 'random',
      pickedLocation: null,
      // Punkteverteilung am Rundenende:
      // 'classic' = jede anerkannte Einreichung 100 Punkte (+25 bei Einstimmigkeit)
      // 'unique'  = Stadt-Land-Fluss: 20 fuer ein Wort, das nur einer hat, sonst 10
      // 'auto'    = 'unique' ab drei Mitspielern, sonst 'classic'
      scoreMode: 'auto',
      // Optionaler Laender-Filter. 'off' = ganze Welt (Standard),
      // 'block' = die Codes sind gesperrt, 'allow' = nur die Codes sind erlaubt.
      // Geprueft wird im Browser - der Server merkt sich nur die Einstellung.
      countryFilter: { mode: 'off', codes: [] },
    },
    round: null, // { startedAt, endsAt, startLocation, submissions: Map }
    // Die Voting-Phase laeuft, bis der Host sie beendet. Es gibt bewusst keinen
    // Timer, der sie abraeumt - sonst waere sie nach einem Reload weg.
    voting: null, // { order, index, votes: Map<subId, Map<playerId, bool>>, deadline }
    results: null,
    timer: null,
  };
  rooms.set(room.code, room);
  return room;
}

function getRoom(code) {
  if (!code) return null;
  return rooms.get(String(code).toUpperCase().trim()) || null;
}

function clearTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function connectedPlayers(room) {
  return [...room.players.values()].filter((p) => p.connected);
}

function ensureHost(room) {
  const host = room.players.get(room.hostId);
  if (host && host.connected) return;
  const next = connectedPlayers(room)[0];
  room.hostId = next ? next.id : room.hostId;
}

// ---------------------------------------------------------------- Serialisierung

function publicPlayer(room, p) {
  let done = 0;
  if (room.round) {
    for (const sub of room.round.submissions.values()) {
      if (sub.playerId === p.id) done++;
    }
  }
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    connected: p.connected,
    isHost: p.id === room.hostId,
    found: done,
  };
}

function currentVoteItem(room) {
  if (!room.voting) return null;
  const subId = room.voting.order[room.voting.index];
  if (!subId) return null;
  return room.voting.byId.get(subId) || null;
}

/** Wer darf ueber diese Einreichung abstimmen? (Ersteller nicht - ausser er ist allein) */
function eligibleVoters(room, sub) {
  const others = connectedPlayers(room).filter((p) => p.id !== sub.playerId);
  return others.length ? others : connectedPlayers(room);
}

export function serializeState(room, playerId) {
  const me = room.players.get(playerId);
  const state = {
    roomCode: room.code,
    phase: room.phase,
    youId: playerId,
    isHost: playerId === room.hostId,
    config: {
      words: room.config.words,
      durationSec: room.config.durationSec,
      votingSec: room.config.votingSec,
      mapTravel: room.config.mapTravel,
      sameStart: room.config.sameStart,
      startMode: room.config.startMode,
      pickedLocation: room.config.pickedLocation,
      countryFilter: room.config.countryFilter,
      scoreMode: room.config.scoreMode,
    },
    players: [...room.players.values()].map((p) => publicPlayer(room, p)),
    poolSize: WORD_POOL.length,
    // Damit die Lobby zeigen kann, was 'auto' gerade bedeutet.
    effectiveScoreMode: effectiveScoreMode(room),
    uniqueMinPlayers: UNIQUE_MIN_PLAYERS,
  };

  if (room.phase === 'playing' && room.round) {
    const mine = {};
    for (const sub of room.round.submissions.values()) {
      if (sub.playerId === playerId) mine[sub.wordId] = { id: sub.id, view: sub.view, savedAt: sub.savedAt };
    }
    state.round = {
      id: room.round.id,
      remainingMs: Math.max(0, room.round.endsAt - Date.now()),
      totalMs: room.config.durationSec * 1000,
      startLocation: room.round.startLocation,
      mySubmissions: mine,
    };
  }

  if (room.phase === 'voting' && room.voting) {
    const sub = currentVoteItem(room);
    const votes = sub ? room.voting.votes.get(sub.id) : null;
    const voters = sub ? eligibleVoters(room, sub) : [];
    const settled = room.voting.order.filter((id) => isSettled(room, room.voting.byId.get(id))).length;
    state.voting = {
      index: room.voting.index,
      total: room.voting.order.length,
      // Reine Anzeige - abgelaufen heisst nur "Richtzeit rum", nicht "vorbei".
      remainingMs: Math.max(0, room.voting.deadline - Date.now()),
      // Host-Feedback: wo stehen wir, und ist hier schon alles entschieden?
      allVoted: !!sub && isSettled(room, sub),
      settled,
      canPrev: room.voting.index > 0,
      canNext: room.voting.index < room.voting.order.length - 1,
      item: sub
        ? {
            id: sub.id,
            word: sub.word,
            view: sub.view,
            playerName: room.players.get(sub.playerId)?.name || '???',
            playerId: sub.playerId,
          }
        : null,
      canVote: !!sub && voters.some((p) => p.id === playerId),
      myVote: votes && votes.has(playerId) ? votes.get(playerId) : null,
      voted: voters.filter((p) => votes && votes.has(p.id)).map((p) => p.name),
      waitingFor: voters.filter((p) => !votes || !votes.has(p.id)).map((p) => p.name),
    };
  }

  if (room.phase === 'results' && room.results) {
    state.results = room.results;
  }

  if (me) me.lastSeen = Date.now();
  return state;
}

// ---------------------------------------------------------------- Phasenwechsel

function startRound(room, startLocation) {
  clearTimer(room);
  room.phase = 'playing';
  room.round = {
    id: nextId('r'),
    startedAt: Date.now(),
    endsAt: Date.now() + room.config.durationSec * 1000,
    startLocation: startLocation || null,
    submissions: new Map(),
  };
  room.voting = null;
  room.results = null;
  room.timer = setTimeout(() => beginVoting(room), room.config.durationSec * 1000 + 200);
}

function beginVoting(room) {
  clearTimer(room);
  if (!room.round) return;

  const subs = [...room.round.submissions.values()];
  if (!subs.length) {
    finishRound(room);
    return;
  }

  // Nach Wort gruppiert durchgehen - so sieht man direkt Vergleiche.
  const wordOrder = new Map(room.config.words.map((w, i) => [w.id, i]));
  subs.sort((a, b) => {
    const d = (wordOrder.get(a.wordId) ?? 99) - (wordOrder.get(b.wordId) ?? 99);
    return d !== 0 ? d : a.savedAt - b.savedAt;
  });

  room.phase = 'voting';
  room.voting = {
    order: subs.map((s) => s.id),
    byId: new Map(subs.map((s) => [s.id, s])),
    index: 0,
    votes: new Map(subs.map((s) => [s.id, new Map()])),
    // Nur zur Anzeige: eine Richtzeit pro Bild. Laeuft sie ab, passiert nichts -
    // beendet wird die Phase ausschliesslich vom Host.
    deadline: Date.now() + room.config.votingSec * 1000,
  };
  broadcast(room);
}

/**
 * Blaettert im Voting vor oder zurueck. Nur der Host loest das aus; das Ende
 * der Liste beendet die Runde bewusst NICHT - dafuer gibt es 'endVoting'.
 */
function moveVote(room, step) {
  if (room.phase !== 'voting' || !room.voting) return;
  const last = room.voting.order.length - 1;
  const next = Math.min(last, Math.max(0, room.voting.index + step));
  if (next === room.voting.index) return;
  room.voting.index = next;
  room.voting.deadline = Date.now() + room.config.votingSec * 1000;
  broadcast(room);
}

/** Haben alle Stimmberechtigten zu dieser Einreichung abgestimmt? */
function isSettled(room, sub) {
  const voters = eligibleVoters(room, sub);
  const votes = room.voting.votes.get(sub.id);
  return !!voters.length && voters.every((p) => votes && votes.has(p.id));
}

/** Wie viele Leute spielen gerade wirklich mit? (verbunden oder mit Fund) */
function activePlayerCount(room) {
  const ids = new Set(connectedPlayers(room).map((p) => p.id));
  if (room.round) {
    for (const sub of room.round.submissions.values()) ids.add(sub.playerId);
  }
  return ids.size;
}

/** 'auto' entscheidet sich erst am Rundenende - je nachdem, wie viele mitspielen. */
function effectiveScoreMode(room) {
  const mode = SCORE_MODES.includes(room.config.scoreMode) ? room.config.scoreMode : 'auto';
  if (mode !== 'auto') return mode;
  return activePlayerCount(room) >= UNIQUE_MIN_PLAYERS ? 'unique' : 'classic';
}

function finishRound(room) {
  clearTimer(room);
  const scores = new Map([...room.players.keys()].map((id) => [id, {
    points: 0, accepted: 0, submitted: 0, uniques: 0,
  }]));
  const details = [];
  const scoreMode = effectiveScoreMode(room);

  const subs = room.round ? [...room.round.submissions.values()] : [];

  // Erst wird ueber alle Einreichungen entschieden, dann erst gewertet: fuer den
  // Einzigartig-Bonus muss man wissen, wer dasselbe Wort sonst noch anerkannt
  // bekommen hat. Deshalb zwei Durchgaenge statt einem.
  const judged = subs.map((sub) => {
    const votes = room.voting ? room.voting.votes.get(sub.id) : null;
    const yes = votes ? [...votes.values()].filter(Boolean).length : 0;
    const no = votes ? [...votes.values()].filter((v) => v === false).length : 0;
    const total = yes + no;
    // Ohne abgegebene Stimmen (z.B. alle weg, Host beendet frueh) zaehlt es als akzeptiert.
    const accepted = total === 0 ? true : yes > total / 2;
    return { sub, yes, no, total, accepted };
  });

  // Abgleich aller anerkannten Woerter: wer hat dasselbe Wort auch abgehakt?
  const findersByWord = new Map();
  for (const j of judged) {
    if (!j.accepted) continue;
    if (!findersByWord.has(j.sub.wordId)) findersByWord.set(j.sub.wordId, new Set());
    findersByWord.get(j.sub.wordId).add(j.sub.playerId);
  }

  for (const { sub, yes, no, total, accepted } of judged) {
    const finders = findersByWord.get(sub.wordId)?.size || 0;
    const unique = accepted && finders === 1;

    let points = 0;
    if (accepted) {
      if (scoreMode === 'unique') {
        points = unique ? POINTS_UNIQUE : POINTS_SHARED;
      } else {
        points = POINTS_ACCEPTED;
        if (total >= 2 && no === 0) points += POINTS_UNANIMOUS_BONUS;
      }
    }

    const s = scores.get(sub.playerId);
    if (s) {
      s.submitted++;
      if (accepted) {
        s.accepted++;
        s.points += points;
        if (unique) s.uniques++;
      }
    }

    details.push({
      id: sub.id,
      word: sub.word,
      wordId: sub.wordId,
      playerId: sub.playerId,
      playerName: room.players.get(sub.playerId)?.name || '???',
      view: sub.view,
      yes,
      no,
      accepted,
      points,
      finders,
      unique,
    });
  }

  const ranking = [...room.players.values()]
    .map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      ...(scores.get(p.id) || { points: 0, accepted: 0, submitted: 0, uniques: 0 }),
    }))
    .sort((a, b) => b.points - a.points || b.accepted - a.accepted || a.name.localeCompare(b.name));

  let rank = 0;
  let lastPoints = null;
  ranking.forEach((r, i) => {
    if (r.points !== lastPoints) {
      rank = i + 1;
      lastPoints = r.points;
    }
    r.rank = rank;
  });

  room.phase = 'results';
  room.results = {
    ranking,
    details,
    wordCount: room.config.words.length,
    scoreMode,
    points: scoreMode === 'unique'
      ? { unique: POINTS_UNIQUE, shared: POINTS_SHARED }
      : { accepted: POINTS_ACCEPTED, unanimous: POINTS_UNANIMOUS_BONUS },
  };
  room.voting = null;
  broadcast(room);
}

// ---------------------------------------------------------------- Broadcast

const sockets = new Set();

export function registerSocket(ws) {
  sockets.add(ws);
}

export function unregisterSocket(ws) {
  sockets.delete(ws);
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  }
}

export function broadcast(room) {
  for (const ws of sockets) {
    if (ws.meta && ws.meta.roomCode === room.code && ws.meta.playerId) {
      send(ws, { t: 'state', state: serializeState(room, ws.meta.playerId) });
    }
  }
}

function toast(ws, text, kind = 'info') {
  send(ws, { t: 'toast', text, kind });
}

// ---------------------------------------------------------------- Nachrichten

const PLAYER_COLORS = [
  '#f97316', '#38bdf8', '#a3e635', '#f472b6', '#facc15', '#c084fc',
  '#34d399', '#fb7185', '#60a5fa', '#fbbf24', '#4ade80', '#e879f9',
];

function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 18) || 'Spieler';
}

function makeWord(text) {
  return { id: nextId('w'), text: String(text).trim().slice(0, 60) };
}

/** Landescodes aus dem Datensatz: 'DE' oder - ohne ISO-Code - 'XKOS'. */
function sanitizeCountryFilter(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mode = ['off', 'block', 'allow'].includes(raw.mode) ? raw.mode : 'off';
  const codes = [];
  const seen = new Set();
  for (const item of Array.isArray(raw.codes) ? raw.codes : []) {
    const code = String(item || '').toUpperCase().trim();
    if (!/^[A-Z]{2,5}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
    if (codes.length >= MAX_COUNTRIES) break;
  }
  return { mode, codes };
}

function sanitizeView(view) {
  if (!view || typeof view !== 'object') return null;
  const num = (v, min, max, fallback = 0) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  const pano = typeof view.pano === 'string' ? view.pano.slice(0, 200) : null;
  const lat = num(view.lat, -90, 90, NaN);
  const lng = num(view.lng, -180, 180, NaN);
  if (!pano && (!Number.isFinite(lat) || !Number.isFinite(lng))) return null;
  return {
    pano,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    heading: num(view.heading, -360, 720, 0),
    pitch: num(view.pitch, -90, 90, 0),
    zoom: num(view.zoom, 0, 5, 0),
  };
}

export function handleMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg || typeof msg.t !== 'string') return;

  if (msg.t === 'hello') return onHello(ws, msg);

  // Lebenszeichen des Clients. Manche Tunnel und Handy-Netze lassen eine tote
  // Verbindung offen aussehen - dieses Echo verraet dem Client, dass wirklich
  // noch etwas ankommt. Muss vor der Raum-Pruefung stehen, sonst gaebe es
  // gleich nach dem Verbinden eine Fehlermeldung.
  if (msg.t === 'ping') return send(ws, { t: 'pong' });

  const room = ws.meta && getRoom(ws.meta.roomCode);
  const player = room && room.players.get(ws.meta.playerId);
  if (!room || !player) {
    send(ws, { t: 'error', msg: 'Nicht in einem Raum. Bitte Seite neu laden.' });
    return;
  }
  const isHost = player.id === room.hostId;

  switch (msg.t) {
    // ---- Lobby / Konfiguration -------------------------------------------
    case 'addWords': {
      if (!isHost) return toast(ws, 'Nur der Host kann Woerter aendern.', 'warn');
      if (room.phase !== 'lobby') return;
      const texts = Array.isArray(msg.words) ? msg.words : [msg.words];
      const existing = new Set(room.config.words.map((w) => w.text.toLowerCase()));
      let added = 0;
      for (const raw of texts) {
        const text = String(raw || '').trim();
        if (!text) continue;
        if (existing.has(text.toLowerCase())) continue;
        if (room.config.words.length >= MAX_WORDS) {
          toast(ws, `Maximal ${MAX_WORDS} Woerter.`, 'warn');
          break;
        }
        room.config.words.push(makeWord(text));
        existing.add(text.toLowerCase());
        added++;
      }
      if (added) broadcast(room);
      return;
    }

    case 'randomWords': {
      if (!isHost) return toast(ws, 'Nur der Host kann Woerter aendern.', 'warn');
      if (room.phase !== 'lobby') return;
      const want = Math.max(1, Math.min(MAX_WORDS, Number(msg.count) || 8));
      const space = MAX_WORDS - room.config.words.length;
      if (space <= 0) return toast(ws, `Maximal ${MAX_WORDS} Woerter.`, 'warn');
      const picked = drawRandomWords(Math.min(want, space), room.config.words.map((w) => w.text));
      picked.forEach((text) => room.config.words.push(makeWord(text)));
      broadcast(room);
      return;
    }

    case 'removeWord': {
      if (!isHost) return;
      if (room.phase !== 'lobby') return;
      room.config.words = room.config.words.filter((w) => w.id !== msg.wordId);
      broadcast(room);
      return;
    }

    case 'clearWords': {
      if (!isHost) return;
      if (room.phase !== 'lobby') return;
      room.config.words = [];
      broadcast(room);
      return;
    }

    case 'setConfig': {
      if (!isHost) return;
      if (room.phase !== 'lobby') return;
      const c = msg.config || {};
      if (c.durationSec != null) {
        room.config.durationSec = Math.max(5, Math.min(7200, Math.round(Number(c.durationSec) || 600)));
      }
      if (c.votingSec != null) {
        room.config.votingSec = Math.max(5, Math.min(300, Math.round(Number(c.votingSec) || 30)));
      }
      if (c.mapTravel != null) room.config.mapTravel = !!c.mapTravel;
      if (c.sameStart != null) room.config.sameStart = !!c.sameStart;
      if (c.startMode != null) {
        room.config.startMode = ['pick', 'freemap'].includes(c.startMode) ? c.startMode : 'random';
      }
      if (c.countryFilter != null) {
        const filter = sanitizeCountryFilter(c.countryFilter);
        if (filter) room.config.countryFilter = filter;
      }
      if (c.scoreMode != null) {
        room.config.scoreMode = SCORE_MODES.includes(c.scoreMode) ? c.scoreMode : 'auto';
      }
      broadcast(room);
      return;
    }

    case 'setPickedLocation': {
      if (!isHost) return toast(ws, 'Nur der Host kann den Startort waehlen.', 'warn');
      if (room.phase !== 'lobby') return;
      const view = sanitizeView(msg.view);
      if (!view) return toast(ws, 'Der Ort konnte nicht uebernommen werden.', 'warn');
      room.config.pickedLocation = { ...view, label: String(msg.label || '').slice(0, 120) || null };
      room.config.startMode = 'pick';
      broadcast(room);
      return;
    }

    case 'start': {
      if (!isHost) return toast(ws, 'Nur der Host kann starten.', 'warn');
      if (room.phase !== 'lobby') return;
      if (!room.config.words.length) return toast(ws, 'Erst Woerter hinzufuegen!', 'warn');
      if (room.config.startMode === 'pick') {
        if (!room.config.pickedLocation) {
          return toast(ws, 'Bitte erst einen Startort auf der Karte waehlen.', 'warn');
        }
        startRound(room, room.config.pickedLocation);
      } else if (room.config.startMode === 'freemap') {
        // Bewusst ohne Ort: jeder Spieler sucht sich selbst einen aus.
        startRound(room, null);
      } else {
        startRound(room, msg.startLocation || null);
      }
      broadcast(room);
      return;
    }

    // ---- Runde ------------------------------------------------------------
    case 'save': {
      if (room.phase !== 'playing') return;
      const word = room.config.words.find((w) => w.id === msg.wordId);
      if (!word) return;
      const view = sanitizeView(msg.view);
      if (!view) return toast(ws, 'Street View Position konnte nicht gelesen werden.', 'warn');

      const key = `${player.id}::${word.id}`;
      const existing = room.round.submissions.get(key);
      room.round.submissions.set(key, {
        id: existing ? existing.id : nextId('s'),
        playerId: player.id,
        wordId: word.id,
        word: word.text,
        view,
        savedAt: Date.now(),
      });
      broadcast(room);
      return;
    }

    case 'unsave': {
      if (room.phase !== 'playing') return;
      room.round.submissions.delete(`${player.id}::${msg.wordId}`);
      broadcast(room);
      return;
    }

    case 'endRound': {
      if (!isHost) return toast(ws, 'Nur der Host kann die Runde beenden.', 'warn');
      if (room.phase !== 'playing') return;
      beginVoting(room); // sendet selbst
      return;
    }

    // ---- Voting -----------------------------------------------------------
    case 'vote': {
      if (room.phase !== 'voting' || !room.voting) return;
      const sub = currentVoteItem(room);
      if (!sub) return;
      if (!eligibleVoters(room, sub).some((p) => p.id === player.id)) {
        return toast(ws, 'Ueber deine eigene Einreichung darfst du nicht abstimmen.', 'warn');
      }
      room.voting.votes.get(sub.id).set(player.id, !!msg.value);
      // Bewusst kein automatisches Weiterschalten mehr: dass alle abgestimmt
      // haben, ist nur ein Hinweis fuer den Host.
      broadcast(room);
      return;
    }

    // Vor- und zurueckblaettern. 'skipVote' bleibt als alter Name bestehen,
    // damit ein noch offener Tab mit altem Code nicht ins Leere greift.
    case 'voteNav':
    case 'skipVote': {
      if (!isHost) return toast(ws, 'Nur der Host steuert das Voting.', 'warn');
      if (room.phase !== 'voting') return;
      moveVote(room, msg.dir === 'prev' ? -1 : 1);
      return;
    }

    case 'endVoting': {
      if (!isHost) return toast(ws, 'Nur der Host kann das Voting beenden.', 'warn');
      if (room.phase !== 'voting') return;
      finishRound(room); // sendet selbst
      return;
    }

    // ---- Nach der Runde ---------------------------------------------------
    case 'backToLobby': {
      if (!isHost) return;
      clearTimer(room);
      room.phase = 'lobby';
      room.round = null;
      room.voting = null;
      room.results = null;
      broadcast(room);
      return;
    }

    case 'newWords': {
      if (!isHost) return;
      clearTimer(room);
      room.phase = 'lobby';
      room.round = null;
      room.voting = null;
      room.results = null;
      const count = room.config.words.length || 8;
      room.config.words = drawRandomWords(count).map(makeWord);
      broadcast(room);
      return;
    }

    case 'ping':
      send(ws, { t: 'pong' });
      return;

    default:
      return;
  }
}

function onHello(ws, msg) {
  const name = cleanName(msg.name);
  let room;

  if (msg.create) {
    room = createRoom();
  } else {
    room = getRoom(msg.roomCode);
    if (!room) {
      send(ws, { t: 'error', msg: 'Raum nicht gefunden. Code pruefen!' });
      return;
    }
  }

  // Reconnect: gleiche playerId -> alten Platz uebernehmen
  let player = msg.playerId ? room.players.get(msg.playerId) : null;

  if (!player) {
    if (room.players.size >= MAX_PLAYERS) {
      send(ws, { t: 'error', msg: 'Raum ist voll.' });
      return;
    }
    if (room.phase !== 'lobby' && !msg.create) {
      // Spaeteinsteiger duerfen zuschauen/mitmachen, starten aber ohne Punkte-Handicap
      // -> wir lassen sie einfach rein.
    }
    player = {
      id: nextId('p'),
      name,
      color: PLAYER_COLORS[room.players.size % PLAYER_COLORS.length],
      connected: true,
      lastSeen: Date.now(),
    };
    room.players.set(player.id, player);
  } else {
    player.name = name;
    player.connected = true;
    player.lastSeen = Date.now();
  }

  if (!room.ownerId) room.ownerId = player.id;
  if (!room.hostId) room.hostId = player.id;
  // Der Gruender ist wieder da: Rolle zurueck. Ohne das haette ein Neuladen
  // waehrend des Votings ihm die Steuerung dauerhaft weggenommen.
  if (player.id === room.ownerId) room.hostId = player.id;

  // Falls dieselbe Person in einem anderen Tab offen war: alte Verbindung trennen
  for (const other of sockets) {
    if (other !== ws && other.meta && other.meta.playerId === player.id) {
      send(other, { t: 'error', msg: 'Du hast das Spiel in einem anderen Tab geoeffnet.' });
      other.meta = null;
    }
  }

  ws.meta = { roomCode: room.code, playerId: player.id };
  send(ws, { t: 'joined', playerId: player.id, roomCode: room.code });
  broadcast(room);
}

export function handleClose(ws) {
  const room = ws.meta && getRoom(ws.meta.roomCode);
  if (!room) return;
  const player = room.players.get(ws.meta.playerId);
  if (!player) return;
  player.connected = false;
  ensureHost(room);
  // Kein Weiterschalten beim Verbindungsverlust: sonst wuerde ein Reload
  // waehrend des Votings die Einreichung ueberspringen.
  broadcast(room);
}

export function roomStats() {
  return { rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0) };
}

// Aufraeumen: Raeume ohne verbundene Spieler nach TTL loeschen
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (connectedPlayers(room).length) continue;
    const last = Math.max(room.createdAt, ...[...room.players.values()].map((p) => p.lastSeen || 0));
    if (now - last > ROOM_TTL_MS) {
      clearTimer(room);
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000).unref?.();
