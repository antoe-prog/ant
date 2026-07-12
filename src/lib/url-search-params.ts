function normalizeTextParam(value: string | null | undefined) {
  return value?.trim() ?? "";
}

export function createUrlWithTextParam(currentHref: string, paramName: string, value: string) {
  const url = new URL(currentHref);
  const normalizedValue = normalizeTextParam(value);

  if (normalizedValue) {
    url.searchParams.set(paramName, normalizedValue);
  } else {
    url.searchParams.delete(paramName);
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export function getNormalizedTextParam(value: string | null | undefined) {
  return normalizeTextParam(value);
}
