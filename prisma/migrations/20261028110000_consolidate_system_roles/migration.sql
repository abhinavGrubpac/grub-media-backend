-- Consolidate permission bundles into the three system roles.
--
-- The Manage Roles screen is backed by PermissionBundle. This migration keeps
-- exactly one bundle for SUPER_ADMIN, ADMIN, and EMPLOYEE:
--   * ADMIN receives the full permission catalog (Admin Full Access + legacy
--     "Admin " permissions).
--   * EMPLOYEE receives the union of the non-admin bundles (Employees, Viewer,
--     HR Manager, Content Manager).
--   * SUPER_ADMIN receives the full permission catalog.
--
-- Every user is assigned exactly one of the three bundles. Users who were on
-- "Admin Full Access" or the legacy "Admin " bundle become ADMIN; every other
-- non-super-admin becomes EMPLOYEE. Existing SUPER_ADMIN users stay super-admin.
DO $$
DECLARE
  v_creator       TEXT;
  v_super_id      TEXT;
  v_admin_id      TEXT;
  v_employee_id   TEXT;
BEGIN
  SELECT id
    INTO v_creator
    FROM "User"
   WHERE role = 'SUPER_ADMIN'
   ORDER BY "createdAt" ASC
   LIMIT 1;

  v_creator := COALESCE(v_creator, 'system');

  -- Capture the users and permissions before old bundle rows are removed.
  DROP TABLE IF EXISTS _role_admin_users;
  CREATE TEMP TABLE _role_admin_users ("userId" TEXT PRIMARY KEY) ON COMMIT DROP;

  INSERT INTO _role_admin_users ("userId")
  SELECT DISTINCT ub."userId"
    FROM "UserBundle" ub
    JOIN "PermissionBundle" pb ON pb.id = ub."bundleId"
   WHERE pb.name IN ('Admin ', 'Admin Full Access', 'ADMIN')
  ON CONFLICT DO NOTHING;

  -- Preserve users who already carry the ADMIN role even if their bundle was
  -- missing or named differently.
  INSERT INTO _role_admin_users ("userId")
  SELECT id FROM "User" WHERE role = 'ADMIN'
  ON CONFLICT DO NOTHING;

  DROP TABLE IF EXISTS _role_employee_perms;
  CREATE TEMP TABLE _role_employee_perms ("permissionId" TEXT PRIMARY KEY) ON COMMIT DROP;

  INSERT INTO _role_employee_perms ("permissionId")
  SELECT DISTINCT bp."permissionId"
    FROM "BundlePermission" bp
    JOIN "PermissionBundle" pb ON pb.id = bp."bundleId"
   WHERE pb.name IN ('Employees', 'Viewer', 'HR Manager', 'Content Manager', 'EMPLOYEE')
  ON CONFLICT DO NOTHING;

  -- SUPER_ADMIN
  SELECT id
    INTO v_super_id
    FROM "PermissionBundle"
   WHERE name = 'SUPER_ADMIN'
   ORDER BY "createdAt" ASC
   LIMIT 1;

  IF v_super_id IS NULL THEN
    v_super_id := 'role_bundle_super_admin';
    INSERT INTO "PermissionBundle" (id, name, description, "createdBy", "createdAt", "updatedAt")
    VALUES (
      v_super_id,
      'SUPER_ADMIN',
      'Full access to every module and super-admin operation',
      v_creator,
      NOW(),
      NOW()
    );
  ELSE
    UPDATE "PermissionBundle"
       SET description = 'Full access to every module and super-admin operation',
           "updatedAt" = NOW()
     WHERE id = v_super_id;
  END IF;

  -- ADMIN (reuse Admin Full Access when possible)
  SELECT id
    INTO v_admin_id
    FROM "PermissionBundle"
   WHERE name = 'ADMIN'
   ORDER BY "createdAt" ASC
   LIMIT 1;

  IF v_admin_id IS NULL THEN
    SELECT id
      INTO v_admin_id
      FROM "PermissionBundle"
     WHERE name = 'Admin Full Access'
     ORDER BY "createdAt" ASC
     LIMIT 1;

    IF v_admin_id IS NOT NULL THEN
      UPDATE "PermissionBundle"
         SET name = 'ADMIN',
             description = 'Full access for admins except super-admin operations',
             "updatedAt" = NOW()
       WHERE id = v_admin_id;
    ELSE
      v_admin_id := 'role_bundle_admin';
      INSERT INTO "PermissionBundle" (id, name, description, "createdBy", "createdAt", "updatedAt")
      VALUES (
        v_admin_id,
        'ADMIN',
        'Full access for admins except super-admin operations',
        v_creator,
        NOW(),
        NOW()
      );
    END IF;
  ELSE
    UPDATE "PermissionBundle"
       SET description = 'Full access for admins except super-admin operations',
           "updatedAt" = NOW()
     WHERE id = v_admin_id;
  END IF;

  -- EMPLOYEE (reuse Employees when possible)
  SELECT id
    INTO v_employee_id
    FROM "PermissionBundle"
   WHERE name = 'EMPLOYEE'
   ORDER BY "createdAt" ASC
   LIMIT 1;

  IF v_employee_id IS NULL THEN
    SELECT id
      INTO v_employee_id
      FROM "PermissionBundle"
     WHERE name = 'Employees'
     ORDER BY "createdAt" ASC
     LIMIT 1;

    IF v_employee_id IS NOT NULL THEN
      UPDATE "PermissionBundle"
         SET name = 'EMPLOYEE',
             description = 'Standard employee access',
             "updatedAt" = NOW()
       WHERE id = v_employee_id;
    ELSE
      v_employee_id := 'role_bundle_employee';
      INSERT INTO "PermissionBundle" (id, name, description, "createdBy", "createdAt", "updatedAt")
      VALUES (
        v_employee_id,
        'EMPLOYEE',
        'Standard employee access',
        v_creator,
        NOW(),
        NOW()
      );
    END IF;
  ELSE
    UPDATE "PermissionBundle"
       SET description = 'Standard employee access',
           "updatedAt" = NOW()
     WHERE id = v_employee_id;
  END IF;

  -- Rebuild the permission sets.
  DELETE FROM "BundlePermission"
   WHERE "bundleId" IN (v_super_id, v_admin_id, v_employee_id);

  INSERT INTO "BundlePermission" ("bundleId", "permissionId")
  SELECT v_super_id, id FROM "Permission"
  ON CONFLICT DO NOTHING;

  INSERT INTO "BundlePermission" ("bundleId", "permissionId")
  SELECT v_admin_id, id FROM "Permission"
  ON CONFLICT DO NOTHING;

  INSERT INTO "BundlePermission" ("bundleId", "permissionId")
  SELECT v_employee_id, "permissionId" FROM _role_employee_perms
  ON CONFLICT DO NOTHING;

  -- Rebuild assignments so every user has exactly one of the three bundles.
  DELETE FROM "UserBundle";

  INSERT INTO "UserBundle" ("userId", "bundleId", "assignedBy", "createdAt")
  SELECT
    u.id,
    CASE
      WHEN u.role = 'SUPER_ADMIN' THEN v_super_id
      WHEN EXISTS (
        SELECT 1 FROM _role_admin_users au WHERE au."userId" = u.id
      ) THEN v_admin_id
      ELSE v_employee_id
    END,
    v_creator,
    NOW()
  FROM "User" u;

  -- Normalize the enum role to match the consolidated bundle.
  UPDATE "User" u
     SET role = CASE
       WHEN u.role = 'SUPER_ADMIN' THEN 'SUPER_ADMIN'
       WHEN EXISTS (
         SELECT 1 FROM _role_admin_users au WHERE au."userId" = u.id
       ) THEN 'ADMIN'
       ELSE 'EMPLOYEE'
     END::"UserRole";

  -- Remove every other bundle (and its remaining permission links).
  DELETE FROM "PermissionBundle"
   WHERE id NOT IN (v_super_id, v_admin_id, v_employee_id);

  DROP TABLE IF EXISTS _role_admin_users;
  DROP TABLE IF EXISTS _role_employee_perms;
END
$$;
