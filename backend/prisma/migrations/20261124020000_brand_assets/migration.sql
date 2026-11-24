-- CreateTable
CREATE TABLE `brand_assets` (
    `id` CHAR(36) NOT NULL,
    `scope` ENUM('PLATFORM', 'TENANT') NOT NULL,
    `tenantId` CHAR(36) NULL,
    `kind` ENUM('LOGO_LIGHT', 'LOGO_DARK', 'FAVICON', 'PANEL_IMAGE') NOT NULL,
    `mimeType` VARCHAR(60) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `storageKey` VARCHAR(255) NOT NULL,
    `uploadedBy` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `brand_assets_storageKey_key`(`storageKey`),
    INDEX `brand_assets_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `brand_assets` ADD CONSTRAINT `brand_assets_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
