// Mini-Server für die Probe: liefert build/ aus und speichert POST /report unter reports/.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT ?? 8090);
const ROOT = join(import.meta.dirname, 'build');
const REPORTS = join(import.meta.dirname, 'reports');
const MAX_BODY = 1024 * 1024;

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png'
};

async function saveReport(req, res) {
	let body = '';
	for await (const chunk of req) {
		body += chunk;
		if (body.length > MAX_BODY) {
			res.writeHead(413).end();
			return;
		}
	}
	try {
		JSON.parse(body);
	} catch {
		res.writeHead(400).end();
		return;
	}
	await mkdir(REPORTS, { recursive: true });
	const file = join(REPORTS, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
	await writeFile(file, body);
	console.log(`Bericht gespeichert: ${file}`);
	res.writeHead(204).end();
}

async function serveFile(req, res) {
	const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
	const file = join(ROOT, path.endsWith('/') ? join(path, 'index.html') : path);
	if (!file.startsWith(ROOT)) {
		res.writeHead(403).end();
		return;
	}
	try {
		const data = await readFile(file);
		res.writeHead(200, {
			'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
			'Cache-Control': 'no-store'
		});
		res.end(data);
	} catch {
		res.writeHead(404).end('nicht gefunden');
	}
}

createServer((req, res) => {
	console.log(`${req.method} ${req.url} – ${req.headers['user-agent'] ?? ''}`);
	if (req.method === 'POST' && req.url === '/report') return void saveReport(req, res);
	if (req.method === 'GET') return void serveFile(req, res);
	res.writeHead(405).end();
}).listen(PORT, '0.0.0.0', () => console.log(`Probe läuft auf http://0.0.0.0:${PORT}`));
