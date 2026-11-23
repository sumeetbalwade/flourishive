-- CreateTable
CREATE TABLE `mail_senders` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NULL,
    `kind` ENUM('PLATFORM_DEFAULT', 'VERIFIED_FROM', 'OWN_SMTP') NOT NULL,
    `fromName` VARCHAR(120) NOT NULL,
    `fromAddress` VARCHAR(191) NOT NULL,
    `replyTo` VARCHAR(191) NULL,
    `smtpHost` VARCHAR(255) NULL,
    `smtpPort` INTEGER NULL,
    `smtpSecure` BOOLEAN NOT NULL DEFAULT false,
    `smtpUser` VARCHAR(255) NULL,
    `smtpPassEnc` TEXT NULL,
    `status` ENUM('DRAFT', 'VERIFYING', 'ACTIVE', 'FAILED') NOT NULL DEFAULT 'DRAFT',
    `codeConfirmedAt` DATETIME(3) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `lastTestAt` DATETIME(3) NULL,
    `lastTestResult` VARCHAR(500) NULL,
    `dnsReport` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mail_senders_tenantId_key`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mail_deliveries` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NULL,
    `event` VARCHAR(60) NOT NULL,
    `toMasked` VARCHAR(191) NOT NULL,
    `toHash` CHAR(64) NOT NULL,
    `senderId` CHAR(36) NULL,
    `status` ENUM('QUEUED', 'SENT', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `providerMessageId` VARCHAR(255) NULL,
    `error` VARCHAR(500) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `requestId` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,

    INDEX `mail_deliveries_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `mail_deliveries_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `mail_deliveries_toHash_idx`(`toHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `mail_senders` ADD CONSTRAINT `mail_senders_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
