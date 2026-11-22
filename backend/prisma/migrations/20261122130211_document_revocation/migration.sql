-- AlterTable
ALTER TABLE `generated_documents` ADD COLUMN `statusChangedAt` DATETIME(3) NULL,
    ADD COLUMN `statusChangedBy` CHAR(36) NULL,
    ADD COLUMN `statusReason` VARCHAR(500) NULL,
    ADD COLUMN `supersededById` CHAR(36) NULL;
