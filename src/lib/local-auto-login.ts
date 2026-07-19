export const localAutoLoginNextMaxLength = 2_048;
export const localAutoLoginFallbackPath = "/app/dashboard";

const localAutoLoginValidationOrigin = "http://local.finaljudo.invalid";

export function normalizeLocalAutoLoginNextPath(value: string | null | undefined) {
  if (
    !value ||
    value.length > localAutoLoginNextMaxLength ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return localAutoLoginFallbackPath;
  }

  try {
    const target = new URL(value, localAutoLoginValidationOrigin);

    if (target.origin !== localAutoLoginValidationOrigin) {
      return localAutoLoginFallbackPath;
    }

    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return localAutoLoginFallbackPath;
  }
}
