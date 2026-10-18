# Google Calendar einrichten

Einmalig in der Google Cloud Console. `<PUBLIC_HOST>` ist die öffentliche Subdomain, `<DOMAIN>` deren Hauptdomain.

## 1. Projekt und API

1. https://console.cloud.google.com/projectcreate öffnen und das Projekt `family-dashboard` anlegen. Danach oben links prüfen, dass es ausgewählt ist.
2. **APIs & Dienste → Bibliothek → „Google Calendar API“ → Aktivieren**

## 2. Google Auth Platform (Zustimmungsbildschirm)

| Menüpunkt | Einstellung |
|---|---|
| **Branding** | App-Name `Family Dashboard`, Support- und Entwickler-E-Mail; autorisierte Domain `<DOMAIN>`; Startseite `https://<PUBLIC_HOST>`; Datenschutz `https://<PUBLIC_HOST>/datenschutz` |
| **Zielgruppe** | Extern, dann **App veröffentlichen** → „In Produktion“. Im Testmodus laufen die Tokens nach 7 Tagen ab. |
| **Datenzugriff** | `https://www.googleapis.com/auth/calendar.events` und `https://www.googleapis.com/auth/calendar.calendarlist.readonly` |
| **Clients** | Webanwendung, Weiterleitungs-URI `https://<PUBLIC_HOST>/api/v1/google/callback` |

Die App wird nicht verifiziert, für den privaten Gebrauch ist das nicht nötig. Beim Verbinden zeigt Google deshalb einmalig eine Warnung, die man über **Erweitert → Weiter zu Family Dashboard** bestätigt.

## 3. `.env` auf dem Server

```
GOOGLE_CLIENT_ID=<Client-ID>
GOOGLE_CLIENT_SECRET=<Clientschlüssel>
ENCRYPTION_KEY=<openssl rand -base64 32>
```

`ENCRYPTION_KEY` nie ändern und zusätzlich sicher aufbewahren. Ohne ihn lassen sich die gespeicherten Google-Verbindungen nicht mehr entschlüsseln und müssen neu hergestellt werden.

## 4. Konten verbinden

- **Wer verbindet:** Jede Person verbindet ihr eigenes Konto. Das geht nur über `https://<PUBLIC_HOST>` (Handy oder PC), nicht am Tablet: anmelden → **Einstellungen → Kalender → Google-Konto verbinden**.
- **Nach dem Verbinden:** Der Hauptkalender des Kontos ist sofort aktiv und der Person zugeordnet. Alle anderen Kalender, auch der geteilte Familienkalender, erscheinen ausgeschaltet. Ein Elternteil schaltet sie unter **Kalender zuordnen** ein und setzt den Familienkalender auf **„Alle“**.
- **Familienkalender:** Er wird nur einmal abgeglichen, auch wenn mehrere Konten ihn sehen. Geschrieben wird über ein Konto mit Schreibrecht.
- **Kinderkonten:** Konten unter 13 Jahren mit Family Link dürfen sich oft nicht bei nicht verifizierten Apps anmelden. Dann teilt das Kind seinen Kalender mit einem Elternteil („Änderungen an Terminen vornehmen“). Der Elternteil klickt danach auf **Kalenderliste neu laden** und ordnet den Kalender dem Kind zu.

## Regeln

- **Abgleich:** alle `CALENDAR_SYNC_MIN` Minuten (Standard 3) und über **Jetzt abgleichen**, im Zeitraum −30 bis +180 Tage
- **Google ist führend:** Wurde ein Termin zwischenzeitlich in Google geändert, wird die Änderung in der App abgelehnt und der Stand aus Google geladen.
- **Serien:** Ändern und Löschen betrifft immer die ganze Serie.
- **Kinder:** Sie legen Termine nur in ihrem eigenen Kalender an und ändern nur Termine, die sie selbst in der App angelegt haben.
