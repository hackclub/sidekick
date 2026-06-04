import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '$env/dynamic/private';

function getKey(): Buffer {
	const hex = env.ENCRYPTION_KEY;
	if (!hex || hex.length !== 64) {
		throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
	}
	return Buffer.from(hex, 'hex');
}

export function encrypt(plaintext: string): string {
	const key = getKey();
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
}

export function decrypt(ciphertext: string): string {
	const key = getKey();
	const [ivHex, encHex, tagHex] = ciphertext.split(':');
	if (!ivHex || !encHex || !tagHex) {
		throw new Error('Invalid ciphertext format');
	}
	const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
	decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
	return decipher.update(encHex, 'hex', 'utf8') + decipher.final('utf8');
}
