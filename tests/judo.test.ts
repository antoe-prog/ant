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
    it("?뺤떆쨌吏媛겶룰껐???쇰꺼", () => {
      expect(getCheckResultLabel("present")).toBe("?뺤떆");
      expect(getCheckResultLabel("late")).toBe("吏媛?);
      expect(getCheckResultLabel("absent")).toBe("寃곗꽍");
    });
  });

  describe("getPromotionResultLabel", () => {
    it("?湲걔룻빀寃㈑룸텋?⑷꺽 ?쇰꺼", () => {
      expect(getPromotionResultLabel("pending")).toBe("?湲?);
      expect(getPromotionResultLabel("passed")).toBe("?⑷꺽");
      expect(getPromotionResultLabel("failed")).toBe("遺덊빀寃?);
    });
  });

  describe("calcParticipationRate", () => {
    it("0 ?먮뒗 ?뚯닔 遺꾨え硫?0", () => {
      expect(calcParticipationRate(5, 0)).toBe(0);
      expect(calcParticipationRate(5, -1)).toBe(0);
    });
    it("鍮꾩쑉??0~100 ?뺤닔濡?, () => {
      expect(calcParticipationRate(3, 10)).toBe(30);
      expect(calcParticipationRate(10, 10)).toBe(100);
      expect(calcParticipationRate(1, 3)).toBe(33);
    });
  });

  describe("isAnnouncementPinnedEffective", () => {
    it("怨좎젙 ?꾨땲硫?false", () => {
      expect(isAnnouncementPinnedEffective(false, null, "2026-04-12")).toBe(false);
    });
    it("怨좎젙?닿퀬 留뚮즺???놁쑝硫?true", () => {
      expect(isAnnouncementPinnedEffective(true, null, "2026-04-12")).toBe(true);
      expect(isAnnouncementPinnedEffective(true, "", "2026-04-12")).toBe(true);
    });
    it("留뚮즺?쇱씠 ?ㅻ뒛 ?댄썑硫?true", () => {
      expect(isAnnouncementPinnedEffective(true, "2026-12-31", "2026-04-12")).toBe(true);
    });
    it("留뚮즺?쇱씠 ?ㅻ뒛 ?댁쟾?대㈃ false", () => {
      expect(isAnnouncementPinnedEffective(true, "2026-01-01", "2026-04-12")).toBe(false);
    });
    it("留뚮즺?쇱씠 ?ㅻ뒛?대㈃ true", () => {
      expect(isAnnouncementPinnedEffective(true, "2026-04-12", "2026-04-12")).toBe(true);
    });
  });

  describe("suggestNextPaymentDate", () => {
    it("nextPaymentDate ?덉쑝硫?洹몃?濡?, () => {
      expect(
        suggestNextPaymentDate({
          joinDate: "2020-01-01",
          nextPaymentDate: "2026-05-01",
        }),
      ).toBe("2026-05-01");
    });
    it("?놁쑝硫??낃???湲곗? 誘몃옒 ?쇱옄 臾몄옄??諛섑솚", () => {
      const s = suggestNextPaymentDate({
        joinDate: "2020-03-15",
        nextPaymentDate: null,
      });
      expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("getBeltColor", () => {
    it("?곕씈???곗깋 諛섑솚", () => {
      expect(getBeltColor("white")).toBe("#FFFFFF");
    });
    it("寃??좊뒗 ?대몢????諛섑솚", () => {
      expect(getBeltColor("black")).toBe("#212121");
    });
    it("?뚮??좊뒗 ?뚮???諛섑솚", () => {
      expect(getBeltColor("blue")).toBe("#1565C0");
    });
    it("?몃??좊뒗 ?몃???諛섑솚", () => {
      expect(getBeltColor("yellow")).toBe("#FFD700");
    });
  });

  describe("getBeltLabel", () => {
    it("white ???곕씈", () => {
      expect(getBeltLabel("white")).toBe("?곕씈");
    });
    it("black ??寃???, () => {
      expect(getBeltLabel("black")).toBe("寃???);
    });
    it("blue ???뚮???, () => {
      expect(getBeltLabel("blue")).toBe("?뚮???);
    });
    it("brown ??媛덉깋??, () => {
      expect(getBeltLabel("brown")).toBe("媛덉깋??);
    });
    it("green ??珥덈줉??, () => {
      expect(getBeltLabel("green")).toBe("珥덈줉??);
    });
  });

  describe("digitsOnly", () => {
    it("?レ옄留?異붿텧", () => {
      expect(digitsOnly("010-1234-5678")).toBe("01012345678");
      expect(digitsOnly("abc")).toBe("");
    });
  });

  describe("getBeltOrder", () => {
    it("?곕씈??0", () => {
      expect(getBeltOrder("white")).toBe(0);
    });
    it("寃??좊뒗 6", () => {
      expect(getBeltOrder("black")).toBe(6);
    });
    it("?뚮??좊뒗 4", () => {
      expect(getBeltOrder("blue")).toBe(4);
    });
    it("?쒖꽌: white < yellow < orange < green < blue < brown < black", () => {
      const ranks: BeltRank[] = ["white", "yellow", "orange", "green", "blue", "brown", "black"];
      const orders = ranks.map(getBeltOrder);
      for (let i = 0; i < orders.length - 1; i++) {
        expect(orders[i]).toBeLessThan(orders[i + 1]);
      }
    });
  });

  describe("getMemberStatusLabel", () => {
    it("active ???쒖꽦", () => {
      expect(getMemberStatusLabel("active")).toBe("?쒖꽦");
    });
    it("suspended ???댄쉶", () => {
      expect(getMemberStatusLabel("suspended")).toBe("?댄쉶");
    });
    it("withdrawn ???덊눜", () => {
      expect(getMemberStatusLabel("withdrawn")).toBe("?덊눜");
    });
  });

  describe("getMemberStatusColor", () => {
    it("active??珥덈줉??怨꾩뿴", () => {
      expect(getMemberStatusColor("active")).toBe("#2DA44E");
    });
    it("suspended??二쇳솴??怨꾩뿴", () => {
      expect(getMemberStatusColor("suspended")).toBe("#F4A261");
    });
    it("withdrawn??鍮④컙??怨꾩뿴", () => {
      expect(getMemberStatusColor("withdrawn")).toBe("#CF222E");
    });
  });

  describe("getAttendanceTypeLabel", () => {
    it("regular ???뺢퇋", () => {
      expect(getAttendanceTypeLabel("regular")).toBe("?뺢퇋");
    });
    it("makeup ??蹂닿컯", () => {
      expect(getAttendanceTypeLabel("makeup")).toBe("蹂닿컯");
    });
    it("trial ??泥댄뿕", () => {
      expect(getAttendanceTypeLabel("trial")).toBe("泥댄뿕");
    });
  });

  describe("getPaymentMethodLabel", () => {
    it("cash ???꾧툑", () => {
      expect(getPaymentMethodLabel("cash")).toBe("?꾧툑");
    });
    it("card ??移대뱶", () => {
      expect(getPaymentMethodLabel("card")).toBe("移대뱶");
    });
    it("transfer ??怨꾩쥖?댁껜", () => {
      expect(getPaymentMethodLabel("transfer")).toBe("怨꾩쥖?댁껜");
    });
  });

  describe("getRoleLabel", () => {
    it("member ???뚯썝", () => {
      expect(getRoleLabel("member")).toBe("?뚯썝");
    });
    it("manager ??愿由ъ옄", () => {
      expect(getRoleLabel("manager")).toBe("愿由ъ옄");
    });
    it("admin ???먯옣", () => {
      expect(getRoleLabel("admin")).toBe("?먯옣");
    });
  });

  describe("formatDate", () => {
    it("null ??-", () => {
      expect(formatDate(null)).toBe("-");
    });
    it("undefined ??-", () => {
      expect(formatDate(undefined)).toBe("-");
    });
    it("?좏슚???좎쭨 臾몄옄???щ㎎", () => {
      const result = formatDate("2025-01-15");
      expect(result).not.toBe("-");
      expect(result).toContain("2025");
    });
    it("Date 媛앹껜 ?щ㎎", () => {
      const result = formatDate(new Date("2025-06-01"));
      expect(result).not.toBe("-");
      expect(result).toContain("2025");
    });
  });

  describe("formatDateTime", () => {
    it("null ??-", () => {
      expect(formatDateTime(null)).toBe("-");
    });
    it("?좏슚??Date 媛앹껜 ?щ㎎ (?쒓컙 ?ы븿)", () => {
      const result = formatDateTime(new Date("2025-03-20T14:30:00"));
      expect(result).not.toBe("-");
      expect(result).toContain("2025");
    });
  });

  describe("formatDateShort", () => {
    it("null ??-", () => {
      expect(formatDateShort(null)).toBe("-");
    });
    it("?좎쭨 臾몄옄??吏㏃? ?щ㎎", () => {
      const result = formatDateShort("2025-04-15");
      expect(result).not.toBe("-");
    });
  });

  describe("formatAmount", () => {
    it("0???щ㎎", () => {
      expect(formatAmount(0)).toBe("0??);
    });
    it("80000???щ㎎ (泥??⑥쐞 援щ텇)", () => {
      const result = formatAmount(80000);
      expect(result).toContain("??);
      expect(result).toContain("80");
    });
    it("1000000???щ㎎", () => {
      const result = formatAmount(1000000);
      expect(result).toContain("??);
    });
  });

  describe("getInitials", () => {
    it("null ???", () => {
      expect(getInitials(null)).toBe("?");
    });
    it("undefined ???", () => {
      expect(getInitials(undefined)).toBe("?");
    });
    it("?대쫫 ??2湲??諛섑솚", () => {
      expect(getInitials("源?쒓텒")).toBe("源??);
    });
    it("1湲???대쫫", () => {
      expect(getInitials("源")).toBe("源");
    });
  });

  describe("getDaysUntil", () => {
    it("null ??null", () => {
      expect(getDaysUntil(null)).toBeNull();
    });
    it("?ㅻ뒛 ?좎쭨 臾몄옄?댁? 0 諛섑솚", () => {
      const now = new Date();
      const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      expect(getDaysUntil(todayLocal)).toBe(0);
    });
    it("7?????좎쭨???묒닔 諛섑솚", () => {
      const future = new Date();
      future.setDate(future.getDate() + 7);
      future.setHours(0, 0, 0, 0);
      const result = getDaysUntil(future);
      expect(result).toBeGreaterThan(0);
    });
    it("7?????좎쭨???뚯닔 諛섑솚", () => {
      const past = new Date();
      past.setDate(past.getDate() - 7);
      past.setHours(0, 0, 0, 0);
      const result = getDaysUntil(past);
      expect(result).toBeLessThan(0);
    });
  });

  describe("calcAttendanceRate", () => {
    it("total??0?대㈃ 0 諛섑솚", () => {
      expect(calcAttendanceRate(0, 0)).toBe(0);
    });
    it("?꾩껜 異쒖꽍 ??100 諛섑솚", () => {
      expect(calcAttendanceRate(20, 20)).toBe(100);
    });
    it("?덈컲 異쒖꽍 ??50 諛섑솚", () => {
      expect(calcAttendanceRate(10, 20)).toBe(50);
    });
    it("3/4 異쒖꽍 ??75 諛섑솚", () => {
      expect(calcAttendanceRate(15, 20)).toBe(75);
    });
    it("?뚯닔??諛섏삱由?, () => {
      expect(calcAttendanceRate(1, 3)).toBe(33);
    });
  });

  describe("getCurrentMonthRange", () => {
    it("start? end 諛섑솚", () => {
      const { start, end } = getCurrentMonthRange();
      expect(start).toMatch(/^\d{4}-\d{2}-01$/);
      expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    it("start媛 end蹂대떎 ?댁쟾", () => {
      const { start, end } = getCurrentMonthRange();
      expect(new Date(start).getTime()).toBeLessThan(new Date(end).getTime());
    });
  });

  describe("getTodayString", () => {
    it("YYYY-MM-DD ?뺤떇 諛섑솚", () => {
      const today = getTodayString();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    it("?ㅻ뒛 ?좎쭨? ?쇱튂", () => {
      const today = getTodayString();
      const expected = new Date().toISOString().split("T")[0];
      expect(today).toBe(expected);
    });
  });
});

