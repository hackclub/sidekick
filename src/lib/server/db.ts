import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { createLogger } from './logger.js';

const log = createLogger('db');

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function maskUrl(raw: string): string {
	try {
		const u = new URL(raw);
		return u.host;
	} catch {
		return '<invalid-url>';
	}
}

function createClient() {
	const url = process.env.DATABASE_URL;
	if (!url) {
		log.error('DATABASE_URL is not set');
		throw new Error('DATABASE_URL is not set');
	}
	log.info('creating Prisma client', { host: maskUrl(url) });
	const adapter = new PrismaPg({ connectionString: url });
	const client = new PrismaClient({ adapter });
	log.info('Prisma client created');
	return client;
}

if (globalForPrisma.prisma) {
	log.debug('using cached Prisma client');
} else {
	log.debug('no cached Prisma client, creating new one');
}

export const db = globalForPrisma.prisma || createClient();

if (process.env.NODE_ENV !== 'production') {
	globalForPrisma.prisma = db;
	log.trace('cached Prisma client for development');
}
