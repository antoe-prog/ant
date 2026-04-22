-- Drop old tables
DROP TABLE IF EXISTS `notifications`;
DROP TABLE IF EXISTS `approvals`;
DROP TABLE IF EXISTS `training_sessions`;
DROP TABLE IF EXISTS `documents`;
DROP TABLE IF EXISTS `tasks`;
DROP TABLE IF EXISTS `onboarding_plans`;

-- Alter users table: update role enum and remove unused columns
ALTER TABLE `users`
  MODIFY COLUMN `role` enum('member','manager','admin') NOT NULL DEFAULT 'member';

ALTER TABLE `users`
  DROP COLUMN IF EXISTS `department`,
  DROP COLUMN IF EXISTS `position`,
  DROP COLUMN IF EXISTS `startDate`;

-- Create members table
CREATE TABLE `members` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int,
  `name` varchar(128) NOT NULL,
  `phone` varchar(20),
  `email` varchar(320),
  `birthDate` date,
  `gender` enum('male','female','other'),
  `beltRank` enum('white','yellow','orange','green','blue','brown','black') NOT NULL DEFAULT 'white',
  `beltDegree` int NOT NULL DEFAULT 1,
  `status` enum('active','suspended','withdrawn') NOT NULL DEFAULT 'active',
  `joinDate` date NOT NULL,
  `monthlyFee` int NOT NULL DEFAULT 0,
  `nextPaymentDate` date,
  `emergencyContact` varchar(128),
  `notes` text,
  `avatarUrl` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `members_id` PRIMARY KEY(`id`)
);

-- Create attendance table
CREATE TABLE `attendance` (
  `id` int AUTO_INCREMENT NOT NULL,
  `memberId` int NOT NULL,
  `attendanceDate` date NOT NULL,
  `checkInTime` timestamp,
  `type` enum('regular','makeup','trial') NOT NULL DEFAULT 'regular',
  `recordedBy` int,
  `notes` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `attendance_id` PRIMARY KEY(`id`)
);

-- Create payments table
CREATE TABLE `payments` (
  `id` int AUTO_INCREMENT NOT NULL,
  `memberId` int NOT NULL,
  `amount` int NOT NULL,
  `paidAt` timestamp NOT NULL DEFAULT (now()),
  `periodStart` date,
  `periodEnd` date,
  `method` enum('cash','card','transfer') NOT NULL DEFAULT 'cash',
  `notes` text,
  `recordedBy` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);

-- Create announcements table
CREATE TABLE `announcements` (
  `id` int AUTO_INCREMENT NOT NULL,
  `title` varchar(255) NOT NULL,
  `content` text NOT NULL,
  `isPinned` boolean NOT NULL DEFAULT false,
  `createdBy` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `announcements_id` PRIMARY KEY(`id`)
);
