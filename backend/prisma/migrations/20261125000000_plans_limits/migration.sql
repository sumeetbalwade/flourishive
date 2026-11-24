-- CreateTable
CREATE TABLE `plans` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(40) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `description` VARCHAR(300) NOT NULL DEFAULT '',
    `priceMonthly` INTEGER NOT NULL DEFAULT 0,
    `priceYearly` INTEGER NOT NULL DEFAULT 0,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'INR',
    `isPublic` BOOLEAN NOT NULL DEFAULT true,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `plans_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plan_limits` (
    `id` CHAR(36) NOT NULL,
    `planId` CHAR(36) NOT NULL,
    `metric` VARCHAR(40) NOT NULL,
    `value` INTEGER NULL,

    UNIQUE INDEX `plan_limits_planId_metric_key`(`planId`, `metric`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscriptions` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `planId` CHAR(36) NOT NULL,
    `status` ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `limitOverrides` JSON NULL,
    `currentPeriodStart` DATETIME(3) NULL,
    `currentPeriodEnd` DATETIME(3) NULL,
    `updatedBy` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `subscriptions_tenantId_key`(`tenantId`),
    INDEX `subscriptions_planId_idx`(`planId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `plan_limits` ADD CONSTRAINT `plan_limits_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed plans (placeholder prices and limits, editable by the super admin)
INSERT INTO `plans` (`id`, `key`, `name`, `description`, `priceMonthly`, `priceYearly`, `currency`, `isPublic`, `isDefault`, `active`, `sortOrder`, `updatedAt`) VALUES
('00000000-0000-7000-8000-0000000000a1', 'free', 'Free', 'For trying Flourishive with a small team', 0, 0, 'INR', true, true, true, 10, CURRENT_TIMESTAMP(3)),
('00000000-0000-7000-8000-0000000000a2', 'starter', 'Starter', 'For growing companies', 99900, 999000, 'INR', true, false, true, 20, CURRENT_TIMESTAMP(3)),
('00000000-0000-7000-8000-0000000000a3', 'business', 'Business', 'For larger teams with high volume', 499900, 4999000, 'INR', true, false, true, 30, CURRENT_TIMESTAMP(3)),
('00000000-0000-7000-8000-0000000000a4', 'internal', 'Internal', 'No limits. For the company that runs Flourishive', 0, 0, 'INR', false, false, true, 99, CURRENT_TIMESTAMP(3));

INSERT INTO `plan_limits` (`id`, `planId`, `metric`, `value`) VALUES
('00000000-0000-7000-8000-0000000001a1', '00000000-0000-7000-8000-0000000000a1', 'users', 5),
('00000000-0000-7000-8000-0000000001a2', '00000000-0000-7000-8000-0000000000a1', 'storage_mb', 500),
('00000000-0000-7000-8000-0000000001a3', '00000000-0000-7000-8000-0000000000a1', 'signatures_month', 10),
('00000000-0000-7000-8000-0000000001b1', '00000000-0000-7000-8000-0000000000a2', 'users', 50),
('00000000-0000-7000-8000-0000000001b2', '00000000-0000-7000-8000-0000000000a2', 'storage_mb', 10240),
('00000000-0000-7000-8000-0000000001b3', '00000000-0000-7000-8000-0000000000a2', 'signatures_month', 200),
('00000000-0000-7000-8000-0000000001c1', '00000000-0000-7000-8000-0000000000a3', 'users', 500),
('00000000-0000-7000-8000-0000000001c2', '00000000-0000-7000-8000-0000000000a3', 'storage_mb', 102400),
('00000000-0000-7000-8000-0000000001c3', '00000000-0000-7000-8000-0000000000a3', 'signatures_month', 2000);

-- Companies that exist today keep working with no limits
INSERT INTO `subscriptions` (`id`, `tenantId`, `planId`, `status`, `updatedAt`)
SELECT UUID(), `id`, '00000000-0000-7000-8000-0000000000a4', 'ACTIVE', CURRENT_TIMESTAMP(3) FROM `tenants`;
