CREATE TABLE `promotion_checklist_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`label` varchar(255) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	CONSTRAINT `promotion_checklist_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `promotion_checklist_progress` (
	`promotionId` int NOT NULL,
	`templateId` int NOT NULL,
	`completedAt` timestamp NOT NULL DEFAULT (now()),
	`completedBy` int,
	CONSTRAINT `promotion_checklist_progress_promotionId_templateId_pk` PRIMARY KEY(`promotionId`,`templateId`)
);
--> statement-breakpoint
ALTER TABLE `promotion_checklist_progress` ADD CONSTRAINT `promotion_checklist_progress_promotionId_promotions_id_fk` FOREIGN KEY (`promotionId`) REFERENCES `promotions`(`id`) ON DELETE cascade ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE `promotion_checklist_progress` ADD CONSTRAINT `promotion_checklist_progress_templateId_promotion_checklist_templates_id_fk` FOREIGN KEY (`templateId`) REFERENCES `promotion_checklist_templates`(`id`) ON DELETE cascade ON UPDATE restrict;
--> statement-breakpoint
INSERT INTO `promotion_checklist_templates` (`label`, `sortOrder`, `isActive`) VALUES
('필수 출석 횟수 충족', 1, true),
('심사 서류 제출', 2, true),
('도복·예절 점검', 3, true),
('가드너 준비 (해당 시)', 4, true),
('부모 동의서 (미성년)', 5, true);
