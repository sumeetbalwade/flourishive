-- CreateTable
CREATE TABLE `webhook_subscriptions` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `description` VARCHAR(120) NOT NULL DEFAULT '',
    `secretEnc` TEXT NOT NULL,
    `events` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdBy` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `webhook_subscriptions_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_deliveries` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `subscriptionId` CHAR(36) NOT NULL,
    `eventId` CHAR(36) NOT NULL,
    `eventType` VARCHAR(60) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDING', 'DELIVERED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NULL,
    `lastStatusCode` INTEGER NULL,
    `lastError` VARCHAR(300) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `webhook_deliveries_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `webhook_deliveries_subscriptionId_createdAt_idx`(`subscriptionId`, `createdAt`),
    INDEX `webhook_deliveries_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `webhook_subscriptions` ADD CONSTRAINT `webhook_subscriptions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_deliveries` ADD CONSTRAINT `webhook_deliveries_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_deliveries` ADD CONSTRAINT `webhook_deliveries_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `webhook_subscriptions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

