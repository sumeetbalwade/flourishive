-- CreateTable
CREATE TABLE `sso_connections` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `provider` ENUM('GOOGLE', 'MICROSOFT') NOT NULL,
    `clientId` VARCHAR(200) NOT NULL,
    `clientSecretEnc` TEXT NOT NULL,
    `directoryId` VARCHAR(120) NULL,
    `hostedDomain` VARCHAR(120) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `enforce` BOOLEAN NOT NULL DEFAULT false,
    `updatedBy` CHAR(36) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sso_connections_tenantId_key`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sso_connections` ADD CONSTRAINT `sso_connections_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

