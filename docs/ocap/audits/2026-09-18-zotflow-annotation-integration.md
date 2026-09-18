# ZotFlow-Annotationen als Dynamic-Action-Panel-Tools — Integrations-Audit

Datum: 2026-09-18. Stand: DAP `3c6408c` (Plugin-ID `dynamic-action-panel`, Settings v5), ZotFlow **1.6.5**. Read-only-Audit; **nichts implementiert**. Alle Zeilenangaben beziehen sich auf den ZotFlow-Quellstand des Release-Tags `1.6.5` (Commit `fe93957`, Reader-Submodul `duanxianpi/obsidian-zotero-reader` @ `c971316`) bzw. auf den DAP-Stand `3c6408c`. Tragende Aussagen wurden zusätzlich im **installierten** Bundle und **empirisch** in einer isolierten Obsidian-1.13.7-Instanz (scratch `--user-data-dir`, Disposable-Vault `ocap-smoke`, CDP) verifiziert; der Produktiv-Vault wurde nur gelesen.

Pfadkürzel: `ZF/` = ZotFlow `src/`, `RD/` = Reader-Submodul `src/`, `DAP/` = dieses Repo `src/`.

Review-Stand: unabhängig adversarial gegen Code und Messdaten reviewt; eingearbeitete Korrekturen: (1) der Vault hat 7 lokale Source Notes, Auto-Erstellung ist aktiv — der Embed-Payload ist der Regelfall, nicht das Reader-Global; (2) `#page=` muss `pageIndex+1` tragen, nicht `pageLabel`; (3) Bereits-offen-Fall läuft generisch über `view.file.path`; (4) `setEphemeralState` kann werfen (T12); (5) `application/zotflow-citation`, `#annotation=`, `obsidian://zotflow` sind de-facto-, keine dokumentierten Contracts. Produktiv-Vault: die Test-Sidecar hatte vor und nach allen Läufen denselben SHA-256 (`B30E8896…`); ihre mtime änderte sich während des Fensters durch die laufende produktive Obsidian-Instanz, nicht durch die Audit-Skripte (alle zeigen auf `ocap-smoke`).

## 1. Executive Summary

- **Identität einer lokalen Annotation = `(Vault-Pfad des PDF, 8-stellige Annotation-ID)`.** Die ID wird vom (Zotero-)Reader erzeugt (`RD/common/annotation-manager.js:306-317`, Alphabet `23456789ABCDEFGHIJKLMNPQRSTUVWXYZ`), liegt persistent in der Sidecar-Datei `<basename>.zf.json` und überlebt Edit, Reload, Rewrite, Rename des PDFs. Für Zotero-Library-Annotationen ist die Identität `(libraryID, annotationKey)`.
- **Die `.zf.json` ist Speicher, nicht Schlüssel.** Sie ist der durable Store lokaler Annotationen (Schema `{version:1, annotations:[…]}`), enthält keinen Rückverweis auf das PDF und wird nur über den PDF-Pfad gefunden. DAP muss sie in v1 **weder lesen noch adressieren**: das Wiederöffnen läuft über einen Link, den ZotFlow selbst auflöst.
- **Wiederöffnen (lokal) ist ein Obsidian-Link-Contract, kein API-Aufruf:** `[[<pdf>#page=<label>#annotation=<encodeURIComponent(JSON.stringify({annotationID}))>]]` — exakt das Format, das ZotFlows eigene Source-Note-Templates ausgeben (`ZF/worker/services/local-template.ts:29,80-85`). `app.workspace.openLinkText(pdf + subpath)` bzw. `leaf.openFile(file, {eState:{subpath}})` selektiert und zentriert die Annotation (**empirisch bestätigt**, Abschnitt 7). Ein zusätzliches `pageIndex` im JSON ergibt automatisch den Seiten-Fallback, wenn die ID nicht mehr existiert (**empirisch bestätigt**).
- **Wiederöffnen (Library):** öffentlicher Protocol-Handler `obsidian://zotflow?type=open-annotation&libraryID=<n>&key=<key>` (`ZF/main.ts:220-223,736-763`). DAPs bestehende `url`-Action akzeptiert `obsidian://` bereits (`DAP/services/UrlService.ts:53,65-72`) — **null Codeänderung**.
- **Drag-Payload ist das Nadelöhr.** ZotFlow setzt beim Annotation-Drag nur `text/plain` und — **ausschließlich für Library-Attachments** — `application/zotflow-citation` (JSON mit `libraryID`, `parentItem`, Annotation-`id`, `pageLabel`, `text`, …) (`ZF/ui/reader/bridge.ts:285-340`). Für **lokale PDFs** ist `text/plain` entweder `![[<SourceNote>#^<id>]]` (wenn ZotFlow für das PDF eine lokale Source Note kennt) oder **ein einzelnes Leerzeichen**. In diesem Vault haben 7 der 8 annotierten PDFs eine Source Note (`A2_Bib/<…>/Annotation/@<basename>.md`, Auto-Erstellung im installierten Bundle **aktiv**); das im Test benutzte Bieker-Westerholt-PDF ist die Ausnahme ohne Note — dort ist der Payload empirisch leer (`types: ["text/plain"]`, Daten `" "`). Das Zitat selbst kommt nie an.
- **Lokale Erkennung hat zwei Wege:** (a) **Level 1, der Regelfall hier:** `![[<note>#^<id>]]` → Annotation-ID + Source Note → PDF-Pfad aus deren Frontmatter `zotflow-local-attachment`; (b) **Level 3, Fallback und Metadaten-Quelle:** das Reader-Iframe ist ein `blob:`-Frame mit Origin `app://obsidian.md` (empirisch), sein Fenster hält `window._draggingAnnotationIDs` (Upstream-Zotero-Code, `RD/common/reader.js:2889`) und den Annotation-State (Text, Seite, Typ für das Label); der Leaf liefert `view.getState().file`. Level 3 bleibt auf eine Adapter-Datei begrenzt, mit Konsistenz-Guard, und ist für PDFs ohne Note (z. B. vor dem ersten Save) der einzige Weg.
- **Empfohlene v1:** bestehende `file`-Action um ein **optionales, generisches `subpath`** erweitern (Obsidian-Subpath, nichts ZotFlow-Spezifisches im Persistenzmodell); Capture-Adapter für Drop; `url`-Action für Library-Annotationen. **Kein neuer Tool-Typ, kein Settings-Bump, kein `formatVersion`-Bump.** Ältere DAP-Builds lesen so ein Template weiterhin (sie verwerfen nur `subpath` → „PDF öffnen“).
- **Contract-Status, ehrlich benannt:** `#annotation=<json>`, `application/zotflow-citation` und `obsidian://zotflow?type=…` stehen in keiner ZotFlow-Doku (README: 0 Treffer). Es sind Quellcode-Konstanten, die ZotFlow selbst in Nutzer-Notizen schreibt bzw. selbst konsumiert — **de-facto-Contracts**, keine veröffentlichte API. `View.setEphemeralState` dagegen ist offizielle Obsidian-API (`obsidian.d.ts:7669`, `@public`).

## 2. ZotFlow Version / Installation

| | |
|---|---|
| Plugin-ID / Name | `zotflow` / ZotFlow |
| Version | 1.6.5 (`manifest.json`, minAppVersion 1.13.4), Autor Xianpi Duan, AGPL-3.0 |
| Installationspfad | `H:\Dropbox\01_Uni\A1_Nexus\.obsidian\plugins\zotflow\` |
| Dateien | `main.js` (10,77 MB, esbuild-Bundle, minifiziert; Reader als gzip+base64-Ressource `./reader.html` eingebettet, `ZF/bundle-assets/inline-assets.ts:36-160`), `styles.css`, `manifest.json`, `data.json` (Settings; Credentials liegen in SecretStorage, `ZF/utils/credentials.ts`), mehrere `*_BEFORE_*`/`*_PATCHED_*`-Backups |
| Source | öffentlich: `github.com/duanxianpi/zotflow` (Tag `1.6.5`), Reader-Submodul `duanxianpi/obsidian-zotero-reader` (Fork von `zotero/reader`) |
| **Installierte `main.js` ist gepatcht** | Byte-Diff gegen `main_BEFORE_SIDECAR_ANNOTATION_2026-09-13.js`: genau **eine** Stelle (16 Bytes) — die Main-Thread-Kopie von `getLocalSidecarPath` schreibt `${dirPart}${folderPart}${basename}.zf.json` statt Stock `${folderPart}${dirPart}…`. Effekt: Sidecar liegt bei `<PDF-Ordner>/Annotation/<basename>.zf.json` (so auf Platte), Stock 1.6.5 würde `Annotation/<PDF-Ordner>/<basename>.zf.json` verwenden. Die Worker-Kopie ist ungepatcht (Template-Preview-Mismatch, für DAP irrelevant). Die Backup-Datei `main_PATCHED_DISABLE_AUTO_SOURCE_NOTE_…` (10 774 197 B) ist **nicht** die laufende Version — die Auto-Erstellung lokaler Source Notes ist aktiv (`ZF/worker/services/local-note.ts:361-383`, Bundle `~21136`). |
| Relevante Settings (`data.json`) | `localSidecarFolder: "Annotation"`, `localSourceNotePathTemplate: "{{directory}}/Annotation/@{{basename}}"`, `overwriteViewer: true` (Default), `useZoteroStorage: false`, `autoSync: false`, `linkedAttachmentBaseDir` gesetzt, keine Zotero-Library aktiv (Tree-View meldet „API Key is missing“) |
| Reale Daten | 9 `Annotation/`-Ordner unter `A2_Bib/…`, 8 davon mit `<basename>.zf.json`, **7 mit Source Note `@<basename>.md`** (Frontmatter `zotflow-local-attachment: "[[…pdf]]"`, Callout-Links `[[pdf#page=<label>#annotation=%7B%22annotationID%22…%7D|…]]`, Block-IDs `^<id>`); das Bieker-Westerholt-PDF hat Sidecar, aber keine Note; 38 PDFs. Weitere `.zf.json` liegen als Fixtures des Nutzer-Plugins `nexus-annotation-router` unter `02_System/…`. |

## 3. Annotation Data Model

Typ `AnnotationJSON` (`ZF/types/zotero-reader.d.ts:167-198`), Zotero-Reader-Form. Reale Sidecar (Struktur, keine Inhalte):

```json
{ "version": 1,
  "annotations": [ {
    "type": "highlight",            // highlight|underline|note|image|text|ink
    "color": "#ffd400",
    "sortIndex": "00043|001156|00339",   // "<pageIndex>|<charOffset>|<top>", RD/pdf/selection.js:399-419
    "pageLabel": "43",
    "position": { "pageIndex": 43, "rects": [[x1,y1,x2,y2], …] },
    "text": "…", "comment": "…", "tags": [],
    "id": "KWBFL8CQ",
    "dateCreated": "…", "dateModified": "…", "authorName": "",
    "onlyTextOrComment": true       // transientes Reader-Flag, wird mitpersistiert
  } ] }
```

- Nicht in der Sidecar: `libraryID`, `parentItem`, `dateAdded`, `image` (Writer entfernt nur `image`, `ZF/ui/reader/local-data-manager.ts:237-260`).
- EPUB/Snapshot: `position` ist ein W3C-Selector-Objekt (`FragmentSelector`/`CssSelector`, `RD/dom/common/lib/selector.ts:1-49`), `pageLabel` nur bei Page-Mapping. Die Navigation per `annotationID` funktioniert dort genauso; ein `pageIndex`-Fallback gibt es nicht.
- `sortIndex` wird bei Positionsänderung neu berechnet — stabil für unbewegte Annotationen, **keine Identität**.
- Library-Annotationen liegen in IndexedDB (`items`, PK `[libraryID+key]`, `ZF/db/db.ts:46-55`), `id` == Zotero-Annotation-Key (`ZF/db/annotation.ts:131`).

## 4. Rolle der `.zf.json`

- **Was:** pro lokaler Datei (PDF/EPUB/HTML) genau eine Sidecar `{version, annotations[]}`; `SIDECAR_VERSION = 1` (`local-data-manager.ts:10-17`). Pfad rein aus dem Dateipfad abgeleitet (`ZF/utils/utils.ts:47-65`, installiert gepatcht, s. o.); **kein** Rückverweis auf das PDF, **kein** Item-/Attachment-Key.
- **Source of Truth:** ja, für lokale Annotationen der durable Store — aber bei offenem Reader gibt es zwei In-Memory-Kopien (`LocalDataManager.annotationCache`, `local-data-manager.ts:27,199-205`; Reader `AnnotationManager._annotations`). Jeder Save schreibt die **ganze** Datei aus dem Cache neu; kein Watcher auf externe Änderungen.
- **Rename/Move des PDFs:** ZotFlow benennt die Sidecar mit um (`ZF/main.ts:499-506,795-812`, `ZF/utils/file.ts:208-236`); Löschen trasht sie. **Sidecar selbst verschoben/umbenannt:** kein Handler → Reader findet nichts, nächster Save legt eine neue an (Annotationen effektiv „verschwunden“).
- **Für DAP bedeutet das:** Die Sidecar ist **nicht** der Ort, an dem DAP nachschlägt. Beim Drop liest DAP die Annotation aus dem laufenden Reader; beim Klick löst ZotFlow die ID selbst gegen die Sidecar auf. DAP darf den Sidecar-Pfad in v1 **nicht selbst ableiten** (die installierte Reihenfolge ist gepatcht; Stock und Patch widersprechen sich). Wenn v1 einen Existenz-Check will, dann über den geöffneten Leaf (`view.dataManager.getAnnotation(id)`, intern) — best effort.

## 5. Stable Annotation Identity

**Lokal:** `{ filePath: <Vault-Pfad des PDF>, annotationId: <8 Zeichen> }`.

| Ereignis | ID bleibt? | Referenz gültig? |
|---|---|---|
| Text/Kommentar/Farbe/Tags editiert | ja (`annotation-manager.js:140-183`) | ja |
| Reload, Vault-Neustart, Sidecar-Rewrite | ja (`rebuildCache` keyed by id) | ja |
| PDF im Vault umbenannt/verschoben | ja; Sidecar folgt (`main.ts:795-812`) | **nein — DAP-`filePath` veraltet** → `File not found` (bestehende Lazy-Fail-Notice). Gleiche Klasse wie heutige `file`-Tools; ein späterer `vault.on('rename')`-Pfad-Rewrite in DAP wäre generisch (nicht Teil von v1). |
| Sidecar verschoben/umbenannt | ja | nein — ZotFlow findet die Annotation nicht → Seiten-Fallback (Abschnitt 11) |
| Highlight ↔ Underline konvertiert | **nein**, neue ID (`annotation-manager.js:198-222`) | Seiten-Fallback |
| Undo/Redo einer Löschung | **nein**, neue ID (`:621-626,655-660`) | Seiten-Fallback |
| Ink-Merge | nein | Seiten-Fallback |
| Annotation gelöscht | — | Seiten-Fallback; ZotFlow schweigt (empirisch T6) |
| PDF ersetzt (andere Seitenzählung) | ja | ID trifft ggf. falsche Stelle — Zotero-inhärent; kein DAP-Thema |
| ZotFlow neu geladen | ja | ja |

**Library:** `{ libraryID, annotationKey }`; PK-garantiert eindeutig; Sync behält den Client-Key (`ZF/worker/services/sync.ts:988-993`).

Verworfen als primäre Identität: Highlight-Text (editierbar, nicht eindeutig), `sortIndex` (positionsabhängig), Rects (positionsabhängig), Source-Note-Pfad (existiert hier nicht).

## 6. Drag Payload

Kette: Sidebar-Karte (`header`/`.text`/`.comment`, `RD/common/components/common/preview.js:179-196,237-378`) oder Seiten-Highlight (`RD/pdf/pdf-view.js:4511-4559`) → `Reader._handleSetDataTransferAnnotations` (`RD/common/reader.js:2842-2896`: `window._draggingAnnotationIDs = ids`, `clearData()`, `setData('text/plain', Zitat)`) → Host-Hook `bridge.handleSetDataTransferAnnotations` (`ZF/ui/reader/bridge.ts:285-340`), der `text/plain` **überschreibt**.

| Situation | `dataTransfer.types` | `text/plain` | `application/zotflow-citation` |
|---|---|---|---|
| Library-Attachment, Source Note vorhanden | `text/plain`, `application/zotflow-citation` | `![[<note>#^<id>]]` je Annotation | JSON `{type:"zotflow-citation", libraryID, key:<parentItem>, annotations:[{id, libraryID, parentItem:<attachmentKey>, type, text, comment, color, pageLabel, tags, position:{pageIndex, rects:[]}}]}` (`ZF/ui/editor/citation-helper.ts:14,49-68`) |
| Library-Attachment, keine Source Note | dito | `" "` | dito |
| **Lokales PDF, Source Note vorhanden (7 von 8 PDFs in diesem Vault)** | **`text/plain`** | **`![[<note>#^<id>]]`** je Annotation, `\n\n`-getrennt | — |
| Lokales PDF, keine Source Note (Bieker-Westerholt, Test-PDF) | `text/plain` | `" "` | — |
| Reine Textselektion (EPUB) / PDF-Selektion > 2 Seiten | `text/plain` | Rohtext | — |

Nie vorhanden: `text/html`, `text/uri-list`, `zotero/annotation`, eine `obsidian://`-URI, das Zitat (überschrieben). `effectAllowed` nicht gesetzt. `app.dragManager` wird von ZotFlow **nie** benutzt (0 Treffer in Source und Bundle). Tree-View-Drags (Items/Attachments, Parent-Dokument) sind Zitat-Drags: `application/zotflow-citation` ohne `annotations` bzw. `text/plain` = `[name](obsidian://zotflow?type=open-attachment&…)` (`ZF/ui/tree-view/Node.tsx:593-649`).

**Empirisch (isolierte Instanz, lokales PDF ohne Source Note, echte Handler-Kette per synthetischem `dragstart` mit `new DataTransfer()` auf dem `header` der Sidebar-Karte):** `types: ["text/plain"]`, Daten `" "`, `window._draggingAnnotationIDs: ["A9BXLVES"]` (`effectAllowed` ist bei einem synthetischen DataTransfer nicht aussagekräftig). Replay dieses Payloads per CDP als `dragenter/dragover/drop` auf eine leere DAP-Zelle: die Events kamen auf der Zelle an (`dropEffect: "copy"` — die heutige `canAcceptVaultFileDrag` akzeptiert jedes `text/plain` ohne `Files`); ein Tool entstand nicht (Registry-Zahl unverändert; konsistent mit `parseDraggedLinkText(" ")` → `null`). Während des Drops war aus dem Parent lesbar: `leaf.view.getState().file` = PDF-Pfad und `iframe.contentWindow._draggingAnnotationIDs` = `["A9BXLVES"]`. Der Embed-Fall (`![[note#^id]]`) wurde nicht empirisch erzeugt (Test-PDF ohne Note), folgt aber direkt aus `bridge.ts:330-336` und den realen Source Notes.

**Iframe-Grenze:** Reader-Iframe `id="zotero-reader-iframe"`, `src` = `blob:app://obsidian.md/…` (`bridge.ts:480-502`), Sandbox `allow-scripts allow-same-origin allow-forms`; empirisch Origin `app://obsidian.md`, `contentDocument` zugreifbar; darin ein zweites `blob:`-Iframe (PDF.js). Der Drag ist nativer HTML5-DnD ohne Weiterleitung; ZotFlow verlässt sich selbst darauf, dass er im Parent ankommt (`editor-drop`-Handler, `ZF/main.ts:210`, `citation-helper.ts:206-248`).

**Nicht automatisierbar war** der echte Maus-Drag über die Iframe-Grenze (CDP `Input.setInterceptDrags` lieferte in Electron kein `dragIntercepted`). Belegt ist: der Payload-Inhalt (synthetisch durch die echte Kette) und der Empfang auf der DAP-Zelle (Replay). Der Transport selbst ist durch ZotFlows eigene Drag-to-Editor-Funktion belegt; ein manueller 30-Sekunden-Test gehört an den Anfang der Implementierung (Abschnitt 16, Smoke).

`_draggingAnnotationIDs` wird **nie geleert** (nur gesetzt, `reader.js:2889`; ein Leser in `annotations-view.js:256`). Deshalb braucht der Fallback einen Konsistenz-Guard (Abschnitt 10).

## 7. Reopen / Navigation Mechanism

### Lokal (empirisch verifiziert, isolierte Instanz, ZotFlow 1.6.5)

| Test | Aufruf | Ergebnis |
|---|---|---|
| T1 | `openLinkText(pdf + '#annotation=' + enc({annotationID:'NJJQHI2C'}), '', true)`, Reader geschlossen | Reader öffnet, `selectedAnnotationIDs: ["NJJQHI2C"]`, Seite 39 sichtbar — **exakt** |
| T2 | dasselbe erneut mit anderer ID, Reader **bereits offen** | kurz 2 Leaves, Duplikat wird von ZotFlow geschlossen, **Navigation geht verloren** (Selection unverändert); ZotFlow zeigt die Notice „This file is already open. Use the reader's built-in split view…“ (T13, `local-view.ts:130-137`) |
| T3 | vorhandenen Leaf fokussieren, `leaf.view.setEphemeralState({subpath})` | **exakt** (Selection wechselt, Seite scrollt) |
| T4 | `leaf.openFile(file, {eState:{subpath}})`, frisch | **exakt** |
| T5 | `{annotationID:'ZZZZZZZZ', pageIndex: 9}` | ID unbekannt → **Seite 10** (Index 9) — Fallback im selben Objekt |
| T6 | `{annotationID:'ZZZZZZZZ'}` allein | **stiller No-op**, keine Notice |
| T7 | `#page=20` (Obsidian-Standard) | **nicht** honoriert (ZotFlow parst nur `annotation=`) |
| T8 | DAPs heutige `file`-Action | öffnet Reader an der zuletzt gespeicherten Position, keine Selection |
| T10 | **kombinierter Subpath** `#page=44#annotation=enc({annotationID:'KWBFL8CQ', pageIndex:43})`, frisch, ZotFlow aktiv | **exakt** (Selection `KWBFL8CQ`, Seite 43 sichtbar) — das v1-Format |
| T11 | kombinierter Subpath via `setEphemeralState` auf vorhandenem Leaf | **exakt** |
| T12 | `setEphemeralState({subpath:'#annotation=not-json'})` | **wirft synchron** (`JSON.parse` ohne try/catch, `local-view.ts:476-479`) → DAP muss den Aufruf kapseln |
| T13 | naives `openLinkText` bei offenem Reader | 1 Leaf am Ende, Navigation verloren, ZotFlow-Notice „already open“; `view.file.path` ist gesetzt |

Mechanik: `LocalReaderView.setEphemeralState(state)` liest `state.subpath`, `parseNavigationInfo` = `/annotation=([^&]+)/` → `JSON.parse(decodeURIComponent(...))` → `readerNavigate` → Bridge `navigate` (queued bis `reader-ready`) → `Reader.navigate` (`RD/common/reader.js:2421-2433`): ID bekannt → `setSelectedAnnotations` → View scrollt zu `position` (`block:'center'`) + Sidebar-Scroll; sonst `PDFView.navigate` mit Reihenfolge `annotationID` → `dest` → `position` (2 s Flash) → `pageIndex` (0-basiert) → `pageLabel` → `pageNumber` (`RD/pdf/pdf-view.js:2023-2068`). `ReaderNavigation` ist ein offenes Objekt (`ZF/types/zotero-reader.d.ts:83-88`). Reihenfolge im Subpath **muss** `#page=…#annotation=…` sein (ZotFlows eigene Reihenfolge); umgekehrt würde ZotFlows Regex den `#page`-Teil in das JSON ziehen.

Bereits-offen-Fall: DAP muss den vorhandenen Leaf finden, fokussieren und `view.setEphemeralState({subpath})` aufrufen (T3/T11). Das geht **ohne** ZotFlow-Wissen: `LocalReaderView` hält zur Laufzeit `file: TFile` (`local-view.ts:45,155`, empirisch `view.file.path` gesetzt), also trifft DAPs bestehendes `FileService.findOpenLeafForFile` (Vergleich `view.file.path`, `DAP/services/FileService.ts:75-88`) den Reader-Leaf genauso wie einen Markdown-Leaf. `setEphemeralState` ist offizielle Obsidian-`View`-API (`obsidian.d.ts:7669`). Der Aufruf **muss in try/catch** stehen (T12). Alternativ `leaf.openFile(file, {eState})` auf dem vorhandenen Leaf — nicht empirisch geprüft, `setEphemeralState` ist.

### Library
`obsidian://zotflow?type=open-annotation&libraryID=<n>&key=<annotationKey>` → `dbHelper.getItem` → `openAttachment(libID, parentItem, app, JSON.stringify({annotationID}))` (`ZF/main.ts:736-763`, `ZF/utils/viewer.ts:17-64`, Leaf-Reuse inklusive). Fehlende Annotation: ZotFlow zeigt selbst „Annotation not found.“. Alternative mit Seiten-Fallback: `type=open-attachment&key=<attachmentKey>&navigation=<urlencoded {annotationID,pageIndex}>`. **Nicht empirisch belegt:** T9 rief nur `window.open('obsidian://zotflow?type=open-attachment&libraryID=0&key=X')` in der isolierten Instanz auf und sah dort keine Notice; wohin das OS den Aufruf geroutet hat, ist nicht protokolliert (mutmaßlich zur produktiven Instanz, ohne Datenänderung). DAPs `UrlService` nutzt für `obsidian://` ebenfalls `window.open(target,'_blank')` (`DAP/services/UrlService.ts:37`) und erbt damit dieselbe OS-Routing-Abhängigkeit — im Normalbetrieb mit einer Instanz der übliche Weg (Advanced URI u. a.).

### Kein Weg
- Kein öffentliches JS-API: kein `window.zotflow`, kein `api`-Property, `services`/`workerBridge` sind Modul-Singletons (`ZF/services/services.ts:165`). Commands (`ZF/main.ts:283-490`) öffnen keine Annotation.
- Protocol-Handler für lokale Dateien: nicht möglich (`libraryID`+`key` Pflicht, IDB-Lookup).
- `zotero://open-pdf/…?annotation=` (`ZF/utils/zotero-uri.ts:26-33`): öffnet Zotero Desktop, nicht ZotFlow; Library-only.
- Core-PDF-Viewer bei **deaktiviertem ZotFlow ohne Neustart:** `.pdf` hat **keinen** View mehr (ZotFlow deregistriert Core beim Laden, `ZF/main.ts:225-233`, und registriert ihn nicht zurück) — `openLinkText` öffnet nichts, ohne Fehler. Nach Neustart ohne ZotFlow: Core-Viewer öffnet die Datei mit dem kombinierten Subpath fehlerfrei (empirisch); ob `#page=43#annotation=…` dort als Seite 43 gelesen wird, ist **UNVERIFIED** (Seite nicht auslesbar).

## 8. Integration Level / Coupling

| Teil | Level | Begründung |
|---|---|---|
| Persistenz (`file` + `subpath`) | **1** | generischer Obsidian-Link-Subpath; nichts ZotFlow-Spezifisches im Datenmodell |
| Reopen lokal, Reader nicht offen | **1** | `openLinkText`/`openFile(eState)`; ZotFlow parst sein eigenes Template-Format (de-facto-Contract, nicht dokumentiert) |
| Reopen lokal, Reader offen | **1** | `findOpenLeafForFile` (generisch, `view.file.path`) + `View.setEphemeralState` (offizielle Obsidian-API); kein ZotFlow-String nötig |
| Reopen Library | **1** | Protocol-Handler `obsidian://zotflow` (im Code registriert und von ZotFlow selbst in Notizen geschrieben; nicht dokumentiert) |
| Capture Library-Drag | **1** | MIME `application/zotflow-citation` (Quellcode-Konstante, von ZotFlow selbst konsumiert; nicht dokumentiert) |
| **Capture lokal via `![[note#^id]]`** | **1** | Regelfall in diesem Vault (7/8 PDFs); PDF-Pfad über Frontmatter `zotflow-local-attachment` |
| Capture lokal ohne Source Note; **Metadaten für Label/Fallback** | **3** | `iframe.contentWindow._draggingAnnotationIDs` + `_reader._state.annotations` (Upstream-Zotero-Globals) bzw. `view.dataManager.getAnnotation(id)` (ZotFlow-intern, TS-öffentlich). Der Embed liefert nur ID + Note, keine Seite/Text — die kommen aus dem Reader (best effort) |
| Existenz-Check beim Klick (optional) | 3 | `view.dataManager` / `knownAnnotationIds` — best effort, typeof-geguardet |

Regel: alles Level-3-Wissen lebt in **einer** Datei (`zotflowReader.ts`), wird beim Drop einmal gelesen und in Level-1-Daten (`filePath`, `subpath`, Label) übersetzt. Die Klick-Seite funktioniert ohne Level 3.

## 9. Proposed DAP Tool Model

**Kein neuer Tool-/Action-Typ.** Erweiterung der bestehenden `file`-Action:

```ts
// DAP/types/action.ts
export interface FileActionParams {
    /** Vault-relative file path */
    filePath: string;
    /** Optional Obsidian link subpath ("#heading", "#^block", "#page=3#annotation=…"), passed verbatim to the target view. */
    subpath?: string;
}
```

Persistiertes Tool (lokal):

```json
{ "id": "tool-…", "name": "p.43 · Eine der wichtigsten Lern…",
  "icon": "<svg …highlighter…>",
  "actions": [{ "type": "file", "parameters": {
      "filePath": "A2_Bib/…/Bieker-Westerholt-2021-….pdf",
      "subpath": "#page=44#annotation=%7B%22annotationID%22%3A%22KWBFL8CQ%22%2C%22pageIndex%22%3A43%7D" } }] }
```

`#page=` trägt die **physische 1-basierte Seite** (`pageIndex + 1`), nicht `pageLabel`: Obsidians Core-Viewer zählt physisch, ZotFlow ignoriert `#page=` ohnehin (T7). ZotFlows eigene Template-Links schreiben dort das Label — für ZotFlow egal, für den Core-Fallback um eins daneben, sobald Label ≠ Index+1 (in der realen Sidecar: Label `43` bei `pageIndex 43`).

Persistiertes Tool (Library): `{ type: "url", parameters: { url: "obsidian://zotflow?type=open-annotation&libraryID=1&key=ABCD1234" } }` — heute schon lauffähig.

- **Kanonische Identität:** `filePath` + `annotationID` im Subpath (lokal) bzw. `libraryID`+`key` in der URL.
- **Fallback-Daten:** `pageIndex` im Subpath-JSON (Seite, wenn ID weg — T5) und `#page=<pageIndex+1>` (Core-Viewer, wenn ZotFlow fehlt — Seitenwirkung dort UNVERIFIED). `pageLabel` nur im Label.
- **Nur Anzeige:** `name`, `icon`. Zitat, Farbe, Kommentar werden **nicht** persistiert (kein Sync-Anspruch; `customCss`/`cellStyles` werden ohnehin nicht gerendert).
- Warum nicht ein eigener Typ `zotflow_annotation`: er würde sechs Registrierungsstellen brauchen (Union, `registry.ts`, `IButtonAction`-Formklasse, `ActionDispatcher`, `templateParse.readAction`, i18n), und Templates mit diesem Typ würden von **allen** älteren Readern abgelehnt (`templateParse.ts:375-376`). `subpath` ist additiv: alte Reader verwerfen unbekannte Properties (`tests/panelTemplate.test.ts` „adopts no property it does not know“) → das Tool degradiert auf „PDF öffnen“.
- Warum nicht `url` mit `obsidian://open?file=…`: Obsidians `open`-Protokoll trägt keinen Subpath in `setEphemeralState`-Form, den ZotFlow parst (nicht verifiziert, nicht nötig).
- **Settings-Version:** kein Bump (additives optionales Feld; `settingsMigrations.ts` inspiziert Actions nicht). **Template-`formatVersion`:** kein Bump (Abschnitt 12).

## 10. Drop Detection Pipeline

Heute (`DAP/components/buttons-panel/GridSlotCell.tsx:119-161`, `DAP/hooks/useSlotFileDrop.ts:42-97`, `DAP/utils/obsidianFileDrag.ts:105-210`): nur **leere** Zellen im Edit-Mode binden `dragenter/over/leave/drop`; `dragover` akzeptiert, wenn `app.dragManager.draggable` Vault-Files trägt oder `types` `text/plain` ohne `Files` enthält; `drop` löst `dragManager` → sonst `getData('text/plain')` → `parseDraggedLinkText` → Vault-Datei → `buildVaultFileButtonDraft` → `createToolInCategory` → `commitToolState`. Der interne Button-DnD ist dnd-kit-Pointer-basiert und erzeugt nie HTML5-Events (`GridSlotCell.tsx:94-98`) — ein natives `drop` kommt immer von außen.

Neue Reihenfolge **beim Drop** (nur `resolveDrop…` ändert sich; `canAccept` bekommt zusätzlich `application/zotflow-citation` in die Typliste — Library-Drags haben ohnehin `text/plain`, lokale auch; die Zelle leuchtet heute schon, empirisch):

```text
1. types ∋ application/zotflow-citation
   → JSON parsen (Form wie ZF/ui/editor/citation-helper.ts:74-101 validieren)
   → annotations[0] vorhanden: Library-Annotation → url-Tool
   → annotations leer (Tree-Item-Drag): kein Tool (kein Fehler)
2. app.dragManager.draggable trägt Vault-Files (File Explorer)
   → bestehender Pfad, unverändert (Priorität wie heute)
3. text/plain vorhanden:
   a. matcht /^!\[\[(.+?)#\^([23456789A-Z]{8})\]\]/ (ZotFlow-Embed; Regelfall hier)
      → note = metadataCache.getFirstLinkpathDest(notePath); PDF = Frontmatter
        zotflow-local-attachment (Wikilink → getFirstLinkpathDest)
      → Identität { filePath, annotationId } steht (Level 1)
      → Metadaten (pageIndex, pageLabel, text, type) best effort aus dem Reader-Leaf,
        dessen getState().file === filePath: view.dataManager.getAnnotation(id)
        (Level 3, typeof-geguardet). Ohne Reader-Treffer: Label „Annotation · <PDF-Basename>“,
        kein #page=, kein pageIndex — Klick bleibt exakt über die ID.
   b. Payload ist " " ODER (a) traf, aber die Note löst kein PDF auf
      → Reader-Guard: für jeden Leaf vom Typ zotflow-local-zotero-reader-view:
         ids = iframe.contentWindow._draggingAnnotationIDs; genau dann übernehmen, wenn
         - ids nicht leer, und
         - view.dataManager.getAnnotation(ids[0]) existiert (Annotation gehört zu DIESEM Leaf), und
         - (a) traf ⇒ ids[0] === Embed-ID, und
         - kein dragManager-File anliegt
      → { filePath: view.getState().file, annotation } → lokale Annotation (Identität + Metadaten)
   c. sonst bestehender parseDraggedLinkText → Vault-Datei (ein Embed ohne ZotFlow-Frontmatter
      fällt hierher und wird wie heute als Note-Link behandelt)
4. nichts → wie heute: kein Tool, keine Notice
```

Der Guard begrenzt die einzige bekannte Fehlklassifizierung (staler `_draggingAnnotationIDs` bei einem späteren, unverwandten Drag mit leerem `text/plain`) auf den Fall „irgendwer zieht ein einzelnes Leerzeichen, während ein ZotFlow-Reader offen ist“. Mehrere Annotationen im Drag (mehrere Embeds bzw. mehrere IDs): nur die erste (wie heute bei Files). Kein Parent-seitiges Signal existiert: `ChildEvents.setDataTransferAnnotations` ist deklariert (`ZF/types/zotero-reader.d.ts:56-61`), wird aber nie emittiert (der Reader ruft den Bridge-Hook direkt, `RD/index.obsidian.reader.js:103-109`); `viewStateChanged` trägt keine Selection.

Warum vor `dragManager`? Nicht nötig — Schritt 1 hat einen eigenen MIME, Schritt 3b läuft nur, wenn kein `dragManager`-File existiert. Bestehende File-Explorer-Drops (`obsidian://open?vault=…&file=…` in `text/plain` **plus** `dragManager`) landen weiterhin in Schritt 2. Move/Swap sind dnd-kit und unberührt.

## 11. Error / Lazy-Fail Semantics

| Situation | Verhalten (v1) | Wo |
|---|---|---|
| PDF fehlt/umbenannt | bestehende Notice `File not found: <path>` | `FileService.getFileByPath` (`DAP/services/FileService.ts:61-68`) |
| ZotFlow nicht installiert (Neustart) | Core-Viewer öffnet PDF; Seite via `#page=` (UNVERIFIED); kein Fehler | Obsidian |
| ZotFlow zur Laufzeit deaktiviert | `.pdf` ohne View → nichts passiert; optionale Notice „No viewer registered for .pdf“ wenn `app.viewRegistry.getTypeByExtension(ext)` leer ist | `FileService` (kleine Guard-Zeile, generisch) |
| Annotation gelöscht / ID konvertiert / Sidecar verschoben | ZotFlow: stiller No-op auf ID, **Seiten-Fallback über `pageIndex`** (empirisch T5); optional best effort: nach dem Öffnen prüfen, ob der resultierende Leaf ein ZotFlow-Local-View ist und `view.dataManager.getAnnotation(id)` fehlt → Notice `Annotation not found — opened page N instead` | Adapter (Level 3, typeof-geguardet, darf nie werfen) |
| Library-Item/-Annotation fehlt | ZotFlow-Notice „Annotation not found.“ | ZotFlow-Protocol-Handler |
| ZotFlow-API geändert (`setEphemeralState`-Regex, Reader-Globals) | schlimmster Fall: PDF öffnet an letzter Position; Capture-Adapter liefert null. **Achtung:** `setEphemeralState` kann synchron werfen (T12: `JSON.parse` ohne try/catch in `local-view.ts:476-479`) — `FileService` kapselt den Aufruf in try/catch und zeigt dann nur die Datei | `FileService.applySubpath` |
| Laden von `data.json` / Template-Import | nie blockiert: `subpath` ist ein String, keine Validierung beim Laden; Import prüft nur Typ/Länge | `settingsMigrations`, `templateParse` |
| Klick ohne ZotFlow-Reader bei EPUB | `annotationID` funktioniert; kein Seiten-Fallback | ZotFlow |

Keine Fuzzy-Suche nach Text — es gibt keinen sicheren Mechanismus und die ID ist stabil genug.

## 12. Template Export/Import Impact

- **Export:** `exportToolDefinition` kopiert `actions` per JSON-Roundtrip (`DAP/export/templateExport.ts:42-44,102-122`) → `subpath` und `url` reisen automatisch mit. Nichts zu tun.
- **Import:** `readAction` (`DAP/export/templateParse.ts:286-302`) baut den `file`-Fall **neu** und übernimmt nur `filePath` → heute würde `subpath` **verworfen** (Tool degradiert auf „PDF öffnen“, kein Fehler). Änderung: optionales `subpath` als `readString(…, MAX_TEXT_LENGTH)` übernehmen, wenn vorhanden. `url`-Fall: unverändert.
- **Externe Referenzen:** `collectTemplateExternalReferences` sammelt `file.filePath` (`DAP/export/templateImport.ts:308-323`) → das PDF erscheint schon heute in der „N referenced files not found“-Zusammenfassung. Library-`url`-Ziele werden bewusst nicht gezählt (Test `panelTemplate.test.ts:548-569`) — bleibt so.
- **Vault-/Library-Spezifik:** lokal = Vault-Pfad + Sidecar-Inhalt des Zielvaults; Library = fremde `libraryID`. Import in einen anderen Vault ist erlaubt, Ziel fehlt lazy (wie File-Targets). Fehlendes ZotFlow blockiert nichts.
- **`formatVersion`: kein Bump.** Regel in `templateFormat.ts:33-37`: nur wenn ein älterer Reader das Dokument nicht mehr verarbeiten kann. Additives optionales Feld ⇒ ältere Reader lesen es und verwerfen `subpath`. Ausdrücklich: **keine Format-Änderung nötig.**

## 13. Future Selection/Create-Note Relevance

Ja, hoch: Die Repräsentation `[[<pdf>#page=…#annotation=<enc>|<label>]]` ist bis auf die Seitenzahl-Semantik **wörtlich** das, was ZotFlows Source-Note-Template pro Annotation ausgibt (`local-template.ts:29`, auch im Custom-Template des Users; real in den 7 Source Notes vorhanden). Ein DAP-Tool `{filePath, subpath}` lässt sich verlustfrei in genau diesen Markdown-Link rendern (`[[${filePath}${subpath}|${name}]]`). Für Library-Annotationen ist `obsidian://zotflow?type=open-annotation&…` ebenfalls ZotFlows eigene Notenverlinkung (`library-template.ts:255`). Zusätzlich existiert für PDFs mit Source Note der Block-Embed `![[<note>#^<id>]]` (das ist der Drag-Payload) — eine zweite, notenzentrierte Repräsentation derselben Annotation. Ein späteres „Create Note from Selection“ könnte je selektierter Zelle einen dieser Links schreiben, ohne zweites Datenmodell. Nichts davon jetzt bauen.

## 14. Decision Matrix

| # | Mechanismus | Exaktheit | Stabilität | Kopplung | Drag-Unterstützung | Persistenz | Risiken | Empfehlung |
|---|---|---|---|---|---|---|---|---|
| 1 | Deep-Link-only `obsidian://zotflow?type=open-annotation` | Annotation | Protocol-Handler, Parameter im Bundle bestätigt; **undokumentiert** (de-facto-Contract, ZotFlow schreibt ihn selbst in Notizen) | Level 1 | nur Library-Drags liefern `libraryID`/`key` | `url` | für lokale Dateien **nicht anwendbar**; `window.open` routet über das OS | **Ja für Library** (null DAP-Code) |
| 2 | `.zf.json`-Lookup | Annotation (nur Existenz/Meta) | Pfadableitung **gepatcht vs. Stock** | Level 2–3 | keine (Drop kennt Pfad nicht) | Sidecar-Pfad | Pfadregel widersprüchlich; Sidecar wandert bei Rename | **Nein** als Mechanismus; höchstens best-effort-Check über `view.dataManager` |
| 3 | ZotFlow API / Command | — | kein öffentliches API; Commands öffnen keine Annotation | — | — | — | — | **Nicht vorhanden** |
| 4 | Zotero-Key / `zotero://open-pdf?annotation=` | Annotation | Zotero-Contract | Level 1 | Library | URL | öffnet **Zotero Desktop**, nicht ZotFlow; lokal nicht anwendbar | Nein (falsches Ziel) |
| 5 | Direkte Reader-/DOM-Integration (`_reader`, `_draggingAnnotationIDs`, `dataManager`) | Annotation + Meta (Text, Seite, Farbe) | Upstream-Zotero-Globals (seit Jahren), ZotFlow-Feldnamen intern | Level 3 | einziger Weg für lokale Drags **ohne Source Note**; Metadaten-Quelle für alle lokalen Drags | → wird in Level-1-Daten übersetzt | Bricht bei Reader-Refactor; nur Capture/Label betroffen, nie der Klick | **Ja, nur für Capture**, in einer Adapter-Datei, guarded |
| 6 | **Obsidian-Link-Subpath `#page=…#annotation=…`** (ZotFlows Template-Contract, undokumentiert) + `setEphemeralState` | Annotation, Fallback Seite | ZotFlow generiert und parst dieses Format selbst; Regex im Bundle bestätigt; T10/T11 | Level 1 (auch Bereits-offen-Fall über `view.file.path`) | unabhängig vom Drag | `file.subpath` | Reihenfolge `page` vor `annotation` zwingend; `setEphemeralState` kann werfen (try/catch) | **Ja — Kern von v1 (lokal)** |
| 7 | Source-Note-Embed `![[note#^id]]` (Drag-Payload lokal) | Annotation-ID + Note | ZotFlow-Bridge setzt ihn selbst (`bridge.ts:330-336`); Block-IDs stehen real in den Notes | Level 1 | **Regelfall in diesem Vault** | → `file.subpath` nach Auflösung der Note | liefert keine Seite/Text (Reader nötig fürs Label); ohne Note leer | **Ja — primärer Capture-Pfad** |

## 15. Exact File-Level Implementation Map

| Datei | Heute | Änderung | Neu | Warum dort |
|---|---|---|---|---|
| `src/types/action.ts` | `FileActionParams { filePath }` (`:7-10`) | `subpath?: string` ergänzen | — | einzige Typquelle der Action-Union; additiv |
| `src/services/FileService.ts` | `openFile`: Existenz-Check → `findOpenLeafForFile` (vergleicht `view.file.path`, trifft auch ZotFlows Reader-Leaf) → `setActiveLeaf` oder `openLinkText(filePath,'',true)` (`:26-40,75-104`) | `subpath` lesen; **offener Leaf:** aktivieren **und** `leaf.view.setEphemeralState({ subpath })` **in try/catch** (T12: ZotFlow wirft bei unparsbarem JSON); **neuer Leaf:** `openLinkText(filePath + subpath, '', true)`; optionale Guard-Notice, wenn `viewRegistry.getTypeByExtension(ext)` fehlt | `private applySubpath(leaf, subpath)` | der eine Öffnungspfad; Verhalten ohne `subpath` byte-gleich; kein ZotFlow-String nötig |
| `src/actions/FileAction.ts` | Form mit `FileInput`; `toJSON` → `{filePath}` (`:19-21,77-79`) | `subpath` im Konstruktor übernehmen und in `toJSON` **durchreichen** (sonst verliert das Edit-Modal ihn); v1: kein eigenes Eingabefeld, nur Erhalt | Feld `subpath?: string` | Edit-Roundtrip läuft über `toJSON` (`ActionSequence.collectConfiguredActions`) |
| `src/export/templateParse.ts` | `readAction` `case 'file'` liest nur `filePath` (`:291-301`); unbekannter Typ → `invalid` (`:376-377`) | optionales `subpath` via `readString(own(parameters,'subpath'), …, MAX_TEXT_LENGTH)` übernehmen | — | Trust-Grenze; ohne das verwirft der Import den Subpath |
| `src/utils/zotflowAnnotationDrop.ts` **(neu, pure)** | — | Payload-Typen + Parser: `parseZotflowCitationPayload(json)`, `parseZotflowEmbedLink(text)` (Regex, erster Treffer), `ZotflowAnnotationRef` (`kind: 'local'|'library'`, `filePath`/`libraryID`/`key`, `annotationId`, `pageIndex?`, `pageLabel?`, `text?`, `comment?`, `type?`, `color?`) | ja | Obsidian-frei, direkt unit-testbar — Gegenstück zu `vaultFileButton.ts` |
| `src/utils/annotationButton.ts` **(neu, pure)** | — | `buildAnnotationButtonDraft(ref)` → `{ name, iconId, action }`: Name `p.<pageLabel> · <text|comment, 60 Zeichen>` (ohne Seite: `<text>`; ohne beides: `Annotation · <PDF-Basename>`), Icon nach `type` (`highlighter`/`underline`/`sticky-note`/`image`/`pen-tool`; unbekannt: `highlighter`), Action lokal `file{filePath, subpath}` mit `subpath = (pageIndex != null ? '#page=' + (pageIndex+1) : '') + '#annotation=' + encodeURIComponent(JSON.stringify({annotationID, ...(pageIndex != null && {pageIndex})}))`, Library `url{obsidian://zotflow?type=open-annotation&libraryID&key}` | ja | Spiegel von `buildVaultFileButtonDraft` (`vaultFileButton.ts:103-124`) |
| `src/utils/zotflowReader.ts` **(neu, Obsidian-gebunden, der Adapter)** | — | `resolveLocalAnnotationFromEmbed(app, notePath, id)`: Note → Frontmatter `zotflow-local-attachment` → PDF-`TFile` (Level 1); `readAnnotationMeta(app, filePath, id)`: Reader-Leaf mit `getState().file === filePath` → `view.dataManager.getAnnotation(id)` (Level 3, best effort); `readDraggedLocalAnnotation(app)`: iteriert `getLeavesOfType('zotflow-local-zotero-reader-view')`, liest geguardet `iframe.contentWindow._draggingAnnotationIDs` + `getAnnotation`, gibt `ZotflowAnnotationRef|null`; optional `annotationExists(leaf, id)` für die Klick-Notice. **Alle** ZotFlow-internen Strings/Globals nur hier; jede Property per `typeof` geprüft; nie werfen | ja | Level-3-Wissen an einer Stelle (der „ZotFlowAdapter“ aus der Aufgabe, aber als Modul, nicht als Klasse) |
| `src/utils/obsidianFileDrag.ts` | `canAcceptVaultFileDrag` (`:198-210`), `resolveDroppedVaultFiles` (`:183-189`) | `canAccept…`: `application/zotflow-citation` in die akzeptierten Typen; neue Funktion `resolveDroppedAnnotation(app, dataTransfer)` nach Pipeline Abschnitt 10 (Schritte 1, 3a, 3b), **vor** `resolveDroppedVaultFiles` aufzurufen | ja | hier lebt die Drop-Klassifikation |
| `src/hooks/useSlotFileDrop.ts` | Drop → erstes File → Draft → `createToolInCategory` → `commitToolState` (`:42-97`) | Verzweigung: erst `resolveDroppedAnnotation`, bei Treffer `buildAnnotationButtonDraft`, sonst bestehender File-Pfad; Notice-Text `slot_annotation_created` | — | Persistenz (`createToolInCategory`, `commitToolState`) unverändert — v5-Registry wird nicht umgangen |
| `src/locales/{en,zh,ru}.json` | — | Keys: `slot_annotation_created`, `annotation_not_found_page_fallback`, `no_viewer_for_extension` | — | i18n-Mechanismus |
| `tests/slotButtonCreation.test.ts` | Datei-Mapping, Slot-Logik, `parseDraggedLinkText` | Blöcke für Payload-Parser, Embed-Regex, Draft-Mapping, Subpath-Encoding | — | bestehende Testdatei für Slot-Erstellung |
| `tests/panelTemplate.test.ts` | Roundtrips, unbekannter Typ abgelehnt (`:678-694`) | `file`+`subpath` Roundtrip; Dokument ohne `subpath` weiter gültig; `subpath` > MAX abgelehnt | — | Format-Trust-Grenze |
| `tests/fileService.test.ts` **(neu, integration mit Obsidian-Mock)** | — | offener Leaf → `setEphemeralState` aufgerufen; kein Leaf → `openLinkText(path+subpath)`; ohne `subpath` byte-gleiches Verhalten; fehlende Datei → Notice | ja | Öffnungspfad ist heute ungetestet |

**Nicht ändern:** `ToolDefinition`/`ToolPlacement`, `categoryOps.ts`, `tools.ts` (GC/Copy/Duplicate treten `actions` als opake JSON durch — `deepCopyDefinition` kopiert Action-Objekte flach, `parameters` bleibt geteilt; unkritisch, weil nichts in place mutiert), `templateFormat.ts`, `settingsMigrations.ts`, `ActionDispatcher.ts`, `registry.ts`, `Button.tsx`, `GridSlotCell.tsx` (bindet nur Handler; Klassifikation liegt in den Utils), `ButtonDragContext.tsx`.

Label-Verhalten (Abschnitt 10 der Aufgabe): einzeilig mit Ellipsis in der Zelle (`PaletteGrid.css:73-79`), Tooltip = voller Name, sofern `panelConfig.showButtonTooltip` (Default an; `src/components/button/Button.tsx:93-105`); deshalb Seite **vorn** (`p.43 · …`), damit sie in schmalen Zellen sichtbar bleibt. Die Drop-Handler bindet `GridSlotCell.tsx:191-194` (Logik `:119-161`). Umbenennen läuft über das normale Edit-Modal. Annotation-Farbe: **nicht** in v1 (kein Render-Pfad für Farben vorhanden). Sehr langer Text: 60 Zeichen, Wortgrenze, `…`.

## 16. Test Plan

**Pure Unit (Vitest, node):**
- `parseZotflowCitationPayload`: gültiges Library-JSON → `ZotflowAnnotationRef{kind:'library'}`; ohne `annotations` (Tree-Item) → null; `type` falsch / kaputtes JSON / `__proto__`-Keys → null; erste von mehreren Annotationen.
- `parseZotflowEmbedLink`: `![[Pfad/@Note#^KWBFL8CQ]]` → `{notePath, id}`; zwei Embeds (`\n\n`-getrennt) → erster; `[[x]]`, `obsidian://open?…`, Rohtext, `" "` → null; ID-Alphabet (kein `0/1/O`).
- `buildAnnotationButtonDraft`: Subpath-Reihenfolge `#page=` vor `#annotation=`; `#page=` = `pageIndex + 1` (nicht `pageLabel`); JSON enthält `annotationID` **und** `pageIndex`; `encodeURIComponent`-Roundtrip mit `JSON.parse(decodeURIComponent(m[1]))` (ZotFlows Regex nachgebaut) ergibt das Objekt; Label-Kürzung, Fallbacks (nur Kommentar, weder Text noch Seite → `Annotation · <Basename>`), Icon nach Typ; EPUB/Embed-only ohne `pageIndex` → kein `#page=`, kein `pageIndex`; Library → `url` mit korrekt encodierten Parametern.
- Regression: `parseDraggedLinkText` unverändert (bestehende Fälle), `buildVaultFileButtonDraft` unverändert; ein `obsidian://open?file=…`-Text wird **nicht** als Annotation erkannt; `" "` ohne Reader → kein Tool.

**Integration (Obsidian-Mock):**
- `resolveDroppedAnnotation`: Reihenfolge der Pipeline (MIME vor `dragManager` vor `text/plain`); Embed → Note-Frontmatter → PDF (Level 1) mit und ohne erreichbaren Reader (ohne: Label-Fallback, kein `pageIndex`); Note ohne `zotflow-local-attachment` → fällt auf den Vault-File-Pfad zurück; `dragManager`-File gewinnt gegen stalen `_draggingAnnotationIDs`; Guard: ID nicht in `dataManager` → null; Embed-ID ≠ Reader-ID → null; kein Reader-Leaf → null; Adapter wirft nie (fehlende Properties, `contentWindow` null).
- `FileService.openFile` mit `subpath`: offener Leaf → `setActiveLeaf` + `setEphemeralState({subpath})`; `setEphemeralState` wirft → abgefangen, Datei bleibt offen, kein unhandled error; kein Leaf → `openLinkText(path+subpath,'',true)`; ohne `subpath` exakt heutiges Verhalten; fehlende Datei → `file_not_found`, kein `openLinkText`.
- `useSlotFileDrop`: Annotation-Drop landet in genau dem Ziel-Slot der editierten Variant; volles Grid → `variant_grid_full`; File-Drop-Pfad unverändert.
- Persistenz: Tool-Roundtrip `data.json` (`subpath` bleibt), `copyToolInCategory`/`duplicateVariantInState` kopieren `subpath` mit frischer Tool-ID, `removeToolFromCategory` GC't die Definition, Reload normalisiert nichts weg.
- Template: Export→Import-Roundtrip mit `subpath` und mit `url`-Annotation; Dokument mit fehlendem PDF importiert (Zähler in der Zusammenfassung); `subpath` nicht-String → `invalid_structure`; Import in einen Vault ohne ZotFlow blockiert nicht.
- `FileAction.toJSON` erhält `subpath` nach Modal-Roundtrip.

**Obsidian Smoke (isolierte Instanz, `ocap-smoke`, ZotFlow 1.6.5, Fehlermonitore):**
1. **Manueller Drag** Sidebar-Karte → leere Zelle (einmal Maus, der Transport ist nicht automatisierbar), je einmal für ein PDF **mit** Source Note (Payload `![[note#^id]]`, Pfad 3a) und **ohne** (Payload `" "`, Pfad 3b): Tool entsteht mit Label/Icon, `data.json` enthält `file`+`subpath` mit `#page=<pageIndex+1>`.
2. Klick: Reader geschlossen → Annotation selektiert, Seite zentriert; Reader offen mit anderem PDF/anderer Annotation → Leaf gewechselt/fokussiert, Selection korrekt; zweimal Klick → kein zweiter Leaf.
3. Seiten-Highlight-Drag (PDF-Seite statt Sidebar) und Multi-Selection → erste Annotation.
4. Annotation im Reader gelöscht → Klick landet auf der Seite; Notice (wenn best-effort-Check implementiert).
5. PDF umbenannt → `File not found`.
6. ZotFlow deaktiviert (Laufzeit) → Notice/No-op ohne Exception; ZotFlow nicht geladen (Neustart) → Core-Viewer öffnet, Seite prüfen (UNVERIFIED-Punkt schließen).
7. Dynamic Category: Drop in Variant `Z` → nur `Z` geändert; Variant-Wechsel, Copy Category, Duplicate Variant → neue Tool-IDs mit identischem `subpath`.
8. Export `.ocap.json` → Löschen → Import → Klick funktioniert; Import derselben Datei in einen Vault ohne ZotFlow → Notice-Pfad.
9. Regression: PDF-/Markdown-/`.js`-Drop aus dem File Explorer, Move/Swap, Slot-`+`, actionless Button, Resize — unverändert (bestehende Smoke-Liste in HANDOFF §5).

## 17. Recommended v1

Scope: **Capture reference → reopen reference**, nichts sonst.

1. `FileActionParams.subpath?` + `FileService` (Bereits-offen-Fall über `setEphemeralState`) + `FileAction`-Roundtrip + `templateParse`-Übernahme — generisch, auch ohne ZotFlow nützlich (`#heading`, `#^block`, `#page=`).
2. `zotflowAnnotationDrop.ts` + `annotationButton.ts` (pure) + `zotflowReader.ts` (Adapter) + Pipeline in `obsidianFileDrag.ts`/`useSlotFileDrop.ts`.
3. Library-Annotationen über die bestehende `url`-Action.
4. Notices: `File not found` (bestehend), `slot_annotation_created`, optional `annotation_not_found_page_fallback`.
5. Tests nach Abschnitt 16; manueller Drag-Smoke **vor** dem Rest (validiert den einzigen nicht automatisierten Punkt).

Reihenfolge der Implementierung: (1) → Tests → (2) pure Teile → Tests → Adapter → Smoke → (3)/(4).

## 18. Explicit Non-Goals

Annotation bearbeiten/löschen; Farbe synchron halten oder rendern; bidirektionale Sync; automatische Label-Aktualisierung bei Textänderung; Batch-Import von Annotationen; Annotation-Browser; Zotero-Library-UI; Selection/Create-Note-Integration; Cell Colors; Sidecar lesen oder schreiben; `.zf.json`-Pfad ableiten; eigener Action-Typ; `formatVersion`/`settingsVersion`-Bump; Rename-Tracking von PDF-Pfaden; Fuzzy-Suche nach Highlight-Text; `zotero://`-Links; Popout-Fenster-Drags (unverifiziert, nicht adressiert).

## 19. Known Version Risks

Geprüft: ZotFlow **1.6.5** (Tag `fe93957`), Reader `c971316`, installierte `main.js` **gepatcht** (nur Sidecar-Pfadreihenfolge; für v1 irrelevant, weil DAP den Pfad nie ableitet).

| Annahme | Quelle | Bruchfolge |
|---|---|---|
| Subpath-Regex `/annotation=([^&]+)/` + `JSON.parse(decodeURIComponent)` **ohne try/catch** | `ZF/ui/reader/local-view.ts:476-483`, Bundle; T12 | Klick öffnet PDF ohne Selection; bei geändertem Format kann `setEphemeralState` werfen → DAP kapselt |
| `ReaderNavigation` akzeptiert `annotationID` + `pageIndex` (0-basiert) im selben Objekt | `RD/common/reader.js:2421-2433`, `RD/pdf/pdf-view.js:2023-2068`, empirisch T5/T10/T11 | Seiten-Fallback entfällt |
| Reihenfolge `#page=…#annotation=…` | ZotFlows eigenes Template; T10 | JSON-Parse-Fehler in ZotFlow, wenn vertauscht |
| `LocalReaderView.file` (TFile) zur Laufzeit gesetzt, `getState().file`; View-Type `zotflow-local-zotero-reader-view` | `ZF/ui/reader/local-view.ts:30-35,45,155`; empirisch T13 | Bereits-offen-Fall erzeugt zweiten Leaf, Navigation verloren, ZotFlow-Notice (T2/T13) |
| `![[<note>#^<id>]]` als `text/plain` + Frontmatter `zotflow-local-attachment` | `ZF/ui/reader/bridge.ts:330-336`, `ZF/worker/services/local-template.ts:184-187`, `ZF/utils/file.ts:269-303`; real in 7 Notes | Regelfall-Capture fällt auf den Reader-Global-Pfad zurück |
| `application/zotflow-citation`-Shape | `ZF/ui/editor/citation-helper.ts:14,49-101` | Library-Drops nicht erkannt |
| `window._draggingAnnotationIDs`, `window._reader._state.annotations` im Reader-Iframe; `view.dataManager.getAnnotation` | Upstream `RD/common/reader.js:2889`; `ZF/ui/reader/local-data-manager.ts` | lokale Drops ohne Note nicht erkannt; Labels ohne Seite/Text; Klick unberührt |
| Iframe same-origin (`blob:` unter `app://obsidian.md`) | `bridge.ts:480-502`, empirisch | Capture-Fallback unmöglich (Android nutzt `srcdoc`, Desktop-only-Annahme) |
| `overwriteViewer: true` | Default | bei `false` scheitert ZotFlows PDF-Registrierung → Core-Viewer, nur Seite |
| Protocol-Parameter `type/libraryID/key` | `ZF/main.ts:698-774` | Library-Klick zeigt ZotFlow-Warnung |
| `obsidian://` per `window.open` erreicht die laufende Instanz | Obsidian/Electron (Advanced-URI-Praxis); hier nur „kein Fehler“ verifiziert | Library-Klick tut nichts |
| Core-Viewer liest `#page=43#annotation=…` als Seite 43 | **UNVERIFIED** | Fallback ohne ZotFlow öffnet Seite 1 |

**Empfehlung an Upstream (optional, später):** ZotFlow könnte lokalen Annotation-Drags denselben MIME-Payload mitgeben (`application/zotflow-citation` mit `filePath` statt `libraryID`) — dann würde der Level-3-Capture zum reinen Fallback. Bis dahin bleibt er in `zotflowReader.ts` isoliert.
