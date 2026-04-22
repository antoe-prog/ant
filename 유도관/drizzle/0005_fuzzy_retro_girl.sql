CREATE TABLE `memberMemoHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`memberId` int NOT NULL,
	`content` text NOT NULL,
	`savedBy` int NOT NULL,
	`savedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `memberMemoHistory_id` PRIMARY KEY(`id`)
);
