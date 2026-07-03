const HANGUL_SYLLABLE_START = 0xac00;
const HANGUL_SYLLABLE_END = 0xd7a3;
const HANGUL_INITIAL_UNIT = 588;
const HANGUL_INITIAL_CONSONANTS = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
] as const;

export function normalizeMemberSearchText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function getHangulInitialSearchText(value: string) {
  return Array.from(value.normalize("NFKC"))
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;

      if (codePoint < HANGUL_SYLLABLE_START || codePoint > HANGUL_SYLLABLE_END) {
        return "";
      }

      return HANGUL_INITIAL_CONSONANTS[Math.floor((codePoint - HANGUL_SYLLABLE_START) / HANGUL_INITIAL_UNIT)];
    })
    .join("");
}

function createMemberSearchHaystack(values: Array<string | null | undefined>) {
  const source = values.filter(Boolean).join(" ");

  return `${normalizeMemberSearchText(source)}${normalizeMemberSearchText(getHangulInitialSearchText(source))}`;
}

export function matchesMemberSearch(query: string, values: Array<string | null | undefined>) {
  const normalizedQuery = normalizeMemberSearchText(query);

  if (!normalizedQuery) {
    return false;
  }

  return createMemberSearchHaystack(values).includes(normalizedQuery);
}

export function normalizeNoticeMemberSearchText(value: string) {
  return normalizeMemberSearchText(value);
}

export function matchesNoticeMemberSearch(query: string, values: Array<string | null | undefined>) {
  return matchesMemberSearch(query, values);
}
