-- CreateTable
CREATE TABLE `announcements` (
    `id` CHAR(36) NOT NULL,
    `message` VARCHAR(500) NOT NULL,
    `tone` ENUM('INFO', 'WARNING', 'CRITICAL') NOT NULL DEFAULT 'INFO',
    `tenantIds` JSON NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `dismissible` BOOLEAN NOT NULL DEFAULT true,
    `createdBy` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `announcements_startsAt_endsAt_idx`(`startsAt`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_features` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `feature` VARCHAR(60) NOT NULL,
    `enabled` BOOLEAN NOT NULL,
    `updatedBy` CHAR(36) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenant_features_tenantId_feature_key`(`tenantId`, `feature`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_usage_daily` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `day` DATE NOT NULL,
    `users` INTEGER NOT NULL,
    `activeUsers30d` INTEGER NOT NULL,
    `people` INTEGER NOT NULL,
    `lettersMonth` INTEGER NOT NULL,
    `storageBytes` BIGINT NOT NULL,
    `emailsSent` INTEGER NOT NULL,
    `lastActivityAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `tenant_usage_daily_tenantId_day_key`(`tenantId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tenant_features` ADD CONSTRAINT `tenant_features_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_usage_daily` ADD CONSTRAINT `tenant_usage_daily_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
