-- CreateTable
CREATE TABLE `brand_profiles` (
    `id` CHAR(36) NOT NULL,
    `scope` ENUM('PLATFORM', 'TENANT') NOT NULL,
    `tenantId` CHAR(36) NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `version` INTEGER NOT NULL DEFAULT 0,
    `data` JSON NOT NULL,
    `updatedBy` CHAR(36) NULL,
    `publishedBy` CHAR(36) NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `brand_profiles_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `brand_profiles_scope_status_idx`(`scope`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `brand_profiles` ADD CONSTRAINT `brand_profiles_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Move each company's accent colour and default theme into its first published brand (version 1).
INSERT INTO `brand_profiles` (`id`, `scope`, `tenantId`, `status`, `version`, `data`, `publishedAt`, `updatedAt`)
SELECT UUID(), 'TENANT', a.`tenantId`, 'PUBLISHED', 1,
  JSON_OBJECT('theme', JSON_OBJECT(
    'preset', 'custom',
    'accent', JSON_UNQUOTE(a.`value`),
    'defaultMode', COALESCE(JSON_UNQUOTE(t.`value`), 'system'))),
  NOW(3), NOW(3)
FROM `setting_values` a
LEFT JOIN `setting_values` t
  ON t.`scope` = 'TENANT' AND t.`scopeId` = a.`scopeId` AND t.`key` = 'branding.defaultTheme'
WHERE a.`scope` = 'TENANT' AND a.`key` = 'branding.accentColor';

-- A company that only set a default theme.
INSERT INTO `brand_profiles` (`id`, `scope`, `tenantId`, `status`, `version`, `data`, `publishedAt`, `updatedAt`)
SELECT UUID(), 'TENANT', t.`tenantId`, 'PUBLISHED', 1,
  JSON_OBJECT('theme', JSON_OBJECT('preset', 'mint', 'accent', '#2a9158', 'defaultMode', JSON_UNQUOTE(t.`value`))),
  NOW(3), NOW(3)
FROM `setting_values` t
WHERE t.`scope` = 'TENANT' AND t.`key` = 'branding.defaultTheme'
  AND NOT EXISTS (
    SELECT 1 FROM `setting_values` a
    WHERE a.`scope` = 'TENANT' AND a.`scopeId` = t.`scopeId` AND a.`key` = 'branding.accentColor');

-- The company-level values now live in the brand. A person's own theme choice stays a setting.
DELETE FROM `setting_values` WHERE `key` = 'branding.accentColor';
DELETE FROM `setting_values` WHERE `key` = 'branding.defaultTheme' AND `scope` <> 'USER';
DELETE FROM `platform_settings` WHERE `key` IN ('branding.accentColor', 'branding.defaultTheme');
