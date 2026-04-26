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
    it("completed ?곹깭??珥덈줉??諛섑솚", () => {
      expect(getStatusColor("completed")).toBe("#10B981");
    });
    it("approved ?곹깭??珥덈줉??諛섑솚", () => {
      expect(getStatusColor("approved")).toBe("#10B981");
    });
    it("in_progress ?곹깭???몃???諛섑솚", () => {
      expect(getStatusColor("in_progress")).toBe("#F59E0B");
    });
    it("pending ?곹깭???뚯깋 諛섑솚", () => {
      expect(getStatusColor("pending")).toBe("#6B7280");
    });
    it("rejected ?곹깭??鍮④컙??諛섑솚", () => {
      expect(getStatusColor("rejected")).toBe("#EF4444");
    });
    it("?????녿뒗 ?곹깭???뚯깋 諛섑솚", () => {
      expect(getStatusColor("unknown_status")).toBe("#6B7280");
    });
  });

  describe("getStatusLabel", () => {
    it("pending ???湲곗쨷", () => {
      expect(getStatusLabel("pending")).toBe("?湲곗쨷");
    });
    it("in_progress ??吏꾪뻾以?, () => {
      expect(getStatusLabel("in_progress")).toBe("吏꾪뻾以?);
    });
    it("completed ???꾨즺", () => {
      expect(getStatusLabel("completed")).toBe("?꾨즺");
    });
    it("approved ???뱀씤", () => {
      expect(getStatusLabel("approved")).toBe("?뱀씤");
    });
    it("rejected ??諛섎젮", () => {
      expect(getStatusLabel("rejected")).toBe("諛섎젮");
    });
    it("not_started ???쒖옉 ??, () => {
      expect(getStatusLabel("not_started")).toBe("?쒖옉 ??);
    });
    it("scheduled ???덉젙", () => {
      expect(getStatusLabel("scheduled")).toBe("?덉젙");
    });
  });

  describe("getCategoryLabel", () => {
    const cases: [TaskCategory, string][] = [
      ["document", "?쒕쪟"],
      ["training", "援먯쑁"],
      ["setup", "?섍꼍?ㅼ젙"],
      ["meeting", "誘명똿"],
      ["other", "湲고?"],
    ];
    cases.forEach(([cat, expected]) => {
      it(`${cat} ??${expected}`, () => {
        expect(getCategoryLabel(cat)).toBe(expected);
      });
    });
  });

  describe("getCategoryIcon", () => {
    it("document 移댄뀒怨좊━??doc.fill ?꾩씠肄?, () => {
      expect(getCategoryIcon("document")).toBe("doc.fill");
    });
    it("training 移댄뀒怨좊━??graduationcap.fill ?꾩씠肄?, () => {
      expect(getCategoryIcon("training")).toBe("graduationcap.fill");
    });
    it("meeting 移댄뀒怨좊━??person.2.fill ?꾩씠肄?, () => {
      expect(getCategoryIcon("meeting")).toBe("person.2.fill");
    });
  });

  describe("getPriorityLabel", () => {
    const cases: [TaskPriority, string][] = [
      ["low", "??쓬"],
      ["medium", "蹂댄넻"],
      ["high", "?믪쓬"],
    ];
    cases.forEach(([priority, expected]) => {
      it(`${priority} ??${expected}`, () => {
        expect(getPriorityLabel(priority)).toBe(expected);
      });
    });
  });

  describe("getPriorityColor", () => {
    it("high ?곗꽑?쒖쐞??鍮④컙??, () => {
      expect(getPriorityColor("high")).toBe("#EF4444");
    });
    it("medium ?곗꽑?쒖쐞???몃???, () => {
      expect(getPriorityColor("medium")).toBe("#F59E0B");
    });
    it("low ?곗꽑?쒖쐞??珥덈줉??, () => {
      expect(getPriorityColor("low")).toBe("#10B981");
    });
  });

  describe("getRoleLabel", () => {
    const cases: [UserRole, string][] = [
      ["employee", "?좉퇋 ?낆궗??],
      ["hr", "HR ?대떦??],
      ["manager", "愿由ъ옄"],
      ["admin", "?쒖뒪??愿由ъ옄"],
    ];
    cases.forEach(([role, expected]) => {
      it(`${role} ??${expected}`, () => {
        expect(getRoleLabel(role)).toBe(expected);
      });
    });
  });

  describe("formatDate", () => {
    it("null/undefined ?낅젰 ??'-' 諛섑솚", () => {
      expect(formatDate(null)).toBe("-");
      expect(formatDate(undefined)).toBe("-");
    });
    it("?좏슚???좎쭨瑜??쒓뎅???뺤떇?쇰줈 諛섑솚", () => {
      // Use a date with explicit time to avoid timezone issues
      const date = new Date(2026, 0, 15); // Jan 15, 2026 local time
      const result = formatDate(date);
      expect(result).toContain("2026");
      expect(result).toContain("1");
      expect(result).toContain("15");
    });
    it("臾몄옄???좎쭨??泥섎━", () => {
      const result = formatDate("2026-03-01");
      expect(result).toContain("2026");
    });
  });

  describe("formatDateTime", () => {
    it("null ?낅젰 ??'-' 諛섑솚", () => {
      expect(formatDateTime(null)).toBe("-");
    });
    it("?좏슚???좎쭨?쒓컙 諛섑솚", () => {
      const date = new Date("2026-04-03T10:30:00");
      const result = formatDateTime(date);
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toBe("-");
    });
  });

  describe("formatDuration", () => {
    it("60遺?誘몃쭔? 遺??⑥쐞", () => {
      expect(formatDuration(30)).toBe("30遺?);
      expect(formatDuration(45)).toBe("45遺?);
    });
    it("?뺥솗??60遺꾩? 1?쒓컙", () => {
      expect(formatDuration(60)).toBe("1?쒓컙");
    });
    it("90遺꾩? 1?쒓컙 30遺?, () => {
      expect(formatDuration(90)).toBe("1?쒓컙 30遺?);
    });
    it("120遺꾩? 2?쒓컙", () => {
      expect(formatDuration(120)).toBe("2?쒓컙");
    });
  });

  describe("getDaysUntil", () => {
    it("null ?낅젰 ??null 諛섑솚", () => {
      expect(getDaysUntil(null)).toBeNull();
    });
    it("誘몃옒 ?좎쭨???묒닔 諛섑솚", () => {
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const days = getDaysUntil(future);
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(8);
    });
    it("怨쇨굅 ?좎쭨???뚯닔 諛섑솚", () => {
      const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const days = getDaysUntil(past);
      expect(days).toBeLessThan(0);
    });
  });

  describe("getInitials", () => {
    it("null/undefined ?낅젰 ??? 諛섑솚", () => {
      expect(getInitials(null)).toBe("?");
      expect(getInitials(undefined)).toBe("?");
    });
    it("?⑥씪 ?대쫫? 泥???湲??諛섑솚", () => {
      expect(getInitials("源泥좎닔")).toBe("源泥?);
    });
    it("???⑥뼱 ?대쫫? 媛?泥?湲??諛섑솚", () => {
      const result = getInitials("John Doe");
      expect(result).toBe("JD");
    });
  });
});

