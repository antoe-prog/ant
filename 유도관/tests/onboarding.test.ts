import { describe, it, expect } from "vitest";
import {
  getStatusColor,
  getStatusLabel,
  getCategoryLabel,
  getCategoryIcon,
  getPriorityLabel,
  getPriorityColor,
  getRoleLabel,
  formatDate,
  formatDateTime,
  formatDuration,
  getDaysUntil,
  getInitials,
  type TaskCategory,
  type TaskPriority,
  type UserRole,
} from "../lib/onboarding-utils";

describe("OnboardPro - onboarding-utils", () => {
  describe("getStatusColor", () => {
    it("completed 상태는 초록색 반환", () => {
      expect(getStatusColor("completed")).toBe("#10B981");
    });
    it("approved 상태는 초록색 반환", () => {
      expect(getStatusColor("approved")).toBe("#10B981");
    });
    it("in_progress 상태는 노란색 반환", () => {
      expect(getStatusColor("in_progress")).toBe("#F59E0B");
    });
    it("pending 상태는 회색 반환", () => {
      expect(getStatusColor("pending")).toBe("#6B7280");
    });
    it("rejected 상태는 빨간색 반환", () => {
      expect(getStatusColor("rejected")).toBe("#EF4444");
    });
    it("알 수 없는 상태는 회색 반환", () => {
      expect(getStatusColor("unknown_status")).toBe("#6B7280");
    });
  });

  describe("getStatusLabel", () => {
    it("pending → 대기중", () => {
      expect(getStatusLabel("pending")).toBe("대기중");
    });
    it("in_progress → 진행중", () => {
      expect(getStatusLabel("in_progress")).toBe("진행중");
    });
    it("completed → 완료", () => {
      expect(getStatusLabel("completed")).toBe("완료");
    });
    it("approved → 승인", () => {
      expect(getStatusLabel("approved")).toBe("승인");
    });
    it("rejected → 반려", () => {
      expect(getStatusLabel("rejected")).toBe("반려");
    });
    it("not_started → 시작 전", () => {
      expect(getStatusLabel("not_started")).toBe("시작 전");
    });
    it("scheduled → 예정", () => {
      expect(getStatusLabel("scheduled")).toBe("예정");
    });
  });

  describe("getCategoryLabel", () => {
    const cases: [TaskCategory, string][] = [
      ["document", "서류"],
      ["training", "교육"],
      ["setup", "환경설정"],
      ["meeting", "미팅"],
      ["other", "기타"],
    ];
    cases.forEach(([cat, expected]) => {
      it(`${cat} → ${expected}`, () => {
        expect(getCategoryLabel(cat)).toBe(expected);
      });
    });
  });

  describe("getCategoryIcon", () => {
    it("document 카테고리는 doc.fill 아이콘", () => {
      expect(getCategoryIcon("document")).toBe("doc.fill");
    });
    it("training 카테고리는 graduationcap.fill 아이콘", () => {
      expect(getCategoryIcon("training")).toBe("graduationcap.fill");
    });
    it("meeting 카테고리는 person.2.fill 아이콘", () => {
      expect(getCategoryIcon("meeting")).toBe("person.2.fill");
    });
  });

  describe("getPriorityLabel", () => {
    const cases: [TaskPriority, string][] = [
      ["low", "낮음"],
      ["medium", "보통"],
      ["high", "높음"],
    ];
    cases.forEach(([priority, expected]) => {
      it(`${priority} → ${expected}`, () => {
        expect(getPriorityLabel(priority)).toBe(expected);
      });
    });
  });

  describe("getPriorityColor", () => {
    it("high 우선순위는 빨간색", () => {
      expect(getPriorityColor("high")).toBe("#EF4444");
    });
    it("medium 우선순위는 노란색", () => {
      expect(getPriorityColor("medium")).toBe("#F59E0B");
    });
    it("low 우선순위는 초록색", () => {
      expect(getPriorityColor("low")).toBe("#10B981");
    });
  });

  describe("getRoleLabel", () => {
    const cases: [UserRole, string][] = [
      ["employee", "신규 입사자"],
      ["hr", "HR 담당자"],
      ["manager", "관리자"],
      ["admin", "시스템 관리자"],
    ];
    cases.forEach(([role, expected]) => {
      it(`${role} → ${expected}`, () => {
        expect(getRoleLabel(role)).toBe(expected);
      });
    });
  });

  describe("formatDate", () => {
    it("null/undefined 입력 시 '-' 반환", () => {
      expect(formatDate(null)).toBe("-");
      expect(formatDate(undefined)).toBe("-");
    });
    it("유효한 날짜를 한국어 형식으로 반환", () => {
      // Use a date with explicit time to avoid timezone issues
      const date = new Date(2026, 0, 15); // Jan 15, 2026 local time
      const result = formatDate(date);
      expect(result).toContain("2026");
      expect(result).toContain("1");
      expect(result).toContain("15");
    });
    it("문자열 날짜도 처리", () => {
      const result = formatDate("2026-03-01");
      expect(result).toContain("2026");
    });
  });

  describe("formatDateTime", () => {
    it("null 입력 시 '-' 반환", () => {
      expect(formatDateTime(null)).toBe("-");
    });
    it("유효한 날짜시간 반환", () => {
      const date = new Date("2026-04-03T10:30:00");
      const result = formatDateTime(date);
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toBe("-");
    });
  });

  describe("formatDuration", () => {
    it("60분 미만은 분 단위", () => {
      expect(formatDuration(30)).toBe("30분");
      expect(formatDuration(45)).toBe("45분");
    });
    it("정확히 60분은 1시간", () => {
      expect(formatDuration(60)).toBe("1시간");
    });
    it("90분은 1시간 30분", () => {
      expect(formatDuration(90)).toBe("1시간 30분");
    });
    it("120분은 2시간", () => {
      expect(formatDuration(120)).toBe("2시간");
    });
  });

  describe("getDaysUntil", () => {
    it("null 입력 시 null 반환", () => {
      expect(getDaysUntil(null)).toBeNull();
    });
    it("미래 날짜는 양수 반환", () => {
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const days = getDaysUntil(future);
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(8);
    });
    it("과거 날짜는 음수 반환", () => {
      const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const days = getDaysUntil(past);
      expect(days).toBeLessThan(0);
    });
  });

  describe("getInitials", () => {
    it("null/undefined 입력 시 ? 반환", () => {
      expect(getInitials(null)).toBe("?");
      expect(getInitials(undefined)).toBe("?");
    });
    it("단일 이름은 첫 두 글자 반환", () => {
      expect(getInitials("김철수")).toBe("김철");
    });
    it("두 단어 이름은 각 첫 글자 반환", () => {
      const result = getInitials("John Doe");
      expect(result).toBe("JD");
    });
  });
});
