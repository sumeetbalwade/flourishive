-- AlterTable
ALTER TABLE `signature_requests` MODIFY `method` ENUM('OTP', 'DSC', 'AADHAAR', 'SEAL') NOT NULL;
