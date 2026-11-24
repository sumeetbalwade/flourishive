-- AlterTable
ALTER TABLE `subscriptions` ADD COLUMN `lastReminderAt` DATETIME(3) NULL,
    ADD COLUMN `pastDueSince` DATETIME(3) NULL,
    ADD COLUMN `reminderCount` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `billing_profiles` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `legalName` VARCHAR(191) NOT NULL,
    `gstin` VARCHAR(15) NULL,
    `address` VARCHAR(500) NOT NULL,
    `stateCode` CHAR(2) NOT NULL,
    `billingEmail` VARCHAR(191) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `billing_profiles_tenantId_key`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `paymentId` CHAR(36) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `description` VARCHAR(300) NOT NULL,
    `periodStart` DATETIME(3) NULL,
    `periodEnd` DATETIME(3) NULL,
    `sacCode` VARCHAR(10) NOT NULL,
    `gstRate` INTEGER NOT NULL,
    `taxableValue` INTEGER NOT NULL,
    `cgst` INTEGER NOT NULL DEFAULT 0,
    `sgst` INTEGER NOT NULL DEFAULT 0,
    `igst` INTEGER NOT NULL DEFAULT 0,
    `total` INTEGER NOT NULL,
    `seller` JSON NOT NULL,
    `buyer` JSON NOT NULL,
    `fileId` CHAR(36) NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `invoices_paymentId_key`(`paymentId`),
    UNIQUE INDEX `invoices_number_key`(`number`),
    INDEX `invoices_tenantId_issuedAt_idx`(`tenantId`, `issuedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoice_counters` (
    `fy` VARCHAR(9) NOT NULL,
    `lastSeq` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`fy`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `billing_profiles` ADD CONSTRAINT `billing_profiles_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

