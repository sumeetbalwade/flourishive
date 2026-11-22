-- CreateTable
CREATE TABLE `esign_transactions` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `requestId` CHAR(36) NOT NULL,
    `provider` VARCHAR(40) NOT NULL,
    `providerTxnId` VARCHAR(100) NOT NULL,
    `status` ENUM('PENDING', 'SIGNED', 'DECLINED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `esign_transactions_tenantId_requestId_idx`(`tenantId`, `requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `esign_transactions` ADD CONSTRAINT `esign_transactions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
