# CLAUDE.md – Regeln für dieses Projekt

Projekt: Familien-Kommandozentrale. Die verbindliche Spezifikation ist `SPEC.md`. Bei Widerspruch gilt SPEC.md; Unklarheiten **fragen statt raten**.

## Arbeitsweise
- Phasenweise nach SPEC.md §10. Eine Phase erst beginnen, wenn die vorherige abgenommen ist.
- Vor jeder Phase: kurzen Plan (Dateien, Schritte) vorlegen und auf Freigabe warten.
- Kleine, nachvollziehbare Commits; Commit-Messages auf Deutsch, Präfix `feat:`, `fix:`, `chore:`, `docs:`.
- Keine neuen Abhängigkeiten ohne kurze Begründung. Bundle-Größe im Blick behalten (Ziel: Fire HD 8, alte WebView).
- Kommunikation kurz und direkt, auf Deutsch.

## Code
- Backend: Node.js + Fastify, TypeScript strict. Frontend: SvelteKit (adapter-static), TypeScript.
- SQLite mit versionierten Migrationen; keine Schemaänderung ohne Migration.
- Punkte nur über `points_ledger` buchen – nie Salden direkt speichern/ändern.
- Kalender: externe Quelle ist führend; Schreibzugriffe write-through mit ETag-Prüfung.
- Mealie-Daten nicht duplizieren; Backend proxyt die Mealie-API.
- Alle Mutationen senden ein SSE-Event, damit Tablet und Handys synchron bleiben.
- Rollenprüfung serverseitig für jede Mutation (Eltern vs. Kind).

## Sicherheit
- Keine Secrets im Repo. Konfiguration über `.env` (Vorlage: `.env.example`).
- Repo ist öffentlich: keine echten Domains, IPs, E-Mail-Adressen oder personenbezogenen Daten (Namen, Alter der Kinder) in Code, Doku oder Commits – Platzhalter verwenden, echte Werte nur in `.env`.
- Tokens/Passwörter verschlüsselt at rest; PINs gehasht; Rate-Limit auf Login.
- Mealie und Home Assistant nie öffentlich exponieren.
- Bei Zugriff über die öffentliche Domain `Cf-Access-Jwt-Assertion` validieren.

## Tests & Qualität
- Unit-Tests für Ledger, Routinen-Generierung, Kalender-Sync/Konflikte.
- Lint + Typecheck müssen vor jedem Commit grün sein.
- Jede Phase endet mit Prüfung der Abnahmekriterien aus SPEC.md und kurzer Zusammenfassung.

## Deployment
- Ein Docker-Image `kommandozentrale`; `docker-compose.yml` mit `kommandozentrale`, `mealie`, `cloudflared`.
- Daten unter `/mnt/user/appdata/kommandozentrale/`.
- Healthcheck-Endpoint `/api/v1/health`.

## Nicht tun
- Keine Features außerhalb von SPEC.md ohne Rückfrage.
- Keine destruktiven Aktionen an externen Kalendern ohne Bestätigung im UI.
- Keine Telemetrie oder externen Analytics.
