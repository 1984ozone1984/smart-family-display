# Familien-Kommandozentrale – Spezifikation

Selbst gehostete Alternative zum Dæly® Calendar. Eine PWA für Wand-Tablet und Familienhandys.

## 1. Ziele & Nicht-Ziele

**Ziele**
- Ein zentraler Ort für Termine, Aufgaben, Punkte, Listen und Essensplan
- Bedienung durch Kinder im Schulalter ohne Hilfe
- Echtzeit-Sync zwischen Tablet und Handys
- Läuft vollständig auf eigener Infrastruktur (Unraid); externe Dienste nur Google (Kalender) und Cloudflare (Tunnel)

**Nicht-Ziele (v1)**
- Native Apps (nur PWA)
- Mehrere Familien/Mandanten
- Eigene Rezeptverwaltung (übernimmt Mealie)
- Offline-Bearbeitung auf Handys (nur Lesen aus Cache)

## 2. Nutzer & Rollen

| Rolle | Personen | Rechte |
|---|---|---|
| Elternteil | 2 | alles: Personen, Kalender, Aufgaben, Punkte vergeben/abziehen, Belohnungen freigeben, Einstellungen |
| Kind | 2 (Schulalter) | eigene Termine anlegen, Aufgaben abhaken, Belohnung anfragen, Listen bearbeiten |
| Tablet (Gerät) | 1 | Anzeige für alle; Aktionen erfordern Personen-Auswahl, geschützte Aktionen Eltern-PIN |

Jede Person hat Name, Farbe, Avatar (Foto) und eine 4-stellige PIN.

## 3. Infrastruktur

| Komponente | Wo | Erreichbar |
|---|---|---|
| `family-dashboard` (App + API, Image `kommandozentrale`) | Unraid Docker | LAN direkt + `https://<sub>.<domain>` über Tunnel |
| `mealie` | Unraid Docker | nur intern (Docker-Netz) |
| `cloudflared` | bestehender LXC auf anderem Server im LAN | ausgehend zu Cloudflare; erreicht die App über `<UNRAID-IP>:8470` |

- Persistenz: Share `/mnt/user/family-dashboard/` (SQLite-DB, Uploads), Mealie: `/mnt/user/family-dashboard-mealie/`
- Stack-Dateien (Compose + `.env`): `/mnt/user/appdata/family-dashboard/`
- Cloudflare Access vor der öffentlichen Subdomain: E-Mail-Allowlist (4 Personen), Login per OTP/Google, Session z. B. 30 Tage
- Tablet nutzt die LAN-URL (kein Access). Die App muss beide Wege unterstützen.
- Docker Compose (Unraid Compose Manager); alle Secrets per Env-Datei, nie im Repo
- Da cloudflared im LAN liegt, gelten Anfragen von seiner IP nie als LAN-Zugriff (siehe §8)

## 4. Tech-Stack

| Schicht | Wahl |
|---|---|
| Backend | Node.js + Fastify (Alternative: FastAPI) |
| DB | SQLite (WAL), Migrationen versioniert |
| Frontend | SvelteKit, statisch gebaut, PWA (Manifest + Service Worker; Service Worker nur auf den Handys über HTTPS) |
| Echtzeit | Server-Sent Events (Fallback: Polling 30 s) |
| Push | Web Push (VAPID) |
| Tablet-Ton/TTS | Fully Kiosk JS-Interface (`fully.*`) |
| Kalender | Google Calendar API (OAuth 2.0); iCloud/CalDAV vorerst nicht (ggf. später) |
| Essen | Mealie REST-API (Token) |

**Zielplattform-Constraint:** Fire HD 8 (2020), Fire OS 7, 2 GB RAM, 1280×800. Frontend-Bundle klein halten, keine schweren Animationen.

**Gemessen in Phase 0** (Details: `docs/tablet.md`):
- System-WebView Chrome 138, dadurch reicht als Build-Target der Vite-Standard (`baseline-widely-available`); kein Legacy-Build, keine Polyfills
- Das Tablet ruft die App über HTTP im LAN auf (kein Secure Context), dort gibt es also **keinen Service Worker und kein Web Push**. Der Tablet-Betrieb darf nicht davon abhängen: Echtzeit per SSE, Ton/TTS und Bildschirm über `fully.*`
- Kein `speechSynthesis` in der WebView, TTS daher nur über Fully

## 5. Funktionen

### 5.1 Kalender
- Quellen: gemeinsamer Google-Familienkalender + persönliche Kalender (Google) je Person
- Zuordnung Kalender → Person (Farbe); Familienkalender → „Alle“
- **Lesen:** Sync alle 2–5 min + manuell; Zeitraum −30 bis +180 Tage
- **Schreiben:** Anlegen/Ändern/Löschen am Tablet/Handy → direkt an die Quelle (write-through), danach lokaler Cache
- Externe Quelle ist führend. Konflikte über `etag`/`updated` (Google); bei Konflikt gewinnt die Quelle, Nutzer bekommt Hinweis
- Ganztags-, wiederkehrende Termine (RRULE) anzeigen; Bearbeiten von Serien in v1: nur „ganze Serie“
- Ansichten: Heute (Default, Spalten pro Person), Woche, Agenda
- Heute-Ansicht: langes Drücken in der Spalte einer Person öffnet „Neu für <Person>“ mit Auswahl Termin (Kalender der Person vorgewählt) oder Aufgabe (Person und gezeigter Tag vorbelegt; Eltern-PIN)
- Langes Drücken auf einen Termin öffnet ihn direkt zum Bearbeiten (mit Löschen), auf eine Aufgabe ebenso (Eltern-PIN); bei einer noch geplanten Routinen-Aufgabe öffnet sich die Routine
- Langes Drücken auch in der Woche (in einem Tag: neuer Termin an diesem Tag) und unter Aufgaben (in der Spalte einer Person: neue Aufgabe für sie; auf einer Aufgabe: bearbeiten; Eltern-PIN)
- Bearbeitungsschutz: externe Termine von Kindern nicht änderbar (konfigurierbar). v1: Kinder schreiben nur in ihren eigenen Kalender und ändern nur Termine, die sie in der App angelegt haben
- Termin anlegen geht am Tablet ohne PIN, in jedem beschreibbaren Kalender; der Termin zählt dann als von der Kalender-Person angelegt (Familienkalender: von niemandem). Ändern und Löschen brauchen weiterhin eine Anmeldung
- Jede Person verbindet ihr eigenes Google-Konto (OAuth über die öffentliche Domain); ein geteilter Familienkalender wird nur einmal synchronisiert

### 5.2 Aufgaben & Routinen
- Aufgabe: Titel, Person(en), Fälligkeit, Punkte, optional Icon
- Routine: wiederkehrende Aufgabenvorlage (täglich / Wochentage / wöchentlich), Zeitfenster (Morgen/Nachmittag/Abend)
- Abhaken durch zugewiesene Person; optional „Eltern bestätigen“ pro Aufgabe
- Tagesansicht pro Kind mit Fortschritt
- Heute-Ansicht zeigt die Aufgaben des gewählten Tages; künftige Routinen-Aufgaben erscheinen vorab und lassen sich bis zu 7 Tage im Voraus abhaken (die Aufgabe wird dabei angelegt)
- Routinen-Aufgaben verfallen nach ihrem Zeitraum (täglich: am Tagesende, wöchentlich: Sonntag) ohne Punkte; einmalige Aufgaben bleiben offen und werden als überfällig markiert
- Einmalige Aufgaben mit künftigem Datum erscheinen ab heute jeden Tag als normale Aufgabe mit „zu erledigen bis …“, bis sie erledigt sind. Am Fälligkeitstag und danach täglich, solange überfällig, kommt ein Popup „Jetzt erledigen“: am Tablet für alle, am Handy nur für die eigenen Aufgaben, einmal pro Gerät und Tag wegklickbar (Push folgt mit Phase 6)
- Abhaken/Zurücknehmen nur durch die zuständige Person selbst oder ein Elternteil. Am Tablet: Antippen öffnet das PIN-Pad der Person (vorausgewählt); danach bleibt sie 2 min ohne Bedienung angemeldet und kann weitere eigene Aufgaben ohne PIN abhaken
- Belohnungen anfragen geht am Tablet ohne PIN (Eltern geben ohnehin frei); Eltern-PIN für geschützte Aktionen (Anlegen, Bestätigen, Freigeben, Bonus/Abzug)
- Eltern können ebenfalls Aufgaben erhalten und Punkte sammeln

### 5.3 Punkte & Belohnungen
- Punktekonto pro Person als **Ledger** (jede Buchung mit Grund, Quelle, Zeit) – Saldo = Summe
- Buchungen: Aufgabe erledigt/bestätigt, Bonus/Abzug durch Eltern, Belohnung eingelöst
- Belohnungen: Titel, Kosten, optional Limit/Woche
- Ablauf: Kind fragt an → Eltern geben frei → Punkte abgebucht. Offene Anfragen reservieren Punkte; bei Freigabe wird der Kontostand erneut geprüft
- Wochenlimit pro Person, Woche Mo–So

### 5.4 Listen
- Beliebige eigene Listen (Urlaub, Projekte …): Einträge, abhaken, sortieren
- Alle Listen sind gemeinsam (keine persönlichen Listen). Am Tablet ohne PIN: Listen und Einträge anlegen, abhaken, bearbeiten, sortieren, Erledigte entfernen; über das Handy jede angemeldete Person. Eine ganze Liste löschen nur Eltern
- Sortieren per ↑/↓ im Bearbeiten-Modus (kein Drag & Drop wegen alter WebView); abgehakte Einträge stehen unten
- **Einkaufsliste = Mealie-Einkaufsliste** (gelesen/geschrieben über API, nicht dupliziert)

### 5.5 Essensplan (Mealie)
- Wochenansicht des Mealie-Mealplans (Frühstück/Mittag/Abend)
- Rezept-Detail (Zutaten, Schritte) lesend anzeigen
- Aktion „Zutaten der Woche auf Einkaufsliste“ (Mealie-Funktion)
- Rezeptpflege erfolgt in Mealie selbst

### 5.6 Erinnerungen
- Pro Termin/Aufgabe: Zeitpunkt(e) vorher
- Kanäle: Web Push an zugewiesene Personen, Ton/TTS am Tablet
- Ruhezeiten (z. B. 21:00–06:30) für Tablet-Ton

### 5.7 Bilderrahmen & Display
- Nach X min Inaktivität Bilderrahmen (Fotos aus Upload-Ordner bzw. Unraid-Share)
- Nachtmodus: Display dunkel/aus (Fully Kiosk), Wake bei Bewegung (Fully-Kamera)
- Optional: Wetter- und Energie-Kachel aus Home Assistant (HA-WebSocket, Long-Lived Token)

## 6. Datenmodell (Entwurf)

| Tabelle | Wichtige Felder |
|---|---|
| `person` | id, name, color, avatar_path, role (parent/child), pin_hash, email |
| `google_account` | id, person_id, email, refresh_token_enc, status (ok/revoked) |
| `calendar_source` | id, type (google; erweiterbar), account_id, remote_id (eindeutig → geteilter Kalender nur einmal), summary, person_id NULL (=Alle), color, enabled, writable, sync_token, full_synced_at |
| `event` | id, source_id, remote_id, recurring_id, etag, title, description, location, start, end, all_day, rrule, range_start/range_end (UTC), created_by, updated_at |
| `task` | id, title, icon, available_from, due_date, time_slot, points, requires_approval, routine_id NULL, created_by; UNIQUE(routine_id, due_date) |
| `task_assignee` | task_id, person_id, status (open/done/approved), done_at |
| `routine` | id, title, icon, schedule (JSON: daily / weekdays / weekly), time_slot, points, requires_approval, active |
| `routine_assignee` | routine_id, person_id |
| `points_ledger` | id, person_id, delta, reason, ref_type (task/bonus/redemption), ref_id, created_by, created_at – append-only (DB-Trigger) |
| `reward` | id, title, cost, weekly_limit, active |
| `redemption` | id, reward_id, person_id, status (requested/approved/rejected/cancelled), requested_at, decided_by, decided_at, ledger_id |
| `list` / `list_item` | id, title / id, list_id, text, done, sort |
| `reminder` | id, ref_type, ref_id, offset_min, channels, last_fired |
| `push_subscription` | id, person_id, endpoint, keys |
| `session` | id (SHA-256 des Tokens), person_id, via (lan/public), created_at, expires_at |
| `setting` | key, value |

## 7. API (Entwurf)

REST unter `/api/v1`, JSON. Echtzeit unter `/api/v1/events/stream` (SSE).

| Bereich | Endpunkte |
|---|---|
| Auth | `GET /session`, `POST /session` (person_id + PIN), `DELETE /session`, `GET /session/persons` (Auswahl für Login) |
| Einrichtung | `GET/POST /setup` (erster Elternteil, nur LAN, nur bei leerer DB) |
| Personen | `GET/POST/PATCH /persons`, `POST /persons/:id/avatar`, `GET /avatars/:file` |
| Kalender | `GET /events?from&to`, `POST /events`, `PATCH/DELETE /events/:id`, `GET /calendars`, `PATCH /calendars/:id`, `POST /calendars/sync`, `POST /calendars/discover` |
| Google | `GET /google/status`, `GET /google/accounts`, `GET /google/connect`, `GET /google/callback`, `DELETE /google/accounts/:id` |
| Aufgaben | `GET/POST /tasks`, `PATCH/DELETE /tasks/:id`, `POST /tasks/:id/done`, `POST /tasks/:id/approve`, `GET /tasks/approvals` |
| Routinen | `GET/POST /routines`, `PATCH /routines/:id` |
| Punkte | `GET /points`, `GET /points/:person`, `POST /points` (nur Eltern) |
| Belohnungen | `GET/POST /rewards`, `PATCH /rewards/:id`, `POST /rewards/:id/redeem`, `GET /redemptions`, `POST /redemptions/:id/decide`, `POST /redemptions/:id/cancel` |
| Listen | `GET/POST/PATCH/DELETE /lists`, `/lists/:id/items` |
| Essen | `GET /meals?week`, `GET /recipes/:slug`, `GET/PATCH /shopping` (Proxy zu Mealie) |
| Push | `POST /push/subscribe` |

## 8. Sicherheit

- Öffentlicher Zugang nur über Cloudflare Access; App prüft zusätzlich `Cf-Access-Jwt-Assertion` bei Zugriff über die öffentliche Domain
- LAN-Zugang (Tablet) nur aus definiertem Subnetz/IP; Anfragen von der cloudflared-IP oder mit öffentlichem Host-Header brauchen immer ein gültiges Access-JWT
- Sessions gelten nur auf dem Weg (LAN/öffentlich), auf dem sie entstanden; LAN-Sessions kurz (10 min), öffentliche lang (90 Tage)
- PIN-Sperre pro Person und pro Client-IP (über den Tunnel: `Cf-Connecting-IP`)
- PINs gehasht (argon2/bcrypt), Rate-Limit bei PIN-Eingabe
- Google-Refresh-Token verschlüsselt at rest (Key aus Env)
- Mealie und HA nie öffentlich; Zugriff nur serverseitig
- Google-OAuth-App im Status „In Produktion“ (sonst 7-Tage-Token-Ablauf)

## 9. UX-Richtlinien

- Querformat als Primärziel: 1280×800 physisch = ca. **960×600 CSS-px** (DPR 1,33); Handy-Layout responsiv
- Touch-Ziele ≥ 48 px, Schrift ≥ 16 px, klare Personenfarben
- Startseite „Heute“: Spalte pro Person mit Terminen + offenen Aufgaben + Punktestand
- Navigation: Heute · Woche · Aufgaben · Essen · Listen · Belohnungen
- Kind-Aktionen ohne Tippen von Text möglich (Icons, Auswahl)

## 10. Phasen & Abnahmekriterien

| Phase | Inhalt | Abnahme |
|---|---|---|
| 0 | Tablet: Fully Kiosk installieren, WebView-Version ermitteln | WebView-Version dokumentiert; Testseite (Svelte-Hello-World) läuft flüssig |
| 1 | Repo, Container, DB/Migrationen, Personen/Rollen/PIN, PWA-Shell, SSE, Tunnel + Access | App über LAN und Subdomain erreichbar; Login per PIN; Änderung am Handy erscheint < 2 s am Tablet |
| 2 | Kalender Google lesen/schreiben | Termin am Tablet angelegt erscheint in Google und umgekehrt (≤ 5 min); Familienkalender als „Alle“ |
| 3 | Aufgaben, Routinen, Punkte-Ledger, Belohnungen | Routine erzeugt täglich Aufgaben; Abhaken bucht Punkte; Einlösung mit Eltern-Freigabe |
| 4 | Eigene Listen | CRUD + Abhaken, Echtzeit-Sync |
| 5 | Mealie: Essensplan, Rezepte, Einkaufsliste | Wochenplan sichtbar; Einkaufsliste in App = Mealie |
| 6 | Erinnerungen (Push + Tablet), Bilderrahmen, Nachtmodus | Push kommt am Handy an; Tablet spielt Ton außerhalb der Ruhezeit; Bilderrahmen nach Inaktivität |
| 7 | Feinschliff, Bearbeitungsschutz, Backup/Restore, optional HA-Kacheln, HA-Ladesteuerung Tablet 20–80 % | Restore aus Backup getestet; Kinder bedienen alle Kernfunktionen ohne Hilfe; Ladeautomation aktiv |

## 11. Entscheidungen

- Subdomain: `<PUBLIC_HOST>` (in Cloudflare noch anzulegen, Phase 1)
- Kalender: alle Personen nutzen Google Calendar; iCloud/CalDAV entfällt in v1
- Fotoquelle Bilderrahmen: eigener Ordner auf Unraid (Pfad folgt in Phase 6)
- HA-Ladesteuerung: verschoben ans Ende (Phase 7)

## 12. Offene Punkte

- Montageort Tablet (beeinflusst Bewegungserkennung, Lautstärke)
