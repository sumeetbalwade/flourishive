-- CreateTable
CREATE TABLE `api_clients` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `clientId` VARCHAR(40) NOT NULL,
    `secretHash` CHAR(64) NOT NULL,
    `secretLast4` VARCHAR(4) NOT NULL,
    `scopes` JSON NOT NULL,
    `entityIds` JSON NULL,
    `rateLimitPerMinute` INTEGER NOT NULL DEFAULT 60,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `actingUserId` CHAR(36) NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `api_clients_clientId_key`(`clientId`),
    INDEX `api_clients_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `api_clients` ADD CONSTRAINT `api_clients_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

