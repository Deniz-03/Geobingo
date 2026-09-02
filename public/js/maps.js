// Alles rund um Google Street View: Laden der API, Zufallsorte finden,
// Panoramen erzeugen und Standbilder fuer die Vorschau bauen.

import {
  countryGeoJson, filterActive, isAllowed, normalizeFilter, randomPointInCountries,
} from './countries.js';

let loadPromise = null;

/** Regionen mit guter Street-View-Abdeckung. weight = wie oft gezogen wird. */
const REGIONS = [
  { name: 'Westeuropa',      lat: [43.0, 55.0],   lng: [-5.0, 15.0],    weight: 20 },
  { name: 'Grossbritannien', lat: [50.0, 58.5],   lng: [-9.0, 1.8],     weight: 9 },
  { name: 'Nordeuropa',      lat: [55.0, 65.0],   lng: [5.0, 26.0],     weight: 8 },
  { name: 'Sued-/Osteuropa', lat: [36.0, 49.0],   lng: [12.0, 30.0],    weight: 11 },
  { name: 'USA',             lat: [30.0, 48.0],   lng: [-124.0, -70.0], weight: 20 },
  { name: 'Kanada',          lat: [43.0, 52.0],   lng: [-124.0, -60.0], weight: 6 },
  { name: 'Mexiko',          lat: [16.0, 30.0],   lng: [-110.0, -88.0], weight: 5 },
  { name: 'Brasilien',       lat: [-30.0, -5.0],  lng: [-55.0, -38.0],  weight: 9 },
  { name: 'Argentinien',     lat: [-40.0, -24.0], lng: [-70.0, -55.0],  weight: 6 },
  { name: 'Suedafrika',      lat: [-34.5, -25.0], lng: [18.0, 31.5],    weight: 5 },
  { name: 'Japan',           lat: [31.0, 43.5],   lng: [130.0, 145.0],  weight: 9 },
  { name: 'Australien',      lat: [-38.5, -25.0], lng: [115.0, 153.5],  weight: 8 },
  { name: 'Neuseeland',      lat: [-46.5, -35.0], lng: [167.0, 178.5],  weight: 4 },
  { name: 'Suedostasien',    lat: [-8.5, 20.0],   lng: [96.0, 125.0],   weight: 8 },
  { name: 'Indien',          lat: [8.0, 30.0],    lng: [70.0, 88.5],    weight: 7 },
  { name: 'Tuerkei',         lat: [36.0, 41.5],   lng: [27.0, 42.0],    weight: 4 },
  { name: 'Russland',        lat: [44.0, 60.0],   lng: [30.0, 60.0],    weight: 5 },
  { name: 'Taiwan',          lat: [22.0, 25.2],   lng: [120.0, 122.0],  weight: 3 },
  { name: 'Chile',           lat: [-42.0, -30.0], lng: [-73.5, -70.0],  weight: 3 },
];

const TOTAL_WEIGHT = REGIONS.reduce((n, r) => n + r.weight, 0);

function randomPoint() {
  let roll = Math.random() * TOTAL_WEIGHT;
  let region = REGIONS[0];
  for (const r of REGIONS) {
    roll -= r.weight;
    if (roll <= 0) { region = r; break; }
  }
  return {
    lat: region.lat[0] + Math.random() * (region.lat[1] - region.lat[0]),
    lng: region.lng[0] + Math.random() * (region.lng[1] - region.lng[0]),
  };
}

/**
 * Google meldet einen abgelehnten Key nicht ueber die Promise, sondern nur
 * ueber diesen globalen Rueckruf - die Karten bleiben sonst wortlos grau.
 * Typisch, wenn der Key auf bestimmte Adressen beschraenkt ist und jemand
 * ueber eine Tunnel-Adresse spielt.
 */
let authErrorHandler = null;
export function onMapsAuthError(fn) {
  authErrorHandler = fn;
}
window.gm_authFailure = () => {
  authErrorHandler?.(
    'Google Maps lehnt den API-Key für diese Adresse ab. Meist ist im Google-Konto '
    + 'eine HTTP-Referrer-Beschränkung gesetzt, die die aktuelle Adresse nicht enthält '
    + '(oder die Abrechnung/das Kontingent ist aus). Karten und Street View bleiben leer.',
  );
};

// Auf einem langsamen Handy im Mobilfunknetz braucht die Maps-API auch mal
// eine halbe Minute. Laeuft die Zeit ab, ist das kein endgueltiges Nein:
// beim naechsten Versuch wird einfach weiter gewartet.
const MAPS_TIMEOUT_MS = 30000;
const MAPS_CALLBACK = '__geobingoMapsReady';
let mapsScript = null;

/**
 * Laedt die Maps JavaScript API. Das Script wird nur einmal eingehaengt,
 * ein fehlgeschlagener Versuch merkt sich aber nichts: sonst blieben Karten
 * und Street View fuer den Rest der Sitzung tot, obwohl das Script kurz nach
 * dem Zeitlimit doch noch fertig geworden ist.
 */
export function loadMaps(key) {
  if (window.google?.maps?.StreetViewPanorama) return Promise.resolve(window.google.maps);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    let poll = null;
    const settle = (fn) => (value) => {
      clearInterval(poll);
      fn(value);
    };
    const done = settle(() => resolve(window.google.maps));
    const fail = settle((err) => {
      loadPromise = null; // naechster Aufruf darf es nochmal versuchen
      reject(err);
    });

    window[MAPS_CALLBACK] = () => {
      delete window[MAPS_CALLBACK];
      done();
    };

    if (!mapsScript) {
      mapsScript = document.createElement('script');
      mapsScript.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`
        + `&v=weekly&loading=async&callback=${MAPS_CALLBACK}`;
      mapsScript.async = true;
      mapsScript.onerror = () => {
        mapsScript.remove();
        mapsScript = null; // wirklich kaputt - beim naechsten Mal neu einhaengen
        fail(new Error('Google Maps konnte nicht geladen werden. Ist der API-Key korrekt?'));
      };
      document.head.appendChild(mapsScript);
    }

    // Der Rueckruf kann verloren gehen (zweiter Versuch, abgebrochenes Laden).
    // Deshalb zusaetzlich nachsehen, ob die API inzwischen einfach da ist.
    const until = Date.now() + MAPS_TIMEOUT_MS;
    poll = setInterval(() => {
      if (window.google?.maps?.StreetViewPanorama) return done();
      if (Date.now() > until) {
        fail(new Error('Google Maps lädt ungewöhnlich lange. Gleich nochmal versuchen.'));
      }
    }, 400);
  });

  return loadPromise;
}

function getPanoramaAt(service, request) {
  return new Promise((resolve, reject) => {
    service.getPanorama(request, (data, status) => {
      if (status === 'OK' && data?.location) resolve(data);
      else reject(new Error(String(status)));
    });
  });
}

/**
 * Zieht einen Kandidatenpunkt - mit Laender-Filter aus den erlaubten Laendern,
 * ohne Filter aus den Regionen oben. Gesperrte Laender werden gleich hier
 * uebersprungen, das spart Anfragen an Google.
 */
function candidatePoint(filter) {
  const f = normalizeFilter(filter);
  if (!filterActive(f)) return randomPoint();
  if (f.mode === 'allow') return randomPointInCountries(f.codes) || randomPoint();

  for (let i = 0; i < 60; i++) {
    const p = randomPoint();
    if (isAllowed(p.lat, p.lng, f)) return p;
  }
  return randomPoint();
}

/**
 * Sucht einen zufaelligen Ort mit Street-View-Abdeckung.
 * Fragt mehrere Kandidaten parallel ab, damit es schnell geht.
 *
 * Mit Laender-Filter wird enger gesucht: ein grosser Radius wuerde sonst gern
 * ueber die Grenze schnappen. Deshalb mehr Versuche mit kleinerem Radius, und
 * das Ergebnis wird am Ende nochmal gegen den Filter geprueft.
 */
export async function findRandomLocation({ batches, perBatch = 4, radius, filter = null } = {}) {
  const service = new google.maps.StreetViewService();
  const source = google.maps.StreetViewSource?.OUTDOOR || 'outdoor';
  const filtered = filterActive(filter);
  const searchRadius = radius ?? (filtered ? 25000 : 60000);
  const rounds = batches ?? (filtered ? 30 : 12);

  for (let i = 0; i < rounds; i++) {
    const tries = Array.from({ length: perBatch }, () =>
      getPanoramaAt(service, { location: candidatePoint(filter), radius: searchRadius, source })
    );
    const settled = await Promise.allSettled(tries);
    for (const res of settled) {
      if (res.status !== 'fulfilled') continue;
      const data = res.value;
      const lat = data.location.latLng.lat();
      const lng = data.location.latLng.lng();
      // Der Radius kann ueber die Grenze gerutscht sein - also nachmessen.
      if (filtered && !isAllowed(lat, lng, filter)) continue;
      return {
        pano: data.location.pano,
        lat,
        lng,
        heading: Math.random() * 360,
        pitch: 0,
        zoom: 0,
      };
    }
  }
  throw new Error(filtered
    ? 'In den gewählten Ländern wurde kein Street-View-Ort gefunden. Nimm ein Land mehr dazu.'
    : 'Kein Street-View-Ort gefunden. Bitte nochmal versuchen.');
}

/** Peilung von einem Punkt zum anderen - damit die Kamera dahin schaut, wo geklickt wurde. */
function bearingBetween(from, to) {
  const rad = Math.PI / 180;
  const dLng = (to.lng - from.lng) * rad;
  const y = Math.sin(dLng) * Math.cos(to.lat * rad);
  const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) -
            Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos(dLng);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/**
 * Sucht das naechstgelegene Panorama zu einem angeklickten Punkt.
 * Der Radius wird schrittweise erweitert, falls direkt daneben nichts liegt.
 */
export async function findPanoramaNear(lat, lng, radii = [80, 400, 2000]) {
  const service = new google.maps.StreetViewService();
  const source = google.maps.StreetViewSource?.OUTDOOR || 'outdoor';

  for (const radius of radii) {
    try {
      const data = await getPanoramaAt(service, { location: { lat, lng }, radius, source });
      const pos = { lat: data.location.latLng.lat(), lng: data.location.latLng.lng() };
      return {
        pano: data.location.pano,
        lat: pos.lat,
        lng: pos.lng,
        // Blick in Richtung des angeklickten Punktes
        heading: bearingBetween(pos, { lat, lng }),
        pitch: 0,
        zoom: 0,
        description: data.location.description || data.location.shortDescription || null,
      };
    } catch {
      /* nichts in diesem Radius - weiter */
    }
  }
  throw new Error('Hier gibt es kein Street View. Klick auf eine blau markierte Strasse.');
}

// Farben fuer die Laender-Markierung: gesperrt rot, erlaubt gruen.
const BLOCK_COLOR = '#f87171';
const ALLOW_COLOR = '#34d399';

const MAP_BASE_OPTIONS = {
  minZoom: 2,
  streetViewControl: false,
  mapTypeControl: true,
  fullscreenControl: false,
  clickableIcons: false,
  gestureHandling: 'greedy',
};

/**
 * Legt die ausgewaehlten Laender als eingefaerbte Flaechen ueber eine Karte.
 * Nur die markierten Laender werden gezeichnet - das haelt die Karte fluessig.
 * Die Flaechen sind nicht anklickbar, damit Klicks weiter bei der Karte landen.
 */
function attachCountryHighlight(map) {
  const layer = new google.maps.Data({ map });
  const geojson = countryGeoJson();
  if (geojson) layer.addGeoJson(geojson);

  let current = { mode: 'off', codes: [] };
  const styleFor = (feature) => {
    const active = current.codes.includes(feature.getProperty('code'));
    if (!active) return { visible: false, clickable: false };
    const color = current.mode === 'allow' ? ALLOW_COLOR : BLOCK_COLOR;
    return {
      visible: true,
      clickable: false,
      fillColor: color,
      fillOpacity: current.mode === 'allow' ? 0.18 : 0.3,
      strokeColor: color,
      strokeWeight: 1.5,
      strokeOpacity: 0.9,
      zIndex: 1,
    };
  };
  // Immer eine frische Funktion uebergeben - sonst haelt die Data-Layer die
  // Style-Angabe fuer unveraendert und zeichnet nicht neu.
  const redraw = () => layer.setStyle((f) => styleFor(f));
  redraw();

  return {
    set(filter) {
      const f = normalizeFilter(filter);
      current = filterActive(f) ? f : { mode: 'off', codes: [] };
      redraw();
    },
  };
}

/**
 * Karte zum Aussuchen des Startorts. Die blauen Linien zeigen, wo Street View existiert.
 * onPick bekommt die angeklickten Koordinaten.
 */
export function createPickerMap(el, center, onPick, { coverage = true } = {}) {
  const map = new google.maps.Map(el, {
    ...MAP_BASE_OPTIONS,
    center: center || { lat: 30, lng: 5 },
    zoom: center ? 15 : 2,
  });

  // Rein optisch: die Ebene wird nur von der Karte abgehaengt. Gesucht und
  // gesprungen wird weiter genauso, egal ob die Linien zu sehen sind.
  const coverageLayer = new google.maps.StreetViewCoverageLayer();
  coverageLayer.setMap(coverage ? map : null);

  const marker = new google.maps.Marker({ map, position: center || null, visible: !!center });
  let highlight = null;

  map.addListener('click', (e) => onPick(e.latLng.lat(), e.latLng.lng()));

  return {
    map,
    /** Blaue Street-View-Linien ein- oder ausblenden. */
    setCoverage(on) {
      coverageLayer.setMap(on ? map : null);
    },
    /** Setzt die Markierung auf die tatsaechlich gefundene Panorama-Position. */
    mark(lat, lng) {
      marker.setPosition({ lat, lng });
      marker.setVisible(true);
    },
    center(lat, lng, zoom) {
      map.setCenter({ lat, lng });
      if (zoom) map.setZoom(zoom);
    },
    resize() {
      google.maps.event.trigger(map, 'resize');
    },
    /** Zeigt gesperrte bzw. erlaubte Laender an - erst beim ersten Aufruf aufgebaut. */
    showFilter(filter) {
      if (!highlight) {
        if (!filterActive(filter) || !countryGeoJson()) return;
        highlight = attachCountryHighlight(map);
      }
      highlight.set(filter);
    },
  };
}

/**
 * Weltkarte, auf der man Laender anklickt. Gibt bei jedem Klick den Landescode
 * zurueck; die Auswahl selbst verwaltet der Aufrufer und schiebt sie per
 * setSelection() wieder rein.
 */
export function createCountryMap(el, { onToggle, onHover }) {
  const map = new google.maps.Map(el, {
    ...MAP_BASE_OPTIONS,
    center: { lat: 25, lng: 8 },
    zoom: 2,
    mapTypeControl: false,
    styles: [
      { featureType: 'poi', stylers: [{ visibility: 'off' }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      { featureType: 'road', stylers: [{ visibility: 'off' }] },
    ],
  });

  const layer = new google.maps.Data({ map });
  const geojson = countryGeoJson();
  if (geojson) layer.addGeoJson(geojson);

  let mode = 'block';
  let selected = new Set();
  let hovered = null;

  const styleFor = (feature) => {
    const code = feature.getProperty('code');
    const on = selected.has(code);
    const hot = code === hovered;
    const color = mode === 'allow' ? ALLOW_COLOR : BLOCK_COLOR;
    return {
      clickable: true,
      fillColor: on ? color : '#7f8ea3',
      fillOpacity: on ? (hot ? 0.62 : 0.48) : (hot ? 0.34 : 0.08),
      strokeColor: on ? color : '#94a3b8',
      strokeWeight: on ? 1.6 : 0.7,
      strokeOpacity: on ? 1 : 0.6,
      zIndex: on ? 2 : 1,
    };
  };
  // Frische Funktion pro Aufruf, sonst haelt die Data-Layer den Style fuer
  // unveraendert und zeichnet nicht neu.
  const redraw = () => layer.setStyle((f) => styleFor(f));
  redraw();

  layer.addListener('click', (e) => onToggle(e.feature.getProperty('code')));
  layer.addListener('mouseover', (e) => {
    hovered = e.feature.getProperty('code');
    redraw();
    onHover?.(hovered, e.feature.getProperty('name'));
  });
  layer.addListener('mouseout', () => {
    hovered = null;
    redraw();
    onHover?.(null, null);
  });

  return {
    map,
    setMode(next) {
      const wanted = next === 'allow' ? 'allow' : 'block';
      if (wanted === mode) return; // 239 Laender neu einfaerben lohnt sich nur bei echter Aenderung
      mode = wanted;
      redraw();
    },
    setSelection(codes) {
      selected = new Set(codes);
      redraw();
    },
    /** Zoomt auf ein Land, damit man nach der Suche sieht, wo es liegt. */
    focus(code) {
      const feature = layer.getFeatureById(code);
      if (!feature) return;
      const bounds = new google.maps.LatLngBounds();
      feature.getGeometry().forEachLatLng((ll) => bounds.extend(ll));
      if (!bounds.isEmpty()) map.fitBounds(bounds, 60);
    },
    resize() {
      google.maps.event.trigger(map, 'resize');
    },
  };
}

const BASE_OPTIONS = {
  addressControl: false,
  fullscreenControl: false,
  motionTracking: false,
  motionTrackingControl: false,
  enableCloseButton: false,
  imageDateControl: false,
  showRoadLabels: true,
};

/** Interaktives Panorama zum Spielen (Bewegen erlaubt). */
export function createGamePanorama(el, view) {
  const pano = new google.maps.StreetViewPanorama(el, {
    ...BASE_OPTIONS,
    ...positionOf(view),
    pov: { heading: view?.heading ?? 0, pitch: view?.pitch ?? 0 },
    zoom: view?.zoom ?? 0,
    linksControl: true,
    clickToGo: true,
    panControl: true,
    zoomControl: true,
    scrollwheel: true,
  });
  return pano;
}

/** Nur-Ansicht-Panorama fuers Voting: umschauen ja, weglaufen nein. */
export function createViewPanorama(el, view) {
  return new google.maps.StreetViewPanorama(el, {
    ...BASE_OPTIONS,
    ...positionOf(view),
    pov: { heading: view?.heading ?? 0, pitch: view?.pitch ?? 0 },
    zoom: view?.zoom ?? 0,
    linksControl: false,
    clickToGo: false,
    disableDoubleClickZoom: true,
    panControl: true,
    zoomControl: true,
    scrollwheel: true,
  });
}

function positionOf(view) {
  if (!view) return { position: { lat: 48.8584, lng: 2.2945 } };
  if (view.pano) return { pano: view.pano };
  return { position: { lat: view.lat, lng: view.lng } };
}

/**
 * Prueft, ob es zu einer gespeicherten Ansicht ueberhaupt noch Bilder gibt,
 * und liefert eine Ansicht zurueck, die sicher etwas anzeigt.
 *
 * Hintergrund: Eine Einreichung reist nur als Panorama-ID plus Koordinaten
 * durchs Netz. Ist die ID beim Betrachter nicht (mehr) aufloesbar - Google
 * tauscht Aufnahmen aus, Nutzerfotos verschwinden -, dann bleibt das Panorama
 * einfach schwarz stehen, ohne Fehler. Deshalb erst nachfragen, und zur Not
 * ueber die Koordinaten das naechstgelegene Bild nehmen.
 */
export async function resolveView(view) {
  if (!view) throw new Error('Zu dieser Einreichung wurde keine Ansicht gespeichert.');
  const service = new google.maps.StreetViewService();
  const pack = (data, base) => ({
    pano: data.location.pano,
    lat: data.location.latLng.lat(),
    lng: data.location.latLng.lng(),
    heading: base.heading ?? 0,
    pitch: base.pitch ?? 0,
    zoom: base.zoom ?? 0,
  });

  if (view.pano) {
    try {
      return pack(await getPanoramaAt(service, { pano: view.pano }), view);
    } catch {
      /* ID nicht mehr gueltig - gleich ueber die Koordinaten weiter */
    }
  }

  if (Number.isFinite(view.lat) && Number.isFinite(view.lng)) {
    for (const radius of [50, 250, 1000]) {
      try {
        return pack(await getPanoramaAt(service, { location: { lat: view.lat, lng: view.lng }, radius }), view);
      } catch {
        /* in diesem Radius nichts - weiter */
      }
    }
  }

  throw new Error('Für diese Stelle gibt es kein Street-View-Bild mehr.');
}

/**
 * Stoesst das Neuvermessen an, bis der Container wirklich eine Groesse hat.
 *
 * Ein Panorama, das in einem versteckten oder noch nicht vermessenen Element
 * entsteht, rendert in 0x0 und bleibt danach schwarz - ein einzelnes
 * 'resize' direkt nach dem Erzeugen reicht dafuer oft nicht. Kein
 * requestAnimationFrame: in einem Hintergrund-Tab feuert das nie.
 */
export function refreshPanorama(pano, el, { tries = 24, delay = 120 } = {}) {
  if (!pano || !el) return;
  let left = tries;
  let hits = 0;
  const tick = () => {
    if (!el.isConnected) return;
    if (el.clientWidth > 0 && el.clientHeight > 0) {
      pano.setVisible(true);
      google.maps.event.trigger(pano, 'resize');
      hits++;
    }
    // Zweimal treffen: einmal sofort, einmal wenn das Layout wirklich steht.
    if (hits >= 2 || --left <= 0) return;
    setTimeout(tick, delay);
  };
  tick();
}

/**
 * Haengt einen Groessen-Waechter an den Container. Damit vermisst sich das
 * Panorama auch dann neu, wenn der Bildschirm erst spaeter sichtbar wird
 * (Bildschirmwechsel, Drehen des Handys, aufklappende Leiste).
 */
export function watchPanoramaSize(pano, el) {
  if (!pano || !el || typeof ResizeObserver !== 'function') return null;
  const observer = new ResizeObserver(() => {
    if (el.clientWidth > 0 && el.clientHeight > 0) google.maps.event.trigger(pano, 'resize');
  });
  observer.observe(el);
  return observer;
}

/** Springt ein bestehendes Panorama an eine gespeicherte Ansicht. */
export function applyView(pano, view) {
  if (!pano || !view) return;
  if (view.pano) pano.setPano(view.pano);
  else if (view.lat != null) pano.setPosition({ lat: view.lat, lng: view.lng });
  pano.setPov({ heading: view.heading ?? 0, pitch: view.pitch ?? 0 });
  pano.setZoom(view.zoom ?? 0);
}

/** Liest die aktuelle Ansicht aus - genau das wird als "Fund" gespeichert. */
export function readView(pano) {
  if (!pano) return null;
  const pos = pano.getPosition();
  const pov = pano.getPov() || { heading: 0, pitch: 0 };
  return {
    pano: pano.getPano() || null,
    lat: pos ? pos.lat() : null,
    lng: pos ? pos.lng() : null,
    heading: pov.heading || 0,
    pitch: pov.pitch || 0,
    zoom: pano.getZoom() || 0,
  };
}

/**
 * Standbild fuer Vorschau-Kacheln.
 *
 * Geholt wird ueber den eigenen Server, nicht direkt bei Google: ein auf
 * HTTP-Referrer beschraenkter Key lehnt die Bilder sonst ab, sobald jemand
 * ueber eine andere Adresse (Tunnel, WLAN-IP) spielt - dann sah ein Teil der
 * Runde nur leere Kacheln. Ueber den Server bekommen alle dasselbe Bild.
 */
export function thumbnailUrl(view, width = 400, height = 250) {
  if (!view) return '';
  if (!view.pano && !Number.isFinite(view.lat)) return '';
  const fov = Math.max(10, Math.min(120, 180 / Math.pow(2, view.zoom || 0)));
  const params = new URLSearchParams({
    w: String(width),
    h: String(height),
    heading: String(Math.round(view.heading || 0)),
    pitch: String(Math.round(view.pitch || 0)),
    fov: String(Math.round(fov)),
  });
  if (view.pano) params.set('pano', view.pano);
  else {
    params.set('lat', String(view.lat));
    params.set('lng', String(view.lng));
  }
  return `/api/streetview?${params}`;
}
