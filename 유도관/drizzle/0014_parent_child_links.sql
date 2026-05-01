-- 플랜 B 2단계: 학부모 계정과 자녀 회원을 별도 연결한다.
-- 학생 본인 계정은 members.userId를 계속 사용하고, 학부모는 이 다대다 테이블을 사용한다.
CREATE TABLE IF NOT EXISTS `parent_child_links` (
  `parentUserId` int NOT NULL,
  `memberId` int NOT NULL,
  `createdBy` int NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`parentUserId`, `memberId`),
  KEY `idx_parent_child_links_member` (`memberId`),
  KEY `idx_parent_child_links_parent` (`parentUserId`)
);
