# 🌍 GeoBingo

Street-View-Schnitzeljagd für dich und deine Freunde. Ihr bekommt eine Liste mit Begriffen,
werdet an einem zufälligen Ort der Welt abgesetzt und müsst die Begriffe finden. Wer etwas
entdeckt, speichert per Knopfdruck die Street-View-Ansicht. Nach Ablauf der Zeit schaut ihr
euch alle Funde gemeinsam an, stimmt ab, ob sie zählen – und am Ende gibt es ein Ranking.

Läuft komplett auf deinem eigenen PC. Kein Server, kein Hosting, keine laufenden Kosten.

---

## 1. Voraussetzungen

* **Node.js 18 oder neuer** – https://nodejs.org (die "LTS"-Version reicht)
* Ein **Google Maps API-Key** (kostenloses Kontingent, siehe Schritt 3)

## 2. Installation

Einmalig im Projektordner:

```bash
npm install
```

## 3. Google Maps API-Key besorgen

Street View gehört Google, deshalb geht es nicht ohne Key. Der Key ist kostenlos, Google
verlangt beim Anlegen aber eine hinterlegte Zahlungsmethode.

**Was kostet das? Praktisch nichts.** Google gewährt pro Monat 10.000 kostenlose Street-View-Aufrufe
(und nochmal 10.000 für die Vorschaubilder). Ein Spieleabend mit Freunden verbraucht davon
vielleicht ein paar hundert. Erst darüber wird abgerechnet (14 $ pro 1.000 Aufrufe) – mit dem
Kontingentlimit weiter unten kann dir das aber gar nicht erst passieren.

> **Warum nicht der kostenlose Google-Embed wie bei OpenGuessr?** Der lädt Street View in einem
> `<iframe>` von google.com. Der Browser lässt uns aus Sicherheitsgründen nicht hineinschauen –
> wir könnten also nicht auslesen, wohin du dich bewegt hast und wo du gerade hinschaust. Genau
> das braucht der „📸 Merken“-Knopf. Für GeoGuessr-Klone reicht der Embed, weil man das Bild dort
> nur sehen muss; für GeoBingo geht es nicht.

1. [Google Cloud Console](https://console.cloud.google.com/) öffnen und ein Projekt anlegen.
2. Unter **APIs & Dienste → Bibliothek** diese beiden aktivieren:
   * **Maps JavaScript API** (das interaktive Street View)
   * **Street View Static API** (die Vorschaubilder im Ergebnis-Screen)
3. Unter **Anmeldedaten → Anmeldedaten erstellen → API-Schlüssel** den Key erzeugen.
4. Spiel starten (Schritt 4) und den Key auf der Startseite eintragen – er landet in
   `config.json` direkt neben dem Spiel.

Alternativ als Umgebungsvariable, dann wird `config.json` ignoriert:

```bash
set GOOGLE_MAPS_API_KEY=DEIN_KEY
```

**Wichtig – Key absichern.** Der Key ist im Browser der Mitspieler sichtbar (das lässt sich bei
Google Maps im Web nicht vermeiden). Deshalb in der Cloud Console:

* Unter **API-Einschränkungen** nur die beiden oben genannten APIs erlauben.
* Unter **Kontingente** ein Tageslimit setzen (z.B. 500 Aufrufe), dann kann selbst bei Missbrauch
  nichts Teures passieren.
* Wenn ihr über einen Tunnel spielt: entweder zusätzlich eine HTTP-Referrer-Einschränkung mit
  eurer Tunnel-Adresse setzen, oder – bei wechselnden Adressen – nur mit dem Kontingentlimit
  absichern.

## 4. Starten

**Windows:** Doppelklick auf `start.bat`

**Sonst:**

```bash
npm start
```

Danach im Browser `http://localhost:8080` öffnen. Anderer Port:

```bash
set PORT=3000
npm start
```

## 5. Mit Freunden spielen

Der Server läuft bei dir, alle anderen verbinden sich zu dir. Drei Wege, je nachdem wo deine
Freunde sitzen:

### a) Alle im selben WLAN

Beim Start zeigt der Server eine Adresse wie `http://192.168.1.42:8080` an – die geben deine
Freunde einfach im Browser ein. Beim ersten Start fragt die Windows-Firewall, ob Node.js
kommunizieren darf: **erlauben** (private Netzwerke reicht).

### b) Übers Internet – Cloudflare Tunnel (empfohlen, kostenlos)

Einmalig installieren:

```bash
winget install --id Cloudflare.cloudflared -e
```

Danach **zuerst `start.bat`**, dann **`tunnel.bat`** doppelklicken. Im Tunnel-Fenster erscheint eine
Adresse wie `https://….trycloudflare.com` – die schickst du deinen Freunden. Kein Router-Gefummel,
keine Anmeldung.

**Beide Fenster müssen offen bleiben.** Schließt du das Tunnel-Fenster, ist die Adresse sofort tot.
Bei jedem Neustart bekommst du eine neue Adresse – die alte funktioniert dann nicht mehr.

> **Solange der Tunnel läuft, kann jeder mit dem Link mitspielen** und deinen Google-Key im
> Seitenquelltext sehen. Deshalb unbedingt vorher das Kontingentlimit aus Schritt 3 setzen. Den Key
> ändern kann von außen niemand – das geht nur direkt an deinem PC.

### c) Übers Internet – ngrok

```bash
ngrok http 8080
```

Braucht einen kostenlosen Account, funktioniert sonst genauso.

> Portfreigabe im Router geht natürlich auch, ist aber unnötig fummelig und öffnet deinen
> Rechner dauerhaft nach außen. Nimm lieber den Tunnel.

## 6. Wie gespielt wird

**Lobby.** Einer erstellt das Spiel und teilt Raum-Code oder Einladungslink. Der Ersteller ist
Host und stellt alles ein:

* **Wörter** – eigene eintippen (mehrere mit Komma getrennt) und/oder per 🎲-Knopf zufällig aus
  einem kuratierten Pool ziehen. Der Pool enthält nur Dinge, die man in Street View realistisch
  finden kann, gemischt aus leichten, mittleren und schweren Begriffen. Maximal 40 Wörter.
* **Spielzeit** – 1 bis 60 Minuten.
* **Bedenkzeit pro Voting** – wie lange ihr pro Fund zum Abstimmen habt.
* **Startort** – drei Modi:
  * **🎲 Zufällig** – ihr werdet irgendwo auf der Welt abgesetzt.
  * **📍 Host wählt** – der Host sucht auf einer Weltkarte einen Ort aus, dort starten alle. Die
    blau eingefärbten Straßen haben Street View. Ein Klick sucht das nächstgelegene Panorama, zeigt
    sofort eine Vorschau und richtet die Kamera auf die angeklickte Stelle. Der gewählte Ort bleibt
    für weitere Runden gespeichert.
  * **🗺 Jeder selbst** – die Runde startet ohne Ort. Bei jedem geht sofort die große Karte auf und
    er sucht sich seinen eigenen Startpunkt. Der Timer läuft dabei schon.
* **Karte im Spiel erlaubt** – wenn an, kann jeder jederzeit die Karte öffnen (Knopf oder Taste
  `M`) und sich woanders hin bewegen, so oft er will. Ein Klick auf die Karte, und du bist dort.
  Aus = ihr müsst euch die ganze Runde zu Fuß durch Street View bewegen (deutlich härter).
* **Alle starten am gleichen Ort** – aus = jeder wird woanders abgesetzt. Nur im Zufallsmodus
  relevant.
* **Länder** – optionaler Filter, standardmäßig aus (🌍 Ganze Welt = alles wie immer):
  * **🚫 Gesperrt** – die gewählten Länder kommen nicht vor. Praktisch, wenn ihr euch in der
    Heimat zu gut auskennt: Deutschland, Schweiz und Österreich raus, der Rest der Welt bleibt.
  * **✅ Nur diese** – gespielt wird ausschließlich in den gewählten Ländern. So könnt ihr eine
    Runde komplett in einem einzigen Land spielen.

  Über **🗺 Länder auf der Karte wählen** öffnet sich eine Weltkarte: Land anklicken = aus- bzw.
  abwählen. Daneben gibt es eine Suchliste (Enter wählt den ersten Treffer, ◎ zoomt auf das Land).
  Zwischen den beiden Modi kannst du umschalten, ohne die Auswahl neu zusammenzuklicken.

  Der Filter greift überall: beim Zufalls-Startort, beim Startort des Hosts, beim Reisen über die
  Karte und beim Speichern eines Fundes. Auf allen Karten siehst du die betroffenen Länder farbig –
  rot = gesperrt, grün = erlaubt. Ohne Auswahl bleibt der Filter wirkungslos, auch wenn ein Modus
  eingestellt ist.

In beiden Kartenansichten kannst du statt zu klicken auch **Koordinaten einfügen** (in Google Maps:
Rechtsklick auf den Ort → Koordinaten anklicken zum Kopieren) – praktisch, wenn ihr eine bestimmte
Stadt spielen wollt, statt auf der Weltkarte herumzuzoomen.

**Runde.** Street View füllt das Fenster, die Wortliste schwebt als fast durchsichtige Leiste
darüber – so siehst du das ganze Bild, auch ohne die Liste einzuklappen (☰ oben links). Auch die Karte im
Spiel lässt die Liste stehen, damit du beim Aussuchen siehst, was noch fehlt. Wenn du etwas Passendes siehst,
richte die Kamera darauf aus und drücke bei dem Wort auf **📸 Merken**. Gespeichert wird die
exakte Blickrichtung – die anderen sehen später genau dein Bild. Mit **↻ Ersetzen** überschreibst
du einen Fund, mit **👁** schaust du ihn dir nochmal an, mit **✕** verwirfst du ihn.

**Voting.** Nach Ablauf der Zeit geht es automatisch weiter: Jeder Fund wird nacheinander allen
gezeigt, und alle außer dem Einreicher stimmen ab, ob er zählt. Ihr könnt euch im Panorama frei
umschauen (aber nicht weglaufen), um zu prüfen ob es wirklich passt. Sobald alle abgestimmt haben,
geht es weiter – oder wenn die Bedenkzeit abläuft.

**Ranking.** 100 Punkte pro anerkanntem Fund, plus 25 Bonuspunkte wenn er einstimmig durchgeht.
Darunter siehst du alle Einreichungen mit Vorschaubild – anklicken öffnet die Ansicht groß.

Danach entweder **Neue Wörter & nochmal** (gleiche Anzahl, frisch gezogen) oder zurück in die
Lobby.

## 7. Gut zu wissen

* **Verbindung verloren?** Kein Problem. Einfach die Seite neu laden – du landest automatisch
  wieder im laufenden Spiel, mit deinen Funden, deinen Punkten und **an der Stelle, an der du
  gerade warst**. Solange der Server läuft, geht nichts verloren.
* **Host geht raus?** Die Host-Rolle wandert automatisch zum nächsten Spieler.
* **Zu spät gekommen?** Man kann jederzeit beitreten, auch mitten in der Runde.
* Stimmt bei einem Fund niemand rechtzeitig ab, zählt er als anerkannt.
* Der Spielstand liegt nur im Arbeitsspeicher – wenn du den Server neu startest, sind Räume weg.

## 8. Wenn etwas nicht geht

| Problem | Ursache |
|---|---|
| Schwarzes Bild statt Street View, Konsole zeigt `InvalidKeyMapError` | Key falsch oder Maps JavaScript API nicht aktiviert |
| Vorschaubilder im Ergebnis kaputt | Street View Static API nicht aktiviert |
| `RefererNotAllowedMapError` | Referrer-Einschränkung passt nicht zur Adresse, unter der ihr spielt |
| „Kein Street-View-Ort gefunden“ | Google hat gerade keinen Treffer geliefert – nochmal versuchen |
| „In den gewählten Ländern wurde kein Street-View-Ort gefunden“ | Das erlaubte Land hat kaum oder gar keine Street-View-Abdeckung – ein weiteres Land dazunehmen |
| Ort direkt an einer Grenze wird dem falschen Land zugeordnet | Die Landesgrenzen sind vereinfacht (siehe unten), auf ein paar hundert Meter genau |
| Freunde im WLAN kommen nicht drauf | Windows-Firewall blockt Node.js |
| Freunde über Tunnel kommen nicht drauf | Tunnel-Fenster geschlossen, Adresse gilt nur solange es läuft |

## 9. Aufbau

```
server/
  index.js    HTTP-Server, statische Dateien, WebSockets, API-Key-Verwaltung
  game.js     Räume, Phasen, Abstimmung, Punkte  (der ganze Spielzustand)
  words.js    kuratierter Wortpool für die Zufallsauswahl
public/
  index.html        alle Screens
  css/              Styling
  js/app.js         Oberfläche und Ablauf
  js/maps.js        Street View: laden, Zufallsorte, Panoramen, Vorschaubilder
  js/countries.js   Länder-Filter: welches Land liegt an einer Koordinate
  js/net.js         WebSocket mit automatischem Reconnect
  data/             Landesgrenzen für den Länder-Filter
tools/
  build-countries.mjs   erzeugt public/data/countries.json neu
```

### Die Landesgrenzen

`public/data/countries.json` enthält 239 Länder und stammt aus
[Natural Earth](https://www.naturalearthdata.com/) (1:50 m, Public Domain). Die Datei ist
vereinfacht und auf drei Nachkommastellen gerundet – rund 1,4 MB, die der Server komprimiert
ausliefert und der Browser erst lädt, wenn wirklich ein Filter eingestellt ist. Die Grenzen sind
damit auf ein paar hundert Meter genau; direkt auf einer Grenze kann die Zuordnung danebenliegen.
Orte, die knapp im Wasser landen (Häfen, Küstenstraßen, Brücken), werden dem nächsten Land
innerhalb von ca. 5 km zugeschlagen.

Neu bauen lässt sich die Datei mit der Originaldatei
`ne_50m_admin_0_countries.geojson` aus dem
[natural-earth-vector-Repo](https://github.com/nvkelso/natural-earth-vector):

```
node tools/build-countries.mjs pfad/zu/ne_50m_admin_0_countries.geojson
```

Geprüft wird der Filter im Browser – der Server merkt sich nur die Einstellung und verteilt sie an
alle Mitspieler.
