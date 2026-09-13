// 순수 수학 유틸. DOM 의존 없음 (headless 테스트 가능).

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

/** 각도를 -PI..PI 로 정규화 */
export function normAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

/** 두 각도의 최소 차이(절대값) */
export function angleDiff(a, b) {
  return Math.abs(normAngle(a - b));
}

/** from 에서 to 로 최대 maxStep 만큼 회전 */
export function rotateToward(from, to, maxStep) {
  const d = normAngle(to - from);
  if (Math.abs(d) <= maxStep) return to;
  return normAngle(from + Math.sign(d) * maxStep);
}

/** 벡터 정규화. 길이 0이면 fallback 반환 */
export function normalize(x, y, fx = 0, fy = 0) {
  const len = Math.hypot(x, y);
  if (len < 1e-6) return { x: fx, y: fy };
  return { x: x / len, y: y / len };
}

/** 지수 감쇠 기반 프레임독립 보간 */
export function damp(current, target, rate, dt) {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

/** 원-원 겹침 */
export const circleHit = (ax, ay, ar, bx, by, br) =>
  dist2(ax, ay, bx, by) <= (ar + br) * (ar + br);

/**
 * 부채꼴(arc) 히트박스 판정.
 * 원점(ox,oy)에서 각도 dir, 반각 halfArc, 반경 range 안에 반지름 tr 인 원이 걸리는지.
 */
export function arcHit(ox, oy, dir, halfArc, range, tx, ty, tr) {
  const d2 = dist2(ox, oy, tx, ty);
  if (d2 > (range + tr) * (range + tr)) return false;
  const d = Math.sqrt(d2);
  if (d < tr) return true; // 원점이 대상 안에 있음 = 무조건 명중
  const toTarget = Math.atan2(ty - oy, tx - ox);
  // 대상 반지름만큼 각도 여유를 준다
  const slack = Math.asin(clamp(tr / Math.max(d, 1e-6), -1, 1));
  return angleDiff(toTarget, dir) <= halfArc + slack;
}

/** 선분-원 판정 (관통 공격 / 광선용) */
export function segCircleHit(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 < 1e-9 ? 0 : ((cx - x1) * dx + (cy - y1) * dy) / len2;
  t = clamp(t, 0, 1);
  const px = x1 + dx * t, py = y1 + dy * t;
  return dist2(px, py, cx, cy) <= r * r;
}
