-- 대회 참가 신청과 취소 이력을 운영 감사 로그에서 구분합니다.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'tournament.registration.update';
