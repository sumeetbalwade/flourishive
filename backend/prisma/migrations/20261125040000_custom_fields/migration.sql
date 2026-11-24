-- CreateTable
CREATE TABLE `custom_field_definitions` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `entityType` ENUM('PERSON', 'ENGAGEMENT') NOT NULL,
    `key` VARCHAR(40) NOT NULL,
    `label` VARCHAR(80) NOT NULL,
    `helpText` VARCHAR(200) NOT NULL DEFAULT '',
    `type` ENUM('TEXT', 'NUMBER', 'DATE', 'SELECT', 'FILE') NOT NULL,
    `options` JSON NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `visibleToRoles` JSON NULL,
    `editableByRoles` JSON NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `archived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `custom_field_definitions_tenantId_entityType_idx`(`tenantId`, `entityType`),
    UNIQUE INDEX `custom_field_definitions_tenantId_entityType_key_key`(`tenantId`, `entityType`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `custom_field_values` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `definitionId` CHAR(36) NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    `value` JSON NOT NULL,
    `updatedBy` CHAR(36) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `custom_field_values_tenantId_entityId_idx`(`tenantId`, `entityId`),
    UNIQUE INDEX `custom_field_values_definitionId_entityId_key`(`definitionId`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `custom_field_definitions` ADD CONSTRAINT `custom_field_definitions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `custom_field_values` ADD CONSTRAINT `custom_field_values_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `custom_field_values` ADD CONSTRAINT `custom_field_values_definitionId_fkey` FOREIGN KEY (`definitionId`) REFERENCES `custom_field_definitions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

