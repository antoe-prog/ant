-- 이력이 없는 오등록 회원의 안전한 삭제를 변경 기록에 남긴다.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'member.delete';
