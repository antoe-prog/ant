export type AppVariant = "admin" | "member";

function normalizeAppVariant(value: string | undefined): AppVariant {
  return value === "admin" ? "admin" : "member";
}

export const APP_VARIANT = normalizeAppVariant(process.env.EXPO_PUBLIC_APP_VARIANT);
export const IS_ADMIN_APP = APP_VARIANT === "admin";
export const IS_MEMBER_APP = APP_VARIANT === "member";

export const APP_VARIANT_LABEL = IS_ADMIN_APP ? "관리자 전용" : "회원 전용";
export const MEMBER_INVITE_SCHEME = process.env.EXPO_PUBLIC_MEMBER_INVITE_SCHEME ?? "judokanmember";

export function canUseAdminApp(role: string | null | undefined): boolean {
  return role === "manager" || role === "admin";
}
