import { describe, it, expect } from "vitest";
import {
  getBeltColor,
  getBeltLabel,
  getBeltOrder,
  digitsOnly,
  getMemberStatusLabel,
  getMemberStatusColor,
  getAttendanceTypeLabel,
  getCheckResultLabel,
  getPromotionResultLabel,
  isAnnouncementPinnedEffective,
  calcParticipationRate,
  suggestNextPaymentDate,
  getPaymentMethodLabel,
  getRoleLabel,
  formatDate,
  formatDateTime,
  formatAmount,
  formatDateShort,
  getDaysUntil,
  getInitials,
  calcAttendanceRate,
  getCurrentMonthRange,
  getTodayString,
  type BeltRank,
  type MemberStatus,
  type AttendanceType,
  type PaymentMethod,
  type UserRole,
} from "../lib/judo-utils";

describe("JudoManager - judo-utils", () => {

  describe("getCheckResultLabel", () => {
    it("정시·지각·결석 라벨", () => {
      expect(getCheckResultLabel("present")).toBe("정시");
      expect(getCheckResultLabel("late")).toBe("지각");
      expect(getCheckResultLabel("absent")).toBe("결석");
    });
  });

  describe("getPromotionResultLabel", () => {
    it("대기·합격·불합격 라벨", () => {
      expect(getPromotionResultLabel("pending")).toBe("대기");
      expect(getPromotionResultLabel("passed")).toBe("합격");
      expect(getPromotionResultLabel("failed")).toBe("불합격");
    });
  });

  describe("calcParticipationRate", () => {
    it("0 또는 음수 분모면 0", () => {
      expect(calcParticipationRate(5, 0)).toBe(0);
      expect(calcParticipationRate(5, -1)).toBe(0);
    });
    it("비율을 0~100 정수로", () => {
      expect(calcParticipationRate(3, 10)).toBe(30);
      expect(calcParticipationRate(10, 10)).toBe(100);
      expect(calcParticipationRate(1, 3)).toBe(33);
    });
  });

  describe("isAnnouncementPinnedEffective", () => {
    it("고정 아니면 false", () => {
      expect(isAnnouncementPinnedEffective(false, null, "2026-04-12")).toBe(false);
    });
    it("고정이고 만료일 없으면 true", () => {
      expect(isAnnouncementPinnedEffective(true, null, "2026-04-12")).toBe(true);
      expect(isAnnouncementPinnedEffective(true, "", "2026-04-12")).toBe(true);
    });
    it("만료일이 오늘 이후면 true", () => {
      expect(isAnnouncementPinnedEffective(true, "2026-12-31", "2026-04-12")).toBe(true);
    });
    it("만료일이 오늘 이전이면 false", () => {
      expect(isAnnouncementPinnedEffective(true, "2026-01-01", "2026-04-12")).toBe(false);
    });
    it("만료일이 오늘이면 true", () => {
      expect(isAnnouncementPinnedEffective(true, "2026-04-12", "2026-04-12")).toBe(true);
    });
  });

  describe("suggestNextPaymentDate", () => {
    it("nextPaymentDate 있으면 그대로", () => {
      expect(
        suggestNextPaymentDate({
          joinDate: "2020-01-01",
          nextPaymentDate: "2026-05-01",
        }),
      ).toBe("2026-05-01");
    });
    it("없으면 입관일 기준 미래 일자 문자열 반환", () => {
      const s = suggestNextPaymentDate({
        joinDate: "2020-03-15",
        nextPaymentDate: null,
      });
      expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("getBeltColor", () => {
    it("흰띠는 흰색 반환", () => {
      expect(getBeltColor("white")).toBe("#FFFFFF");
    });
    it("검은띠는 어두운 색 반환", () => {
      expect(getBeltColor("black")).toBe("#212121");
    });
    it("파란띠는 파란색 반환", () => {
      expect(getBeltColor("blue")).toBe("#1565C0");
    });
    it("노란띠는 노란색 반환", () => {
      expect(getBeltColor("yellow")).toBe("#FFD700");
    });
  });

  describe("getBeltLabel", () => {
    it("white → 흰띠", () => {
      expect(getBeltLabel("white")).toBe("흰띠");
    });
    it("black → 검은띠", () => {
      expect(getBeltLabel("black")).toBe("검은띠");
    });
    it("blue → 파란띠", () => {
      expect(getBeltLabel("blue")).toBe("파란띠");
    });
    it("brown → 갈색띠", () => {
      expect(getBeltLabel("brown")).toBe("갈색띠");
    });
    it("green → 초록띠", () => {
      expect(getBeltLabel("green")).toBe("초록띠");
    });
  });

  describe("digitsOnly", () => {
    it("숫자만 추출", () => {
      expect(digitsOnly("010-1234-5678")).toBe("01012345678");
      expect(digitsOnly("abc")).toBe("");
    });
  });

  describe("getBeltOrder", () => {
    it("흰띠는 0", () => {
      expect(getBeltOrder("white")).toBe(0);
    });
    it("검은띠는 6", () => {
      expect(getBeltOrder("black")).toBe(6);
    });
    it("파란띠는 4", () => {
      expect(getBeltOrder("blue")).toBe(4);
    });
    it("순서: white < yellow < orange < green < blue < brown < black", () => {
      const ranks: BeltRank[] = ["white", "yellow", "orange", "green", "blue", "brown", "black"];
      const orders = ranks.map(getBeltOrder);
      for (let i = 0; i < orders.length - 1; i++) {
        expect(orders[i]).toBeLessThan(orders[i + 1]);
      }
    });
  });

  describe("getMemberStatusLabel", () => {
    it("active → 활성", () => {
      expect(getMemberStatusLabel("active")).toBe("활성");
    });
    it("suspended → 휴회", () => {
      expect(getMemberStatusLabel("suspended")).toBe("휴회");
    });
    it("withdrawn → 탈퇴", () => {
      expect(getMemberStatusLabel("withdrawn")).toBe("탈퇴");
    });
  });

  describe("getMemberStatusColor", () => {
    it("active는 초록색 계열", () => {
      expect(getMemberStatusColor("active")).toBe("#2DA44E");
    });
    it("suspended는 주황색 계열", () => {
      expect(getMemberStatusColor("suspended")).toBe("#F4A261");
    });
    it("withdrawn는 빨간색 계열", () => {
      expect(getMemberStatusColor("withdrawn")).toBe("#CF222E");
    });
  });

  describe("getAttendanceTypeLabel", () => {
    it("regular → 정규", () => {
      expect(getAttendanceTypeLabel("regular")).toBe("정규");
    });
    it("makeup → 보강", () => {
      expect(getAttendanceTypeLabel("makeup")).toBe("보강");
    });
    it("trial → 체험", () => {
      expect(getAttendanceTypeLabel("trial")).toBe("체험");
    });
  });

  describe("getPaymentMethodLabel", () => {
    it("cash → 현금", () => {
      expect(getPaymentMethodLabel("cash")).toBe("현금");
    });
    it("card → 카드", () => {
      expect(getPaymentMethodLabel("card")).toBe("카드");
    });
    it("transfer → 계좌이체", () => {
      expect(getPaymentMethodLabel("transfer")).toBe("계좌이체");
    });
  });

  describe("getRoleLabel", () => {
    it("member → 회원", () => {
      expect(getRoleLabel("member")).toBe("회원");
    });
    it("manager → 관리자", () => {
      expect(getRoleLabel("manager")).toBe("관리자");
    });
    it("admin → 원장", () => {
      expect(getRoleLabel("admin")).toBe("원장");
    });
  });

  describe("formatDate", () => {
    it("null → -", () => {
      expect(formatDate(null)).toBe("-");
    });
    it("undefined → -", () => {
      expect(formatDate(undefined)).toBe("-");
    });
    it("유효한 날짜 문자열 포맷", () => {
      const result = formatDate("2025-01-15");
      expect(result).not.toBe("-");
      expect(result).toContain("2025");
    });
    it("Date 객체 포맷", () => {
      const result = formatDate(new Date("2025-06-01"));
      expect(result).not.toBe("-");
      expect(result).toContain("2025");
    });
  });

  describe("formatDateTime", () => {
    it("null → -", () => {
      expect(formatDateTime(null)).toBe("-");
    });
    it("유효한 Date 객체 포맷 (시간 포함)", () => {
      const result = formatDateTime(new Date("2025-03-20T14:30:00"));
      expect(result).not.toBe("-");
      expect(result).toContain("2025");
    });
  });

  describe("formatDateShort", () => {
    it("null → -", () => {
      expect(formatDateShort(null)).toBe("-");
    });
    it("날짜 문자열 짧은 포맷", () => {
      const result = formatDateShort("2025-04-15");
      expect(result).not.toBe("-");
    });
  });

  describe("formatAmount", () => {
    it("0원 포맷", () => {
      expect(formatAmount(0)).toBe("0원");
    });
    it("80000원 포맷 (천 단위 구분)", () => {
      const result = formatAmount(80000);
      expect(result).toContain("원");
      expect(result).toContain("80");
    });
    it("1000000원 포맷", () => {
      const result = formatAmount(1000000);
      expect(result).toContain("원");
    });
  });

  describe("getInitials", () => {
    it("null → ?", () => {
      expect(getInitials(null)).toBe("?");
    });
    it("undefined → ?", () => {
      expect(getInitials(undefined)).toBe("?");
    });
    it("이름 앞 2글자 반환", () => {
      expect(getInitials("김태권")).toBe("김태");
    });
    it("1글자 이름", () => {
      expect(getInitials("김")).toBe("김");
    });
  });

  describe("getDaysUntil", () => {
    it("null → null", () => {
      expect(getDaysUntil(null)).toBeNull();
    });
    it("오늘 날짜 문자열은 0 반환", () => {
      const now = new Date();
      const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      expect(getDaysUntil(todayLocal)).toBe(0);
    });
    it("7일 후 날짜는 양수 반환", () => {
      const future = new Date();
      future.setDate(future.getDate() + 7);
      future.setHours(0, 0, 0, 0);
      const result = getDaysUntil(future);
      expect(result).toBeGreaterThan(0);
    });
    it("7일 전 날짜는 음수 반환", () => {
      const past = new Date();
      past.setDate(past.getDate() - 7);
      past.setHours(0, 0, 0, 0);
      const result = getDaysUntil(past);
      expect(result).toBeLessThan(0);
    });
  });

  describe("calcAttendanceRate", () => {
    it("total이 0이면 0 반환", () => {
      expect(calcAttendanceRate(0, 0)).toBe(0);
    });
    it("전체 출석 시 100 반환", () => {
      expect(calcAttendanceRate(20, 20)).toBe(100);
    });
    it("절반 출석 시 50 반환", () => {
      expect(calcAttendanceRate(10, 20)).toBe(50);
    });
    it("3/4 출석 시 75 반환", () => {
      expect(calcAttendanceRate(15, 20)).toBe(75);
    });
    it("소수점 반올림", () => {
      expect(calcAttendanceRate(1, 3)).toBe(33);
    });
  });

  describe("getCurrentMonthRange", () => {
    it("start와 end 반환", () => {
      const { start, end } = getCurrentMonthRange();
      expect(start).toMatch(/^\d{4}-\d{2}-01$/);
      expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    it("start가 end보다 이전", () => {
      const { start, end } = getCurrentMonthRange();
      expect(new Date(start).getTime()).toBeLessThan(new Date(end).getTime());
    });
  });

  describe("getTodayString", () => {
    it("YYYY-MM-DD 형식 반환", () => {
      const today = getTodayString();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    it("오늘 날짜와 일치", () => {
      const today = getTodayString();
      const expected = new Date().toISOString().split("T")[0];
      expect(today).toBe(expected);
    });
  });
});
