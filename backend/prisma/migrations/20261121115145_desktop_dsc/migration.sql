-- AlterTable
ALTER TABLE `signature_parties` ADD COLUMN `userId` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `signature_requests` ADD COLUMN `claimExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `claimedByDeviceId` CHAR(36) NULL,
    ADD COLUMN `inputFileId` CHAR(36) NULL,
    ADD COLUMN `signedFileId` CHAR(36) NULL,
    ADD COLUMN `testSignature` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `desktop_devices` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `platform` VARCHAR(30) NOT NULL,
    `appVersion` VARCHAR(30) NOT NULL,
    `credentialHash` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `desktop_devices_credentialHash_key`(`credentialHash`),
    INDEX `desktop_devices_tenantId_userId_idx`(`tenantId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `desktop_devices` ADD CONSTRAINT `desktop_devices_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
