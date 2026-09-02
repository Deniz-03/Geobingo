import * as net from './net.js';
import {
  loadMaps, onMapsAuthError, findRandomLocation, findPanoramaNear, createGamePanorama,
  createViewPanorama, createPickerMap, createCountryMap, applyView, readView, thumbnailUrl,
  resolveView, refreshPanorama, watchPanoramaSize,
} from './maps.js';
import {
  loadCountries, countriesReady, allCountries, namesFor,
  filterActive, normalizeFilter, isAllowed, rejectionReason,
} from './countries.js';

// ---------------------------------------------------------------- Helfer

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function fmtTime(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function toast(text, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 3800);
}

// ---------------------------------------------------------------- Zustand

let state = null;
let mapsReady = false;
let apiKey = '';

let gamePano = null;
let votePano = null;
let modalPano = null;
let picker = null;
let pickerPano = null;
let pickedCandidate = null;

let countryMap = null;
let countryLoad = null;
let countryLoadFailed = false;
/** Arbeitskopie der Auswahl, solange das Laender-Modal offen ist. */
const cm = { mode: 'block', codes: new Set() };

let lastPhase = null;
let lastVoteItemId = null;
let gameDeadline = 0;
let voteDeadline = 0;
let startingGame = false;

const store = {
  get name() { return localStorage.getItem('geobingo:name') || ''; },
  set name(v) { localStorage.setItem('geobingo:name', v); },
  pid(room) { return sessionStorage.getItem(`geobingo:pid:${room}`) || null; },
  setPid(room, id) { sessionStorage.setItem(`geobingo:pid:${room}`, id); },
  // Blaue Street-View-Linien auf den Karten - reine Ansichtssache, gilt
  // geraeteweit und ueberlebt das Neuladen.
  get coverage() { return localStorage.getItem('geobingo:coverage') !== 'off'; },
  set coverage(on) { localStorage.setItem('geobingo:coverage', on ? 'on' : 'off'); },
};

// ---------------------------------------------------------------- Screens

const SCREENS = ['setup', 'home', 'lobby', 'game', 'vote', 'results'];
let activeScreen = null;

function showScreen(name) {
  if (activeScreen === name) return;
  activeScreen = name;
  SCREENS.forEach((s) => $(`screen-${s}`).classList.toggle('hidden', s !== name));
  // Panoramen brauchen sichtbare Container, sonst rendern sie in 0x0 und
  // bleiben danach schwarz. refreshPanorama misst so lange nach, bis der
  // Container wirklich Platz hat - ein einzelnes 'resize' reicht dafuer nicht.
  if (name === 'game') refreshPanorama(gamePano, $('pano-game'));
  if (name === 'vote') refreshPanorama(votePano, $('pano-vote'));
}

// ---------------------------------------------------------------- Start

/**
 * Sorgt dafuer, dass die Maps-API da ist, bevor jemand sie benutzt.
 * Ein Fehlschlag ist nicht endgueltig - loadMaps() wartet beim naechsten
 * Aufruf einfach weiter. Deshalb ruft das hier jede Stelle auf, die eine
 * Karte oder ein Panorama braucht, statt sich auf den Start zu verlassen.
 */
async function ensureMaps({ quiet = false } = {}) {
  if (mapsReady) return true;
  try {
    await loadMaps(apiKey);
    mapsReady = true;
    return true;
  } catch (err) {
    if (!quiet) toast(err.message, 'error');
    return false;
  }
}

/**
 * Holt die Server-Konfiguration und gibt nicht beim ersten Fehlversuch auf.
 * Durch einen Tunnel kommt der allererste Aufruf gern als Fehlerseite zurueck -
 * ohne diese Schleife haenge man dann auf einer toten Startseite fest.
 */
async function fetchConfig() {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const cfg = await res.json();
      $('home-error').classList.add('hidden');
      return cfg;
    } catch {
      if (attempt === 1) toast('Server nicht erreichbar – versuche es weiter…', 'error');
      $('home-error').textContent =
        'Keine Verbindung zum Spiel-Server. Läuft er noch, und steht der Tunnel? Es wird weiter versucht…';
      $('home-error').classList.remove('hidden');
      showScreen('home');
      await new Promise((r) => setTimeout(r, Math.min(8000, 700 * attempt)));
    }
  }
}

async function boot() {
  wireStaticHandlers();
  setSidebarOpen(true);
  applyCoverage();
  onMapsAuthError((message) => toast(message, 'error'));

  const cfg = await fetchConfig();

  if (!cfg.hasKey) {
    showScreen('setup');
    if (!cfg.canEdit) {
      $('setup-error').textContent =
        'Der Host hat noch keinen Google-Maps-Key hinterlegt. Er muss das direkt am Host-PC tun.';
      $('setup-error').classList.remove('hidden');
      $('setup-key').disabled = true;
      $('setup-save').disabled = true;
    }
    return;
  }

  apiKey = cfg.apiKey;
  ensureMaps({ quiet: true }); // laeuft nebenher, Meldung kommt spaeter beim Benutzen

  $('home-name').value = store.name;
  const codeFromUrl = (location.hash || '').replace('#', '').toUpperCase().trim();
  const validCode = /^[A-Z0-9]{4}$/.test(codeFromUrl);
  if (validCode) $('home-code').value = codeFromUrl;

  net.connect();
  showScreen('home');

  // Waren wir in diesem Raum schon drin? Dann ohne Nachfrage zurueck ins Spiel.
  const savedPid = validCode ? store.pid(codeFromUrl) : null;
  if (savedPid && store.name) {
    const hello = { t: 'hello', name: store.name, roomCode: codeFromUrl, playerId: savedPid };
    net.setHello(hello);
    net.send(hello);
    return;
  }

  ($('home-name').value ? $('home-code') : $('home-name')).focus();
}

// ---------------------------------------------------------------- Netzwerk

net.on('open', () => $('connection-lost').classList.add('hidden'));
net.on('close', () => {
  if (activeScreen && activeScreen !== 'home' && activeScreen !== 'setup') {
    $('connection-lost').classList.remove('hidden');
  }
});

net.on('joined', (msg) => {
  store.setPid(msg.roomCode, msg.playerId);
  history.replaceState(null, '', `#${msg.roomCode}`);
  net.setHello({ t: 'hello', name: store.name, roomCode: msg.roomCode, playerId: msg.playerId });
});

net.on('error', (msg) => {
  if (activeScreen === 'home') {
    $('home-error').textContent = msg.msg;
    $('home-error').classList.remove('hidden');
    setButtonsBusy(false);
  } else {
    toast(msg.msg, 'error');
  }
});

net.on('toast', (msg) => toast(msg.text, msg.kind));

net.on('state', (msg) => {
  state = msg.state;
  render();
});

// ---------------------------------------------------------------- Render

function render() {
  if (!state) return;

  document.querySelectorAll('.host-only').forEach((el) => el.classList.toggle('hidden', !state.isHost));

  // Karte gehoert nur in die laufende Runde - beim Phasenwechsel zumachen.
  if (state.phase !== 'playing') {
    firstPickPending = false;
    $('gamemap').classList.add('hidden');
  }

  if (state.phase === 'playing' && state.round) gameDeadline = Date.now() + state.round.remainingMs;
  if (state.phase === 'voting' && state.voting) voteDeadline = Date.now() + state.voting.remainingMs;

  switch (state.phase) {
    case 'lobby': renderLobby(); break;
    case 'playing': renderGame(); break;
    case 'voting': renderVoting(); break;
    case 'results': renderResults(); break;
  }
  lastPhase = state.phase;
}

// ---- Lobby ---------------------------------------------------------------

function renderLobby() {
  showScreen('lobby');
  $('lobby-code').textContent = state.roomCode;
  $('lobby-count').textContent = `(${state.players.length})`;

  $('lobby-players').innerHTML = state.players.map((p) => `
    <li class="${p.connected ? '' : 'offline'}">
      <span class="dot" style="background:${esc(p.color)}"></span>
      <span>${esc(p.name)}</span>
      ${p.isHost ? '<span class="tag">Host</span>' : ''}
    </li>`).join('');

  const words = state.config.words;
  $('lobby-wordcount').textContent = `(${words.length})`;
  $('word-empty').classList.toggle('hidden', words.length > 0);
  $('word-list').innerHTML = words.map((w) => `
    <li>
      <span>${esc(w.text)}</span>
      ${state.isHost ? `<button class="x" data-remove="${esc(w.id)}" title="Entfernen">✕</button>` : ''}
    </li>`).join('');

  // Startort: Zufall, vom Host gewaehlt oder jeder selbst
  const mode = state.config.startMode || 'random';
  const picked = state.config.pickedLocation;
  for (const [id, value] of [['mode-random', 'random'], ['mode-pick', 'pick'], ['mode-free', 'freemap']]) {
    $(id).classList.toggle('active', mode === value);
    $(id).disabled = !state.isHost;
  }
  $('pick-row').classList.toggle('hidden', mode !== 'pick');
  // "Alle am gleichen Ort" ergibt nur beim Zufallsmodus Sinn.
  $('samestart-row').classList.toggle('hidden', mode !== 'random');

  $('pick-info').textContent = picked
    ? (picked.label || locLabel(picked))
    : (state.isHost ? 'Noch kein Ort gewählt.' : 'Der Host wählt gerade einen Ort aus…');

  const thumb = $('pick-thumb');
  if (picked) {
    const url = thumbnailUrl(picked, 320, 140);
    if (thumb.dataset.src !== url) {
      thumb.dataset.src = url;
      thumb.src = url;
      thumb.classList.remove('hidden');
    }
  } else {
    thumb.classList.add('hidden');
    thumb.dataset.src = '';
  }

  syncRange('cfg-duration', Math.round(state.config.durationSec / 60));
  syncRange('cfg-voting', state.config.votingSec);
  $('dur-label').textContent = fmtTime(state.config.durationSec * 1000);
  $('vote-label').textContent = `${state.config.votingSec}s`;
  if (document.activeElement !== $('cfg-maptravel')) $('cfg-maptravel').checked = state.config.mapTravel;
  if (document.activeElement !== $('cfg-samestart')) $('cfg-samestart').checked = state.config.sameStart;

  $('cfg-duration').disabled = !state.isHost;
  $('cfg-voting').disabled = !state.isHost;
  $('cfg-maptravel').disabled = !state.isHost;
  $('cfg-samestart').disabled = !state.isHost;
  $('rand-count').max = 40;

  renderCountryFilter();
  renderScoreMode();

  $('lobby-waiting').classList.toggle('hidden', state.isHost);
  $('lobby-start').disabled = !words.length || startingGame;
  $('lobby-start').textContent = startingGame ? 'Suche Startort…' : 'Spiel starten';
  $('lobby-status').textContent = words.length
    ? `${words.length} Wörter · ${fmtTime(state.config.durationSec * 1000)} Spielzeit`
    : '';
}

// ---- Punktesystem ---------------------------------------------------------

/** Was die drei Schalter bedeuten - in einem Satz unter der Auswahl. */
function scoreModeHint(mode, effective, minPlayers, playerCount) {
  if (mode === 'classic') {
    return 'Jede anerkannte Einreichung bringt 100 Punkte, bei einstimmigem Ja 125.';
  }
  if (mode === 'unique') {
    return 'Wie Stadt-Land-Fluss: 20 Punkte für ein Wort, das sonst niemand gefunden hat, '
      + '10 Punkte, wenn es mehrere haben. Gezählt wird erst am Rundenende.';
  }
  return `Ab ${minPlayers} Mitspielern zählt Stadt-Land-Fluss (20 Punkte einzigartig / 10 geteilt), `
    + `darunter die klassische Wertung. Aktuell: ${effective === 'unique' ? 'Stadt-Land-Fluss' : 'klassisch'} `
    + `(${playerCount} ${playerCount === 1 ? 'Spieler' : 'Spieler'}).`;
}

function renderScoreMode() {
  const mode = state.config.scoreMode || 'auto';
  for (const [id, value] of [['sm-auto', 'auto'], ['sm-classic', 'classic'], ['sm-unique', 'unique']]) {
    $(id).classList.toggle('active', mode === value);
    $(id).disabled = !state.isHost;
  }
  $('sm-hint').textContent = scoreModeHint(
    mode,
    state.effectiveScoreMode || 'classic',
    state.uniqueMinPlayers || 3,
    state.players.filter((p) => p.connected).length,
  );
}

function syncRange(id, value) {
  const el = $(id);
  if (document.activeElement !== el) el.value = value;
}

function locLabel(v) {
  if (!v || v.lat == null) return 'Gewählter Ort';
  return `${v.lat.toFixed(4)}, ${v.lng.toFixed(4)}`;
}

// ---- Laender-Filter -------------------------------------------------------

/** Der Filter des Raums, immer in normalisierter Form. */
function activeFilter() {
  return normalizeFilter(state?.config?.countryFilter);
}

/**
 * Laedt die Grenzdaten nach. Das sind gut 1,4 MB, deshalb erst wenn sie
 * wirklich gebraucht werden - also sobald ein Filter im Spiel ist.
 * Alle Aufrufer haengen sich an denselben Ladevorgang; sonst gaebe es bei
 * einem Fehler eine Meldung pro Aufruf.
 */
function ensureCountries({ rerender = true, retry = false } = {}) {
  if (countriesReady()) return Promise.resolve(true);
  // Nach einem Fehlschlag wird nicht von allein weiterprobiert (sonst haette
  // man die Meldung mehrfach). Ein neuer Anlauf beginnt erst, wenn jemand die
  // Laenderkarte wieder oeffnet - Tunnel-Aussetzer sind meist voruebergehend.
  if (retry) countryLoadFailed = false;
  if (countryLoadFailed) return Promise.resolve(false);
  if (!countryLoad) {
    countryLoad = loadCountries()
      .then(() => true)
      .catch((err) => {
        countryLoadFailed = true;
        toast(err.message, 'error');
        return false;
      });
  }
  return countryLoad.then((ok) => {
    if (ok && rerender && state) render();
    return ok;
  });
}

function chipsHtml(names, mode, empty) {
  return names.length
    ? names.map((n) => `<span class="chip ${mode}">${esc(n)}</span>`).join('')
    : `<span class="muted small">${esc(empty)}</span>`;
}

function renderCountryFilter() {
  const f = activeFilter();
  for (const [id, value] of [['cf-off', 'off'], ['cf-block', 'block'], ['cf-allow', 'allow']]) {
    $(id).classList.toggle('active', f.mode === value);
    $(id).disabled = !state.isHost;
  }
  $('cf-row').classList.toggle('hidden', f.mode === 'off');
  if (f.mode === 'off') return;

  // Ohne die Grenzdaten kennen wir nur die Codes - also nachladen.
  if (f.codes.length && !countriesReady()) ensureCountries();

  $('cf-hint').textContent = f.mode === 'block'
    ? 'Diese Länder kommen nicht vor:'
    : 'Gespielt wird nur in diesen Ländern:';
  $('cf-chips').innerHTML = chipsHtml(
    countriesReady() ? namesFor(f.codes) : f.codes,
    f.mode,
    'Noch keine Länder gewählt – es gilt weiter die ganze Welt.',
  );
}

function countryModalOpen() {
  return !$('countrymodal').classList.contains('hidden');
}

/**
 * Schickt die Auswahl aus dem Modal an den Server.
 * Nur bei offenem Modal - danach ist die Arbeitskopie veraltet und wuerde
 * einen Moduswechsel aus der Lobby wieder ueberschreiben.
 */
function pushCountryFilter() {
  if (!countryModalOpen()) return;
  net.send({ t: 'setConfig', config: { countryFilter: { mode: cm.mode, codes: [...cm.codes] } } });
}

function setCountryMode(mode) {
  cm.mode = mode;
  pushCountryFilter();
  renderCountryModal();
}

function toggleCountry(code) {
  if (!code) return;
  if (cm.codes.has(code)) cm.codes.delete(code);
  else cm.codes.add(code);
  pushCountryFilter();
  renderCountryModal();
}

function setCmStatus(text) {
  $('cm-status').textContent = text;
}

async function openCountryModal() {
  const f = activeFilter();
  cm.mode = f.mode === 'allow' ? 'allow' : 'block';
  cm.codes = new Set(f.codes);
  $('cm-search').value = '';
  $('countrymodal').classList.remove('hidden');
  setCmStatus('Länderkarte wird geladen…');
  renderCountryModal();

  if (!(await ensureMaps({ quiet: true }))) {
    return setCmStatus('Google Maps ist noch nicht bereit. Fenster schließen und gleich nochmal öffnen.');
  }
  if (!(await ensureCountries({ rerender: false, retry: true }))) {
    return setCmStatus('Die Länderkarte konnte nicht geladen werden. Fenster schließen und nochmal öffnen versucht es erneut.');
  }
  setCmStatus('Tipp: Land anklicken zum Aus- und Abwählen.');
  renderCountryModal();

  // setTimeout statt requestAnimationFrame: in einem Hintergrund-Tab
  // wuerde rAF nie feuern und die Karte nie entstehen.
  setTimeout(() => {
    if ($('countrymodal').classList.contains('hidden')) return;
    if (!countryMap) {
      countryMap = createCountryMap($('cm-map'), {
        onToggle: toggleCountry,
        onHover: (code, name) => setCmStatus(
          name ? `${name}${cm.codes.has(code) ? ' · ausgewählt' : ''}` : 'Tipp: Land anklicken zum Aus- und Abwählen.',
        ),
      });
      setTimeout(() => countryMap.resize(), 80);
    } else {
      countryMap.resize();
    }
    countryMap.setMode(cm.mode);
    countryMap.setSelection(cm.codes);
  }, 0);
}

function renderCountryModal() {
  $('cm-mode-block').classList.toggle('active', cm.mode === 'block');
  $('cm-mode-allow').classList.toggle('active', cm.mode === 'allow');
  $('cm-title').textContent = cm.mode === 'block' ? 'Länder sperren' : 'Nur diese Länder';
  $('cm-sub').textContent = cm.mode === 'block'
    ? 'Wähle die Länder, in denen nicht gespielt werden soll.'
    : 'Wähle die Länder, in denen gespielt werden soll.';
  $('cm-count').textContent = String(cm.codes.size);

  const query = $('cm-search').value.trim().toLowerCase();
  const matches = allCountries().filter((c) =>
    !query || c.name.toLowerCase().includes(query) || c.code.toLowerCase() === query);

  if (!countriesReady()) {
    $('cm-results').innerHTML = '<li class="empty muted small">Länder werden geladen…</li>';
  } else {
    $('cm-results').innerHTML = matches.length
      ? matches.map((c) => `
          <li class="${cm.codes.has(c.code) ? 'on' : ''}" data-code="${esc(c.code)}">
            <span class="box">${cm.codes.has(c.code) ? '✓' : ''}</span>
            <span class="name">${esc(c.name)}</span>
            <button class="btn tiny ghost" data-focus="${esc(c.code)}" title="Auf der Karte zeigen">◎</button>
          </li>`).join('')
      : '<li class="empty muted small">Kein Land gefunden.</li>';
  }

  $('cm-chips').innerHTML = chipsHtml(
    namesFor([...cm.codes]),
    cm.mode,
    'Nichts ausgewählt – damit gilt weiter die ganze Welt.',
  );

  countryMap?.setMode(cm.mode);
  countryMap?.setSelection(cm.codes);
}

function closeCountryModal() {
  $('countrymodal').classList.add('hidden');
}

/**
 * Setzt Hinweistext und die farbigen Flaechen auf einer Karte.
 * Ohne aktiven Filter passiert nichts - die Karte bleibt wie immer.
 */
function applyFilterToMap(mapHandle, hintId) {
  const f = activeFilter();
  const on = filterActive(f);
  const hint = $(hintId);
  hint.classList.toggle('hidden', !on);
  if (on) {
    hint.textContent = f.mode === 'block'
      ? '🚫 Rot markierte Länder sind für diese Runde gesperrt.'
      : '✅ Gespielt wird nur in den grün markierten Ländern.';
  }
  // Auch beim Ausschalten aufrufen - sonst blieben alte Flaechen liegen.
  if (countriesReady()) mapHandle?.showFilter(f);
}

// ---- Startort auf der Karte auswaehlen ------------------------------------

/**
 * Die blauen Linien zeigen, wo es Street View gibt - auf der Karte legen sie
 * sich aber ueber alles drueber. Der Schalter blendet nur die Anzeige aus:
 * gesucht, gesprungen und geprueft wird genau wie vorher.
 */
function applyCoverage() {
  const on = store.coverage;
  picker?.setCoverage(on);
  gameMap?.setCoverage(on);

  for (const id of ['picker-coverage', 'gamemap-coverage']) {
    $(id).textContent = on ? '🔵 Blaue Linien: an' : '🔵 Blaue Linien: aus';
    $(id).classList.toggle('off', !on);
  }
  $('picker-hint').innerHTML = on
    ? 'Klick auf die Karte. Die <b style="color:#4b8bf5">blau markierten</b> Straßen haben '
      + 'Street View – überall sonst gibt es keine Bilder.'
    : 'Klick auf die Karte – gesucht wird der nächstgelegene Street-View-Ort. '
      + 'Ohne die blauen Linien siehst du vorher nicht, wo es welche gibt.';
  $('gamemap-hint').textContent = on
    ? 'Klick auf eine blaue Straße – du landest sofort dort.'
    : 'Klick auf die Karte – du landest am nächstgelegenen Street-View-Ort.';
}

async function openMapPicker() {
  if (!(await ensureMaps())) return;
  const existing = state?.config.pickedLocation;
  pickedCandidate = null;
  $('picker-confirm').disabled = true;
  setPickerStatus(existing ? `Aktuell: ${existing.label || locLabel(existing)}` : '', '');
  $('mapmodal').classList.remove('hidden');
  if (filterActive(activeFilter())) await ensureCountries({ rerender: false });

  // Bewusst setTimeout statt requestAnimationFrame: rAF feuert in einem
  // Hintergrund-Tab nicht, die Karte wuerde dann nie entstehen.
  setTimeout(() => {
    const center = existing && existing.lat != null ? { lat: existing.lat, lng: existing.lng } : null;
    if (!picker) {
      picker = createPickerMap($('picker-map'), center, onMapPick, { coverage: store.coverage });
      // Sicherheitsnetz: falls der Container beim Erzeugen noch nicht vermessen war.
      setTimeout(() => picker.resize(), 80);
    } else {
      picker.resize();
      if (center) picker.center(center.lat, center.lng, 15);
    }
    if (center) {
      picker.mark(center.lat, center.lng);
      showPickerPreview(existing);
    }
    applyFilterToMap(picker, 'picker-filter');
  }, 0);
}

/** Nimmt "48.8584, 2.2945" oder "48.8584 2.2945" entgegen. */
function parseCoords(text) {
  const m = String(text).trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(',', '.'));
  const lng = parseFloat(m[2].replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

async function onMapPick(lat, lng, recenter = false) {
  setPickerStatus('Suche Street View in der Nähe…', '');
  $('picker-confirm').disabled = true;
  try {
    const view = await findPanoramaNear(lat, lng);
    // Die Karte ist optional - ueber die Koordinateneingabe geht es auch ohne sie.
    if (picker) {
      picker.mark(view.lat, view.lng);
      if (recenter) picker.center(view.lat, view.lng, 16);
    }
    showPickerPreview(view);

    const filter = activeFilter();
    if (!isAllowed(view.lat, view.lng, filter)) {
      pickedCandidate = null;
      return setPickerStatus(rejectionReason(view.lat, view.lng, filter), 'bad');
    }
    pickedCandidate = view;
    setPickerStatus(view.description ? `📍 ${view.description}` : '📍 Street View gefunden', 'ok');
    $('picker-confirm').disabled = false;
  } catch (err) {
    pickedCandidate = null;
    setPickerStatus(err.message, 'bad');
  }
}

function showPickerPreview(view) {
  $('picker-empty').classList.add('hidden');
  if (!pickerPano) {
    pickerPano = createViewPanorama($('picker-pano'), view);
    watchPanoramaSize(pickerPano, $('picker-pano'));
  } else {
    applyView(pickerPano, view);
  }
  refreshPanorama(pickerPano, $('picker-pano'));
}

function setPickerStatus(text, kind) {
  const el = $('picker-status');
  el.textContent = text;
  el.className = `small ${kind || ''}`;
}

function closeMapPicker() {
  $('mapmodal').classList.add('hidden');
}

// ---- Game ----------------------------------------------------------------

function renderGame() {
  showScreen('game');
  startingGame = false;

  if (lastPhase !== 'playing') {
    lastVoteItemId = null;
    initGamePanorama();
  }

  const mine = state.round.mySubmissions || {};
  const found = Object.keys(mine).length;
  const total = state.config.words.length;

  $('game-found').textContent = `${found} von ${total} gefunden`;
  $('game-map').classList.toggle('hidden', !state.config.mapTravel);

  $('game-words').innerHTML = state.config.words.map((w) => {
    const saved = mine[w.id];
    return `
      <li class="${saved ? 'done' : ''}">
        <span class="label">${esc(w.text)}</span>
        <span class="word-actions">
          ${saved ? `<button class="btn tiny ghost" data-show="${esc(w.id)}" title="Gespeicherte Ansicht zeigen">👁</button>` : ''}
          <button class="btn tiny ${saved ? '' : 'primary'}" data-save="${esc(w.id)}">
            ${saved ? '↻ Ersetzen' : '📸 Merken'}
          </button>
          ${saved ? `<button class="x" data-unsave="${esc(w.id)}" title="Verwerfen">✕</button>` : ''}
        </span>
      </li>`;
  }).join('');

  $('game-players').innerHTML = state.players.map((p) => `
    <li class="${p.connected ? '' : 'offline'}">
      <span class="dot" style="background:${esc(p.color)}"></span>
      <span>${esc(p.name)}</span>
      <span class="tag count">${p.found}</span>
    </li>`).join('');
}

async function initGamePanorama(attempt = 1) {
  // Ohne Maps-API bliebe der Spielbildschirm wortlos schwarz. Ein Fehlschlag
  // ist aber selten endgueltig - meist ist die Leitung nur langsam.
  setPanoLoading(true);
  if (!(await ensureMaps({ quiet: attempt < 3 }))) {
    if (state?.phase !== 'playing') return setPanoLoading(false);
    if (attempt < 3) {
      setTimeout(() => initGamePanorama(attempt + 1), 2000);
      return;
    }
    setPanoLoading(false);
    return toast('Street View lädt nicht. Meist hilft die Seite neu zu laden.', 'error');
  }
  setPanoLoading(false);

  // Nach einem Reload dort weitermachen, wo man war.
  const saved = loadPosition();
  if (saved) return placePlayer(saved);

  const view = state.round.startLocation;
  if (view) return placePlayer(view);

  if (state.config.startMode === 'freemap') {
    // Kein Startort vorgesehen - der Spieler sucht sich selbst einen aus.
    return openGameMap(true);
  }

  // "Alle am gleichen Ort" ist aus: jeder bekommt seinen eigenen Zufallsort.
  const filter = activeFilter();
  setPanoLoading(true);
  try {
    if (filterActive(filter)) await ensureCountries({ rerender: false });
    placePlayer(await findRandomLocation({ filter }));
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setPanoLoading(false);
  }
}

/** Setzt den Spieler an eine Ansicht - erzeugt das Panorama beim ersten Mal. */
function placePlayer(view) {
  if (!gamePano) {
    gamePano = createGamePanorama($('pano-game'), view);
    gamePano.addListener('position_changed', schedulePositionSave);
    gamePano.addListener('pov_changed', schedulePositionSave);
    watchPanoramaSize(gamePano, $('pano-game'));
  } else {
    applyView(gamePano, view);
  }
  refreshPanorama(gamePano, $('pano-game'));
  savePosition(view);
}

function setPanoLoading(on) {
  $('pano-loading').classList.toggle('hidden', !on);
}

// ---- Position merken (nur lokal, ueberlebt Reload und Verbindungsabbruch) --

function positionKey() {
  return state?.round?.id ? `geobingo:pos:${state.roomCode}:${state.round.id}` : null;
}

function savePosition(view) {
  const key = positionKey();
  if (!key || !view) return;
  try { sessionStorage.setItem(key, JSON.stringify(view)); } catch { /* voll oder gesperrt */ }
}

function loadPosition() {
  const key = positionKey();
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

let posSaveTimer = null;
function schedulePositionSave() {
  clearTimeout(posSaveTimer);
  posSaveTimer = setTimeout(() => {
    const v = readView(gamePano);
    if (v) savePosition(v);
  }, 1200);
}

// ---- Karte waehrend der Runde --------------------------------------------

let gameMap = null;
let firstPickPending = false;

async function openGameMap(firstPick = false) {
  if (state?.phase !== 'playing') return;
  if (!firstPick && !state.config.mapTravel) return;
  if (!(await ensureMaps())) return;

  firstPickPending = firstPick;
  $('gamemap-title').textContent = firstPick ? 'Such dir einen Startpunkt' : 'Wohin willst du?';
  // Beim ersten Mal gibt es kein Zurueck - ohne Ort kein Spiel.
  $('gamemap-close').classList.toggle('hidden', firstPick);
  setGameMapStatus('', '');
  $('gamemap').classList.remove('hidden');
  if (filterActive(activeFilter())) await ensureCountries({ rerender: false });

  setTimeout(() => {
    const here = readView(gamePano);
    const center = here && here.lat != null ? { lat: here.lat, lng: here.lng } : null;
    if (!gameMap) {
      gameMap = createPickerMap($('gamemap-map'), center, onGameMapPick, { coverage: store.coverage });
      setTimeout(() => gameMap.resize(), 80);
    } else {
      gameMap.resize();
      if (center) {
        gameMap.center(center.lat, center.lng, 14);
        gameMap.mark(center.lat, center.lng);
      }
    }
    applyFilterToMap(gameMap, 'gamemap-filter');
  }, 0);
}

async function onGameMapPick(lat, lng, recenter = false) {
  setGameMapStatus('Suche Street View…', '');
  try {
    const view = await findPanoramaNear(lat, lng);
    const filter = activeFilter();
    if (!isAllowed(view.lat, view.lng, filter)) {
      if (recenter && gameMap) gameMap.center(view.lat, view.lng, 8);
      return setGameMapStatus(rejectionReason(view.lat, view.lng, filter), 'bad');
    }
    if (recenter && gameMap) gameMap.center(view.lat, view.lng, 16);
    placePlayer(view);
    firstPickPending = false;
    closeGameMap();
    flashTravel();
    toast(view.description ? `Angekommen: ${view.description}` : 'Angekommen 🗺');
  } catch (err) {
    setGameMapStatus(err.message, 'bad');
  }
}

function setGameMapStatus(text, kind) {
  const el = $('gamemap-status');
  el.textContent = text;
  el.className = `small ${kind || ''}`;
}

function closeGameMap() {
  if (firstPickPending) return; // erst einen Ort waehlen
  $('gamemap').classList.add('hidden');
}

/** Kurzes Abdunkeln, damit der Ortswechsel spuerbar ist. */
function flashTravel() {
  const el = document.createElement('div');
  el.className = 'travel-flash';
  $('pano-game').parentElement.appendChild(el);
  setTimeout(() => el.remove(), 500);
}

// ---- Voting --------------------------------------------------------------

function renderVoting() {
  showScreen('vote');
  const v = state.voting;
  const item = v.item;

  $('vote-progress').textContent = `${v.index + 1} / ${v.total}`;
  $('vote-word').textContent = item ? item.word : '—';
  $('vote-badge').innerHTML = item ? `Eingereicht von <b>${esc(item.playerName)}</b>` : '';

  if (item && item.id !== lastVoteItemId) {
    lastVoteItemId = item.id;
    showVoteImage(item);
  } else if (item) {
    // Auch ohne Wechsel nachmessen: der Bildschirm kann inzwischen erst
    // sichtbar geworden sein (Reload, Tab-Wechsel, gedrehtes Handy).
    refreshPanorama(votePano, $('pano-vote'), { tries: 4 });
  }

  $('vote-actions').classList.toggle('hidden', !v.canVote);
  $('vote-own').classList.toggle('hidden', v.canVote);
  $('vote-yes').classList.toggle('active', v.myVote === true);
  $('vote-no').classList.toggle('active', v.myVote === false);

  // Kein Auto-Weiter mehr: "alle haben abgestimmt" ist nur noch ein Hinweis.
  $('vote-status').textContent = v.waitingFor.length
    ? `Warte auf: ${v.waitingFor.join(', ')}`
    : (v.allVoted ? '✓ Alle haben abgestimmt – der Host kann weiterklicken.' : '');

  $('vote-prev').disabled = !v.canPrev;
  $('vote-next').disabled = !v.canNext;
  $('vote-settled').textContent = `${v.settled} von ${v.total} durch`;
  $('vote-finish').textContent = v.settled >= v.total
    ? '🏁 Voting beenden & Runde auswerten'
    : `🏁 Voting beenden (${v.total - v.settled} offen)`;
  $('vote-hostwait').classList.toggle('hidden', state.isHost);
}

// ---- Voting-Bild ----------------------------------------------------------
//
// Die Einreichung reist nur als Panorama-ID plus Koordinaten - das Bild baut
// sich jeder Client selbst. Genau da entstand das schwarze Feld: das Panorama
// war schon da, seine Kacheln aber noch nicht (langsame Leitung, Handy), oder
// die Panorama-ID liess sich gar nicht mehr aufloesen.
//
// Deshalb zwei Ebenen:
//   1. Standbild vom eigenen Server - eine einzelne JPEG-Datei, in
//      Millisekunden da und bei allen Clients garantiert dieselbe. Das ist
//      jetzt das, worueber abgestimmt wird, und es bleibt liegen.
//   2. Das begehbare Panorama darunter. Es wird sofort vorbereitet, aber erst
//      auf Knopfdruck aufgedeckt - dann sind seine Kacheln laengst da.
//
// Ein Zeitfenster zum Ausblenden gibt es bewusst nicht mehr: wie lange Google
// fuer die Kacheln braucht, weiss man vorher nicht.

let voteImageToken = 0;
let votePanoReady = false;

function setVoteImageState({ loading = false, failed = false } = {}) {
  $('vote-loading').classList.toggle('hidden', !loading);
  $('vote-failed').classList.toggle('hidden', !failed);
}

function stillVisible() {
  return !$('vote-still').classList.contains('hidden');
}

/** Der Knopf lohnt nur, solange das Standbild oben liegt und es ein Panorama gibt. */
function updateLookButton() {
  $('vote-look').classList.toggle('hidden', !(votePanoReady && stillVisible()));
}

/** Standbild vorladen und erst anzeigen, wenn es wirklich fertig ist. */
function showVoteStill(item, token) {
  const img = $('vote-still');
  const url = thumbnailUrl(item.view, 640, 400);
  if (!url) return;

  const probe = new Image();
  probe.onload = () => {
    if (token !== voteImageToken) return; // laengst ein anderes Bild dran
    img.src = url;
    img.classList.remove('hidden');
    setVoteImageState({ loading: false });
    updateLookButton();
  };
  // Kein Standbild? Dann uebernimmt das Panorama - Meldung kommt von dort.
  probe.onerror = () => {
    if (token !== voteImageToken) return;
    img.classList.add('hidden');
    updateLookButton();
  };
  probe.src = url;
}

async function showVoteImage(item) {
  const token = ++voteImageToken;
  const el = $('pano-vote');
  votePanoReady = false;
  $('vote-still').classList.add('hidden');
  $('vote-still').removeAttribute('src');
  $('vote-look').classList.add('hidden');
  setVoteImageState({ loading: true });
  // Das alte Panorama zeigt noch die vorige Einreichung - sofort wegnehmen,
  // sonst stimmt jemand ueber das falsche Bild ab.
  votePano?.setVisible(false);

  showVoteStill(item, token);

  if (!(await ensureMaps({ quiet: true }))) {
    if (token !== voteImageToken) return;
    // Ohne Maps-API bleibt das Standbild stehen - abstimmen geht trotzdem.
    setVoteImageState({ loading: false, failed: !stillVisible() });
    return;
  }

  try {
    // Erst nachfragen, ob es die Aufnahme ueberhaupt noch gibt. Eine tote
    // Panorama-ID bliebe sonst wortlos schwarz.
    const view = await resolveView(item.view);
    if (token !== voteImageToken) return;

    if (!votePano) {
      votePano = createViewPanorama(el, view);
      watchPanoramaSize(votePano, el);
    } else {
      applyView(votePano, view);
    }
    refreshPanorama(votePano, el);
    votePanoReady = true;
    updateLookButton();
    // Ohne Standbild ist das Panorama die einzige Ebene - dann sofort zeigen.
    if (!stillVisible()) setVoteImageState({ loading: false });
  } catch (err) {
    if (token !== voteImageToken) return;
    // Standbild da? Dann reicht das zum Abstimmen, sonst klare Ansage.
    setVoteImageState({ loading: false, failed: !stillVisible() });
    if (!stillVisible()) toast(err.message, 'warn');
  }
}

/** Standbild wegklappen und im Panorama umsehen. */
function lookAroundInVote() {
  $('vote-still').classList.add('hidden');
  $('vote-look').classList.add('hidden');
  setVoteImageState({ loading: false });
  refreshPanorama(votePano, $('pano-vote'));
}

// ---- Results -------------------------------------------------------------

function renderResults() {
  showScreen('results');
  const r = state.results;
  const slf = r.scoreMode === 'unique';

  $('results-mode').textContent = slf
    ? `🎯 Stadt-Land-Fluss: ${r.points.unique} Punkte für ein Wort, das sonst niemand hatte, `
      + `${r.points.shared} Punkte für ein geteiltes.`
    : `🏅 Klassisch: ${r.points.accepted} Punkte pro anerkannter Einreichung, `
      + `+${r.points.unanimous} bei einstimmigem Ja.`;

  $('results-ranking').innerHTML = r.ranking.map((p) => `
    <li class="${p.rank === 1 && p.points > 0 ? 'top' : ''}">
      <span class="rank-no">${p.rank}.</span>
      <span class="dot" style="background:${esc(p.color)}"></span>
      <span class="rank-name">
        ${esc(p.name)}
        <span class="rank-sub">
          ${p.accepted} von ${p.submitted} anerkannt${slf && p.uniques ? ` · ${p.uniques}× einzigartig ✨` : ''}
        </span>
      </span>
      <span class="rank-points">${p.points}</span>
    </li>`).join('');

  $('results-details').innerHTML = r.details.length
    ? r.details.map((d, i) => `
        <div class="detail ${d.accepted ? 'accepted' : 'rejected'} ${slf && d.unique ? 'unique' : ''}" data-detail="${i}">
          <img class="thumb" loading="lazy" alt="${esc(d.word)}" src="${esc(thumbnailUrl(d.view))}">
          <div class="meta">
            <div class="w">
              ${esc(d.word)}
              ${slf && d.accepted ? `<span class="tag ${d.unique ? 'uniq' : 'shared'}">${
                d.unique ? '✨ nur du' : `${d.finders}× gefunden`}</span>` : ''}
            </div>
            <div class="p">
              <span>${esc(d.playerName)}</span>
              <span class="verdict ${d.accepted ? 'ok' : 'nope'}">
                ${d.accepted ? `+${d.points}` : '0'} · ${d.yes}👍 ${d.no}👎
              </span>
            </div>
          </div>
        </div>`).join('')
    : '<p class="muted">Niemand hat etwas eingereicht. 🙈</p>';

  $('results-waiting').classList.toggle('hidden', state.isHost);
}

// ---------------------------------------------------------------- Ticker

setInterval(() => {
  if (!state) return;

  if (state.phase === 'playing') {
    const left = gameDeadline - Date.now();
    const el = $('game-timer');
    el.textContent = fmtTime(left);
    el.classList.toggle('urgent', left < 30000);
    $('gamemap-timer').textContent = el.textContent;
    $('gamemap-timer').classList.toggle('urgent', left < 30000);
    const total = state.round?.totalMs || 1;
    $('game-progress').style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
  }

  if (state.phase === 'voting') {
    const left = voteDeadline - Date.now();
    const el = $('vote-timer');
    // Die Zeit beendet nichts mehr - abgelaufen heisst nur "Richtzeit rum".
    el.textContent = left > 0 ? fmtTime(left) : 'Zeit rum';
    el.classList.toggle('over', left <= 0);
  }
}, 250);

// ---------------------------------------------------------------- Events

function setButtonsBusy(busy) {
  $('home-create').disabled = busy;
  $('home-join').disabled = busy;
}

function joinRoom(create) {
  const name = $('home-name').value.trim();
  if (!name) {
    $('home-error').textContent = 'Bitte gib einen Namen ein.';
    $('home-error').classList.remove('hidden');
    return;
  }
  store.name = name;
  $('home-error').classList.add('hidden');
  setButtonsBusy(true);

  const roomCode = create ? null : $('home-code').value.trim().toUpperCase();
  if (!create && !/^[A-Z0-9]{4}$/.test(roomCode || '')) {
    $('home-error').textContent = 'Der Raum-Code besteht aus 4 Zeichen.';
    $('home-error').classList.remove('hidden');
    setButtonsBusy(false);
    return;
  }

  const hello = { t: 'hello', name, create: !!create, roomCode, playerId: roomCode ? store.pid(roomCode) : null };
  net.setHello(hello);
  net.send(hello);
  setTimeout(() => setButtonsBusy(false), 1500);
}

function wireStaticHandlers() {
  // ---- Setup
  $('setup-save').addEventListener('click', async () => {
    const key = $('setup-key').value.trim();
    if (!key) return;
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key }),
    });
    const data = await res.json();
    if (data.ok) location.reload();
    else {
      $('setup-error').textContent = data.error || 'Speichern fehlgeschlagen.';
      $('setup-error').classList.remove('hidden');
    }
  });

  // ---- Home
  $('home-create').addEventListener('click', () => joinRoom(true));
  $('home-join').addEventListener('click', () => joinRoom(false));
  $('home-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(false); });
  $('home-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ($('home-code').value ? joinRoom(false) : $('home-code').focus());
  });

  // ---- Lobby
  $('lobby-copy').addEventListener('click', async () => {
    const link = `${location.origin}/#${state.roomCode}`;
    try {
      await navigator.clipboard.writeText(link);
      toast('Einladungslink kopiert!');
    } catch {
      prompt('Link zum Kopieren:', link);
    }
  });

  const addWords = () => {
    const raw = $('word-input').value;
    const words = raw.split(',').map((w) => w.trim()).filter(Boolean);
    if (!words.length) return;
    net.send({ t: 'addWords', words });
    $('word-input').value = '';
    $('word-input').focus();
  };
  $('word-add').addEventListener('click', addWords);
  $('word-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addWords(); });

  $('word-random').addEventListener('click', () => {
    net.send({ t: 'randomWords', count: Number($('rand-count').value) || 10 });
  });
  $('word-clear').addEventListener('click', () => {
    if (confirm('Wirklich alle Wörter löschen?')) net.send({ t: 'clearWords' });
  });
  $('word-list').addEventListener('click', (e) => {
    const id = e.target.dataset.remove;
    if (id) net.send({ t: 'removeWord', wordId: id });
  });

  $('cfg-duration').addEventListener('input', (e) => {
    $('dur-label').textContent = fmtTime(Number(e.target.value) * 60000);
  });
  $('cfg-duration').addEventListener('change', (e) => {
    net.send({ t: 'setConfig', config: { durationSec: Number(e.target.value) * 60 } });
  });
  $('cfg-voting').addEventListener('input', (e) => { $('vote-label').textContent = `${e.target.value}s`; });
  $('cfg-voting').addEventListener('change', (e) => {
    net.send({ t: 'setConfig', config: { votingSec: Number(e.target.value) } });
  });
  $('cfg-maptravel').addEventListener('change', (e) => {
    net.send({ t: 'setConfig', config: { mapTravel: e.target.checked } });
  });
  $('cfg-samestart').addEventListener('change', (e) => {
    net.send({ t: 'setConfig', config: { sameStart: e.target.checked } });
  });

  for (const [id, scoreMode] of [['sm-auto', 'auto'], ['sm-classic', 'classic'], ['sm-unique', 'unique']]) {
    $(id).addEventListener('click', () => net.send({ t: 'setConfig', config: { scoreMode } }));
  }

  $('mode-random').addEventListener('click', () => net.send({ t: 'setConfig', config: { startMode: 'random' } }));
  $('mode-pick').addEventListener('click', () => {
    net.send({ t: 'setConfig', config: { startMode: 'pick' } });
    if (!state?.config.pickedLocation) openMapPicker();
  });
  $('mode-free').addEventListener('click', () => net.send({ t: 'setConfig', config: { startMode: 'freemap' } }));
  $('pick-open').addEventListener('click', openMapPicker);
  $('pick-thumb').addEventListener('error', () => $('pick-thumb').classList.add('hidden'));

  $('picker-confirm').addEventListener('click', () => {
    if (!pickedCandidate) return;
    net.send({ t: 'setPickedLocation', view: pickedCandidate, label: pickedCandidate.description || '' });
    closeMapPicker();
    toast('Startort übernommen 📍');
  });
  const gotoCoords = () => {
    const c = parseCoords($('picker-coords').value);
    if (!c) return setPickerStatus('Bitte im Format  48.8584, 2.2945  eingeben.', 'bad');
    onMapPick(c.lat, c.lng, true);
  };
  $('picker-go').addEventListener('click', gotoCoords);
  $('picker-coords').addEventListener('keydown', (e) => { if (e.key === 'Enter') gotoCoords(); });

  for (const id of ['picker-coverage', 'gamemap-coverage']) {
    $(id).addEventListener('click', () => {
      store.coverage = !store.coverage;
      applyCoverage();
    });
  }

  $('mapmodal-close').addEventListener('click', closeMapPicker);
  $('mapmodal').addEventListener('click', (e) => { if (e.target === $('mapmodal')) closeMapPicker(); });

  // ---- Laender-Filter
  for (const [id, mode] of [['cf-off', 'off'], ['cf-block', 'block'], ['cf-allow', 'allow']]) {
    $(id).addEventListener('click', () => {
      const f = activeFilter();
      if (f.mode === mode) return;
      // Modus wechseln, die Auswahl bleibt erhalten - so kann man zwischen
      // "diese sperren" und "nur diese" hin und her schalten.
      net.send({ t: 'setConfig', config: { countryFilter: { mode, codes: f.codes } } });
      if (mode !== 'off' && !f.codes.length) openCountryModal();
    });
  }
  $('cf-open').addEventListener('click', openCountryModal);

  $('cm-mode-block').addEventListener('click', () => setCountryMode('block'));
  $('cm-mode-allow').addEventListener('click', () => setCountryMode('allow'));
  $('cm-search').addEventListener('input', renderCountryModal);
  $('cm-search').addEventListener('keydown', (e) => {
    e.stopPropagation();
    // Enter waehlt den ersten Treffer - so kann man Laender schnell durchtippen.
    if (e.key !== 'Enter') return;
    const first = $('cm-results').querySelector('li[data-code]');
    if (first) {
      toggleCountry(first.dataset.code);
      $('cm-search').select();
    }
  });
  $('cm-results').addEventListener('click', (e) => {
    const focusBtn = e.target.closest('button[data-focus]');
    if (focusBtn) return countryMap?.focus(focusBtn.dataset.focus);
    const row = e.target.closest('li[data-code]');
    if (row) toggleCountry(row.dataset.code);
  });
  $('cm-clear').addEventListener('click', () => {
    cm.codes.clear();
    pushCountryFilter();
    renderCountryModal();
  });
  $('cm-close').addEventListener('click', closeCountryModal);
  $('countrymodal').addEventListener('click', (e) => {
    if (e.target === $('countrymodal')) closeCountryModal();
  });

  $('lobby-start').addEventListener('click', async () => {
    if (!state?.config.words.length) return;
    if (state.config.startMode === 'pick' && !state.config.pickedLocation) {
      toast('Bitte erst einen Startort auf der Karte wählen.', 'warn');
      return openMapPicker();
    }
    startingGame = true;
    renderLobby();
    try {
      if (!(await ensureMaps({ quiet: true }))) throw new Error('Google Maps lädt noch. Gleich nochmal versuchen.');
      const filter = activeFilter();
      if (filterActive(filter)) await ensureCountries({ rerender: false });

      // Der gewaehlte Startort kann noch aus der Zeit vor dem Filter stammen.
      const picked = state.config.pickedLocation;
      if (state.config.startMode === 'pick' && picked && !isAllowed(picked.lat, picked.lng, filter)) {
        startingGame = false;
        renderLobby();
        toast(rejectionReason(picked.lat, picked.lng, filter), 'warn');
        return openMapPicker();
      }

      // Bei 'pick' kennt der Server den Ort schon, bei 'freemap' gibt es bewusst keinen.
      const needsRandom = state.config.startMode === 'random' && state.config.sameStart;
      const startLocation = needsRandom ? await findRandomLocation({ filter }) : null;
      net.send({ t: 'start', startLocation });
    } catch (err) {
      startingGame = false;
      renderLobby();
      toast(err.message, 'error');
    }
  });

  // ---- Game
  $('game-words').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.save) {
      const view = readView(gamePano);
      if (!view) return toast('Street View ist noch nicht bereit.', 'warn');
      // Ueber die Pfeile kann man zu Fuss ueber eine Grenze laufen - hier
      // faellt so ein Fund auf, bevor er in die Wertung kommt.
      const filter = activeFilter();
      if (!isAllowed(view.lat, view.lng, filter)) {
        return toast(rejectionReason(view.lat, view.lng, filter), 'warn');
      }
      net.send({ t: 'save', wordId: btn.dataset.save, view });
      const word = state.config.words.find((w) => w.id === btn.dataset.save);
      toast(`„${word?.text}“ gespeichert 📸`);
    } else if (btn.dataset.unsave) {
      net.send({ t: 'unsave', wordId: btn.dataset.unsave });
    } else if (btn.dataset.show) {
      const sub = state.round.mySubmissions[btn.dataset.show];
      const word = state.config.words.find((w) => w.id === btn.dataset.show);
      if (sub) openModal(word?.text || 'Gespeicherte Ansicht', sub.view);
    }
  });

  $('game-map').addEventListener('click', () => openGameMap(false));
  $('gamemap-close').addEventListener('click', closeGameMap);
  $('gamemap').addEventListener('click', (e) => { if (e.target === $('gamemap')) closeGameMap(); });

  const gameMapGo = () => {
    const c = parseCoords($('gamemap-coords').value);
    if (!c) return setGameMapStatus('Bitte im Format  48.8584, 2.2945  eingeben.', 'bad');
    onGameMapPick(c.lat, c.lng, true);
  };
  $('gamemap-go').addEventListener('click', gameMapGo);
  $('gamemap-coords').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') gameMapGo();
  });
  $('game-end').addEventListener('click', () => {
    if (confirm('Runde für alle beenden und zum Voting gehen?')) net.send({ t: 'endRound' });
  });
  $('sidebar-toggle').addEventListener('click', () => {
    setSidebarOpen($('game-sidebar').classList.contains('collapsed'));
  });

  // ---- Voting
  $('vote-yes').addEventListener('click', () => net.send({ t: 'vote', value: true }));
  $('vote-no').addEventListener('click', () => net.send({ t: 'vote', value: false }));
  $('vote-prev').addEventListener('click', () => net.send({ t: 'voteNav', dir: 'prev' }));
  $('vote-next').addEventListener('click', () => net.send({ t: 'voteNav', dir: 'next' }));
  $('vote-finish').addEventListener('click', () => {
    const open = state?.voting ? state.voting.total - state.voting.settled : 0;
    const question = open > 0
      ? `${open} Einreichung(en) sind noch nicht fertig abgestimmt.\nVoting trotzdem beenden und auswerten?`
      : 'Voting beenden und die Runde auswerten?';
    if (confirm(question)) net.send({ t: 'endVoting' });
  });
  $('vote-look').addEventListener('click', lookAroundInVote);
  // Bild klemmt? Nochmal von vorn - meist ist nur die Leitung kurz weg gewesen.
  $('vote-retry').addEventListener('click', () => {
    if (state?.voting?.item) showVoteImage(state.voting.item);
  });

  // ---- Results
  $('results-again').addEventListener('click', () => net.send({ t: 'newWords' }));
  $('results-lobby').addEventListener('click', () => net.send({ t: 'backToLobby' }));
  // Standbilder kommen ueber den eigenen Server. Ein Fehlversuch ist meist nur
  // eine Netz-Aussetzer - deshalb einmal nachfassen, bevor der Platzhalter
  // erscheint. Die Ansicht selbst laesst sich trotzdem oeffnen.
  // error-Ereignisse steigen nicht auf, deshalb in der Capture-Phase lauschen.
  $('results-details').addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG') return;
    if (img.dataset.retried) return img.classList.add('broken');
    img.dataset.retried = '1';
    const base = img.src.split('&_r=')[0];
    setTimeout(() => { img.src = `${base}&_r=${Date.now()}`; }, 800);
  }, true);

  $('results-details').addEventListener('click', (e) => {
    const card = e.target.closest('[data-detail]');
    if (!card) return;
    const d = state.results.details[Number(card.dataset.detail)];
    if (d) openModal(`${d.word} — ${d.playerName}`, d.view);
  });

  // ---- Modal
  $('modal-close').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeMapPicker();
      closeCountryModal();
      closeGameMap();
      return;
    }
    // M oeffnet die Karte - aber nicht waehrend man irgendwo tippt.
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
    if (!typing && (e.key === 'm' || e.key === 'M') && state?.phase === 'playing') {
      if ($('gamemap').classList.contains('hidden')) openGameMap(false);
      else closeGameMap();
    }
  });
}

/**
 * Die Wortliste liegt als halbtransparente Leiste ueber dem Panorama.
 * Der body merkt sich den Zustand, damit die Karte im Spiel daneben aufgeht
 * statt die Liste zuzudecken.
 */
function setSidebarOpen(open) {
  $('game-sidebar').classList.toggle('collapsed', !open);
  document.body.classList.toggle('sidebar-open', open);
}

async function openModal(title, view) {
  $('modal-title').textContent = title;
  $('modal').classList.remove('hidden');
  if (!(await ensureMaps())) return;
  const el = $('pano-modal');
  let shown = view;
  try {
    // Auch hier erst nachfragen: eine tote Panorama-ID bliebe sonst schwarz.
    shown = await resolveView(view);
  } catch (err) {
    toast(err.message, 'warn');
    return;
  }
  if ($('modal').classList.contains('hidden')) return;
  if (!modalPano) {
    modalPano = createViewPanorama(el, shown);
    watchPanoramaSize(modalPano, el);
  } else {
    applyView(modalPano, shown);
  }
  refreshPanorama(modalPano, el);
}

function closeModal() {
  $('modal').classList.add('hidden');
}

boot();
