import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Idempotent seed: ensures a single SUPER_ADMIN exists from env credentials.
 * Fails loudly if the seed credentials are missing so we never create a
 * well-known default admin. Run with `npm run prisma:seed`.
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL;
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD are required to seed the super admin',
    );
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      firstName: 'Super',
      lastName: 'Admin',
      role: UserRole.SUPER_ADMIN,
    },
  });

  console.log(`Seeded super admin: ${user.email} (${user.id})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
