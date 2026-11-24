-- CreateTable
CREATE TABLE `log_requests` (
    `id` CHAR(36) NOT NULL,
    `requestId` VARCHAR(64) NOT NULL,
    `tenantId` CHAR(36) NULL,
    `actorType` VARCHAR(20) NULL,
    `actorId` CHAR(36) NULL,
    `method` VARCHAR(10) NOT NULL,
    `routePattern` VARCHAR(200) NOT NULL,
    `status` INTEGER NOT NULL,
    `durationMs` INTEGER NOT NULL,
    `ip` VARCHAR(64) NULL,
    `userAgentShort` VARCHAR(120) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `log_requests_createdAt_idx`(`createdAt`),
    INDEX `log_requests_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `log_requests_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `log_errors` (
    `id` CHAR(36) NOT NULL,
    `requestId` VARCHAR(64) NULL,
    `tenantId` CHAR(36) NULL,
    `actorId` CHAR(36) NULL,
    `routePattern` VARCHAR(200) NULL,
    `errorCode` VARCHAR(60) NOT NULL,
    `message` VARCHAR(500) NOT NULL,
    `story` TEXT NOT NULL,
    `stack` TEXT NULL,
    `fingerprint` CHAR(40) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 1,
    `firstSeen` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeen` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `log_errors_lastSeen_idx`(`lastSeen`),
    INDEX `log_errors_tenantId_lastSeen_idx`(`tenantId`, `lastSeen`),
    INDEX `log_errors_requestId_idx`(`requestId`),
    UNIQUE INDEX `log_errors_fingerprint_tenantId_key`(`fingerprint`, `tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `log_signins` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NULL,
    `userId` CHAR(36) NULL,
    `emailHash` CHAR(64) NOT NULL,
    `outcome` ENUM('SUCCESS', 'BAD_PASSWORD', 'LOCKED', 'MFA_OK', 'MFA_FAILED', 'PASSKEY', 'TRUSTED_DEVICE', 'SUSPENDED') NOT NULL,
    `ip` VARCHAR(64) NULL,
    `userAgentShort` VARCHAR(120) NULL,
    `requestId` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `log_signins_createdAt_idx`(`createdAt`),
    INDEX `log_signins_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `log_signins_emailHash_idx`(`emailHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `alert_subscriptions` (
    `id` CHAR(36) NOT NULL,
    `subscriberType` ENUM('PLATFORM_USER', 'USER') NOT NULL,
    `subscriberId` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NULL,
    `event` ENUM('ERROR_SPIKE', 'JOB_FAILING', 'MAIL_FAILING', 'AUDIT_CHAIN_BROKEN', 'SIGNIN_ATTACK', 'DISK_LOW', 'SENDER_DNS_BROKEN') NOT NULL,
    `delivery` ENUM('INSTANT', 'DIGEST', 'OFF') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `alert_subscriptions_event_delivery_idx`(`event`, `delivery`),
    UNIQUE INDEX `alert_subscriptions_subscriberType_subscriberId_event_key`(`subscriberType`, `subscriberId`, `event`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
