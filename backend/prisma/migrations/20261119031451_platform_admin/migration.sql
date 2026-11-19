-- CreateTable
CREATE TABLE `platform_users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(255) NULL,
    `status` ENUM('INVITED', 'ACTIVE', 'DISABLED') NOT NULL DEFAULT 'INVITED',
    `mfaSecretEnc` VARCHAR(255) NULL,
    `mfaEnabledAt` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `platform_users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_recovery_codes` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `codeHash` CHAR(64) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `platform_recovery_codes_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_sessions` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `userAgent` VARCHAR(255) NULL,
    `ip` VARCHAR(64) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `platform_sessions_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_refresh_tokens` (
    `id` CHAR(36) NOT NULL,
    `sessionId` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `platform_refresh_tokens_tokenHash_key`(`tokenHash`),
    INDEX `platform_refresh_tokens_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `platform_recovery_codes` ADD CONSTRAINT `platform_recovery_codes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `platform_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_sessions` ADD CONSTRAINT `platform_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `platform_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_refresh_tokens` ADD CONSTRAINT `platform_refresh_tokens_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `platform_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
