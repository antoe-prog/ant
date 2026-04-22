ALTER TABLE `announcements` ADD `pinnedUntil` date;
--> statement-breakpoint
CREATE TABLE `announcement_reads` (
	`userId` int NOT NULL,
	`announcementId` int NOT NULL,
	`readAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `announcement_reads_userId_announcementId_pk` PRIMARY KEY(`userId`,`announcementId`)
);
--> statement-breakpoint
ALTER TABLE `announcement_reads` ADD CONSTRAINT `announcement_reads_announcementId_announcements_id_fk` FOREIGN KEY (`announcementId`) REFERENCES `announcements`(`id`) ON DELETE cascade ON UPDATE restrict;
