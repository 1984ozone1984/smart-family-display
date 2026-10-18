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
		SESSION_TTL_PUBLIC_DAYS: z.coerce.number().positive().default(90)
	})
	.superRefine((c, ctx) => {
		if (!!c.CF_ACCESS_TEAM_DOMAIN !== !!c.CF_ACCESS_AUD) {
			ctx.addIssue({
				code: 'custom',
				message: 'CF_ACCESS_TEAM_DOMAIN und CF_ACCESS_AUD nur gemeinsam setzen'
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
