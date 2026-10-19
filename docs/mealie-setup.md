# Mealie einrichten

Die App zeigt Essensplan, Rezepte und Einkaufsliste aus Mealie an und speichert davon nichts selbst.
Rezepte und den Essensplan pflegst du in der Mealie-Oberfläche. Die ist nur im Heimnetz erreichbar.

Platzhalter: `<unraid-ip>` ist die LAN-Adresse des Unraid-Servers.

## 1. Mealie öffnen

1. Der Stack startet Mealie mit dem Port aus `MEALIE_PORT` (Standard `9925`).
2. Im Browser `http://<unraid-ip>:9925` öffnen.
3. Beim ersten Start mit dem Standardkonto anmelden (`changeme@example.com` / `MyPassword`) bzw. dem Einrichtungsassistenten folgen.
   **Danach sofort** E-Mail und Passwort ändern (Profil → Einstellungen).
4. Optional weitere Benutzer für die Familie anlegen (Einstellungen → Benutzer). Alle müssen im **selben Haushalt** sein, damit sie denselben Essensplan sehen.

> Den Port **nicht** im Cloudflare-Tunnel freigeben. Von unterwegs siehst du Plan und Einkaufsliste über die App.

## 2. API-Token erzeugen

1. In Mealie rechts oben auf das Profil → **API-Tokens** (bzw. „Manage Your API Tokens“).
2. Namen eingeben, z. B. `kommandozentrale`, und **Generate** klicken.
3. Den Token kopieren. Er wird nur einmal angezeigt.

Der Token handelt im Namen dieses Benutzers. Die App sieht deshalb den Essensplan und die Einkaufslisten von dessen Haushalt.

## 3. In die `.env` eintragen

In `/mnt/user/appdata/family-dashboard/.env`:

```
MEALIE_TOKEN=<token aus Schritt 2>
# optional: Name der Einkaufsliste in Mealie
MEALIE_SHOPPING_LIST=Einkaufsliste
```

Ohne `MEALIE_SHOPPING_LIST` nimmt die App die älteste Liste. Gibt es keine, legt sie „Einkaufsliste“ an.

Für die Links „In Mealie öffnen“ am Tablet zusätzlich:

```
MEALIE_LAN_URL=http://<unraid-ip>:9925
```

Bitte die IP verwenden, nicht `tower.local`: Android 9 (Fire OS 7) löst `.local`-Namen nicht auf.
In Fully Kiosk öffnen sich Links in einem neuen Fenster nur, wenn dort Pop-ups erlaubt sind
(Web Browsing Settings → Enable Popups). Sonst öffnet Mealie im selben Fenster, und „Zurück“ führt zur App.

Danach den Stack neu starten. Im Log von `family-dashboard` darf die Warnung `MEALIE_TOKEN fehlt` nicht mehr stehen.

## 4. Prüfen

- In Mealie einen Eintrag in den Essensplan dieser Woche setzen. Er erscheint in der App unter **Essen** (spätestens nach `MEALIE_POLL_SEC`, Standard 60 s).
- In der App etwas auf die Einkaufsliste setzen. Es steht sofort auch in Mealie.

## Fehlerbilder

| Meldung | Ursache |
|---|---|
| „Mealie ist nicht eingerichtet“ | `MEALIE_TOKEN` fehlt in der `.env` |
| „Mealie ist gerade nicht erreichbar“ | Container `family-dashboard-mealie` läuft nicht oder der Token ist ungültig (Log von `family-dashboard` ansehen) |
