# Wand-Tablet (Phase 0)

Gerät: Fire HD 8 (2020), Fire OS 7, 2 GB RAM, 1280×800. Kiosk-App: Fully Kiosk Browser (Plus-Lizenz erst ab Phase 6 nötig).

## Status

- [x] Testseite `tools/webview-probe/` gebaut (Build-Target chrome64)
- [x] Fully Kiosk installiert
- [ ] JS-Interface aktiv (`fully`-Objekt im Testlauf nicht gefunden)
- [x] Probe in Fully gelaufen (inkl. FPS-Test)
- [x] Vergleichslauf in Silk
- [x] Ergebnis dokumentiert, Build-Target festgelegt

## Probe starten

```sh
cd tools/webview-probe
npm install && npm run build
npm run serve   # gibt die LAN-URL aus (Port 8090, per PORT=… änderbar)
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

Testlauf 2026-10-18, 7 Berichte (4× Fully/WebView, 3× Silk).

| | Wert |
|---|---|
| Fire OS / Modell | Android 9, `KFONWI`, Build PS7331.4463N |
| **System-WebView** | **Chrome 138.0.7204.244** |
| Silk | 138.13.4 (Chrome 138) |
| CSS-Viewport | 601×961 im Hochformat, DPR 1,33 → quer ca. **962×601 CSS-px** (nicht 1280×800) |
| CPU / Zeitzone | 4 Kerne, `Europe/Vienna` |
| FPS (24 Elemente, 8 s) | Ø 60, min 58–60, schlechtester Frame 17 ms; einmal 50 ms beim ersten Lauf |

**Vorhanden:** die gesamte moderne JS-Syntax und alle geprüften APIs (u. a. SSE, `structuredClone`, `WeakRef`, `ResizeObserver`, `Intl`), dazu `AudioContext` und die Fullscreen-API. Im CSS ebenfalls alles geprüfte: Grid, Flex-`gap`, `:has()`, Container Queries, Nesting, `color-mix()`, `dvh`.

**Fehlt in der WebView:**
- `isSecureContext` = false über `http://<LAN-IP>` → **kein Service Worker, kein Push** am Tablet
- `speechSynthesis` → TTS am Tablet nur über `fully.textToSpeech()`
- Wake Lock, `getBattery`, `Notification` (gibt es in Fully über eigene Funktionen)

### Folgerungen

- **Build-Target:** Vite-Standard (`baseline-widely-available`) reicht für die App. Er liegt deutlich unter Chrome 138 und deckt die Handys ab. Polyfills oder Legacy-Build sind nicht nötig.
- **Layout:** Ziel ist ca. 960×600 CSS-px im Querformat, nicht 1280×800 (wegen DPR 1,33).
- **Tablet ohne Service Worker:** Der Tablet-Betrieb darf nicht vom Service Worker abhängen; Echtzeit per SSE, Ton/TTS per Fully. PWA-Installation und Push nur auf den Handys (HTTPS über Tunnel).

