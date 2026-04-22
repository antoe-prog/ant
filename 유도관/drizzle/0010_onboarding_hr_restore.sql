CREATE TABLE IF NOT EXISTS `approvals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int,
	`documentId` int,
	`onboardingPlanId` int NOT NULL,
	`requestedBy` int NOT NULL,
	`approverId` int,
	`type` enum('task_completion','document_review','plan_completion') NOT NULL,
	`status` enum('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
	`comment` text,
	`decidedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `approvals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int,
	`onboardingPlanId` int NOT NULL,
	`uploadedBy` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`fileUrl` text,
	`fileType` varchar(64),
	`fileSize` int,
	`status` enum('pending','under_review','approved','rejected') NOT NULL DEFAULT 'pending',
	`reviewedBy` int,
	`reviewNote` text,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`type` enum('task_assigned','approval_needed','approval_result','document_status','training_reminder','general') NOT NULL DEFAULT 'general',
	`isRead` boolean NOT NULL DEFAULT false,
	`relatedId` int,
	`relatedType` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `onboarding_plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employeeId` int NOT NULL,
	`managerId` int,
	`hrId` int,
	`status` enum('not_started','in_progress','completed','on_hold') NOT NULL DEFAULT 'not_started',
	`completionRate` int NOT NULL DEFAULT 0,
	`targetCompletionDate` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `onboarding_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`onboardingPlanId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`category` enum('document','training','setup','meeting','other') NOT NULL DEFAULT 'other',
	`assignedTo` int,
	`assignedBy` int,
	`status` enum('pending','in_progress','completed','skipped') NOT NULL DEFAULT 'pending',
	`priority` enum('low','medium','high') NOT NULL DEFAULT 'medium',
	`dueDate` timestamp,
	`completedAt` timestamp,
	`requiresApproval` boolean NOT NULL DEFAULT false,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `training_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`onboardingPlanId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`instructor` varchar(128),
	`location` varchar(255),
	`meetingUrl` text,
	`scheduledAt` timestamp NOT NULL,
	`durationMinutes` int NOT NULL DEFAULT 60,
	`status` enum('scheduled','completed','cancelled','rescheduled') NOT NULL DEFAULT 'scheduled',
	`completedAt` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `training_sessions_id` PRIMARY KEY(`id`)
);
