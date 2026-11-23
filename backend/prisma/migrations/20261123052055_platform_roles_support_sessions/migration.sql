-- AlterTable
ALTER TABLE `audit_log` MODIFY `actorType` ENUM('USER', 'PLATFORM', 'SYSTEM', 'SUPPORT') NOT NULL;

-- AlterTable
ALTER TABLE `platform_users` ADD COLUMN `roleId` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `platform_roles` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(60) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `description` VARCHAR(255) NULL,
    `isPreset` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `platform_roles_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_role_permissions` (
    `roleId` CHAR(36) NOT NULL,
    `permissionCode` VARCHAR(60) NOT NULL,

    PRIMARY KEY (`roleId`, `permissionCode`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_sessions` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `platformUserId` CHAR(36) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `mode` ENUM('READ', 'WRITE') NOT NULL DEFAULT 'READ',
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `endedAt` DATETIME(3) NULL,

    INDEX `support_sessions_tenantId_startedAt_idx`(`tenantId`, `startedAt`),
    INDEX `support_sessions_platformUserId_idx`(`platformUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- Preset roles (their permissions are kept in step by the API at startup) and every existing
-- member of staff becomes an Owner, so nobody loses access.
INSERT INTO `platform_roles` (`id`, `key`, `name`, `description`, `isPreset`) VALUES
  ('00000000-0000-7000-8000-000000000001', 'owner', 'Owner', 'Everything, including who else is staff and what roles can do', true),
  ('00000000-0000-7000-8000-000000000002', 'super_admin', 'Super admin', 'Everything except managing staff and roles, and changing secrets', true),
  ('00000000-0000-7000-8000-000000000003', 'support', 'Support', 'See companies, accounts and logs, and open view-only support sessions', true),
  ('00000000-0000-7000-8000-000000000004', 'auditor', 'Read-only auditor', 'See companies, logs and the platform audit trail. Cannot open companies', true);
UPDATE `platform_users` SET `roleId` = '00000000-0000-7000-8000-000000000001' WHERE `roleId` IS NULL;
ALTER TABLE `platform_users` MODIFY `roleId` CHAR(36) NOT NULL;

-- AddForeignKey
ALTER TABLE `platform_users` ADD CONSTRAINT `platform_users_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `platform_roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_role_permissions` ADD CONSTRAINT `platform_role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `platform_roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_sessions` ADD CONSTRAINT `support_sessions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_sessions` ADD CONSTRAINT `support_sessions_platformUserId_fkey` FOREIGN KEY (`platformUserId`) REFERENCES `platform_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
