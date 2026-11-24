-- AlterTable
ALTER TABLE `subscriptions` ADD COLUMN `billingInterval` ENUM('MONTHLY', 'YEARLY') NULL,
    ADD COLUMN `cancelAtPeriodEnd` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `gatewaySubscriptionId` VARCHAR(64) NULL,
    ADD COLUMN `pendingPlanId` CHAR(36) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `subscriptions_gatewaySubscriptionId_key` ON `subscriptions`(`gatewaySubscriptionId`);

