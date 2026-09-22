# ZotFlow-Reader: Sidebar wahlweise links oder rechts — Machbarkeitsbefund

Datum: 2026-09-22. Auftrag: die bestehende Reader-Sidebar soll eine persistente Seite
bekommen (`left` | `right`), der Toggle-Button soll immer auf derselben Seite wie die
Sidebar sitzen, Rechtsklick auf den Toggle öffnet ein kleines Kontextmenü.

**Status: reine Machbarkeitsprüfung. Kein Produktivcode geschrieben, kein Plugin gebaut,
nichts deployt.** Dieses Dokument hält fest, was empirisch verifiziert wurde und welche
konkreten CSS-/DOM-Eingriffe tragen.

Alles unten wurde in einer isolierten Obsidian-1.13.7-Instanz gemessen (eigener
`--user-data-dir`, CDP auf Port 9333, Disposable-Vault `ocap-smoke`, ZotFlow 1.6.5,
Reader-Viewport 980 px). Der Produktiv-Vault `A1_Nexus` wurde ausschließlich gelesen.

---

## 1. Executive Summary

- **Der Reader gehört nicht zu diesem Repo.** Er ist ein Fork von `zotero/reader`
  (`duanxianpi/obsidian-zotero-reader`), gebaut zu einer einzelnen `reader.html`, die
  gzip+base64-kodiert als String-Ressource in ZotFlows `main.js` steckt und in ein
  `blob:`-Iframe geladen wird. Toolbar, Toggle, Sidebar und Layout liegen vollständig
  in diesem minifizierten React-Bundle.
- **Ein ZotFlow-Quellcode-Checkout existiert auf der Maschine nicht.** Installiert ist
  nur das fertige Bundle (10,77 MB) unter
  `H:\Dropbox\01_Uni\A1_Nexus\.obsidian\plugins\zotflow\`.
- **Die Änderung ist von außen machbar**, ohne ZotFlow-Quellcode und ohne Binary-Patch:
  das Reader-Iframe ist same-origin (`app://obsidian.md`), sein Dokument ist voll
  zugänglich. Ein Companion-Plugin kann die Seite per CSS-Klasse + zwei DOM-Moves
  umschalten.
- **Der Flip existiert im Reader bereits als RTL-Spiegel**, inklusive Icon-Spiegelung
  (`[dir=rtl] .toolbar .sidebar-toggle { transform: scaleX(-1) }`). Er ist nur an die
  Textrichtung gekoppelt und deshalb nicht direkt schaltbar. Das Layout ist durchgängig
  in logischen Properties geschrieben — die Seite ist *nicht* hart verdrahtet.
- **Zwei Fallen, die eine reine Vermutung übersehen hätte** (beide gemessen, s. u.):
  der Reader hat **zwei** Split-Views (`.split-view` per Klasse *und* `#split-view` per
  ID — nur die ID-Variante trägt das PDF-Iframe), und die **Resizer-Mathematik ist auf
  eine linke Sidebar hartcodiert** (Breite = `clientX` ab linkem Rand). Letzteres ist
  die einzige Stelle, die CSS allein nicht lösen kann.
- **Verifiziert: 9/9 Layout-Zustände, 4/4 Resizer-Drags rechts, Zoom/Scroll/Seitenlauf
  unverändert, kein doppeltes DOM, Rückwechsel trifft exakt die Baseline.**

---

## 2. Tatsächlich vorgefundene Architektur

| | |
|---|---|
| Plugin | ZotFlow 1.6.5, Xianpi Duan, AGPL-3.0, Plugin-ID `zotflow` |
| Reader-Herkunft | `duanxianpi/obsidian-zotero-reader` (Fork von `zotero/reader`) |
| Auslieferung | `reader.html` (4 979 434 B entpackt) als gzip+base64-String in `main.js`, Key `case"./reader.html"` |
| Einbettung | `blob:app://obsidian.md/<uuid>` in einem Iframe der View `zotflow-local-zotero-reader-view` |
| Zugriff von außen | **same-origin**, `iframe.contentDocument` lesbar und schreibbar (empirisch bestätigt) |
| Reader-Instanz | `iframeWindow._reader` — live, mit `toggleSidebar()`, `setSidebarWidth()`, `setSidebarView()`, `_state` |

DAP greift heute schon lesend auf dieses Iframe zu (`src/utils/zotflowReader.ts`,
Level 3). Der Zugriffsweg ist also nicht neu, nur die Richtung wäre es.

### Relevante DOM-Struktur (gemessen)

```
.toolbar
├── .start   → #sidebarToggle, .divider, #zoomOut, #zoomIn, #zoomAuto,
│              #readingMode, .divider, #navigateBack, .divider,
│              #previous, #next, #pageNumber, #numPages
├── .center.tools → highlight, underline, note, text, area, ink, .divider, Farbwahl
└── .end     → .custom-sections, #appearance ("Aa"), .find (Lupe)

#sidebarContainer   (nur vorhanden, wenn die Sidebar offen ist — wird un-/gemountet)
├── .sidebar-toolbar → "Show Thumbnails", "Show Annotations", "Show Outline"
└── .sidebar-content
.sidebar-resizer     (eigener Handle, getrennt vom .split-view-resizer)
```

**Korrektur zur Auftragsbeschreibung:** die reale visuelle Reihenfolge der rechten
Gruppe ist **„Aa" → Lupe** (Appearance bei x=911, Find bei x=948), nicht „Lupe → Aa".
Die Lupe ist heute das äußerste rechte Element. Die Anforderung „Toggle ganz außen
rechts" ist davon unberührt und wurde so umgesetzt/gemessen; die bestehende Reihenfolge
von Aa und Lupe wurde nicht angetastet.

### Relevante Reader-CSS (aus `reader.html` extrahiert)

```css
#sidebarContainer { position:absolute; top:41px; bottom:0;
                    width:var(--sidebar-width); z-index:10 }
[dir=ltr] #sidebarContainer { border-right:var(--material-panedivider);
                              left:calc(var(--sidebar-width)*-1) }
[dir=rtl] #sidebarContainer { border-left:var(--material-panedivider);
                              right:calc(var(--sidebar-width)*-1) }
.sidebar-open #split-view, body.sidebar-open .split-view {
                              inset-inline-start:var(--sidebar-width) }
.sidebar-resizer { inset-inline-start:var(--sidebar-width) }
[dir=rtl] .toolbar .sidebar-toggle { transform:scaleX(-1) }
```

---

## 3. Der verifizierte Eingriff

### 3.1 CSS (in das Iframe-Dokument injiziert)

```css
body.zf-sidebar-right #sidebarContainer {
  left: auto;
  right: calc(var(--sidebar-width) * -1);
  border-right: none;
  border-left: var(--material-panedivider);
}
body.zf-sidebar-right.sidebar-open #sidebarContainer { right: 0; left: auto; }

/* BEIDE Split-Views: der Reader liefert eine klassenbasierte und eine
   ID-basierte Variante aus, und nur die ID-basierte trägt das PDF-Iframe. */
body.zf-sidebar-right.sidebar-open .split-view,
body.zf-sidebar-right.sidebar-open #split-view {
  inset-inline-start: 0;
  inset-inline-end: var(--sidebar-width);
}

body.zf-sidebar-right .sidebar-resizer {
  inset-inline-start: auto;
  inset-inline-end: var(--sidebar-width);
}

/* Icon-Spiegelung — dieselbe Technik, die der Reader für RTL schon benutzt */
body.zf-sidebar-right .toolbar .sidebar-toggle { transform: scaleX(-1); }

/* keine tote Lücke, wo der Button saß */
body.zf-sidebar-right .toolbar .start > .divider.zf-orphan-divider { display: none; }
```

### 3.2 DOM (zwei Moves, reversibel)

```js
// nach rechts
const next = btn.nextElementSibling;
if (next && next.classList.contains('divider')) next.classList.add('zf-orphan-divider');
toolbarEnd.appendChild(btn);            // äußerstes Element der rechten Gruppe
doc.body.classList.add('zf-sidebar-right');

// zurück nach links
toolbarStart.insertBefore(btn, toolbarStart.firstChild);
[...toolbarStart.querySelectorAll('.zf-orphan-divider')]
  .forEach(e => e.classList.remove('zf-orphan-divider'));
doc.body.classList.remove('zf-sidebar-right');
```

### 3.3 Resizer-Override (die eine Stelle, die JS braucht)

Der Reader berechnet die Sidebar-Breite aus der Pointer-Position **ab dem linken
Viewport-Rand** — hartcodiert für eine linke Sidebar. Gemessen bei Viewport 980:

| Drop-X | resultierende Breite | `clientX`-Modell | korrektes Rechts-Modell (`vw − x`) |
|---|---|---|---|
| 300 | 300 | 300 ✓ | 680 |
| 400 | 400 | 400 ✓ | 580 |
| 580 | 490 (auf 50 % geklemmt) | 580 | 400 |
| 700 | 240 (verworfen) | 700 | 280 |

Der Override fängt den Drag ab und führt ihn über die **reader-eigene** State-API,
damit React die Breite nicht zurücksetzt:

```js
doc.addEventListener('pointerdown', e => {
  if (!doc.body.classList.contains('zf-sidebar-right')) return;
  const rz = e.target.closest && e.target.closest('.sidebar-resizer');
  if (!rz) return;
  e.stopPropagation(); e.preventDefault();
  dragging = true;
  rz.setPointerCapture(e.pointerId);        // sonst gehen die Moves ans PDF-Iframe
}, true);

doc.addEventListener('pointermove', e => {
  if (!dragging) return;
  const w = Math.min(win.innerWidth * 0.5, Math.max(180, win.innerWidth - e.clientX));
  win._reader.setSidebarWidth(w);           // NICHT die CSS-Variable direkt setzen
}, true);
```

Zwei Details, die jeweils einen Fehlversuch gekostet haben und die nicht weggelassen
werden dürfen:

1. **`setPointerCapture`** — ohne sie verliert der Drag die Events, sobald der Zeiger
   das innere PDF-Iframe überstreicht. Rechtsgerichtete Drags funktionierten, linke
   nicht.
2. **`_reader.setSidebarWidth()` statt `--sidebar-width` direkt** — die CSS-Variable
   gehört dem React-State des Readers und wird beim nächsten Re-Render überschrieben.
   Über die API bleibt die Breite stabil und überlebt Schließen/Öffnen.

### 3.4 Kontextmenü

Ein `contextmenu`-Listener in der Capture-Phase auf `.sidebar-toggle` im Iframe-Dokument
genügt. Gemessen: er feuert bei Rechtsklick (2/2), liefert brauchbare Iframe-lokale
Koordinaten, schaltet die Sidebar **nicht** um — und der normale Linksklick toggelt
weiterhin unbeeinflusst (3/3), ohne das Menü auszulösen. Für die Obsidian-`Menu`
müssen die Koordinaten um das Iframe-Offset versetzt werden
(`iframe.getBoundingClientRect()` + `e.clientX/Y`).

---

## 4. Messergebnisse

### 4.1 Zustandsmatrix (Viewport 980 px, Sidebar 240 px)

| Test | offen | Seite | Sidebar x/w | Dokument x/w | Toggle x | Parent | gespiegelt | Toggles | Sidebars |
|---|---|---|---|---|---|---|---|---|---|
| T1 links offen (Baseline) | ja | left | 0/240 | 240/740 | 8 | `.start` | nein | 1 | 1 |
| T2 links geschlossen | nein | left | — | 0/980 | 8 | `.start` | nein | 1 | 0 |
| T3 links wieder offen | ja | left | 0/240 | 240/740 | 8 | `.start` | nein | 1 | 1 |
| T4 rechts offen | ja | right | 740/240 | 0/740 | 948 | `.end` | **ja** | 1 | 1 |
| T5 rechts geschlossen | nein | right | — | 0/980 | 948 | `.end` | ja | 1 | 0 |
| T6 rechts wieder offen | ja | right | 740/240 | 0/740 | 948 | `.end` | ja | 1 | 1 |
| T7 rechts, Thumbnails | ja | right | 740/240 | 0/740 | 948 | `.end` | ja | 1 | 1 |
| T8 rechts, Outline | ja | right | 740/240 | 0/740 | 948 | `.end` | ja | 1 | 1 |
| T9 zurück nach links | ja | left | 0/240 | 240/740 | 8 | `.start` | nein | 1 | 1 |

T9 trifft T1 exakt. Kein doppelter Toggle, kein doppeltes Sidebar-DOM in keinem Zustand.
`.start` beginnt im Rechts-Modus sichtbar mit „Zoom Out" bei x=8 — keine tote Lücke.

### 4.2 Resizer rechts, mit Override (Viewport 980)

| Drag | resultierende Breite | erwartet | |
|---|---|---|---|
| 740 → 680 | 300 | 300 | OK |
| 680 → 600 | 380 | 380 | OK |
| 600 → 760 | 220 | 220 | OK |
| 760 → 540 | 440 | 440 | OK |

4/4. Breite überlebt einen Schließen/Öffnen-Zyklus.

### 4.3 Zoom, Scroll, Seitenlauf

| Seite | Seitenbreite Basis → Zoom+ → Zoom− | Scroll | PDF-Iframe x/w |
|---|---|---|---|
| left | 938 → 1056 → 938 | +600 px wirksam | 440/540 |
| right | 938 → 1056 → 938 | +600 px wirksam | 0/540 |

Identisches Verhalten auf beiden Seiten. Seitenlauf („Next Page") ebenfalls auf beiden
Seiten wirksam (185→186 bzw. 186→187).

### 4.4 Sidebar-Inhalte

Thumbnails / Annotations / Outline schalten im Rechts-Modus unverändert um; der aktive
Tab wird korrekt geführt. Die Annotationsliste rendert vollständig.

---

## 5. Offene Punkte für eine Umsetzung

1. **Pro Reader-Instanz anwenden.** Jeder Reader bekommt ein eigenes Iframe; ein neu
   geöffnetes PDF startet ungepatcht (gemessen). Ein Plugin muss die Anwendung an
   Leaf-/Layout-Ereignisse hängen und idempotent halten. Re-Anwendung auf eine zweite
   Instanz wurde verifiziert und beeinflusst die erste nicht.
2. **`#sidebarContainer` wird un-/gemountet**, nicht versteckt. Kein Caching des
   Elements; alle Regeln müssen über `body`-Klasse + Selektoren laufen (tun sie).
3. **Persistenz.** Die Seite ist eine User-UI-Präferenz und gehört reader-/pluginweit
   gespeichert, nicht pro PDF. In ZotFlows `data.json` kann ein Fremdplugin nicht sauber
   schreiben; ein Companion-Plugin nutzt seine eigene `data.json`. DAPs Settings sind
   dafür der falsche Ort.
4. **Versionskopplung.** Der Eingriff hängt an den Zotero-Reader-DOM-Namen
   (`#sidebarToggle`, `#sidebarContainer`, `#split-view`, `.toolbar .start/.end`,
   `.sidebar-resizer`) und an `window._reader`. Das sind Upstream-Konstanten, aber keine
   zugesagte API — dieselbe De-facto-Contract-Klasse, die schon in
   `2026-09-18-zotflow-annotation-integration.md` benannt ist. Jede Probe muss
   `typeof`-geprüft sein und bei Abweichung folgenlos aussteigen (Sidebar bleibt links).
5. **Nicht geprüft:** EPUB-/Snapshot-Reader (nur PDF getestet), RTL-Oberfläche in
   Kombination mit `zf-sidebar-right` (die Spiegelung würde sich aufheben),
   Mobile/schmale Layouts, Kontextpane (`context-pane-toggle`) auf der rechten Seite.

---

## 6. Projektbezug

Die bestehende Linie in `DECISIONS.md` ist: DAP liest ZotFlow read-only und schreibt nie
hinein. Dieser Befund ändert daran nichts — der Eingriff gehört in ein eigenes
Companion-Plugin, nicht in DAP. Wird er umgesetzt, ist das eine eigene Codebasis mit
eigenem Repo und eigener Entscheidung; dieses Dokument ist die Vorarbeit dazu, keine
Zusage.

## 7. Reproduktion

Skripte liegen im Session-Scratchpad (nicht im Repo): `cdp.mjs` (CDP-Treiber über Node-24
`WebSocket`), `flip2.mjs` (CSS + DOM-Moves), `matrix.mjs` (Zustandsmatrix),
`resize-capture.mjs` (Resizer-Override), `ctxmenu.mjs` (Rechtsklick-Trennung),
`zoom2.mjs` (Zoom/Scroll), `reopen.mjs` (Mehrfachinstanzen).

Aufbau: Obsidian mit eigenem `--user-data-dir` und `--remote-debugging-port=9333` auf
`ocap-smoke` starten, Restricted Mode per `app.plugins.setEnable(true)` lösen, PDF in
`zotflow-local-zotero-reader-view` öffnen.
