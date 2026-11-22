-- AlterTable
ALTER TABLE `generated_documents` ADD COLUMN `downloadReleasedAt` DATETIME(3) NULL,
    ADD COLUMN `downloadReleasedBy` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `delivery_links` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `documentId` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `sentTo` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdBy` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `delivery_links_tokenHash_key`(`tokenHash`),
    INDEX `delivery_links_tenantId_documentId_idx`(`tenantId`, `documentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `delivery_links` ADD CONSTRAINT `delivery_links_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
