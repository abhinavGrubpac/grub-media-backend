"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const argon2 = __importStar(require("argon2"));
const prisma = new client_1.PrismaClient();
async function hashPassword(plain) {
    return argon2.hash(plain, { type: argon2.argon2id });
}
const PERMISSION_DEFS = [
    { module: 'users', page: 'list', action: 'read' },
    { module: 'users', page: 'list', action: 'export' },
    { module: 'users', page: 'detail', action: 'read' },
    { module: 'users', page: 'detail', action: 'update' },
    { module: 'users', page: 'detail', action: 'delete' },
    { module: 'users', page: 'create', action: 'create' },
    { module: 'permissions', page: 'bundles', action: 'read' },
    { module: 'permissions', page: 'bundles', action: 'create' },
    { module: 'permissions', page: 'bundles', action: 'update' },
    { module: 'permissions', page: 'bundles', action: 'delete' },
    { module: 'permissions', page: 'assign', action: 'create' },
    { module: 'help', page: 'categories', action: 'read' },
    { module: 'help', page: 'categories', action: 'create' },
    { module: 'help', page: 'categories', action: 'update' },
    { module: 'help', page: 'categories', action: 'delete' },
    { module: 'help', page: 'faqs', action: 'read' },
    { module: 'help', page: 'faqs', action: 'create' },
    { module: 'help', page: 'faqs', action: 'update' },
    { module: 'help', page: 'faqs', action: 'delete' },
    { module: 'audit', page: 'logs', action: 'read' },
    { module: 'audit', page: 'logs', action: 'export' },
    { module: 'dashboard', page: 'overview', action: 'read' },
    { module: 'media', page: 'library', action: 'read' },
    { module: 'media', page: 'library', action: 'create' },
    { module: 'media', page: 'library', action: 'update' },
    { module: 'media', page: 'library', action: 'delete' },
    { module: 'media', page: 'library', action: 'export' },
];
async function seedPermissions() {
    const permissionIdMap = new Map();
    for (const def of PERMISSION_DEFS) {
        const perm = await prisma.permission.upsert({
            where: { module_page_action: def },
            update: {},
            create: { ...def },
        });
        permissionIdMap.set(`${def.module}:${def.page}:${def.action}`, perm.id);
    }
    console.log(`  Upserted ${PERMISSION_DEFS.length} permissions`);
    return permissionIdMap;
}
async function seedSuperAdmin() {
    const email = process.env.SEED_SUPER_ADMIN_EMAIL;
    const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
    if (!email || !password) {
        const existing = await prisma.user.findFirst({
            where: { role: client_1.UserRole.SUPER_ADMIN, deletedAt: null },
            orderBy: { createdAt: 'asc' },
        });
        if (!existing) {
            throw new Error('No super admin found. Set SEED_SUPER_ADMIN_EMAIL + SEED_SUPER_ADMIN_PASSWORD to create one.');
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
            role: client_1.UserRole.SUPER_ADMIN,
            status: client_1.UserStatus.ACTIVE,
        },
    });
    console.log(`  Super admin: ${user.email} (${user.id})`);
    return user.id;
}
async function seedOrganizations(superAdminId) {
    const org = await prisma.organization.upsert({
        where: { regNumber: 'GRUB-ORG-001' },
        update: {},
        create: {
            name: 'GrubPac Foods Pvt Ltd',
            regNumber: 'GRUB-ORG-001',
            logoUrl: null,
            jurisdiction: 'Maharashtra',
            status: client_1.OrgStatus.ACTIVE,
            createdBy: superAdminId,
        },
    });
    console.log(`  Organisation: ${org.name} (${org.id})`);
    return org.id;
}
async function seedAdmins(superAdminId, orgId) {
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
            avatarUrl: 'https://grub-media.s3.ap-south-1.amazonaws.com/development/avatars/cmv655inn000titdjtpvb4qlz/2026/10/14/b8354fce-db49-4b61-ad46-3471b19f3d47.png',
            phoneNumber: null,
            jurisdiction: null,
            joiningDate: null,
            organizationId: orgId,
        },
    ];
    const ids = [];
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
                role: client_1.UserRole.ADMIN,
                status: client_1.UserStatus.ACTIVE,
                createdBy: superAdminId,
            },
        });
        ids.push(user.id);
        console.log(`  Admin: ${user.email} (${user.id})`);
    }
    return ids;
}
async function seedEmployees(adminIds, superAdminId) {
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
            status: client_1.UserStatus.INACTIVE,
        },
    ];
    const ids = [];
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
                role: client_1.UserRole.EMPLOYEE,
                status: emp.status ?? client_1.UserStatus.ACTIVE,
                createdBy: adminIds[i % adminIds.length] ?? superAdminId,
            },
        });
        ids.push(user.id);
        console.log(`  Employee: ${user.email} (${user.id})`);
    }
    return ids;
}
async function seedBundles(superAdminId, adminIds, permMap) {
    const bundleIdMap = new Map();
    const bundleDefs = [
        {
            name: 'Viewer',
            description: 'Read-only access across all modules',
            createdBy: superAdminId,
            permKeys: [
                'users:list:read',
                'users:detail:read',
                'help:categories:read',
                'help:faqs:read',
                'dashboard:overview:read',
                'media:library:read',
                'audit:logs:read',
            ],
        },
        {
            name: 'HR Manager',
            description: 'Manage users and view audit logs',
            createdBy: superAdminId,
            permKeys: [
                'users:list:read',
                'users:list:export',
                'users:detail:read',
                'users:detail:update',
                'users:create:create',
                'dashboard:overview:read',
                'audit:logs:read',
                'audit:logs:export',
            ],
        },
        {
            name: 'Content Manager',
            description: 'Full access to media library and help content',
            createdBy: adminIds[0] ?? superAdminId,
            permKeys: [
                'media:library:read',
                'media:library:create',
                'media:library:update',
                'media:library:delete',
                'media:library:export',
                'help:categories:read',
                'help:categories:create',
                'help:categories:update',
                'help:faqs:read',
                'help:faqs:create',
                'help:faqs:update',
                'dashboard:overview:read',
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
        for (const key of def.permKeys) {
            const permId = permMap.get(key);
            if (!permId)
                continue;
            await prisma.bundlePermission.upsert({
                where: { bundleId_permissionId: { bundleId: bundle.id, permissionId: permId } },
                update: {},
                create: { bundleId: bundle.id, permissionId: permId },
            });
        }
        console.log(`  Bundle "${def.name}": ${def.permKeys.length} permissions (id: ${bundle.id})`);
    }
    return bundleIdMap;
}
async function seedUserBundles(adminIds, employeeIds, bundleMap, superAdminId) {
    const assignments = [
        { userId: adminIds[0], bundleName: 'Admin Full Access', assignedBy: superAdminId },
        { userId: adminIds[1], bundleName: 'Admin Full Access', assignedBy: superAdminId },
        { userId: employeeIds[0], bundleName: 'Content Manager', assignedBy: adminIds[0] },
        { userId: employeeIds[1], bundleName: 'HR Manager', assignedBy: adminIds[0] },
        { userId: employeeIds[2], bundleName: 'Viewer', assignedBy: adminIds[1] },
    ];
    for (const a of assignments) {
        const bundleId = bundleMap.get(a.bundleName);
        if (!bundleId || !a.userId)
            continue;
        await prisma.userBundle.upsert({
            where: { userId_bundleId: { userId: a.userId, bundleId } },
            update: {},
            create: { userId: a.userId, bundleId, assignedBy: a.assignedBy },
        });
    }
    console.log(`  Assigned bundles to ${assignments.length} users`);
}
async function seedAdminEmployeeAssignments(adminIds, employeeIds, superAdminId) {
    const assignments = [
        { employeeId: employeeIds[0], adminId: adminIds[0] },
        { employeeId: employeeIds[1], adminId: adminIds[0] },
        { employeeId: employeeIds[2], adminId: adminIds[1] },
    ];
    for (const a of assignments) {
        if (!a.employeeId || !a.adminId)
            continue;
        await prisma.adminEmployeeAssignment.upsert({
            where: { employeeId: a.employeeId },
            update: {},
            create: { employeeId: a.employeeId, adminId: a.adminId, assignedBy: superAdminId },
        });
    }
    console.log(`  Admin-employee assignments: ${assignments.length}`);
}
async function seedHelp() {
    const categories = [
        {
            name: 'Getting Started',
            description: 'Onboarding guides and initial setup',
            icon: 'help/categories/getting-started.png',
            displayOrder: 1,
            faqs: [
                {
                    question: 'How do I log in for the first time?',
                    answer: 'Navigate to the login page, enter the email and temporary password sent to you, then set a new password when prompted.',
                    displayOrder: 1,
                },
                {
                    question: 'How do I reset my password?',
                    answer: 'Click "Forgot Password" on the login screen and enter your registered email. A reset link will be sent within a few minutes.',
                    displayOrder: 2,
                },
                {
                    question: 'Can I log in with an OTP instead of a password?',
                    answer: 'Yes. On the login page choose "Login with OTP", enter your email, and a 4-digit code will be sent to your registered email address.',
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
                    answer: 'Go to Profile → Edit Profile, click the avatar area, and upload a new image. Supported formats: JPG, PNG (max 5 MB).',
                    displayOrder: 1,
                },
                {
                    question: 'How do I change my email address?',
                    answer: 'Go to Profile → Security, enter your new email, and verify it with the OTP sent to the new address.',
                    displayOrder: 2,
                },
                {
                    question: 'How do I change my phone number?',
                    answer: 'Go to Profile → Security, enter your new phone number, and verify it with the OTP sent to that number.',
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
                    answer: 'A Permission Bundle is a named group of permissions that can be assigned to users. Admins create bundles for common roles (e.g., "Content Manager") to simplify access management.',
                    displayOrder: 1,
                },
                {
                    question: 'Who can assign bundles to users?',
                    answer: 'Super Admins and Admins with the "permissions:assign:create" permission can assign bundles.',
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
                    answer: 'Images (JPG, PNG, GIF, WEBP), videos (MP4, MOV), and documents (PDF). Maximum single-file size is 200 MB.',
                    displayOrder: 1,
                },
                {
                    question: 'How do I delete a media asset?',
                    answer: 'Open the asset in the library, click the kebab menu (⋮), and select "Delete". You need the "media:library:delete" permission.',
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
                    answer: 'Go to Settings → Billing, find the relevant billing period, and click "Download PDF".',
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
async function seedAuditLogs(superAdminId, adminIds) {
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
async function main() {
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
    .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
});
//# sourceMappingURL=seed.js.map