// Kuratierter Wortpool fuer den "Zufalls-Woerter"-Button.
// Alle Begriffe sind so gewaehlt, dass man sie in Google Street View
// realistisch finden kann. difficulty: 1 = leicht, 2 = mittel, 3 = schwer.

export const WORD_POOL = [
  // --- Strasse & Verkehr ---
  { text: 'Ampel', difficulty: 1 },
  { text: 'Zebrastreifen', difficulty: 1 },
  { text: 'Stoppschild', difficulty: 1 },
  { text: 'Kreisverkehr', difficulty: 1 },
  { text: 'Bushaltestelle', difficulty: 1 },
  { text: 'Tankstelle', difficulty: 1 },
  { text: 'Baustelle', difficulty: 1 },
  { text: 'Bruecke', difficulty: 1 },
  { text: 'Tunnel', difficulty: 2 },
  { text: 'Bahnuebergang', difficulty: 2 },
  { text: 'Sackgassen-Schild', difficulty: 2 },
  { text: 'Tempolimit-Schild', difficulty: 1 },
  { text: 'Parkplatz', difficulty: 1 },
  { text: 'Parkuhr', difficulty: 2 },
  { text: 'Strassenlaterne', difficulty: 1 },
  { text: 'Leitplanke', difficulty: 1 },
  { text: 'Verkehrsspiegel', difficulty: 2 },
  { text: 'Mautstation', difficulty: 3 },
  { text: 'Autobahnkreuz', difficulty: 3 },
  { text: 'Schlagloch', difficulty: 2 },
  { text: 'Fussgaengerbruecke', difficulty: 2 },
  { text: 'Wegweiser mit drei Zielen', difficulty: 2 },

  // --- Fahrzeuge ---
  { text: 'Fahrrad', difficulty: 1 },
  { text: 'Motorrad', difficulty: 1 },
  { text: 'LKW', difficulty: 1 },
  { text: 'Bus', difficulty: 1 },
  { text: 'Wohnwagen', difficulty: 2 },
  { text: 'Traktor', difficulty: 2 },
  { text: 'Polizeiauto', difficulty: 2 },
  { text: 'Feuerwehrauto', difficulty: 3 },
  { text: 'Krankenwagen', difficulty: 3 },
  { text: 'Muellwagen', difficulty: 3 },
  { text: 'Taxi', difficulty: 2 },
  { text: 'Strassenbahn', difficulty: 2 },
  { text: 'Zug', difficulty: 3 },
  { text: 'Boot', difficulty: 2 },
  { text: 'Segelboot', difficulty: 3 },
  { text: 'Flugzeug am Himmel', difficulty: 3 },
  { text: 'Hubschrauber', difficulty: 3 },
  { text: 'Cabrio', difficulty: 2 },
  { text: 'Oldtimer', difficulty: 3 },
  { text: 'Rotes Auto', difficulty: 1 },
  { text: 'Auto mit offener Tuer', difficulty: 3 },
  { text: 'Abgeschlepptes Auto', difficulty: 3 },
  { text: 'Tuk-Tuk oder Rikscha', difficulty: 3 },
  { text: 'Anhaenger', difficulty: 1 },
  { text: 'Bagger', difficulty: 2 },
  { text: 'Kran', difficulty: 2 },

  // --- Gebaeude & Orte ---
  { text: 'Kirche', difficulty: 1 },
  { text: 'Kirchturm mit Uhr', difficulty: 2 },
  { text: 'Moschee', difficulty: 3 },
  { text: 'Tempel', difficulty: 3 },
  { text: 'Friedhof', difficulty: 2 },
  { text: 'Schule', difficulty: 2 },
  { text: 'Krankenhaus', difficulty: 3 },
  { text: 'Supermarkt', difficulty: 1 },
  { text: 'Baeckerei', difficulty: 2 },
  { text: 'Restaurant', difficulty: 1 },
  { text: 'Hotel', difficulty: 2 },
  { text: 'Bank oder Geldautomat', difficulty: 2 },
  { text: 'Apotheke', difficulty: 2 },
  { text: 'Friseur', difficulty: 2 },
  { text: 'Autowerkstatt', difficulty: 2 },
  { text: 'Waschanlage', difficulty: 3 },
  { text: 'Bahnhof', difficulty: 2 },
  { text: 'Flughafen', difficulty: 3 },
  { text: 'Burg oder Schloss', difficulty: 3 },
  { text: 'Leuchtturm', difficulty: 3 },
  { text: 'Windmuehle', difficulty: 3 },
  { text: 'Hochhaus mit ueber 10 Stockwerken', difficulty: 2 },
  { text: 'Haus mit rotem Dach', difficulty: 1 },
  { text: 'Verlassenes Gebaeude', difficulty: 2 },
  { text: 'Gewaechshaus', difficulty: 3 },
  { text: 'Scheune', difficulty: 2 },
  { text: 'Garage', difficulty: 1 },
  { text: 'Balkon mit Pflanzen', difficulty: 1 },
  { text: 'Solaranlage auf dem Dach', difficulty: 2 },
  { text: 'Satellitenschuessel', difficulty: 1 },
  { text: 'Wandmalerei oder Graffiti', difficulty: 1 },
  { text: 'Statue oder Denkmal', difficulty: 2 },
  { text: 'Brunnen', difficulty: 2 },

  // --- Natur ---
  { text: 'Berg im Hintergrund', difficulty: 1 },
  { text: 'Fluss', difficulty: 1 },
  { text: 'See', difficulty: 2 },
  { text: 'Strand', difficulty: 2 },
  { text: 'Wasserfall', difficulty: 3 },
  { text: 'Palme', difficulty: 2 },
  { text: 'Kaktus', difficulty: 3 },
  { text: 'Nadelwald', difficulty: 1 },
  { text: 'Umgekippter Baum', difficulty: 3 },
  { text: 'Bluehender Baum', difficulty: 2 },
  { text: 'Weinberg', difficulty: 3 },
  { text: 'Feld mit Heuballen', difficulty: 2 },
  { text: 'Schnee', difficulty: 2 },
  { text: 'Wolkenloser Himmel', difficulty: 1 },
  { text: 'Regenwolken', difficulty: 2 },
  { text: 'Sonnenuntergang', difficulty: 3 },
  { text: 'Nebel', difficulty: 3 },
  { text: 'Pfuetze', difficulty: 2 },
  { text: 'Blumenbeet', difficulty: 1 },
  { text: 'Hecke', difficulty: 1 },
  { text: 'Sanddüne', difficulty: 3 },

  // --- Tiere ---
  { text: 'Hund', difficulty: 2 },
  { text: 'Katze', difficulty: 3 },
  { text: 'Kuh', difficulty: 2 },
  { text: 'Pferd', difficulty: 2 },
  { text: 'Schaf', difficulty: 2 },
  { text: 'Vogel', difficulty: 2 },
  { text: 'Vogelschwarm', difficulty: 3 },
  { text: 'Huhn', difficulty: 3 },
  { text: 'Ziege', difficulty: 3 },
  { text: 'Esel', difficulty: 3 },
  { text: 'Kamel', difficulty: 3 },
  { text: 'Affe', difficulty: 3 },
  { text: 'Strassenhund', difficulty: 3 },

  // --- Menschen ---
  { text: 'Person auf einem Fahrrad', difficulty: 2 },
  { text: 'Person mit Hund', difficulty: 2 },
  { text: 'Kind', difficulty: 2 },
  { text: 'Person mit Regenschirm', difficulty: 3 },
  { text: 'Jemand der winkt', difficulty: 3 },
  { text: 'Bauarbeiter', difficulty: 2 },
  { text: 'Polizist', difficulty: 3 },
  { text: 'Jogger', difficulty: 3 },
  { text: 'Gruppe von mehr als 5 Leuten', difficulty: 2 },
  { text: 'Person in kurzer Hose', difficulty: 2 },
  { text: 'Strassenmusiker', difficulty: 3 },
  { text: 'Kinderwagen', difficulty: 3 },

  // --- Objekte & Details ---
  { text: 'Hydrant', difficulty: 1 },
  { text: 'Muelltonne', difficulty: 1 },
  { text: 'Sitzbank', difficulty: 1 },
  { text: 'Briefkasten', difficulty: 2 },
  { text: 'Telefonzelle', difficulty: 3 },
  { text: 'Werbeplakat', difficulty: 1 },
  { text: 'Flagge', difficulty: 2 },
  { text: 'Waescheleine', difficulty: 3 },
  { text: 'Sonnenschirm', difficulty: 2 },
  { text: 'Marktstand', difficulty: 3 },
  { text: 'Baustellenkegel', difficulty: 1 },
  { text: 'Zaun aus Holz', difficulty: 1 },
  { text: 'Stromleitung', difficulty: 1 },
  { text: 'Hochspannungsmast', difficulty: 2 },
  { text: 'Windrad', difficulty: 2 },
  { text: 'Schild in kyrillischer Schrift', difficulty: 3 },
  { text: 'Schild auf Englisch', difficulty: 1 },
  { text: 'Hausnummer', difficulty: 1 },
  { text: 'Container', difficulty: 2 },
  { text: 'Gully', difficulty: 1 },
  { text: 'Verkehrsschild mit Tier', difficulty: 3 },

  // --- Freizeit ---
  { text: 'Spielplatz', difficulty: 2 },
  { text: 'Fussballtor', difficulty: 2 },
  { text: 'Basketballkorb', difficulty: 2 },
  { text: 'Tennisplatz', difficulty: 3 },
  { text: 'Golfplatz', difficulty: 3 },
  { text: 'Schwimmbad oder Pool', difficulty: 3 },
  { text: 'Skatepark', difficulty: 3 },
  { text: 'Riesenrad', difficulty: 3 },
  { text: 'Trampolin im Garten', difficulty: 3 },
  { text: 'Grillplatz', difficulty: 3 },
  { text: 'Campingplatz', difficulty: 3 },
  { text: 'Zelt', difficulty: 3 },

  // --- Meta / Kurios ---
  { text: 'Schatten des Google-Autos', difficulty: 2 },
  { text: 'Verpixeltes Gesicht', difficulty: 3 },
  { text: 'Glitch im Street View Bild', difficulty: 3 },
  { text: 'Google-Auto im Spiegel', difficulty: 3 },
  { text: 'Regenbogen', difficulty: 3 },
];

/**
 * Zieht `count` zufaellige, eindeutige Woerter aus dem Pool.
 * Die Mischung ist bewusst leicht-lastig, damit eine Runde spielbar bleibt:
 * ca. 45% leicht, 40% mittel, 15% schwer.
 */
export function drawRandomWords(count, exclude = []) {
  const taken = new Set(exclude.map((w) => normalize(w)));
  const available = WORD_POOL.filter((w) => !taken.has(normalize(w.text)));

  const buckets = {
    1: shuffle(available.filter((w) => w.difficulty === 1)),
    2: shuffle(available.filter((w) => w.difficulty === 2)),
    3: shuffle(available.filter((w) => w.difficulty === 3)),
  };

  const quota = [
    Math.round(count * 0.45),
    Math.round(count * 0.4),
    count, // Rest wird mit schweren Woertern aufgefuellt
  ];

  const picked = [];
  const order = [1, 2, 3];
  for (let i = 0; i < order.length; i++) {
    const level = order[i];
    while (picked.length < Math.min(count, quota[i]) && buckets[level].length) {
      picked.push(buckets[level].pop());
    }
  }

  // Falls ein Schwierigkeitsgrad leer war: mit allem auffuellen was uebrig ist.
  const rest = shuffle([...buckets[1], ...buckets[2], ...buckets[3]]);
  while (picked.length < count && rest.length) picked.push(rest.pop());

  return shuffle(picked).map((w) => w.text);
}

function normalize(text) {
  return String(text).trim().toLowerCase();
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
