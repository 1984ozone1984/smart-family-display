import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** AES-256-GCM für Secrets at rest. Format: `v1:` + base64(iv | tag | ciphertext). */
export function createCrypto(keyBase64: string) {
	const key = Buffer.from(keyBase64, 'base64');
	if (key.length !== 32) throw new Error('ENCRYPTION_KEY muss 32 Byte (base64) lang sein');

	return {
		encrypt(plain: string): string {
			const iv = randomBytes(12);
			const cipher = createCipheriv('aes-256-gcm', key, iv);
			const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
			return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
		},
		decrypt(value: string): string {
			if (!value.startsWith('v1:')) throw new Error('unbekanntes Format');
			const buf = Buffer.from(value.slice(3), 'base64');
			const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
			decipher.setAuthTag(buf.subarray(12, 28));
			return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
		}
	};
}

export type Crypto = ReturnType<typeof createCrypto>;
