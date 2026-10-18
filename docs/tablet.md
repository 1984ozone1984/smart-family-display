# Wand-Tablet (Phase 0)

Gerät: Fire HD 8 (2020), Fire OS 7, 2 GB RAM, 1280×800. Kiosk-App: Fully Kiosk Browser (Plus-Lizenz erst ab Phase 6 nötig).

## Status

- [x] Testseite `tools/webview-probe/` gebaut (Build-Target chrome64)
- [ ] Fully Kiosk installiert, JS-Interface aktiv
- [ ] Probe in Fully gelaufen (inkl. FPS-Test), Bericht in `tools/webview-probe/reports/`
- [ ] Vergleichslauf in Silk
- [ ] Ergebnis dokumentiert, Build-Target für die App festgelegt

## Probe starten

```sh
cd tools/webview-probe
npm install && npm run build
npm run serve   # http://<LAN-IP>:8090, Port per PORT=… änderbar
```

## Schritte am Tablet

1. Einstellungen → Sicherheit & Datenschutz → „Apps aus unbekannten Quellen“ für Silk erlauben
2. In Silk die Fully-APK von fully-kiosk.com laden und installieren
3. Fully: Advanced Web Settings → „Enable JavaScript Interface“ an
4. Start-URL `http://<LAN-IP>:8090` öffnen
5. „FPS-Test starten“ tippen, 8 s warten (Bericht wird automatisch gesendet)
6. Scroll-Kasten unten durchwischen: flüssig?
7. Dieselbe URL einmal in Silk öffnen

## Ergebnis

_Folgt nach dem Testlauf: WebView-/Chromium-Version, fehlende Features, FPS, abgeleitetes `build.target`._
