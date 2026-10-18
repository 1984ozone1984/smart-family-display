// Erzeugt die PWA-Icons (vier Personen-Punkte auf dunklem Grund) ohne Abhängigkeiten.
// Aufruf: node tools/gen-icons.mjs
import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const BG = [30, 41, 59];
const DOTS = [
	[225, 29, 72],
	[37, 99, 235],
	[22, 163, 74],
	[217, 119, 6]
];

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const td = Buffer.concat([Buffer.from(type), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(td));
	return Buffer.concat([len, td, crc]);
}

function png(size) {
	const raw = Buffer.alloc(size * (size * 4 + 1));
	// Punkte im inneren 60 %, damit "maskable" (sicherer Bereich 80 %) nichts abschneidet
	const r = size * 0.13;
	const centers = [
		[0.36, 0.36],
		[0.64, 0.36],
		[0.36, 0.64],
		[0.64, 0.64]
	].map(([x, y]) => [x * size, y * size]);
	for (let y = 0; y < size; y++) {
		const row = y * (size * 4 + 1);
		raw[row] = 0;
		for (let x = 0; x < size; x++) {
			let c = BG;
			let a = 0;
			centers.forEach(([cx, cy], i) => {
				const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
				const cov = Math.min(1, Math.max(0, r - d + 0.5));
				if (cov > a) {
					a = cov;
					c = DOTS[i];
				}
			});
			const o = row + 1 + x * 4;
			for (let k = 0; k < 3; k++) raw[o + k] = Math.round(BG[k] * (1 - a) + c[k] * a);
			raw[o + 3] = 255;
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0))
	]);
}

const out = new URL('../web/static/', import.meta.url);
for (const [name, size] of [
	['icon-192.png', 192],
	['icon-512.png', 512],
	['apple-touch-icon.png', 180],
	['favicon.png', 48]
]) {
	writeFileSync(new URL(name, out), png(size));
}
console.log('Icons geschrieben');
