-- Role-based two-step and recovery policy, platform floors, and lockable platform settings.
ALTER TABLE `roles`
    ADD COLUMN `mfaLevel` ENUM('OFF', 'OPTIONAL', 'REQUIRED') NOT NULL DEFAULT 'OPTIONAL',
    ADD COLUMN `recoveryEmail` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `recoveryCodes` BOOLEAN NOT NULL DEFAULT true;

-- Keep today's behaviour: roles that required MFA keep requiring it.
UPDATE `roles` SET `mfaLevel` = 'REQUIRED' WHERE `mfaRequired` = true;

ALTER TABLE `roles` DROP COLUMN `mfaRequired`;

ALTER TABLE `platform_settings` ADD COLUMN `locked` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `platform_role_policies` (
    `roleKey` VARCHAR(64) NOT NULL,
    `mfaLevel` ENUM('OFF', 'OPTIONAL', 'REQUIRED') NOT NULL,
    `mfaFloor` ENUM('OFF', 'OPTIONAL', 'REQUIRED') NOT NULL DEFAULT 'OFF',
    `recoveryEmail` BOOLEAN NOT NULL DEFAULT true,
    `recoveryCodes` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`roleKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
