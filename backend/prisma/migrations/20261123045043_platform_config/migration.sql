-- CreateTable
CREATE TABLE `platform_config` (
    `key` VARCHAR(100) NOT NULL,
    `valueJson` JSON NULL,
    `secretEnc` TEXT NULL,
    `updatedBy` CHAR(36) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
