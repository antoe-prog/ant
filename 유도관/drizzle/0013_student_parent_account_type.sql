-- 플랜 B 1단계: 회원앱 가입 유형(학생/학부모) 분리
ALTER TABLE `users`
  ADD COLUMN `accountType` enum('student','parent') NOT NULL DEFAULT 'student' AFTER `role`;
