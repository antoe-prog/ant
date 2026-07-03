-- 파이널 유도 멀티짐 MVP initial PostgreSQL migration draft
-- 기준: docs/BACKEND_DB_SCHEMA.md, docs/API_CONTRACT.md

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE user_status AS ENUM ('invited', 'active', 'suspended', 'deleted');
CREATE TYPE role_scope AS ENUM ('global', 'branch', 'self');
CREATE TYPE branch_status AS ENUM ('active', 'inactive');
CREATE TYPE member_status AS ENUM ('trial', 'active', 'paused', 'withdrawn');
CREATE TYPE guardian_status AS ENUM ('active', 'inactive');
CREATE TYPE guardian_relationship AS ENUM ('father', 'mother', 'legal_guardian', 'other');
CREATE TYPE class_status AS ENUM ('active', 'paused', 'archived');
CREATE TYPE class_session_status AS ENUM ('scheduled', 'cancelled', 'completed');
CREATE TYPE enrollment_status AS ENUM ('active', 'paused', 'ended', 'waitlisted', 'cancelled');
CREATE TYPE enrollment_type AS ENUM ('regular', 'trial');
CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'excused');
CREATE TYPE notice_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE notice_target_type AS ENUM ('branch', 'class', 'member', 'guardian', 'role');
CREATE TYPE note_visibility AS ENUM ('staff_only', 'coach_visible', 'guardian_visible');
CREATE TYPE membership_status AS ENUM ('pending', 'active', 'paused', 'expired', 'cancelled');
CREATE TYPE membership_type AS ENUM ('monthly', 'session_pack', 'trial', 'custom');
CREATE TYPE payment_status AS ENUM ('scheduled', 'paid', 'overdue', 'expiringSoon', 'cancelled', 'refunded', 'partially_refunded');
CREATE TYPE payment_method AS ENUM ('cash', 'bank_transfer', 'card_manual', 'other');
CREATE TYPE pilot_incident_severity AS ENUM ('p0', 'p1', 'p2');
CREATE TYPE pilot_incident_status AS ENUM ('open', 'monitoring', 'resolved');
CREATE TYPE pilot_operation_status AS ENUM ('pending', 'verified', 'blocked');
CREATE TYPE audit_action AS ENUM (
  'create',
  'read',
  'update',
  'delete',
  'login',
  'logout',
  'export',
  'assign_role',
  'revoke_role',
  'approve',
  'reject',
  'attendance.update',
  'request.create',
  'request.approve',
  'request.reject',
  'notice.create',
  'notice.read',
  'notification.subscribe',
  'notification.unsubscribe',
  'notification.dispatch',
  'member.create',
  'member.update',
  'class.create',
  'class.update',
  'payment.create',
  'payment.refund',
  'branch.create',
  'branch.update',
  'branch.owner.assign',
  'user.invite.create',
  'user.role.update',
  'audit_logs.read',
  'export.create',
  'pilot_readiness.update',
  'pilot_incident.create',
  'pilot_incident.update',
  'pilot_operation.update',
  'auth.invite.accept',
  'auth.password_reset.request',
  'auth.password_reset.complete',
  'auth.login',
  'auth.logout'
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext,
  phone_e164 varchar(32),
  display_name varchar(100) NOT NULL,
  password_hash text,
  password_reset_requested_at timestamptz,
  password_updated_at timestamptz,
  status user_status NOT NULL DEFAULT 'invited',
  last_login_at timestamptz,
  roles_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
);

CREATE UNIQUE INDEX ux_users_email_active ON users (email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX ux_users_phone_active ON users (phone_e164) WHERE phone_e164 IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(50) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  phone_e164 varchar(32),
  address text,
  timezone varchar(64) NOT NULL DEFAULT 'Asia/Seoul',
  status branch_status NOT NULL DEFAULT 'active',
  settings jsonb NOT NULL DEFAULT '{"attendanceEditRequiresReason":true}'::jsonb,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(80) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  scope role_scope NOT NULL,
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(120) NOT NULL UNIQUE,
  resource varchar(80) NOT NULL,
  action varchar(80) NOT NULL,
  description text,
  is_sensitive boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id),
  branch_id uuid REFERENCES branches(id),
  assigned_by_user_id uuid REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid REFERENCES users(id),
  revoke_reason text
);

CREATE INDEX ix_user_roles_user_active ON user_roles (user_id, branch_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX ux_user_roles_active_branch
  ON user_roles (user_id, role_id, branch_id)
  WHERE branch_id IS NOT NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX ux_user_roles_active_global
  ON user_roles (user_id, role_id)
  WHERE branch_id IS NULL AND revoked_at IS NULL;

CREATE TABLE guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  primary_branch_id uuid REFERENCES branches(id),
  name varchar(100) NOT NULL,
  phone_e164 varchar(32) NOT NULL,
  email citext,
  status guardian_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  user_id uuid UNIQUE REFERENCES users(id),
  display_name varchar(100) NOT NULL,
  birth_date date,
  age_group varchar(20) NOT NULL,
  level_name varchar(80) NOT NULL,
  belt_name varchar(80) NOT NULL,
  status member_status NOT NULL DEFAULT 'trial',
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  primary_coach_user_id uuid REFERENCES users(id),
  emergency_contact_name varchar(100),
  emergency_contact_phone_e164 varchar(32),
  caution_notes text,
  joined_at date,
  withdrawn_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_members_branch_status ON members (branch_id, status);
CREATE INDEX ix_members_primary_coach ON members (primary_coach_user_id);

CREATE TABLE member_guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  guardian_id uuid NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  relationship guardian_relationship NOT NULL DEFAULT 'legal_guardian',
  is_primary boolean NOT NULL DEFAULT false,
  can_receive_billing boolean NOT NULL DEFAULT true,
  can_pickup boolean NOT NULL DEFAULT true,
  status guardian_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_member_guardians_active
  ON member_guardians (member_id, guardian_id)
  WHERE status = 'active';
CREATE UNIQUE INDEX ux_member_guardians_primary
  ON member_guardians (member_id)
  WHERE is_primary = true AND status = 'active';
CREATE INDEX ix_member_guardians_guardian ON member_guardians (guardian_id, status);

CREATE TABLE classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  name varchar(120) NOT NULL,
  level_name varchar(80) NOT NULL,
  age_group varchar(20) NOT NULL,
  coach_user_id uuid NOT NULL REFERENCES users(id),
  room varchar(80),
  capacity integer NOT NULL CHECK (capacity > 0),
  status class_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_classes_branch_status ON classes (branch_id, status);
CREATE INDEX ix_classes_coach ON classes (coach_user_id, branch_id);

CREATE TABLE class_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  coach_user_id uuid NOT NULL REFERENCES users(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status class_session_status NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX ix_class_sessions_branch_start ON class_sessions (branch_id, starts_at);
CREATE INDEX ix_class_sessions_class_start ON class_sessions (class_id, starts_at);
CREATE INDEX ix_class_sessions_coach_start ON class_sessions (coach_user_id, starts_at);

CREATE TABLE enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  member_id uuid NOT NULL REFERENCES members(id),
  class_id uuid NOT NULL REFERENCES classes(id),
  enrollment_type enrollment_type NOT NULL DEFAULT 'regular',
  status enrollment_status NOT NULL DEFAULT 'active',
  starts_on date NOT NULL,
  ends_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_enrollments_member_status ON enrollments (member_id, status);
CREATE INDEX ix_enrollments_class_status ON enrollments (class_id, status);
CREATE UNIQUE INDEX ux_enrollments_active_regular
  ON enrollments (member_id, class_id)
  WHERE status IN ('active', 'waitlisted');

CREATE TABLE attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  class_session_id uuid NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id),
  status attendance_status NOT NULL,
  note text,
  marked_by_user_id uuid NOT NULL REFERENCES users(id),
  marked_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_attendance_session_member ON attendance (class_session_id, member_id);
CREATE INDEX ix_attendance_member_date ON attendance (member_id, marked_at DESC);
CREATE INDEX ix_attendance_branch_date ON attendance (branch_id, marked_at DESC);

CREATE TABLE notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  author_user_id uuid NOT NULL REFERENCES users(id),
  title varchar(180) NOT NULL,
  body text NOT NULL,
  important boolean NOT NULL DEFAULT false,
  status notice_status NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_notices_branch_status_publish ON notices (branch_id, status, published_at DESC);

CREATE TABLE notice_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id uuid NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  target_type notice_target_type NOT NULL,
  target_id uuid,
  role_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (target_id IS NOT NULL OR role_code IS NOT NULL OR target_type = 'branch')
);

CREATE INDEX ix_notice_targets_notice ON notice_targets (notice_id);
CREATE INDEX ix_notice_targets_lookup ON notice_targets (target_type, target_id, role_code);

CREATE TABLE notice_reads (
  notice_id uuid NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_id)
);

CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  branch_ids uuid[] NOT NULL DEFAULT '{}',
  last_sent_at timestamptz,
  last_failure_at timestamptz,
  last_failure_reason text,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_push_subscriptions_endpoint ON push_subscriptions (endpoint);
CREATE INDEX ix_push_subscriptions_user_active ON push_subscriptions (user_id, updated_at DESC) WHERE disabled_at IS NULL;

CREATE TABLE counseling_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  member_id uuid NOT NULL REFERENCES members(id),
  author_user_id uuid NOT NULL REFERENCES users(id),
  note_type varchar(60) NOT NULL DEFAULT 'general',
  visibility note_visibility NOT NULL DEFAULT 'staff_only',
  title varchar(160),
  body text NOT NULL,
  follow_up_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX ix_counseling_notes_member ON counseling_notes (member_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_counseling_notes_branch_followup ON counseling_notes (branch_id, follow_up_at) WHERE deleted_at IS NULL;

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  member_id uuid NOT NULL REFERENCES members(id),
  name varchar(120) NOT NULL,
  membership_type membership_type NOT NULL,
  status membership_status NOT NULL DEFAULT 'pending',
  starts_on date NOT NULL,
  expires_on date,
  total_sessions integer,
  remaining_sessions integer,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_memberships_member_status ON memberships (member_id, status);
CREATE INDEX ix_memberships_branch_expiry ON memberships (branch_id, expires_on);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  member_id uuid NOT NULL REFERENCES members(id),
  membership_id uuid REFERENCES memberships(id),
  status payment_status NOT NULL DEFAULT 'scheduled',
  amount_krw integer NOT NULL CHECK (amount_krw >= 0),
  discount_amount_krw integer NOT NULL DEFAULT 0 CHECK (discount_amount_krw >= 0),
  refunded_amount_krw integer NOT NULL DEFAULT 0 CHECK (refunded_amount_krw >= 0),
  method payment_method,
  due_on date,
  paid_at timestamptz,
  refunded_at timestamptz,
  refund_reason text,
  online_provider varchar(40),
  online_provider_payment_id varchar(160),
  online_payment_status varchar(40),
  online_checkout_url text,
  online_requested_at timestamptz,
  online_paid_at timestamptz,
  online_failed_at timestamptz,
  online_failure_reason text,
  receipt_id varchar(160),
  receipt_url text,
  recurring_provider varchar(40),
  recurring_provider_agreement_id varchar(160),
  recurring_status varchar(40),
  recurring_interval varchar(40),
  recurring_billing_day integer CHECK (recurring_billing_day BETWEEN 1 AND 28),
  recurring_next_billing_on date,
  recurring_requested_at timestamptz,
  recurring_activated_at timestamptz,
  recurring_cancelled_at timestamptz,
  recurring_cancel_reason text,
  memo text,
  recorded_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (discount_amount_krw <= amount_krw),
  CHECK (refunded_amount_krw <= amount_krw)
);

CREATE INDEX ix_payments_branch_status_due ON payments (branch_id, status, due_on);
CREATE INDEX ix_payments_member_created ON payments (member_id, created_at DESC);
CREATE UNIQUE INDEX ux_payments_online_provider_payment
  ON payments (online_provider_payment_id)
  WHERE online_provider_payment_id IS NOT NULL;
CREATE UNIQUE INDEX ux_payments_recurring_provider_agreement
  ON payments (recurring_provider_agreement_id)
  WHERE recurring_provider_agreement_id IS NOT NULL;

CREATE TABLE payment_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  status payment_status NOT NULL,
  event varchar(40) NOT NULL,
  provider_event_id varchar(160),
  reason text NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_payment_status_events_payment_changed ON payment_status_events (payment_id, changed_at DESC);
CREATE UNIQUE INDEX ux_payment_status_events_provider_event
  ON payment_status_events (provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE TABLE pilot_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES branches(id),
  severity pilot_incident_severity NOT NULL,
  status pilot_incident_status NOT NULL DEFAULT 'open',
  title varchar(160) NOT NULL,
  description text NOT NULL,
  role_code varchar(40),
  screen varchar(160),
  workaround text,
  owner varchar(100) NOT NULL,
  reported_by_user_id uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_pilot_incidents_status ON pilot_incidents (status, severity, created_at DESC);
CREATE INDEX ix_pilot_incidents_branch ON pilot_incidents (branch_id, created_at DESC);

CREATE TABLE pilot_operation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES branches(id),
  operation_date date NOT NULL,
  status pilot_operation_status NOT NULL DEFAULT 'pending',
  owner varchar(100) NOT NULL,
  evidence text,
  classes_checked integer NOT NULL DEFAULT 0 CHECK (classes_checked >= 0),
  attendance_records integer NOT NULL DEFAULT 0 CHECK (attendance_records >= 0),
  payment_checks integer NOT NULL DEFAULT 0 CHECK (payment_checks >= 0),
  request_checks integer NOT NULL DEFAULT 0 CHECK (request_checks >= 0),
  notice_checks integer NOT NULL DEFAULT 0 CHECK (notice_checks >= 0),
  mobile_attendance_duration_seconds numeric(5,2) CHECK (
    mobile_attendance_duration_seconds IS NULL
    OR (mobile_attendance_duration_seconds > 0 AND mobile_attendance_duration_seconds <= 30)
  ),
  mobile_attendance_evidence text,
  blocker_summary text,
  checked_by_user_id uuid REFERENCES users(id),
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, operation_date)
);

CREATE INDEX ix_pilot_operation_logs_status ON pilot_operation_logs (status, operation_date DESC);
CREATE INDEX ix_pilot_operation_logs_branch_date ON pilot_operation_logs (branch_id, operation_date DESC);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES branches(id),
  actor_user_id uuid REFERENCES users(id),
  action audit_action NOT NULL,
  resource_type varchar(80) NOT NULL,
  resource_id uuid,
  result varchar(20) NOT NULL DEFAULT 'success',
  reason text,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  user_agent text,
  request_id varchar(120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_audit_logs_branch_date ON audit_logs (branch_id, created_at DESC);
CREATE INDEX ix_audit_logs_actor_date ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX ix_audit_logs_resource ON audit_logs (resource_type, resource_id, created_at DESC);

INSERT INTO roles (code, name, scope, is_system) VALUES
  ('super_admin', '총괄 어드민', 'global', true),
  ('branch_owner', '대표', 'branch', true),
  ('coach', '코치', 'branch', true),
  ('guardian', '학부모', 'self', true),
  ('member', '회원', 'self', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, resource, action, description, is_sensitive) VALUES
  ('branches.create', 'branches', 'create', '지점 생성', true),
  ('branches.read', 'branches', 'read', '지점 조회', false),
  ('branches.update', 'branches', 'update', '지점 수정', true),
  ('users.manage', 'users', 'manage', '사용자 생성/비활성화', true),
  ('rbac.manage', 'rbac', 'manage', '역할과 권한 관리', true),
  ('members.read.full', 'members', 'read.full', '회원 전체 개인정보 조회', true),
  ('members.read.limited', 'members', 'read.limited', '회원 제한 정보 조회', false),
  ('members.write', 'members', 'write', '회원 생성/수정', true),
  ('guardians.write', 'guardians', 'write', '보호자 연결 수정', true),
  ('classes.read', 'classes', 'read', '수업 조회', false),
  ('classes.write', 'classes', 'write', '수업 관리', true),
  ('attendance.write', 'attendance', 'write', '출석 체크/수정', true),
  ('notices.publish', 'notices', 'publish', '공지 작성/발행', true),
  ('counseling_notes.read', 'counseling_notes', 'read', '상담/주의 메모 조회', true),
  ('counseling_notes.write', 'counseling_notes', 'write', '상담/주의 메모 작성', true),
  ('memberships.write', 'memberships', 'write', '회원권 등록/수정', true),
  ('payments.read', 'payments', 'read', '결제 상세 조회', true),
  ('payments.write', 'payments', 'write', '수기 결제 기록', true),
  ('payments.refund', 'payments', 'refund', '환불 처리', true),
  ('audit_logs.read', 'audit_logs', 'read', '감사 로그 조회', true),
  ('exports.create', 'exports', 'create', 'CSV 내보내기', true)
ON CONFLICT (code) DO NOTHING;
