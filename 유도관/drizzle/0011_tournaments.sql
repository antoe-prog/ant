CREATE TABLE IF NOT EXISTS `tournaments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`eventDate` date NOT NULL,
	`location` varchar(255),
	`registrationDeadline` date,
	`description` text,
	`status` enum('upcoming','ongoing','completed','cancelled') NOT NULL DEFAULT 'upcoming',
	`recordedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tournaments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tournament_participants` (
	`tournamentId` int NOT NULL,
	`memberId` int NOT NULL,
	`weightClass` varchar(64),
	`division` varchar(64),
	`result` enum('pending','participated','gold','silver','bronze','absent') NOT NULL DEFAULT 'pending',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tournament_participants_tournamentId_memberId_pk` PRIMARY KEY(`tournamentId`,`memberId`)
);
--> statement-breakpoint
CREATE INDEX `tournaments_eventDate_idx` ON `tournaments` (`eventDate`);
--> statement-breakpoint
CREATE INDEX `tournament_participants_memberId_idx` ON `tournament_participants` (`memberId`);
