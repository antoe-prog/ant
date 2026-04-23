/**
 * 앱 전체에서 실제로 쓰이는 유도관 블루 계열로 토큰을 맞춘다.
 * 하드코딩 색(#1565C0 등)을 점진적으로 token 참조로 바꿀 때 기준이 된다.
 * @type {const}
 */
const themeColors = {
  primary: { light: '#1565C0', dark: '#60A5FA' },
  primarySoft: { light: '#E3F2FD', dark: '#1E293B' },
  background: { light: '#FFFFFF', dark: '#0F172A' },
  surface: { light: '#FAFAFC', dark: '#1E293B' },
  surfaceAlt: { light: '#F1F5F9', dark: '#111827' },
  foreground: { light: '#0F172A', dark: '#F1F5F9' },
  muted: { light: '#64748B', dark: '#94A3B8' },
  border: { light: '#E2E8F0', dark: '#334155' },
  success: { light: '#16A34A', dark: '#22C55E' },
  warning: { light: '#D97706', dark: '#F59E0B' },
  error: { light: '#DC2626', dark: '#F87171' },
  tint: { light: '#1565C0', dark: '#60A5FA' },
};

module.exports = { themeColors };
