import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const email = process.argv[2];
if (!email) {
	console.error('Usage: npx tsx scripts/promote-admin.ts <email>');
	process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

const user = await db.user.findUnique({ where: { email } });
if (!user) {
	console.error(`No user found with email: ${email}`);
	console.error('The user must log in at least once before being promoted.');
	await db.$disconnect();
	process.exit(1);
}

await db.user.update({
	where: { email },
	data: { isSuperAdmin: true, isProgramAuthor: true }
});

console.log(`Promoted ${user.name} (${email}) to super admin + program author.`);
await db.$disconnect();
