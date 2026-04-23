-- 이메일 + 비밀번호 자체 인증: users 테이블에 passwordHash 컬럼 추가
ALTER TABLE `users` ADD COLUMN `passwordHash` varchar(255);

-- email이 유일한 로그인 식별자이므로 unique index (null 허용)
-- 기존 OAuth 계정과의 충돌 방지를 위해 NULL 허용
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
