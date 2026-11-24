-- CreateTable
CREATE TABLE `email_templates` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NULL,
    `event` VARCHAR(60) NOT NULL,
    `subject` VARCHAR(300) NOT NULL,
    `body` TEXT NOT NULL,
    `locked` BOOLEAN NOT NULL DEFAULT false,
    `updatedBy` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `email_templates_tenantId_event_idx`(`tenantId`, `event`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `email_templates` ADD CONSTRAINT `email_templates_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
