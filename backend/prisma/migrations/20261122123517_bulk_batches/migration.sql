-- CreateTable
CREATE TABLE `bulk_batches` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `templateId` CHAR(36) NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    `createdBy` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bulk_batches_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bulk_batch_rows` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `batchId` CHAR(36) NOT NULL,
    `position` INTEGER NOT NULL,
    `personId` CHAR(36) NULL,
    `engagementId` CHAR(36) NULL,
    `fields` JSON NOT NULL,
    `status` ENUM('PENDING', 'DONE', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `documentId` CHAR(36) NULL,
    `error` VARCHAR(500) NULL,

    INDEX `bulk_batch_rows_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `bulk_batch_rows_batchId_position_key`(`batchId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bulk_batches` ADD CONSTRAINT `bulk_batches_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bulk_batch_rows` ADD CONSTRAINT `bulk_batch_rows_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bulk_batch_rows` ADD CONSTRAINT `bulk_batch_rows_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `bulk_batches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
