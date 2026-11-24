-- CreateTable
CREATE TABLE `gateway_plan_refs` (
    `id` CHAR(36) NOT NULL,
    `planId` CHAR(36) NOT NULL,
    `interval` ENUM('MONTHLY', 'YEARLY') NOT NULL,
    `amount` INTEGER NOT NULL,
    `gatewayPlanId` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `gateway_plan_refs_planId_interval_amount_key`(`planId`, `interval`, `amount`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `gatewayPaymentId` VARCHAR(64) NOT NULL,
    `amount` INTEGER NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'INR',
    `status` ENUM('CAPTURED', 'FAILED', 'REFUNDED') NOT NULL,
    `method` VARCHAR(30) NULL,
    `failureReason` VARCHAR(300) NULL,
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payments_gatewayPaymentId_key`(`gatewayPaymentId`),
    INDEX `payments_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `billing_events` (
    `id` CHAR(36) NOT NULL,
    `gatewayEventId` VARCHAR(80) NOT NULL,
    `type` VARCHAR(60) NOT NULL,
    `payload` JSON NOT NULL,
    `processedAt` DATETIME(3) NULL,
    `error` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `billing_events_gatewayEventId_key`(`gatewayEventId`),
    INDEX `billing_events_type_createdAt_idx`(`type`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
