import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '$env/dynamic/private';
import { createLogger } from './logger.js';

const log = createLogger('crypto');

function getKey(): Buffer {
	const hex = env.ENCRYPTION_KEY;
	if (!hex || hex.length !== 64) {
		log.error('ENCRYPTION_KEY missing or invalid length', undefined, { keyLength: hex?.length });
		throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
	}
	return Buffer.from(hex, 'hex');
}

export function encrypt(plaintext: string): string {
	log.trace('encrypt: encrypting value', { plaintextLength: plaintext.length });
	try {
		const key = getKey();
		const iv = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', key, iv);
		const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
		const tag = cipher.getAuthTag();
		const result = `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
		log.trace('encrypt: success', { ciphertextLength: result.length });
		return result;
	} catch (err) {
		log.error('encrypt failed', err);
		throw err;
	}
}

export function decrypt(ciphertext: string): string {
	log.trace('decrypt: decrypting value', { ciphertextLength: ciphertext.length });
	try {
		const key = getKey();
		const [ivHex, encHex, tagHex] = ciphertext.split(':');
		if (!ivHex || !encHex || !tagHex) {
			log.error('decrypt: invalid ciphertext format', undefined, { parts: ciphertext.split(':').length });
			throw new Error('Invalid ciphertext format');
		}
		const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
		decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
		const result = decipher.update(encHex, 'hex', 'utf8') + decipher.final('utf8');
		log.trace('decrypt: success', { plaintextLength: result.length });
		return result;
	} catch (err) {
		log.error('decrypt failed', err);
		throw err;
	}
}
