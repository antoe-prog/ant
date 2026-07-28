-- 대한유도회 일정 동기화는 수동 대회 수정과 구분해 기록한다.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'tournament.sync';
