import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../server/_core/context";
import { appRouter } from "../server/routers";
import {
  clearMemoHistory,
  deleteMemoHistoryItem,
  getMemberById,
  getMemoHistory,
  saveMemoHistory,
  updateMember,
} from "../server/db";

// vi.mock은 vitest가 파일 최상단으로 호이스팅한다
vi.mock("../server/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("../server/db")>();
  return {
    ...original,
    getMemberById: vi.fn(),
    updateMember: vi.fn(),
    saveMemoHistory: vi.fn(),
    getMemoHistory: vi.fn(),
    deleteMemoHistoryItem: vi.fn(),
    clearMemoHistory: vi.fn(),
  };
});

type Role = "member" | "manager" | "admin";
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createCaller(role: Role | null) {
  const user: AuthenticatedUser | null = role
    ? {
        id: 42,
        openId: `memo-test-${role}`,
        email: `${role}@example.com`,
        passwordHash: null,
        name: `테스트 ${role}`,
        loginMethod: "manus",
        role,
        accountType: "student",
        avatarUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      }
    : null;

  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", hostname: "localhost", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as unknown as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

const sampleHistory = [
  { id: 2, memberId: 7, content: "두 번째 메모", savedBy: 42, savedAt: new Date(), savedByName: "테스트 admin" },
  { id: 1, memberId: 7, content: "첫 번째 메모", savedBy: 42, savedAt: new Date(), savedByName: "테스트 admin" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMemoHistory).mockResolvedValue(sampleHistory);
  vi.mocked(getMemberById).mockResolvedValue({ id: 7, notes: "이전 메모" } as never);
});

describe("memoHistory.list 권한/동작", () => {
  it("admin은 이력을 조회할 수 있다", async () => {
    const result = await createCaller("admin").memoHistory.list({ memberId: 7 });
    expect(result).toHaveLength(2);
    expect(result[0]?.content).toBe("두 번째 메모");
  });

  it("manager도 이력을 조회할 수 있다", async () => {
    const result = await createCaller("manager").memoHistory.list({ memberId: 7 });
    expect(result).toHaveLength(2);
  });

  it("member는 조회할 수 없다 (FORBIDDEN)", async () => {
    await expect(createCaller("member").memoHistory.list({ memberId: 7 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(getMemoHistory).not.toHaveBeenCalled();
  });

  it("비로그인 사용자는 조회할 수 없다 (FORBIDDEN)", async () => {
    await expect(createCaller(null).memoHistory.list({ memberId: 7 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("요청한 memberId가 조회 함수에 그대로 전달된다", async () => {
    await createCaller("admin").memoHistory.list({ memberId: 7 });
    expect(getMemoHistory).toHaveBeenCalledWith(7);
  });

  it("memberId 타입이 잘못되면 입력 검증 오류가 난다", async () => {
    await expect(
      createCaller("admin").memoHistory.list({ memberId: "abc" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("memoHistory.deleteItem 권한/동작", () => {
  it("admin은 이력 항목을 삭제할 수 있다", async () => {
    const result = await createCaller("admin").memoHistory.deleteItem({ id: 1 });
    expect(result).toEqual({ success: true });
    expect(deleteMemoHistoryItem).toHaveBeenCalledWith(1);
  });

  it("manager도 이력 항목을 삭제할 수 있다", async () => {
    const result = await createCaller("manager").memoHistory.deleteItem({ id: 1 });
    expect(result).toEqual({ success: true });
  });

  it("member는 삭제할 수 없다 (FORBIDDEN)", async () => {
    await expect(createCaller("member").memoHistory.deleteItem({ id: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(deleteMemoHistoryItem).not.toHaveBeenCalled();
  });

  it("id 타입이 잘못되면 입력 검증 오류가 난다", async () => {
    await expect(
      createCaller("admin").memoHistory.deleteItem({ id: "1" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("memoHistory.clearAll 권한/동작", () => {
  it("admin은 회원의 전체 이력을 삭제할 수 있다", async () => {
    const result = await createCaller("admin").memoHistory.clearAll({ memberId: 7 });
    expect(result).toEqual({ success: true });
    expect(clearMemoHistory).toHaveBeenCalledWith(7);
  });

  it("manager도 전체 이력을 삭제할 수 있다", async () => {
    const result = await createCaller("manager").memoHistory.clearAll({ memberId: 7 });
    expect(result).toEqual({ success: true });
  });

  it("member는 전체 삭제할 수 없다 (FORBIDDEN)", async () => {
    await expect(createCaller("member").memoHistory.clearAll({ memberId: 7 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(clearMemoHistory).not.toHaveBeenCalled();
  });

  it("비로그인 사용자는 전체 삭제할 수 없다 (FORBIDDEN)", async () => {
    await expect(createCaller(null).memoHistory.clearAll({ memberId: 7 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("members.update 메모 저장 시 이력 자동 기록", () => {
  it("이전 메모가 있으면 이력에 기록하고 저장자를 남긴다", async () => {
    await createCaller("admin").members.update({ id: 7, notes: "새 메모" });
    expect(saveMemoHistory).toHaveBeenCalledWith({ memberId: 7, content: "이전 메모", savedBy: 42 });
    expect(updateMember).toHaveBeenCalledWith(7, expect.objectContaining({ notes: "새 메모" }));
  });

  it("이전 메모가 null이면 이력을 기록하지 않는다", async () => {
    vi.mocked(getMemberById).mockResolvedValue({ id: 7, notes: null } as never);
    await createCaller("admin").members.update({ id: 7, notes: "새 메모" });
    expect(saveMemoHistory).not.toHaveBeenCalled();
  });

  it("이전 메모가 빈 문자열이면 이력을 기록하지 않는다", async () => {
    vi.mocked(getMemberById).mockResolvedValue({ id: 7, notes: "" } as never);
    await createCaller("admin").members.update({ id: 7, notes: "새 메모" });
    expect(saveMemoHistory).not.toHaveBeenCalled();
  });

  it("이전 메모가 공백뿐이면 이력을 기록하지 않는다", async () => {
    vi.mocked(getMemberById).mockResolvedValue({ id: 7, notes: "   " } as never);
    await createCaller("admin").members.update({ id: 7, notes: "새 메모" });
    expect(saveMemoHistory).not.toHaveBeenCalled();
  });

  it("notes 없이 다른 필드만 수정하면 이력·수정시각을 건드리지 않는다", async () => {
    await createCaller("admin").members.update({ id: 7, name: "이름만 변경" });
    expect(saveMemoHistory).not.toHaveBeenCalled();
    expect(getMemberById).not.toHaveBeenCalled();
    const payload = vi.mocked(updateMember).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.notesUpdatedAt).toBeUndefined();
  });

  it("notes 수정 시 notesUpdatedAt이 자동 설정된다", async () => {
    await createCaller("admin").members.update({ id: 7, notes: "새 메모" });
    const payload = vi.mocked(updateMember).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.notesUpdatedAt).toBeInstanceOf(Date);
  });

  it("메모를 비워도(빈 문자열) 이전 내용은 이력에 남는다", async () => {
    await createCaller("admin").members.update({ id: 7, notes: "" });
    expect(saveMemoHistory).toHaveBeenCalledWith({ memberId: 7, content: "이전 메모", savedBy: 42 });
    expect(updateMember).toHaveBeenCalledWith(7, expect.objectContaining({ notes: "" }));
  });

  it("manager도 메모를 저장할 수 있다", async () => {
    await createCaller("manager").members.update({ id: 7, notes: "매니저 메모" });
    expect(updateMember).toHaveBeenCalledWith(7, expect.objectContaining({ notes: "매니저 메모" }));
  });

  it("member는 메모를 저장할 수 없다 (FORBIDDEN)", async () => {
    await expect(
      createCaller("member").members.update({ id: 7, notes: "회원 메모" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updateMember).not.toHaveBeenCalled();
  });

  it("2000자를 초과하는 메모는 거부된다", async () => {
    await expect(
      createCaller("admin").members.update({ id: 7, notes: "가".repeat(2001) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(updateMember).not.toHaveBeenCalled();
  });

  it("정확히 2000자 메모는 저장된다", async () => {
    const notes = "가".repeat(2000);
    await createCaller("admin").members.update({ id: 7, notes });
    expect(updateMember).toHaveBeenCalledWith(7, expect.objectContaining({ notes }));
  });

  it("앞뒤 공백은 잘라서 저장한다", async () => {
    await createCaller("admin").members.update({ id: 7, notes: "  공백 메모  " });
    expect(updateMember).toHaveBeenCalledWith(7, expect.objectContaining({ notes: "공백 메모" }));
  });

  it("연속 수정 시 각각 직전 내용이 이력으로 누적된다", async () => {
    const caller = createCaller("admin");
    vi.mocked(getMemberById).mockResolvedValueOnce({ id: 7, notes: "버전1" } as never);
    await caller.members.update({ id: 7, notes: "버전2" });
    vi.mocked(getMemberById).mockResolvedValueOnce({ id: 7, notes: "버전2" } as never);
    await caller.members.update({ id: 7, notes: "버전3" });

    expect(saveMemoHistory).toHaveBeenCalledTimes(2);
    expect(saveMemoHistory).toHaveBeenNthCalledWith(1, { memberId: 7, content: "버전1", savedBy: 42 });
    expect(saveMemoHistory).toHaveBeenNthCalledWith(2, { memberId: 7, content: "버전2", savedBy: 42 });
  });

  it("대용량(2000자)·특수문자 이전 메모도 원본 그대로 이력에 기록된다", async () => {
    const bigMemo = `특수문자 <>'"%& 이모지 🥋 ${"메".repeat(1980)}`.slice(0, 2000);
    vi.mocked(getMemberById).mockResolvedValue({ id: 7, notes: bigMemo } as never);
    await createCaller("admin").members.update({ id: 7, notes: "정리된 메모" });
    expect(saveMemoHistory).toHaveBeenCalledWith({ memberId: 7, content: bigMemo, savedBy: 42 });
  });
});
