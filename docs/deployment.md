# Deployment

```
Handy ──HTTPS──▶ Cloudflare Access ──▶ Tunnel ──▶ cloudflared (LXC, anderer Server)
                                                       │ HTTP im LAN
Tablet ──────────── HTTP im LAN ─────────────────────▶ Unraid :8470  family-dashboard ──▶ family-dashboard-mealie (Docker-Netz; Oberfläche nur im LAN :9925)
```

Platzhalter in dieser Anleitung:

| Platzhalter | Bedeutung |
|---|---|
| `<PUBLIC_HOST>` | öffentliche Subdomain, z. B. `dashboard.example.com` |
| `<UNRAID-IP>` | LAN-IP des Unraid-Servers |
| `<LXC-IP>` | LAN-IP des cloudflared-LXC |
| `<TEAM>` | Zero-Trust-Teamname (`<TEAM>.cloudflareaccess.com`) |

Echte Werte stehen nur in der `.env` auf dem Server.

## Sicherheitsmodell

- **Tunnel:** Anfragen von `TUNNEL_SOURCE_IPS` (der LXC) oder mit `Host: <PUBLIC_HOST>` müssen ein gültiges `Cf-Access-Jwt-Assertion` mitbringen. Geprüft werden Signatur, Team-Domain und AUD. Dass der LXC selbst im LAN liegt, ändert daran nichts.
- **LAN:** Direkte Anfragen aus `LAN_SUBNETS` sind ohne Access erlaubt. Lesen geht ohne Login; Ändern erfordert eine Person mit PIN, die Session läuft nach 10 min ab.
- **Alles andere:** wird mit 403 abgelehnt.
- **Ohne Access-Konfiguration:** Solange `CF_ACCESS_TEAM_DOMAIN` und `CF_ACCESS_AUD` fehlen, ist der öffentliche Weg gesperrt (fail-closed).

## 1. Cloudflare Zero Trust

Reihenfolge beachten: **erst Access, dann die Tunnel-Route.** So ist die Subdomain nie ungeschützt erreichbar.

### 1.1 Login-Methode

Zero Trust → **Settings → Authentication → Login methods**:
- **One-time PIN** ist standardmäßig vorhanden: Code per E-Mail, keine weitere Einrichtung nötig.
- Optional **Google**: Dafür braucht es einen OAuth-Client in der Google Cloud Console. Der Assistent erklärt die Schritte.

### 1.2 Access-Application

Zero Trust → **Access → Applications → Add an application → Self-hosted**:

1. **Name:** `Kommandozentrale`
2. **Session Duration:** `1 month`
3. **Public hostname:** Subdomain und Domain von `<PUBLIC_HOST>`
4. **Identity providers:** One-time PIN (plus Google, falls eingerichtet). Bei nur einem Anbieter **Instant Auth** aktivieren.
5. **Policy:**
   - Name `Familie`, Action **Allow**
   - Include → **Emails** → die 4 Adressen der Familie
6. Speichern.
7. Application öffnen → **Overview**: Den **Application Audience (AUD) Tag** kopieren und in der `.env` als `CF_ACCESS_AUD` eintragen.
8. Team-Domain: Zero Trust → **Settings → Custom Pages** (bzw. Team name). In der `.env` als `CF_ACCESS_TEAM_DOMAIN=https://<TEAM>.cloudflareaccess.com` eintragen.

### 1.3 Tunnel-Route

Je nachdem, wie der vorhandene Tunnel verwaltet wird:

**Im Dashboard verwaltet:** Zero Trust → **Networks → Tunnels** → Tunnel → **Configure → Public Hostname → Add**
- Subdomain/Domain = `<PUBLIC_HOST>`
- Service: **HTTP**, URL `<UNRAID-IP>:8470`
- Unter *Additional application settings → HTTP Settings* den **HTTP Host Header leer lassen**, damit die App den öffentlichen Host sieht.

**Lokal per `config.yml` im LXC:** Eine Ingress-Regel vor der Catch-all-Regel ergänzen und cloudflared neu starten:
```yaml
ingress:
  - hostname: <PUBLIC_HOST>
    service: http://<UNRAID-IP>:8470
  # … bestehende Regeln …
  - service: http_status:404
```

### 1.4 Test

`https://<PUBLIC_HOST>` in einem privaten Fenster öffnen. Es muss die Access-Anmeldung erscheinen; nach der Anmeldung kommt die App (oder 502, solange der Container noch nicht läuft).

## 2. Image (GitHub Container Registry)

Die GitHub Action baut bei jedem Push auf `main` das Image `ghcr.io/1984ozone1984/kommandozentrale:latest`.

Das Paket erbt die Sichtbarkeit des öffentlichen Repos, Unraid kann es also ohne Login ziehen. Im Image sind keine Secrets. Sollte der Pull doch mit `denied` scheitern: GitHub → Profil → **Packages → kommandozentrale → Package settings → Change visibility → Public**.

## 3. Unraid

Ablage:

| Was | Pfad |
|---|---|
| Stack (Compose File + `.env`) | `/mnt/user/appdata/family-dashboard/` |
| App-Daten (DB, Fotos) | Share `/mnt/user/family-dashboard/` |
| Mealie-Daten | Share `/mnt/user/family-dashboard-mealie/` |

1. **Shares → Add Share**: `family-dashboard` und `family-dashboard-mealie` anlegen. Primary storage am besten **Cache**, weil SQLite dort schneller ist und die Array-Platten schlafen können.
2. Rechte setzen und Stack-Ordner anlegen (Terminal):
   ```
   mkdir -p /mnt/user/appdata/family-dashboard
   chown 99:100 /mnt/user/family-dashboard /mnt/user/family-dashboard-mealie
   ```
3. `docker-compose.yml` und die ausgefüllte `.env` nach `/mnt/user/appdata/family-dashboard/` legen. Vorlage für `.env`: `.env.example`. Wichtig:
   - `LAN_SUBNETS`: Subnetz des Tablets, z. B. `192.168.x.0/24`
   - `TUNNEL_SOURCE_IPS`: `<LXC-IP>`
   - `PUBLIC_HOST`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`: aus Schritt 1
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ENCRYPTION_KEY`: siehe [google-setup.md](google-setup.md)
4. Plugin **Compose Manager Plus** (Fork des archivierten Docker Compose Manager) installieren.
5. Docker → *Compose* → **Add New Stack** `family-dashboard`, Quelle **External folder** → `/mnt/user/appdata/family-dashboard`.
6. **Compose Up**. Unter Docker sollte `family-dashboard` nach kurzer Zeit *healthy* sein.

Update auf eine neue Version: **Compose Pull**, danach **Compose Up**.

## 4. Ersteinrichtung

1. Am Tablet (oder einem Rechner im LAN) `http://<UNRAID-IP>:8470` öffnen und den ersten Elternteil mit PIN anlegen. Das geht nur aus dem LAN.
2. Unter **Einstellungen → Personen** die übrigen Personen anlegen: Farbe, Foto, PIN. Die **E-Mail** ist die Access-Adresse; dann ist die Person am Handy beim Login schon vorausgewählt.
3. **Fully Kiosk:** Start-URL `http://<UNRAID-IP>:8470`. JavaScript-Interface aktiv lassen.
4. **Handys:** `https://<PUBLIC_HOST>` öffnen, mit Access anmelden, Person wählen, PIN eingeben. Danach über das Browser-Menü **Zum Startbildschirm hinzufügen**.

## Fehlersuche

| Symptom | Ursache |
|---|---|
| Handy: 401 oder ein leeres „forbidden“ | Access-JWT fehlt oder ist ungültig: AUD oder Team-Domain prüfen. In den Logs steht `Zugriff abgelehnt`. |
| Tablet: 403 | Tablet-IP liegt nicht in `LAN_SUBNETS`. |
| Rote Sync-Anzeige oben rechts | SSE-Verbindung getrennt; die App pollt alle 30 s und verbindet sich selbst neu. |
| Container startet nicht | Logs zeigen `Ungültige Konfiguration` mit dem betroffenen Schlüssel. |
