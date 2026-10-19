import { OrgStatus, PrismaClient, UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

const PERMISSION_DEFS: { module: string; page: string; action: string; label: string }[] = [
  // ── Dashboard (2) ──────────────────────────────────────────────────────────
  { module: 'dashboard', page: 'overview', action: 'read', label: 'View dashboard' },
  { module: 'dashboard', page: 'overview', action: 'export', label: 'Export dashboard' },

  // ── Employees (10) ─────────────────────────────────────────────────────────
  { module: 'employees', page: 'list', action: 'view_active', label: 'View active employees' },
  {
    module: 'employees',
    page: 'list',
    action: 'view_suspended',
    label: 'View suspended employees',
  },
  {
    module: 'employees',
    page: 'list',
    action: 'view_dismissed',
    label: 'View dismissed employees',
  },
  { module: 'employees', page: 'list', action: 'view_logs', label: 'View employee logs' },
  { module: 'employees', page: 'list', action: 'create', label: 'Add employees' },
  { module: 'employees', page: 'list', action: 'export', label: 'Export employees' },
  { module: 'employees', page: 'detail', action: 'update', label: 'Edit employees' },
  { module: 'employees', page: 'detail', action: 'delete', label: 'Delete employees' },
  { module: 'employees', page: 'detail', action: 'suspend', label: 'Suspend employees' },
  { module: 'employees', page: 'detail', action: 'activate', label: 'Activate employees' },

  // ── Roles (4) ──────────────────────────────────────────────────────────────
  { module: 'roles', page: 'list', action: 'read', label: 'View roles' },
  { module: 'roles', page: 'list', action: 'create', label: 'Create roles' },
  { module: 'roles', page: 'detail', action: 'update', label: 'Edit roles' },
  { module: 'roles', page: 'detail', action: 'delete', label: 'Delete roles' },

  // ── Clients (6) ────────────────────────────────────────────────────────────
  { module: 'clients', page: 'list', action: 'read', label: 'View clients' },
  { module: 'clients', page: 'list', action: 'create', label: 'Add clients' },
  { module: 'clients', page: 'list', action: 'export', label: 'Export clients' },
  { module: 'clients', page: 'detail', action: 'update', label: 'Edit clients' },
  { module: 'clients', page: 'detail', action: 'delete', label: 'Delete clients' },
  { module: 'clients', page: 'detail', action: 'suspend', label: 'Suspend clients' },

  // ── Support (14) ───────────────────────────────────────────────────────────
  { module: 'support', page: 'categories', action: 'read', label: 'View help categories' },
  { module: 'support', page: 'categories', action: 'create', label: 'Create help categories' },
  { module: 'support', page: 'categories', action: 'update', label: 'Edit help categories' },
  { module: 'support', page: 'categories', action: 'delete', label: 'Delete help categories' },
  { module: 'support', page: 'faqs', action: 'read', label: 'View help FAQs' },
  { module: 'support', page: 'faqs', action: 'create', label: 'Create help FAQs' },
  { module: 'support', page: 'faqs', action: 'update', label: 'Edit help FAQs' },
  { module: 'support', page: 'faqs', action: 'delete', label: 'Delete help FAQs' },
  { module: 'support', page: 'tickets', action: 'read', label: 'View support tickets' },
  { module: 'support', page: 'tickets', action: 'create', label: 'Create support tickets' },
  { module: 'support', page: 'tickets', action: 'update', label: 'Edit support tickets' },
  { module: 'support', page: 'tickets', action: 'delete', label: 'Delete support tickets' },
  { module: 'support', page: 'tickets', action: 'close', label: 'Close support tickets' },
  { module: 'support', page: 'tickets', action: 'export', label: 'Export support tickets' },
];

async function seedPermissions(): Promise<Map<string, string>> {
  // Wipe the old catalog (non-custom only). BundlePermission rows cascade-delete.
  await prisma.permission.deleteMany({ where: { custom: false } });

  const permissionIdMap = new Map<string, string>();
  for (const def of PERMISSION_DEFS) {
    const perm = await prisma.permission.create({
      data: {
        module: def.module,
        page: def.page,
        action: def.action,
        label: def.label,
        custom: false,
      },
    });
    permissionIdMap.set(`${def.module}:${def.page}:${def.action}`, perm.id);
  }

  console.log(`  Created ${PERMISSION_DEFS.length} permissions`);
  return permissionIdMap;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

async function seedSuperAdmin(): Promise<string> {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL;
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    // Env vars not set — find the existing super admin instead of creating one.
    const existing = await prisma.user.findFirst({
      where: { role: UserRole.SUPER_ADMIN, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!existing) {
      throw new Error(
        'No super admin found. Set SEED_SUPER_ADMIN_EMAIL + SEED_SUPER_ADMIN_PASSWORD to create one.',
      );
    }
    console.log(`  Super admin: ${existing.email} (${existing.id}) [existing — skipped create]`);
    return existing.id;
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash: await hashPassword(password),
      firstName: 'Super',
      lastName: 'Admin',
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
    },
  });

  console.log(`  Super admin: ${user.email} (${user.id})`);
  return user.id;
}

async function seedOrganizations(superAdminId: string): Promise<string> {
  const org = await prisma.organization.upsert({
    where: { regNumber: 'GRUB-ORG-001' },
    update: {},
    create: {
      name: 'GrubPac Foods Pvt Ltd',
      regNumber: 'GRUB-ORG-001',
      logoUrl: null,
      jurisdiction: 'Maharashtra',
      status: OrgStatus.ACTIVE,
      createdBy: superAdminId,
    },
  });

  console.log(`  Organisation: ${org.name} (${org.id})`);
  return org.id;
}

// superadmin@grubpac.com / SuperAdmin@123456

async function seedAdmins(superAdminId: string, orgId: string): Promise<string[]> {
  const admins = [
    {
      email: 'admin1@grubpac.com',
      password: 'Admin@123456',
      firstName: 'Alice',
      lastName: 'Johnson',
      employeeId: 'EMP-ADM-001',
      avatarUrl: null,
      phoneNumber: null,
      jurisdiction: null,
      joiningDate: null,
      organizationId: null,
    },
    {
      id: 'cmv655inn000titdjtpvb4qlz',
      email: 'admin2@grubpac.com',
      password: 'Admin@123456',
      firstName: 'Bob',
      lastName: 'Williams',
      employeeId: 'EMP-ADM-002',
      avatarUrl:
        'https://grub-media.s3.ap-south-1.amazonaws.com/development/avatars/cmv655inn000titdjtpvb4qlz/2026/10/14/b8354fce-db49-4b61-ad46-3471b19f3d47.png',
      phoneNumber: null,
      jurisdiction: null,
      joiningDate: null,
      organizationId: orgId,
    },
  ];

  const ids: string[] = [];

  for (const admin of admins) {
    const user = await prisma.user.upsert({
      where: { email: admin.email },
      update: { organizationId: admin.organizationId },
      create: {
        ...(admin.id ? { id: admin.id } : {}),
        email: admin.email,
        passwordHash: await hashPassword(admin.password),
        firstName: admin.firstName,
        lastName: admin.lastName,
        employeeId: admin.employeeId,
        avatarUrl: admin.avatarUrl,
        phoneNumber: admin.phoneNumber,
        jurisdiction: admin.jurisdiction,
        joiningDate: admin.joiningDate,
        organizationId: admin.organizationId,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        createdBy: superAdminId,
      },
    });
    ids.push(user.id);
    console.log(`  Admin: ${user.email} (${user.id})`);
  }

  return ids;
}

async function seedEmployees(adminIds: string[], superAdminId: string): Promise<string[]> {
  const employees = [
    {
      email: 'emp1@grubpac.com',
      password: 'Employee@123',
      firstName: 'Charlie',
      lastName: 'Brown',
      employeeId: 'EMP-001',
      phoneNumber: '+91-9000000001',
    },
    {
      email: 'emp2@grubpac.com',
      password: 'Employee@123',
      firstName: 'Diana',
      lastName: 'Prince',
      employeeId: 'EMP-002',
      phoneNumber: '+91-9000000002',
    },
    {
      email: 'emp3@grubpac.com',
      password: 'Employee@123',
      firstName: 'Ethan',
      lastName: 'Hunt',
      employeeId: 'EMP-003',
      phoneNumber: '+91-9000000003',
      status: UserStatus.INACTIVE,
    },
  ];

  const ids: string[] = [];

  for (const [i, emp] of employees.entries()) {
    const user = await prisma.user.upsert({
      where: { email: emp.email },
      update: {},
      create: {
        email: emp.email,
        passwordHash: await hashPassword(emp.password),
        firstName: emp.firstName,
        lastName: emp.lastName,
        employeeId: emp.employeeId,
        phoneNumber: emp.phoneNumber,
        role: UserRole.EMPLOYEE,
        status: emp.status ?? UserStatus.ACTIVE,
        createdBy: adminIds[i % adminIds.length] ?? superAdminId,
      },
    });
    ids.push(user.id);
    console.log(`  Employee: ${user.email} (${user.id})`);
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Permission Bundles
// ---------------------------------------------------------------------------

async function seedBundles(
  superAdminId: string,
  adminIds: string[],
  permMap: Map<string, string>,
): Promise<Map<string, string>> {
  const bundleIdMap = new Map<string, string>();

  const bundleDefs: {
    name: string;
    description: string;
    createdBy: string;
    permKeys: string[];
  }[] = [
    {
      name: 'Viewer',
      description: 'Read-only access across all modules',
      createdBy: superAdminId,
      permKeys: [
        'dashboard:overview:read',
        'employees:list:view_active',
        'roles:list:read',
        'clients:list:read',
        'support:categories:read',
        'support:faqs:read',
        'support:tickets:read',
      ],
    },
    {
      name: 'HR Manager',
      description: 'Manage employees and view audit logs',
      createdBy: superAdminId,
      permKeys: [
        'dashboard:overview:read',
        'dashboard:overview:export',
        'employees:list:view_active',
        'employees:list:view_suspended',
        'employees:list:view_dismissed',
        'employees:list:view_logs',
        'employees:list:create',
        'employees:list:export',
        'employees:detail:update',
        'employees:detail:suspend',
        'employees:detail:activate',
      ],
    },
    {
      name: 'Content Manager',
      description: 'Full access to support/help content',
      createdBy: adminIds[0] ?? superAdminId,
      permKeys: [
        'dashboard:overview:read',
        'support:categories:read',
        'support:categories:create',
        'support:categories:update',
        'support:categories:delete',
        'support:faqs:read',
        'support:faqs:create',
        'support:faqs:update',
        'support:faqs:delete',
      ],
    },
    {
      name: 'Admin Full Access',
      description: 'Full access for admins except super-admin operations',
      createdBy: superAdminId,
      permKeys: PERMISSION_DEFS.map((d) => `${d.module}:${d.page}:${d.action}`),
    },
  ];

  for (const def of bundleDefs) {
    const bundle = await prisma.permissionBundle.upsert({
      where: { createdBy_name: { createdBy: def.createdBy, name: def.name } },
      update: {},
      create: {
        name: def.name,
        description: def.description,
        createdBy: def.createdBy,
      },
    });
    bundleIdMap.set(def.name, bundle.id);

    // Attach permissions
    let attached = 0;
    for (const key of def.permKeys) {
      const permId = permMap.get(key);
      if (!permId) {
        console.warn(`  WARNING: permission key "${key}" not found in catalog — skipped`);
        continue;
      }
      await prisma.bundlePermission.upsert({
        where: { bundleId_permissionId: { bundleId: bundle.id, permissionId: permId } },
        update: {},
        create: { bundleId: bundle.id, permissionId: permId },
      });
      attached++;
    }

    console.log(`  Bundle "${def.name}": ${attached} permissions (id: ${bundle.id})`);
  }

  return bundleIdMap;
}

// ---------------------------------------------------------------------------
// User → Bundle assignments
// ---------------------------------------------------------------------------

async function seedUserBundles(
  adminIds: string[],
  employeeIds: string[],
  bundleMap: Map<string, string>,
  superAdminId: string,
): Promise<void> {
  const assignments: { userId: string; bundleName: string; assignedBy: string }[] = [
    { userId: adminIds[0], bundleName: 'Admin Full Access', assignedBy: superAdminId },
    { userId: adminIds[1], bundleName: 'Admin Full Access', assignedBy: superAdminId },
    { userId: employeeIds[0], bundleName: 'Content Manager', assignedBy: adminIds[0] },
    { userId: employeeIds[1], bundleName: 'HR Manager', assignedBy: adminIds[0] },
    { userId: employeeIds[2], bundleName: 'Viewer', assignedBy: adminIds[1] },
  ];

  for (const a of assignments) {
    const bundleId = bundleMap.get(a.bundleName);
    if (!bundleId || !a.userId) continue;
    await prisma.userBundle.upsert({
      where: { userId_bundleId: { userId: a.userId, bundleId } },
      update: {},
      create: { userId: a.userId, bundleId, assignedBy: a.assignedBy },
    });
  }

  console.log(`  Assigned bundles to ${assignments.length} users`);
}

// ---------------------------------------------------------------------------
// Admin → Employee assignments
// ---------------------------------------------------------------------------

async function seedAdminEmployeeAssignments(
  adminIds: string[],
  employeeIds: string[],
  superAdminId: string,
): Promise<void> {
  const assignments = [
    { employeeId: employeeIds[0], adminId: adminIds[0] },
    { employeeId: employeeIds[1], adminId: adminIds[0] },
    { employeeId: employeeIds[2], adminId: adminIds[1] },
  ];

  for (const a of assignments) {
    if (!a.employeeId || !a.adminId) continue;
    await prisma.adminEmployeeAssignment.upsert({
      where: { employeeId: a.employeeId },
      update: {},
      create: { employeeId: a.employeeId, adminId: a.adminId, assignedBy: superAdminId },
    });
  }

  console.log(`  Admin-employee assignments: ${assignments.length}`);
}

// ---------------------------------------------------------------------------
// Help Categories & FAQs
// ---------------------------------------------------------------------------

async function seedHelp(): Promise<void> {
  const categories = [
    {
      name: 'Getting Started',
      description: 'Onboarding guides and initial setup',
      icon: 'help/categories/getting-started.png',
      displayOrder: 1,
      faqs: [
        {
          question: 'How do I log in for the first time?',
          answer:
            'Navigate to the login page, enter the email and temporary password sent to you, then set a new password when prompted.',
          displayOrder: 1,
        },
        {
          question: 'How do I reset my password?',
          answer:
            'Click "Forgot Password" on the login screen and enter your registered email. A reset link will be sent within a few minutes.',
          displayOrder: 2,
        },
        {
          question: 'Can I log in with an OTP instead of a password?',
          answer:
            'Yes. On the login page choose "Login with OTP", enter your email, and a 4-digit code will be sent to your registered email address.',
          displayOrder: 3,
        },
      ],
    },
    {
      name: 'Account & Profile',
      description: 'Managing your personal account settings',
      icon: 'help/categories/account.png',
      displayOrder: 2,
      faqs: [
        {
          question: 'How do I update my profile picture?',
          answer:
            'Go to Profile → Edit Profile, click the avatar area, and upload a new image. Supported formats: JPG, PNG (max 5 MB).',
          displayOrder: 1,
        },
        {
          question: 'How do I change my email address?',
          answer:
            'Go to Profile → Security, enter your new email, and verify it with the OTP sent to the new address.',
          displayOrder: 2,
        },
        {
          question: 'How do I change my phone number?',
          answer:
            'Go to Profile → Security, enter your new phone number, and verify it with the OTP sent to that number.',
          displayOrder: 3,
        },
      ],
    },
    {
      name: 'Permissions & Access',
      description: 'Understanding roles, bundles, and access control',
      icon: 'help/categories/permissions.png',
      displayOrder: 3,
      faqs: [
        {
          question: 'What is a Permission Bundle?',
          answer:
            'A Permission Bundle is a named group of permissions that can be assigned to users. Admins create bundles for common roles (e.g., "Content Manager") to simplify access management.',
          displayOrder: 1,
        },
        {
          question: 'Who can assign bundles to users?',
          answer:
            'Super Admins and Admins with the "permissions:assign:create" permission can assign bundles.',
          displayOrder: 2,
        },
      ],
    },
    {
      name: 'Media Library',
      description: 'Uploading, organising, and sharing media assets',
      icon: 'help/categories/media.png',
      displayOrder: 4,
      faqs: [
        {
          question: 'What file types are supported for upload?',
          answer:
            'Images (JPG, PNG, GIF, WEBP), videos (MP4, MOV), and documents (PDF). Maximum single-file size is 200 MB.',
          displayOrder: 1,
        },
        {
          question: 'How do I delete a media asset?',
          answer:
            'Open the asset in the library, click the kebab menu (⋮), and select "Delete". You need the "media:library:delete" permission.',
          displayOrder: 2,
        },
      ],
    },
    {
      name: 'Billing & Support',
      description: 'Plans, invoices, and contacting support',
      icon: 'help/categories/billing.png',
      displayOrder: 5,
      isActive: false,
      faqs: [
        {
          question: 'How do I download an invoice?',
          answer:
            'Go to Settings → Billing, find the relevant billing period, and click "Download PDF".',
          displayOrder: 1,
        },
      ],
    },
  ];

  for (const cat of categories) {
    const { faqs, isActive, ...catData } = cat;
    const category = await prisma.helpCategory.upsert({
      where: { id: catData.displayOrder },
      update: {},
      create: { ...catData, isActive: isActive ?? true },
    });

    for (const faq of faqs) {
      await prisma.helpFaq.upsert({
        where: {
          id: (category.id - 1) * 10 + faq.displayOrder,
        },
        update: {},
        create: { ...faq, categoryId: category.id },
      });
    }

    console.log(`  Help category "${category.name}" with ${faqs.length} FAQs`);
  }
}

// ---------------------------------------------------------------------------
// Audit Logs (sample entries)
// ---------------------------------------------------------------------------

async function seedAuditLogs(superAdminId: string, adminIds: string[]): Promise<void> {
  const entries = [
    {
      actorId: superAdminId,
      action: 'CREATE',
      resource: 'User',
      resourceId: adminIds[0],
      metadata: { role: 'ADMIN' },
    },
    {
      actorId: superAdminId,
      action: 'CREATE',
      resource: 'User',
      resourceId: adminIds[1],
      metadata: { role: 'ADMIN' },
    },
    {
      actorId: adminIds[0],
      action: 'UPDATE',
      resource: 'PermissionBundle',
      resourceId: null,
      metadata: { bundleName: 'Content Manager' },
    },
  ];

  for (const entry of entries) {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId ?? undefined,
        metadata: entry.metadata,
      },
    });
  }

  console.log(`  Created ${entries.length} audit log entries`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n🌱 Seeding database...\n');

  console.log('→ Permissions');
  const permMap = await seedPermissions();

  console.log('\n→ Organisations');
  const superAdminId = await seedSuperAdmin();
  const orgId = await seedOrganizations(superAdminId);

  console.log('\n→ Users');
  const adminIds = await seedAdmins(superAdminId, orgId);
  const employeeIds = await seedEmployees(adminIds, superAdminId);

  console.log('\n→ Permission Bundles');
  const bundleMap = await seedBundles(superAdminId, adminIds, permMap);

  console.log('\n→ User Bundle Assignments');
  await seedUserBundles(adminIds, employeeIds, bundleMap, superAdminId);

  console.log('\n→ Admin-Employee Assignments');
  await seedAdminEmployeeAssignments(adminIds, employeeIds, superAdminId);

  console.log('\n→ Help Content');
  await seedHelp();

  console.log('\n→ Audit Logs');
  await seedAuditLogs(superAdminId, adminIds);

  console.log('\n✅ Seed complete.\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
