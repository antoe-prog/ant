-- 명시적 런타임 무결성 정정 이력을 감사 로그에 기록한다.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'notice.update';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'system.integrity.repair';
