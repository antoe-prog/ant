-- 상담 메모 수정/삭제 변경 기록 액션을 기존 audit_action enum에 추가한다.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'counseling_note.update';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'counseling_note.delete';
