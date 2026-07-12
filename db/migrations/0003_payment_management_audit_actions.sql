-- 수기 결제 정정/삭제 변경 기록 액션을 기존 audit_action enum에 추가한다.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment.update';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment.delete';
