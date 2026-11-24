-- CreateTable
CREATE TABLE `tenant_domains` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `hostname` VARCHAR(253) NOT NULL,
    `status` ENUM('PENDING_DNS', 'VERIFIED', 'ACTIVE', 'FAILED') NOT NULL DEFAULT 'PENDING_DNS',
    `verificationToken` VARCHAR(64) NOT NULL,
    `checkedAt` DATETIME(3) NULL,
    `error` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenant_domains_hostname_key`(`hostname`),
    INDEX `tenant_domains_tenantId_idx`(`tenantId`),
    INDEX `tenant_domains_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tenant_domains` ADD CONSTRAINT `tenant_domains_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
