export function getVisibleUserEmail(email?: string | null) {
  const normalizedEmail = email?.trim();

  if (!normalizedEmail || normalizedEmail.toLowerCase().endsWith(".test")) {
    return null;
  }

  return normalizedEmail;
}
