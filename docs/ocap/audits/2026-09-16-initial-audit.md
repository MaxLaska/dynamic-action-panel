Notion ist aktualisiert. Hier der vollständige Auditbericht.

---

# OCAP – Initialer Architektur-, Qualitäts- und Sicherheits-Audit (2026-09-16)

Notion-Zugriff bestätigt. Repository read-only untersucht (Stand: `master` @ `a20369c`, v2.4.7, Arbeitsbaum sauber; einzige untracked Dateien sind unser `CLAUDE.md` und `docs/ocap/`).

## 1. Kurzfazit

Buttons Panel 2.4.7 ist eine **überraschend disziplinierte, aktiv entwickelte Ein-Personen-Codebasis** (152 Commits, Juli 2025 – August 2026, ein Autor „Kevin"). TypeScript strict inkl. `noUncheckedIndexedAccess`, null `any`, null `@ts-ignore`, saubere Service-Schicht, echte SVG-Sanitisierung, URL-Allowlist, keinerlei Telemetrie oder Netzwerkzugriffe. **Keine Hinweise auf Bösartigkeit, keine Prompt-Injection, kein verstecktes Unicode.** Die chinesischen Inhalte sind normale Entwicklerkommentare plus vollständige Lokalisierung.

Die Schwächen sind handwerklicher Natur: eine **fragile, monolithische Drag-&-Drop-Schicht** mit dnd-kit-Monkey-Patching, **zwei parallele UI-Paradigmen** (React-Panel vs. imperative Obsidian-Modals), **zwei echte React-Hook-Bugs**, ~250 Zeilen toter Code, **null Tests** – und ein realer Security-Befund: Script-Metadaten-Parsing führt Scriptcode implizit aus.

**Empfehlung: Variante B – Independent Fork**, mit gezieltem Porting interessanter Upstream-Änderungen (Details in Abschnitt 13/14).

## 2. Repository- und Architekturkarte

154 getrackte Dateien, ~5.800 Zeilen TS/TSX in `src/`.

```
main.ts (ButtonsPanelPlugin)
 ├─ registerView('buttons-panel-view') ──► views/ButtonsPanelView.tsx (ItemView)
 │    ├─ utils/ReactRoot.ts (React-18-createRoot-Wrapper)     → mountet:
 │    │    └─ ButtonsPanelApp.tsx
 │    │         └─ PluginProvider ► ConfigProvider ► ButtonsPanelLayout
 │    │              └─ PanelBody ► PanelContent ► {List|Tabs|Folder}ModeContent
 │    │                   └─ CategoryButtonGrid ► SortableButtonItem ► SimpleButton
 │    └─ views/renderers/NavigationBarRenderer.tsx (eigener zweiter ReactRoot
 │         oberhalb des view-headers) ► NavigationBar.tsx
 ├─ actionDispatcher (lazy via import()) ──► services/ActionDispatcher.ts
 │    └─ FileService | CommandService | UrlService | CreateFileService | ScriptService
 ├─ settings/ButtonsPanelSettingTab.ts (imperativ, Obsidian Setting-API)
 └─ registerScriptCommands() – 1 Command pro .js-Datei im Script-Ordner
```

Wichtige Querschnitte:

- **Klick-Ausführung:** `SimpleButton onClick` → `useButtonClickHandler` → `useButtonActions` → `useActionDispatcher` → `ActionDispatcher.executeActions` (sequentiell/parallel, stopOnError, Delay) → `executeSingleAction`-Switch → jeweiliger Service.
- **Zwei getrennte „Action"-Welten:** `src/actions/*` sind **Formular-Klassen** für die Modals (`render/validate/toJSON`, kein `execute()`), `src/services/*` sind die **Executor**. Keine Redundanz, aber irreführende Benennung.
- **Modals & Inputs** (`components/modal/*`, `components/input/*`, `components/suggest/*`) sind komplett **imperativ** (Obsidian `Modal`/`Setting`), nicht React. Rückmeldung an React erfolgt über ein dokumentweites `CustomEvent('buttons-panel-refresh')` – an ~10 Stellen handverstreut statt zentral.
- **DnD:** Ein einziger 869-Zeilen-Provider `contexts/ButtonDragContext.tsx` bedient Button- UND Kategorie-Drag über String-Präfix-IDs (`cat-sort:`, `container:`, `tab:`, `title:`), mit eigenen Sensoren (`src/sensors/*`), die dnd-kit-Interna zur Laufzeit patchen.
- **Settings-Persistenz:** `loadData/saveData` (data.json), Shallow-Merge über `DEFAULT_SETTINGS` in `src/main.ts:112-122` – **keine Versionierung, keine Migrationslogik**.
- **Build/Release:** esbuild (CJS-Bundle nach `dist/`), CSS wird aus allen `src/**/*.css` konkateniert; `scripts/deploy.mjs` (dev = Symlink/Junction in den Vault, build = Kopie) — *überholt am 2026-09-18, siehe Hinweis unten und `HANDOFF.md` §1a*; GitHub Actions: Lint-Workflow (npm ci, build, lint) + Release-Workflow mit **SLSA-Provenance-Attestation** – für ein Community-Plugin ungewöhnlich professionell.
- **i18n:** en/zh/ru, je 187 Keys, vollständig synchron.

## 3. Reifegrad

Reif für ein Community-Plugin dieser Größe: aktive, feature-orientierte Historie mit sauberen Conventional Commits, konsistente Versionierungskette (`version-bump.mjs` → `manifest.json`/`versions.json`), Provenance-Attestation, drei Sprachen, drei View-Modi, Mobile-Support (`isDesktopOnly: false`). Der letzte Commit vor dem Fork behebt einen Hook-Order-Crash – der Autor kämpft erkennbar mit genau der React/DnD-Komplexität, die auch unsere Befunde dominiert. Es ist ein Ein-Personen-Projekt ohne Reviews und ohne Tests; „Reife" bedeutet hier gepflegt, nicht abgesichert.

## 4. Codequalität

**Stark:**
- `tsconfig.json`: `strict`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess` – strenger als die meisten Obsidian-Plugins. Kein `any`, kein `@ts-ignore`, kein `eslint-disable` in ganz `src/`.
- Service-Schicht (`services/*`): klein, fokussiert, saubere Fehlerbehandlung mit Notices, Typ-Guards auf Action-Discriminants.
- Diszipliniertes Listener-/Timer-Cleanup: trotz der DnD-Komplexität wurden **keine geleakten Listener oder Timer** gefunden; `registerEvent`/`registerDomEvent` korrekt genutzt.
- Diskriminierte Union `ButtonAction` (`src/types/action.ts`) als sauberes Datenmodell.

**Schwach (mit Belegen):**
- **Zwei Rules-of-Hooks-Verstöße (echte Bugs):**
  - `src/components/shared/NavigationBar.tsx:160-166` – `if (!showTopNavBar) return null;` **vor** `useState`. Da `NavigationBarRenderer` denselben React-Root per `update()` weiterverwendet, führt das Umschalten von „Show Navigation Bar" bei offenem Panel zu „Rendered fewer hooks than expected" (verifiziert im Code).
  - `src/components/buttons-panel/FolderModeContent.tsx:364-390` – Early-Return vor `useCallback`; derzeit nur durch den Remount-Hack `key={'folder-'+filteredCategories.length}` in `PanelContent.tsx:97` maskiert.
- **Memo-Lücke:** `ButtonItem.tsx:44-51` vergleicht nur `id/name/icon` + Flags, ignoriert `actions`/`executionMode`/`order` – nach `loadSettings()` (frische Objektidentitäten, `ButtonsPanelView.tsx:129-131`) kann ein Button mit geänderten Actions stale rendern.
- **God-Komponente:** `ButtonDragContext.tsx` (869 Zeilen, ~20 Refs + 7 States, zwei Contexts aus einem Provider, 110-Zeilen-`handleDragEnd`).
- **Duplikate:** Kategorie-Kontextmenü existiert zweifach (`utils/categoryMenuUtils.ts:16-67` ≡ `hooks/useCategoryMenu.ts:12-67`), Kategorie-Kopierlogik dreifach; `ButtonCreateModal`/`ButtonEditModal` zu ~85–90 % identisch; 6 der 8 Input-Klassen sind Boilerplate-Klone; Hover-Timer-Logik dreifach.
- **Toter Code (~250 Zeilen):** komplette `utils/path.ts`, `hooks/useCategoryMenu.ts`, `hooks/useCategoryOperations.ts`, `utils/buttonFactory.ts`, `PANEL_VIEW_TYPES`, `categoryDragCollision.ts:62-152`, ungenutzte Props.
- **Versteckter globaler Zustand:** `window.__dndSensorTarget` (`types/global.d.ts:10`, gesetzt in `patchScrollAwareHandleMove.ts:77`), plus dokumentweite CustomEvents als Refresh-/Cancel-Bus.
- **Fragile Workarounds:** dnd-kit-Monkey-Patching (siehe 5.), synthetische `PointerEvent`s (`FolderModeContent.tsx:155-163`), verstecktes Duplikat-Overlay mit `display:none` (`FolderModeContent.tsx:429-450`), DOM-Klassennamen-basierte Kollisionserkennung (`buttonDragCollision.ts:47-65`).
- **Kleinere Lifecycle-Lücken:** `NavigationBarRenderer.destroy()` wird von `ButtonsPanelView.onClose()` nie aufgerufen (React-Root des Nav-Headers bleibt beim Schließen ungemountet zurück); `ButtonCreateModal`/`ButtonEditModal` haben als einzige Modals kein `onClose()`; `useActionDispatcher.ts:25` kann transient einen zweiten Dispatcher samt eigenem Meta-Cache erzeugen.

## 5. Technische Schulden

Konzentriert auf drei Cluster:

1. **DnD-Schicht** (höchstes Risiko): `sensors/patchScrollAwareHandleMove.ts:52-77` greift in **private dnd-kit-Strukturen** ein (Listener-Array wird ersetzt, `handleStart/End/Cancel` rebindet), `scrollAwarePointerHandleMove.ts` re-implementiert `AbstractPointerSensor.handleMove` von Hand. Jedes dnd-kit-Patch-Release kann Drag **stumm** brechen (Bail-out ohne Warnung). Dependency ist nur per Caret gepinnt (`@dnd-kit/core: ^6.3.1`).
2. **Paradigmen-Split:** React-Panel vs. imperative Modals/Inputs/SettingTab, verbunden über CustomEvents statt State – jede neue Konfigurations-UI (z. B. unser Condition-Editor) müsste sich für eine Seite entscheiden oder den Split vergrößern.
3. **Settings ohne Migrationspfad:** Shallow-Merge in `main.ts:112-122`; verschachtelte neue Defaults gehen bei Alt-Daten verloren (derzeit durch `??`-Fallbacks kompensiert). Für OCAPs Schema-Erweiterungen brauchen wir `settingsVersion` + Migrationen. `customCss` in `ButtonConfig` (`types/settings.ts:21`) ist deklariert, aber nirgends implementiert.

## 6. Security- und Privacy-Befunde

Gesamtbild: **kein bösartiger Code, keine Telemetrie, kein Netzwerkverkehr im Plugin selbst.** Systematische Suchen nach `fetch`/XHR/WebSocket/`eval`/`Function`/`child_process`/`fs.`/`process.`/`import()`/`innerHTML`/Clipboard/Storage über ganz `src/` ergaben ausschließlich die unten genannten Punkte. Dateizugriff ausschließlich über die Vault-API mit `normalizePath`; kein Adapter-/Node-Escape.

| Schweregrad | Befund                                                                                                                                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **High**    | Implizite Script-Ausführung beim Metadaten-Parsing (Details Abschnitt 7).                                                                                                                                                                                             |
| **Medium**  | Script-Engine = uneingeschränkte Codeausführung mit vollem App-/Netzwerkzugriff. Bewusst mächtige User-Funktion (Klasse Templater/QuickAdd), kein Bug – aber der einzige echte Angriffskanal des Plugins und in README nur funktional, nicht als Risiko dokumentiert. |
| **Low**     | `safeSetSVG` (`utils/dom.ts:32-58`) entfernt `<script>` und `on*`-Attribute rekursiv (Defense-in-Depth), filtert aber keine `javascript:`-`href`s/`xlink:href` und kein `<foreignObject>`. Da das SVG nur als Element eingefügt wird, geringes Restrisiko.            |
| **Low**     | `window.open` nur nach Protokoll-Allowlist http/https/obsidian (`UrlService.ts:53-88`) – solide; `obsidian://` kann allerdings URI-Handler beliebiger anderer Plugins triggern.                                                                                       |
| **Info**    | Konfigurationsdaten (data.json) enthalten keine Secrets; `.env` (Vault-Pfad) ist gitignored; Fehlermeldungen/Logs auf Chinesisch (Support-Thema, kein Security-Thema).                                                                                                |

Hinweis: Ein Agentenbefund „keine Schema-Validierung bei window.open" hat sich bei Verifikation als **falsch** erwiesen – die Allowlist existiert; ich habe die verifizierte Fassung übernommen.

## 7. ScriptAction/ScriptService-Risikobewertung

**Mechanik:** Scripts sind `.js`-Dateien im per Setting konfigurierten Vault-Ordner (`pathConfig.scriptFolderPath`, Default `scripts/`). `ScriptService.evaluateModule` (`ScriptService.ts:212-236`) baut per `AsyncFunction`-Konstruktor (funktional äquivalent zu `eval`) eine Funktion mit `module/exports` und führt sie im **Renderer-Kontext des Plugins** aus – keine Sandbox, kein iframe, kein Worker. Der Entry bekommt via `this.$context`: `app` (kompletter Vault + Workspace), `plugin`, das gesamte `obsidian`-Modul und `requestUrl` (CORS-freier HTTP-Client). Damit sind faktisch möglich: Vault-Lese/Schreibzugriff, Manipulation von Obsidian intern, beliebige Netzwerk-Exfiltration, und via Prototype-Chain auch Electron-/Node-Erreichbarkeit (normales Obsidian-Plugin-Niveau, das Plugin errichtet keine zusätzliche Barriere und kann das realistisch auch nicht).

**Einordnung:**
- *Bewusst mächtige User-Funktion:* die Ausführung per Button-Klick oder per registriertem Command (`main.ts:210-242`). Das ist der Produktzweck, dokumentiert im README; vergleichbar mit Templater. Kein Plugin-Bug.
- **Echte Schwachstelle des Plugins (High):** `getScriptMeta` (`ScriptService.ts:81-99`) **führt zur Metadaten-Gewinnung das gesamte Script-Top-Level aus**. Über `ScriptAction.createScriptMetaGetter` → `ScriptInput.ts:65` → `FileInputSuggest.prefetchMeta` (`:95-108`, `Promise.all`, bis zu 50 Dateien) genügt es, im Button-Editor das Script-Feld zu fokussieren, um Top-Level-Code von bis zu 50 Vault-Scripts auszuführen – **ohne Klick, ohne Ausführungsabsicht**. Der Code-Kommentar behauptet fälschlich „keine Seiteneffekte". Angriffspfad: jede Quelle, die Dateien in den Script-Ordner legen kann (Sync geteilter Vaults, importierte Vault-Templates, andere Plugins). Fix für OCAP: statisches Parsen (Regex/AST auf `module.exports`-Literal) statt Evaluation.
- *Theoretisch/normal:* alles, was ein Nutzer per selbst geschriebenem Script tut.

## 8. Dependency-/Supply-Chain-Befund

**Sauber.** Runtime-Dependencies nur `@dnd-kit/{core,sortable,utilities}`; React ist devDependency und wird gebundelt. Lockfile: **349 Pakete, alle von `registry.npmjs.org`, keine git-/http-Quellen, keine `preinstall`/`postinstall`/`prepare`-Hooks** im gesamten Baum. `.npmrc` enthält nur `tag-version-prefix=""`. Keine externen Downloads in Build-Skripten. `obsidian: "latest"` ist unpinned (Reproduzierbarkeits-, kein Sicherheitsthema); dnd-kit sollte wegen des Monkey-Patchings exakt gepinnt werden.

> **Überholt am 2026-09-18.** Der unten beschriebene Build-/Deploy-Ablauf existiert
> nicht mehr: `npm run build` deployt nicht mehr, die Dev-Junction ist entfernt,
> `VAULT_PATH` wird nicht mehr gelesen, und Deploy fasst `data.json` nicht an.
> Aktueller Stand in `docs/ocap/HANDOFF.md` §1a. Der Abschnitt bleibt als
> Fundstand stehen — er dokumentiert, womit der Refactor begründet wurde.

**Ausführbarkeit der Befehle (nach Inspektion aller Skripte):**
- `npm install` / `npm ci`: gefahrlos (keine Hooks); schreibt nur `node_modules/`. Vorher nichts nötig.
- `npm run lint`, `tsc -noEmit`: gefahrlos, read-only.
- `node esbuild.config.mjs [production]`: schreibt nur `dist/` – gefahrlos.
- `npm run dev` / `npm run build`: rufen zusätzlich `scripts/deploy.mjs` auf. **Ohne `.env` bricht das Deploy still ab** (Exit 0, `deploy.mjs:163-167`) – d. h. beide sind auch ohne Vault-Konfiguration gefahrlos; mit `.env` legt dev einen Symlink/Junction im Vault an, build **löscht** `<Vault>/.obsidian/plugins/buttons-panel/` rekursiv und kopiert `dist/` hinein (mit `data.json`-Rettung, `deploy.mjs:249-269`). Zielpfad ist fest auf `.obsidian/plugins/<id>` begrenzt.
- `npm version …`: verändert Git (add) + `manifest.json`/`versions.json` – nur bewusst nutzen.
- Release-Workflow läuft nur bei GitHub-Release-Publish; erzeugt Assets + Attestation. Kein Risiko lokal.

## 9. Unicode-/Sprach-/Prompt-Injection-Befund

**Belastbare Aussage: viele fremdsprachige Entwicklerkommentare, aber harmlos – kein Sicherheitsbefund.**

- **Lokalisierung:** `README.zh.md`/`README.ru.md`, `src/locales/{en,zh,ru}.json` mit identischen 187 Keys – normale Mehrsprachigkeit.
- **Kommentare:** 95 von 105 Source-Dateien enthalten CJK; ausschließlich Kommentarprosa, JSDoc-Texte und `console.*`-Meldungen. **Alle Bezeichner, Typen, Dateinamen sind Englisch.** Repräsentativ: `// 动作执行前，自动激活最后激活的内容标签页（排除按钮面板）` = „Vor Ausführung der Aktion automatisch den zuletzt aktiven Inhalts-Tab aktivieren (Buttons-Panel ausgenommen)" – durchweg fachlich erklärende Kommentare. Einzige UI-Lücke: hartkodiertes `'固定'/'取消固定'` („anpinnen/lösen") in `FolderDetailOverlay.tsx:207` außerhalb von i18n.
- **Unicode-Scan:** keine Zero-Width-/Bidi-/Override-Zeichen, keine Homoglyphen-Identifier, keine Base64-/Hex-Blöcke, keine Obfuskation (repo-weit geprüft inkl. Configs/Workflows).
- **Agent-Injection:** `AGENTS.md` ist das Standard-Template des Obsidian-Sample-Plugins (harmloser Entwickler-Leitfaden, deckt sich inhaltlich mit den Obsidian-Richtlinien). Keine Datei versucht, einem AI-Agenten Anweisungen zu geben, Regeln zu überschreiben oder Daten zu exfiltrieren. Interessantes Detail: `.gitignore` schließt `.codebuddy` aus – der Upstream-Autor arbeitet selbst mit einem AI-Coding-Tool (Tencent CodeBuddy); dessen Konfiguration ist nicht im Repo.

## 10. Build-/Deploy-/Release-Befund

Kette vollständig inspiziert (Details in Abschnitt 8): esbuild-Config mit eigenem CSS-Konkatenator und Manifest-Watcher, sauberes `external`-Handling (obsidian/electron/codemirror/Node-Builtins), CJS/ES2021, Sourcemaps nur dev. Deploy-Skript defensiv geschrieben (Schutz gegen Selbst-Kopie, `data.json`-Backup, expliziter Modus-Parameter). Release via GitHub Actions mit `actions/attest` (SLSA-Provenance) – überdurchschnittlich. Schwächen: `drop: ['console']` ist auskommentiert (chinesische Debug-Logs landen im Release-Bundle), Lint-Workflow baut auf jedem Branch-Push (unkritisch).

## 11. Testlage

**Es existieren null Tests** – kein Test-Framework in `package.json`, keine `*.test.*`/`*.spec.*`-Dateien, keine Mocks, kein Test-Workflow. Die Testbarkeit ist gemischt: die Service-Schicht ist gut testbar (kleine Klassen, injizierte `app`), die DnD-/React-Schicht wegen DOM-Kopplung, CustomEvent-Bus und dnd-kit-Patching schlecht. Jeder größere Umbau geschieht derzeit ohne Sicherheitsnetz – das ist das größte praktische Risiko für OCAP, noch vor der Codequalität selbst.

## 12. OCAP-Erweiterbarkeit

Konkrete Anknüpfungspunkte für den Context Resolver:

- **Wo er lebt:** analog zu `actionDispatcher` als Feld der Plugin-Klasse – neu z. B. `src/services/ContextService.ts` (oder `src/context/OCAPContextResolver.ts`), instanziiert in `main.ts onload()`. Er hält einen immutablen `OCAPContext`-Snapshot (activeFile, path, folder, frontmatter/properties, tags, viewType, leaf, selection …).
- **Obsidian-Events:** `workspace.on('active-leaf-change')` (in `main.ts:91-101` bereits vorhanden – heute nur für `lastActiveContentLeaf`; genau dort andocken), `workspace.on('file-open')`, `workspace.on('layout-change')`, `metadataCache.on('changed')` für Frontmatter/Tags, optional `editor-selection-change`-Polling für Cursor-Kontext. Alles via `plugin.registerEvent` – Cleanup gratis.
- **React-Anbindung:** dritter Provider in `ButtonsPanelApp.tsx:24-30` neben `PluginProvider`/`ConfigProvider`. Empfohlen: `useSyncExternalStore` auf dem ContextService (Subscribe/Snapshot) statt Props durch `ButtonsPanelView.renderPanel()` zu schleusen – das umgeht auch den bestehenden CustomEvent-Bus. Re-Render-Vermeidung: Snapshot nur bei tatsächlicher Änderung ersetzen (Shallow-Equality auf den Kontextfeldern), Selector-Hooks (`useOCAPContext(select)`) pro Button, Debounce auf `metadataCache`-Events.
- **Button-Modell:** `ButtonConfig` in `src/types/settings.ts:9-28` um optionales `conditions`-Feld erweitern – **deklarativ und serialisierbar** (z. B. `{ all/any/not: [...], matcher: path|folder|tag|property|viewType|nodeType, op, value }`), nicht als Funktions-Strings (sonst entsteht ein zweiter Eval-Pfad neben ScriptService). `visibleWhen/enabledWhen` werden dann als Interpreter über diesem Modell implementiert; eine spätere `label(context)/icon(context)/action(context)`-Ebene kann als registrierter Code (Script-Ordner oder Plugin-API) referenziert werden statt inline serialisiert.
- **Auswertungsort:** Die Filter-Pipeline existiert bereits – `searchQuery` fließt von `ButtonsPanelView` über `ButtonsPanelApp` in die `filteredCategories` der Mode-Contents. Dort (bzw. eine Ebene höher in `PanelContent.tsx`) wird der Condition-Filter eingehängt; `enabledWhen` zusätzlich in `SimpleButton` (disabled-State). Statische Buttons sind schlicht Buttons ohne `conditions` – Koexistenz trivial.
- **Settings-Migration:** zwingend `settingsVersion` einführen und den Shallow-Merge in `main.ts:112-122` durch eine Migrationskette ersetzen (alte Buttons bekommen `conditions: undefined` – abwärtskompatibel).
- **Neue Action-Types:** heute 4 Berührungspunkte pro Typ (Union in `types/action.ts`, Formular-Klasse + `actions/registry.ts`, `ActionDispatcher`-Switch `ActionDispatcher.ts:121-142`, Modal-Verkabelung). Für OCAP: einheitliche Registry, die pro Typ Editor-Factory **und** Executor bündelt – dann ist ein Action-Type eine Datei.
- **Eigene React-Komponenten:** erst sinnvoll, nachdem die Modal-Schicht auf React gezogen wurde (Abschnitt 5, Punkt 2); dann als Komponenten-Registry, die `CategoryButtonGrid` neben `SimpleButton` rendert.
- **UI für Conditions:** Achtung Paradigmen-Split – der Button-Editor ist imperativ (`ButtonCreateModal`/`ButtonEditModal`, ~90 % Duplikat). Ein Condition-Editor sollte Anlass sein, diese Modals zu konsolidieren (und idealerweise zu reactifizieren), statt die Duplikate zu verdreifachen.

## 13. Extension vs. Independent Fork

| Kriterium           | A – Upstream-kompatible Extension                                                                                                                                                   | B – Independent Fork                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Initialaufwand      | niedriger (nichts anfassen)                                                                                                                                                         | mittel (Bugfixes + Entschlackung zuerst)                                            |
| Langfrist-Aufwand   | hoch: jede OCAP-Kernfunktion (Conditions im `ButtonConfig`, Settings-Migration, Render-Filter, Registry-Umbau) schneidet durch Dateien, die Upstream aktiv umbaut                   | planbar; Upstream-Ideen werden gezielt portiert                                     |
| Merge-Risiko        | hoch: Upstream committet feature-getrieben quer durch `ButtonDragContext`, Mode-Contents, Modals – genau unsere Änderungszonen; kein `upstream`-Remote, keine Upstream-Tags im Fork | entfällt; Porting pro Feature (Upstream-Commits sind sauber gescoped, das hilft)    |
| Technische Freiheit | gering: Paradigmen-Split, DnD-Monolith und fehlende Migrationslogik müssten konserviert werden                                                                                      | voll: Hook-Bugs fixen, toten Code löschen, Modals konsolidieren, Registry einführen |
| Testbarkeit         | bliebe schlecht (kein Refactoring erlaubt)                                                                                                                                          | Tests können mit dem Umbau eingeführt werden                                        |
| Upstream-Nutzen     | theoretisch automatische Bugfixes – aber Upstream hat selbst keine Tests, Fixes sind oft Folgefehler eigener Features                                                               | Bugfix-Porting selektiv, mit eigenem Urteil                                         |
| Produktidentität    | „Buttons Panel + Aufsatz"                                                                                                                                                           | eigenständiges OCAP (eigene manifest-`id` nötig, Attribution/MIT bleibt)            |

Entscheidend aus dem Code: Es gibt **keine Extension-Punkte** – keine Plugin-API, keine Hooks, keine Registry, über die man kontextsensitive Sichtbarkeit von außen einspeisen könnte. Variante A hieße faktisch, denselben Kern zu patchen wie Variante B, nur mit selbst auferlegtem Merge-Zwang gegen ein Ein-Personen-Projekt ohne Stabilitätsgarantien.

## 14. Empfehlung

**Variante B – Independent Fork**, mit drei Leitplanken:

1. **Behalten, was gut ist:** Service-Schicht, Action-Union, i18n-Mechanik, Build-/Release-Kette (inkl. Attestation), SVG-Sanitizer, tsconfig-Strenge.
2. **Vor dem ersten OCAP-Feature härten:** die zwei Hook-Bugs, `getScriptMeta`-Verhalten, Memo-Lücke, toter Code, dnd-kit exakt pinnen. Erst danach Context Engine.
3. **Upstream beobachten, nicht mergen:** Upstream-Repo als reines Referenz-Remote betrachten; interessante Commits (sie sind klein und thematisch sauber) einzeln cherry-picken/nachbauen.

## 15. Fünf wichtigste nächste Schritte

1. **Audit abnehmen und persistieren:** Bericht nach `docs/ocap/audits/2026-09-16-initial-audit.md`, `STATUS.md`/`DECISIONS.md` aktualisieren (Entscheidung A/B festhalten), Read-only-Regel in `CLAUDE.md` ablösen. (Separater Auftrag, wie vereinbart.)
2. **Baseline herstellen:** `npm ci` + `npm run lint` + `tsc -noEmit` (nach obiger Freigabe gefahrlos), um den Ist-Zustand kompilier-/lintfähig zu bestätigen.
3. **Stabilisierungs-Commit-Serie:** NavigationBar- und FolderModeContent-Hook-Fixes, `ButtonItem`-Memo, ~250 Zeilen toter Code entfernen, `@dnd-kit/*` exakt pinnen, `getScriptMeta` auf statisches Parsen umstellen.
4. **OCAP-Fundament:** `settingsVersion` + Migrationspipeline, dann `OCAPContext`/ContextService mit `useSyncExternalStore`-Anbindung und deklarativem `conditions`-Feld am `ButtonConfig` (erst `visibleWhen`/`enabledWhen`).
5. **Produktidentität klären:** eigene manifest-`id`/Name für OCAP (Vermeidung von Kollisionen mit installiertem Buttons Panel), Attribution gemäß MIT sauber dokumentieren, Teststrategie festlegen (Vitest für Services/Context-Resolver als Start).

---

Notion-Hauptseite wurde mit Auditfazit, Empfehlung, offenen Fragen und nächstem Schritt kompakt aktualisiert. Das Repository wurde nicht verändert. Wenn du den Bericht freigibst, übernehme ich im nächsten Schritt die Persistierung unter `docs/ocap/audits/`.