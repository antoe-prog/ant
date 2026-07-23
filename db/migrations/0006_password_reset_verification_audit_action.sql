-- 휴대폰 인증번호 검증 성공/실패를 비밀번호 변경과 분리해 감사한다.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'auth.password_reset.verify';
