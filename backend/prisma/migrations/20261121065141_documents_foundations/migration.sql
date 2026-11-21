-- CreateTable
CREATE TABLE `letterheads` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    `orientation` ENUM('PORTRAIT', 'LANDSCAPE') NOT NULL DEFAULT 'PORTRAIT',
    `version` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `fileId` CHAR(36) NOT NULL,
    `marginTop` INTEGER NOT NULL DEFAULT 110,
    `marginBottom` INTEGER NOT NULL DEFAULT 90,
    `marginLeft` INTEGER NOT NULL DEFAULT 60,
    `marginRight` INTEGER NOT NULL DEFAULT 60,
    `createdBy` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `letterheads_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `letterheads_tenantId_entityId_orientation_version_key`(`tenantId`, `entityId`, `orientation`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `numbering_schemes` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    `letterType` VARCHAR(40) NOT NULL,
    `format` VARCHAR(120) NOT NULL,
    `startAt` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `numbering_schemes_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `numbering_schemes_tenantId_entityId_letterType_key`(`tenantId`, `entityId`, `letterType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `numbering_counters` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `schemeId` CHAR(36) NOT NULL,
    `period` VARCHAR(10) NOT NULL,
    `lastSeq` INTEGER NOT NULL,

    INDEX `numbering_counters_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `numbering_counters_schemeId_period_key`(`schemeId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `templates` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `letterType` VARCHAR(40) NOT NULL,
    `kind` ENUM('CODED', 'EDITOR', 'PDF_UPLOAD') NOT NULL DEFAULT 'CODED',
    `archivedAt` DATETIME(3) NULL,
    `createdBy` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `templates_tenantId_letterType_idx`(`tenantId`, `letterType`),
    UNIQUE INDEX `templates_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `template_versions` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `templateId` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `orientation` ENUM('PORTRAIT', 'LANDSCAPE') NOT NULL DEFAULT 'PORTRAIT',
    `layoutKey` VARCHAR(60) NULL,
    `content` JSON NOT NULL,
    `fields` JSON NOT NULL,
    `createdBy` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `template_versions_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `template_versions_templateId_version_key`(`templateId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `generated_documents` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    `templateVersionId` CHAR(36) NOT NULL,
    `letterheadId` CHAR(36) NOT NULL,
    `letterType` VARCHAR(40) NOT NULL,
    `reference` VARCHAR(80) NOT NULL,
    `verifyToken` VARCHAR(40) NOT NULL,
    `status` ENUM('GENERATED', 'SUPERSEDED', 'REVOKED') NOT NULL DEFAULT 'GENERATED',
    `personId` CHAR(36) NULL,
    `engagementId` CHAR(36) NULL,
    `data` JSON NOT NULL,
    `fileId` CHAR(36) NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `pageCount` INTEGER NOT NULL,
    `createdBy` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `generated_documents_verifyToken_key`(`verifyToken`),
    INDEX `generated_documents_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `generated_documents_tenantId_personId_idx`(`tenantId`, `personId`),
    UNIQUE INDEX `generated_documents_tenantId_reference_key`(`tenantId`, `reference`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `letterheads` ADD CONSTRAINT `letterheads_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `letterheads` ADD CONSTRAINT `letterheads_entityId_fkey` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `numbering_schemes` ADD CONSTRAINT `numbering_schemes_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `numbering_schemes` ADD CONSTRAINT `numbering_schemes_entityId_fkey` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `numbering_counters` ADD CONSTRAINT `numbering_counters_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `numbering_counters` ADD CONSTRAINT `numbering_counters_schemeId_fkey` FOREIGN KEY (`schemeId`) REFERENCES `numbering_schemes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `templates` ADD CONSTRAINT `templates_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `template_versions` ADD CONSTRAINT `template_versions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `template_versions` ADD CONSTRAINT `template_versions_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generated_documents` ADD CONSTRAINT `generated_documents_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generated_documents` ADD CONSTRAINT `generated_documents_entityId_fkey` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generated_documents` ADD CONSTRAINT `generated_documents_templateVersionId_fkey` FOREIGN KEY (`templateVersionId`) REFERENCES `template_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generated_documents` ADD CONSTRAINT `generated_documents_letterheadId_fkey` FOREIGN KEY (`letterheadId`) REFERENCES `letterheads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
