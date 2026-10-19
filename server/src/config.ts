import { z } from 'zod';

const list = z
	.string()
	.default('')
	.transform((s) =>
		s
			.split(',')
			.map((x) => x.trim())
			.filter(Boolean)
	);

const schema = z
	.object({
		PORT: z.coerce.number().int().positive().default(8470),
		HOST: z.string().default('0.0.0.0'),
		DATA_DIR: z.string().default('./data'),
		WEB_DIR: z.string().optional(),

		// Öffentlicher Zugang über Cloudflare Tunnel + Access
		PUBLIC_HOST: z.string().optional(),
		// Toleriert fehlendes https:// und Schrägstrich am Ende: "team.cloudflareaccess.com" reicht
		CF_ACCESS_TEAM_DOMAIN: z
			.string()
			.transform((v) => (/^https?:\/\//.test(v) ? v : `https://${v}`).replace(/\/+$/, ''))
			.pipe(z.url({ message: 'erwartet z. B. https://<team>.cloudflareaccess.com' }))
			.optional(),
		CF_ACCESS_AUD: z.string().optional(),
		// IPs, von denen der Tunnel (cloudflared) die App erreicht – nie als LAN vertraut
		TUNNEL_SOURCE_IPS: list,

		// Subnetze, aus denen direkter LAN-Zugriff (Tablet) erlaubt ist, z. B. 192.168.1.0/24
		LAN_SUBNETS: list,

		SESSION_TTL_LAN_MIN: z.coerce.number().positive().default(10),
		SESSION_TTL_PUBLIC_DAYS: z.coerce.number().positive().default(90),

		TZ: z
			.string()
			.default('Europe/Berlin')
			.refine((tz) => {
				try {
					new Intl.DateTimeFormat('de', { timeZone: tz });
					return true;
				} catch {
					return false;
				}
			}, 'unbekannte Zeitzone'),

		// Google Calendar (OAuth-Client aus der Google Cloud Console)
		GOOGLE_CLIENT_ID: z.string().optional(),
		GOOGLE_CLIENT_SECRET: z.string().optional(),
		// Standard: https://<PUBLIC_HOST>/api/v1/google/callback
		GOOGLE_REDIRECT_URI: z.url().optional(),
		CALENDAR_SYNC_MIN: z.coerce.number().positive().default(3),

		// Mealie (nur intern erreichbar); ohne Token ist „Essen“ deaktiviert
		MEALIE_URL: z.url().default('http://family-dashboard-mealie:9000'),
		MEALIE_TOKEN: z.string().optional(),
		// Name der Einkaufsliste in Mealie; leer = älteste vorhandene (oder neu „Einkaufsliste“)
		MEALIE_SHOPPING_LIST: z.string().optional(),
		// Adresse der Mealie-Oberfläche im LAN (z. B. http://<server-ip>:9925) für Links am Tablet
		MEALIE_LAN_URL: z.url().optional(),
		MEALIE_POLL_SEC: z.coerce.number().int().min(15).default(60),
		// 32 Byte, base64 (openssl rand -base64 32); verschlüsselt Tokens at rest. Nie ändern!
		ENCRYPTION_KEY: z
			.string()
			.refine((k) => Buffer.from(k, 'base64').length === 32, '32 Byte base64 erwartet')
			.optional()
	})
	.superRefine((c, ctx) => {
		if (!!c.CF_ACCESS_TEAM_DOMAIN !== !!c.CF_ACCESS_AUD) {
			ctx.addIssue({
				code: 'custom',
				message: 'CF_ACCESS_TEAM_DOMAIN und CF_ACCESS_AUD nur gemeinsam setzen'
			});
		}
		if (!!c.GOOGLE_CLIENT_ID !== !!c.GOOGLE_CLIENT_SECRET) {
			ctx.addIssue({
				code: 'custom',
				message: 'GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET nur gemeinsam setzen'
			});
		}
		if (c.GOOGLE_CLIENT_ID && !c.ENCRYPTION_KEY) {
			ctx.addIssue({ code: 'custom', message: 'Google konfiguriert: ENCRYPTION_KEY ist Pflicht' });
		}
		if (c.GOOGLE_CLIENT_ID && !c.GOOGLE_REDIRECT_URI && !c.PUBLIC_HOST) {
			ctx.addIssue({
				code: 'custom',
				message: 'Google konfiguriert: PUBLIC_HOST oder GOOGLE_REDIRECT_URI ist Pflicht'
			});
		}
		if (c.LAN_SUBNETS.length === 0 && !c.PUBLIC_HOST) {
			ctx.addIssue({ code: 'custom', message: 'Weder LAN_SUBNETS noch PUBLIC_HOST gesetzt' });
		}
	});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	// Leerzeichen, \r und umschließende Anführungszeichen entfernen; leere Werte gelten als nicht gesetzt
	const cleaned = Object.fromEntries(
		Object.entries(env)
			.map(([k, v]) => [k, v?.trim().replace(/^(['"])(.*)\1$/, '$2')] as const)
			.filter(([, v]) => v !== undefined && v !== '')
	);
	const result = schema.safeParse(cleaned);
	if (!result.success) {
		const msg = result.error.issues
			.map((i) => `  ${i.path.join('.') || '(config)'}: ${i.message}`)
			.join('\n');
		throw new Error(`Ungültige Konfiguration:\n${msg}`);
	}
	return result.data;
}
