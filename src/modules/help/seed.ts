/**
 * Seed script — `npm run prisma:seed` (or `npx prisma db seed`).
 *
 * Production Help APIs are GET-only; this is how help content gets into the
 * database. Idempotent: re-running updates existing rows instead of duplicating.
 */
import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

interface SeedFaq {
  question: string;
  answer: string;
}

interface SeedCategory {
  name: string;
  description: string;
  displayOrder: number;
  faqs: SeedFaq[];
}

const HELP_CATEGORIES: SeedCategory[] = [
  {
    name: 'Attendance',
    description: 'Attendance related help',
    displayOrder: 1,
    faqs: [
      {
        question: "Why can't I mark attendance?",
        answer:
          'Check your location permission and ensure you are inside the office geofence. If the problem persists, restart the app and try again.',
      },
      {
        question: 'How do I check in?',
        answer:
          'Open the Attendance tab and tap Check In. Make sure your location services are enabled and you are within the office premises.',
      },
      {
        question: 'Attendance check-in is not working',
        answer:
          'Confirm that location permission is granted, GPS is on, and you are inside the geofence. If it still fails, contact your admin to verify your office location settings.',
      },
    ],
  },
  {
    name: 'Leave',
    description: 'Leave application and balance related help',
    displayOrder: 2,
    faqs: [
      {
        question: 'How do I apply for leave?',
        answer:
          'Go to Leave → Apply Leave, select the leave type, date range and reason, then submit. You will get an update once your manager approves or rejects it.',
      },
      {
        question: 'How can I check my leave balance?',
        answer:
          'Open the Leave tab — your remaining balance for each leave type is shown at the top.',
      },
      {
        question: 'Why was my leave rejected?',
        answer:
          'Open the leave request to see the rejection comment from your approver. You can revise and reapply with the requested changes.',
      },
    ],
  },
  {
    name: 'Salary',
    description: 'Salary, payslips and payroll related help',
    displayOrder: 3,
    faqs: [
      {
        question: 'When is salary credited?',
        answer:
          'Salary is credited on the last working day of every month (or the previous working day if it is a holiday).',
      },
      {
        question: 'How do I download my payslip?',
        answer: 'Go to Salary → Payslips, select the month and tap Download to save the PDF.',
      },
      {
        question: 'Why is my salary less this month?',
        answer:
          'The payslip shows a full breakup of earnings and deductions. If anything looks incorrect, raise a query with the payroll team from the Salary screen.',
      },
    ],
  },
  {
    name: 'Profile',
    description: 'Profile and personal details related help',
    displayOrder: 4,
    faqs: [
      {
        question: 'How do I update my profile photo?',
        answer:
          'Open Profile → tap the camera icon on your photo, choose or capture a new image and save.',
      },
      {
        question: 'How do I change my phone number?',
        answer:
          'Go to Profile → Edit Details, update your phone number and save. An OTP may be required to verify the new number.',
      },
      {
        question: 'How do I update my address?',
        answer: 'Open Profile → Edit Details → Address, update the fields and save.',
      },
    ],
  },
  {
    name: 'Login & Account',
    description: 'Login, password and account related help',
    displayOrder: 5,
    faqs: [
      {
        question: 'I forgot my password',
        answer:
          'Tap Forgot Password on the login screen and follow the reset link sent to your registered email.',
      },
      {
        question: 'How do I reset my password?',
        answer:
          'Go to Profile → Security → Change Password. You must know your current password; otherwise use the Forgot Password flow.',
      },
      {
        question: 'Why am I being logged out frequently?',
        answer:
          'Sessions expire after a period of inactivity for security. If it happens immediately, check that your device clock is correct and update the app.',
      },
    ],
  },
];

async function seedHelp(): Promise<void> {
  for (const category of HELP_CATEGORIES) {
    const existing = await prisma.helpCategory.findFirst({ where: { name: category.name } });
    const data = {
      name: category.name,
      description: category.description,
      icon: `help/categories/${category.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`,
      displayOrder: category.displayOrder,
      isActive: true,
    };
    const saved = existing
      ? await prisma.helpCategory.update({ where: { id: existing.id }, data })
      : await prisma.helpCategory.create({ data });

    let order = 1;
    for (const faq of category.faqs) {
      const existingFaq = await prisma.helpFaq.findFirst({
        where: { categoryId: saved.id, question: faq.question },
      });
      const faqData = {
        answer: faq.answer,
        displayOrder: order,
        isActive: true,
      };
      if (existingFaq) {
        await prisma.helpFaq.update({ where: { id: existingFaq.id }, data: faqData });
      } else {
        await prisma.helpFaq.create({
          data: { categoryId: saved.id, question: faq.question, ...faqData },
        });
      }
      order += 1;
    }
    console.log(`Seeded category "${saved.name}" with ${category.faqs.length} FAQs`);
  }
}

/** Optional: creates the SUPER_ADMIN when SEED_SUPER_ADMIN_* env vars are set. */
async function seedSuperAdmin(): Promise<void> {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL;
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('SEED_SUPER_ADMIN_EMAIL/PASSWORD not set — skipping super-admin seed');
    return;
  }
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.user.upsert({
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
  console.log(`Super admin ready: ${email}`);
}

async function main(): Promise<void> {
  await seedHelp();
  await seedSuperAdmin();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
