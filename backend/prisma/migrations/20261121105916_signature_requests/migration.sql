-- CreateTable
CREATE TABLE `signature_requests` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `documentId` CHAR(36) NOT NULL,
    `method` ENUM('OTP', 'DSC', 'AADHAAR') NOT NULL,
    `status` ENUM('PENDING', 'COMPLETED', 'DECLINED', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `finalStep` BOOLEAN NOT NULL DEFAULT false,
    `expiresAt` DATETIME(3) NOT NULL,
    `sealedFileId` CHAR(36) NULL,
    `documentSha256` CHAR(64) NOT NULL,
    `createdBy` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `signature_requests_tenantId_documentId_idx`(`tenantId`, `documentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `signature_parties` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `requestId` CHAR(36) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'DECLINED') NOT NULL DEFAULT 'PENDING',
    `respondedAt` DATETIME(3) NULL,

    UNIQUE INDEX `signature_parties_tokenHash_key`(`tokenHash`),
    INDEX `signature_parties_tenantId_requestId_idx`(`tenantId`, `requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `signature_events` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `requestId` CHAR(36) NOT NULL,
    `partyId` CHAR(36) NULL,
    `type` VARCHAR(60) NOT NULL,
    `ip` VARCHAR(64) NULL,
    `userAgent` VARCHAR(255) NULL,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `signature_events_requestId_createdAt_idx`(`requestId`, `createdAt`),
    INDEX `signature_events_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `signature_requests` ADD CONSTRAINT `signature_requests_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signature_parties` ADD CONSTRAINT `signature_parties_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signature_parties` ADD CONSTRAINT `signature_parties_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `signature_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signature_events` ADD CONSTRAINT `signature_events_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signature_events` ADD CONSTRAINT `signature_events_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `signature_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
