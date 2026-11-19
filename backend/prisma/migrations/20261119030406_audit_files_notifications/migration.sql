-- CreateTable
CREATE TABLE `audit_log` (
    `seq` BIGINT NOT NULL AUTO_INCREMENT,
    `tenantId` CHAR(36) NOT NULL,
    `actorType` ENUM('USER', 'PLATFORM', 'SYSTEM') NOT NULL,
    `actorId` CHAR(36) NULL,
    `action` VARCHAR(120) NOT NULL,
    `entityType` VARCHAR(60) NULL,
    `entityId` VARCHAR(64) NULL,
    `meta` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL,
    `prevHash` CHAR(64) NOT NULL,
    `hash` CHAR(64) NOT NULL,

    INDEX `audit_log_tenantId_seq_idx`(`tenantId`, `seq`),
    INDEX `audit_log_tenantId_entityType_entityId_idx`(`tenantId`, `entityType`, `entityId`),
    PRIMARY KEY (`seq`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_chain_heads` (
    `tenantId` CHAR(36) NOT NULL,
    `lastSeq` BIGINT NOT NULL DEFAULT 0,
    `lastHash` CHAR(64) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `files` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `storageKey` VARCHAR(255) NOT NULL,
    `originalName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `uploadedBy` CHAR(36) NULL,
    `ownerType` VARCHAR(60) NULL,
    `ownerId` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `files_storageKey_key`(`storageKey`),
    INDEX `files_tenantId_idx`(`tenantId`),
    INDEX `files_tenantId_ownerType_ownerId_idx`(`tenantId`, `ownerType`, `ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `event` VARCHAR(100) NOT NULL,
    `toEmail` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `body` TEXT NOT NULL,
    `status` ENUM('QUEUED', 'SENT', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `error` VARCHAR(500) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_chain_heads` ADD CONSTRAINT `audit_chain_heads_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `files` ADD CONSTRAINT `files_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
