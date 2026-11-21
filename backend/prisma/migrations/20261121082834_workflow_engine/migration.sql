-- CreateTable
CREATE TABLE `workflow_definitions` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `key` VARCHAR(60) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `version` INTEGER NOT NULL,
    `states` JSON NOT NULL,
    `transitions` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workflow_definitions_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `workflow_definitions_tenantId_key_version_key`(`tenantId`, `key`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_instances` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `definitionId` CHAR(36) NOT NULL,
    `subjectType` VARCHAR(40) NOT NULL,
    `subjectId` CHAR(36) NOT NULL,
    `state` VARCHAR(60) NOT NULL,
    `createdBy` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `workflow_instances_tenantId_state_idx`(`tenantId`, `state`),
    UNIQUE INDEX `workflow_instances_tenantId_subjectType_subjectId_key`(`tenantId`, `subjectType`, `subjectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_actions` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `instanceId` CHAR(36) NOT NULL,
    `action` VARCHAR(60) NOT NULL,
    `fromState` VARCHAR(60) NOT NULL,
    `toState` VARCHAR(60) NOT NULL,
    `actorId` CHAR(36) NULL,
    `comment` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workflow_actions_instanceId_createdAt_idx`(`instanceId`, `createdAt`),
    INDEX `workflow_actions_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `workflow_definitions` ADD CONSTRAINT `workflow_definitions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_instances` ADD CONSTRAINT `workflow_instances_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_instances` ADD CONSTRAINT `workflow_instances_definitionId_fkey` FOREIGN KEY (`definitionId`) REFERENCES `workflow_definitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_actions` ADD CONSTRAINT `workflow_actions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_actions` ADD CONSTRAINT `workflow_actions_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `workflow_instances`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
