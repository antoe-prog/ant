import type { Tournament } from "@/lib/domain";
import { containsUnsafeTournamentText, tournamentFieldLimits } from "./tournaments.ts";

export const koreaJudoAssociationTournamentSource = "korea_judo_association" as const;
export const koreaJudoAssociationScheduleUrl =
  "http://judo.sports.or.kr/Match/Country/schedule.asp";
const defaultTournamentListUrl =
  "http://judo.sports.or.kr/Match/Country/ajax/MatchList.asp";
const officialTournamentHost = "judo.sports.or.kr";
const officialTournamentPath = "/Match/Country/ajax/MatchList.asp";
const fetchTimeoutMs = 12_000;
const maximumSourceBytes = 2_000_000;
const maximumSourceIdLength = 32;
const sourceIdPattern = new RegExp(`^\\d{1,${maximumSourceIdLength}}$`);

function isAllowedTournamentSourceUrl(sourceUrl: URL) {
  const isOfficialSource =
    sourceUrl.hostname === officialTournamentHost &&
    sourceUrl.pathname === officialTournamentPath &&
    (sourceUrl.protocol === "http:" || sourceUrl.protocol === "https:");
  const isLocalDevelopmentSource =
    process.env.NODE_ENV !== "production" &&
    (sourceUrl.hostname === "127.0.0.1" || sourceUrl.hostname === "localhost") &&
    (sourceUrl.protocol === "http:" || sourceUrl.protocol === "https:");

  return isOfficialSource || isLocalDevelopmentSource;
}

export type KoreaJudoTournamentRecord = {
  externalId: string;
  title: string;
  organizer: string;
  eventDate: string;
  eventEndDate?: string;
  location?: string;
  sourceUrl: string;
};

export type KoreaJudoTournamentMergeResult = {
  tournaments: Tournament[];
  createdCount: number;
  missingCount: number;
  updatedCount: number;
  unchangedCount: number;
};

export async function readBoundedTournamentSource(
  response: Response,
  maximumBytes = maximumSourceBytes,
) {
  const declaredLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("대한유도회 일정 원본의 크기 또는 형식이 올바르지 않습니다.");
  }

  if (!response.body) {
    throw new Error("대한유도회 일정 원본의 크기 또는 형식이 올바르지 않습니다.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let source = "";
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      source += decoder.decode();
      break;
    }

    receivedBytes += value.byteLength;

    if (receivedBytes > maximumBytes) {
      await reader.cancel();
      throw new Error("대한유도회 일정 원본의 크기 또는 형식이 올바르지 않습니다.");
    }

    source += decoder.decode(value, { stream: true });
  }

  if (!source) {
    throw new Error("대한유도회 일정 원본의 크기 또는 형식이 올바르지 않습니다.");
  }

  return source;
}

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
    if (token.startsWith("#x")) {
      const codePoint = Number.parseInt(token.slice(2), 16);
      return isValidHtmlCodePoint(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    if (token.startsWith("#")) {
      const codePoint = Number.parseInt(token.slice(1), 10);
      return isValidHtmlCodePoint(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    return namedEntities[token.toLowerCase()] ?? entity;
  });
}

function isValidHtmlCodePoint(codePoint: number) {
  return (
    Number.isInteger(codePoint) &&
    codePoint >= 0 &&
    codePoint <= 0x10ffff &&
    (codePoint < 0xd800 || codePoint > 0xdfff)
  );
}

function normalizeHtmlText(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function readInputValue(segment: string, name: string) {
  const input = segment.match(new RegExp(`<input\\b[^>]*\\bname=["']${name}["'][^>]*>`, "i"))?.[0];

  if (!input) {
    return "";
  }

  return decodeHtmlEntities(input.match(/\bvalue=["']([^"']*)["']/i)?.[1] ?? "").trim();
}

function readLabelValue(segment: string, label: string) {
  const match = segment.match(
    new RegExp(
      `<span\\b[^>]*class=["'][^"']*\\bleft_name\\b[^"']*["'][^>]*>\\s*${label}\\s*<\\/span>\\s*` +
        `<span\\b[^>]*class=["'][^"']*\\bright_text\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/span>`,
      "i",
    ),
  );

  return match ? normalizeHtmlText(match[1]) : "";
}

function formatDateKey(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseKoreaJudoTournamentPeriod(value: string) {
  const compactValue = value.replace(/\s+/g, "");
  const [startPart, endPart] = compactValue.split("~", 2);
  const startMatch = startPart?.match(/(\d{4})년(\d{1,2})월(\d{1,2})일/);

  if (!startMatch) {
    return null;
  }

  const startYear = Number(startMatch[1]);
  const startMonth = Number(startMatch[2]);
  const startDay = Number(startMatch[3]);
  const eventDate = formatDateKey(startYear, startMonth, startDay);

  if (!eventDate) {
    return null;
  }

  if (!endPart) {
    return { eventDate, eventEndDate: undefined };
  }

  const endMatch = endPart.match(/(?:(\d{4})년)?(?:(\d{1,2})월)?(\d{1,2})일/);

  if (!endMatch) {
    return null;
  }

  const endMonth = endMatch[2] ? Number(endMatch[2]) : startMonth;
  const endYear = endMatch[1]
    ? Number(endMatch[1])
    : endMonth < startMonth
      ? startYear + 1
      : startYear;
  const eventEndDate = formatDateKey(endYear, endMonth, Number(endMatch[3]));

  if (!eventEndDate || eventEndDate < eventDate) {
    return null;
  }

  return {
    eventDate,
    eventEndDate: eventEndDate === eventDate ? undefined : eventEndDate,
  };
}

export function parseKoreaJudoTournamentList(html: string, year: number) {
  const panelPattern = /<div\b[^>]*class=["'][^"']*\bpanel\b[^"']*\bpanel-default\b[^"']*["'][^>]*>/gi;
  const panelStarts = [...html.matchAll(panelPattern)].map((match) => match.index ?? 0);
  const records: KoreaJudoTournamentRecord[] = [];
  const seenExternalIds = new Set<string>();
  let skippedCount = 0;

  for (let index = 0; index < panelStarts.length; index += 1) {
    const segment = html.slice(panelStarts[index], panelStarts[index + 1] ?? html.length);
    const externalId = readInputValue(segment, "GameTitleIDX");
    const title = normalizeHtmlText(readInputValue(segment, "GameTitleName"));
    const organizer = readLabelValue(segment, "주최") || "대한유도회";
    const location = readLabelValue(segment, "장소") || undefined;
    const period = parseKoreaJudoTournamentPeriod(readLabelValue(segment, "기간"));
    const sourceUrl = `${koreaJudoAssociationScheduleUrl}?GameYear=${year}#collapse${externalId}`;

    if (
      !sourceIdPattern.test(externalId) ||
      !title ||
      title.length > tournamentFieldLimits.title ||
      containsUnsafeTournamentText(title) ||
      organizer.length > tournamentFieldLimits.organizer ||
      containsUnsafeTournamentText(organizer) ||
      (location?.length ?? 0) > tournamentFieldLimits.location ||
      (location !== undefined && containsUnsafeTournamentText(location)) ||
      sourceUrl.length > tournamentFieldLimits.sourceUrl ||
      containsUnsafeTournamentText(sourceUrl) ||
      !period ||
      Number(period.eventDate.slice(0, 4)) !== year
    ) {
      skippedCount += 1;
      continue;
    }

    if (seenExternalIds.has(externalId)) {
      skippedCount += 1;
      continue;
    }

    seenExternalIds.add(externalId);

    records.push({
      externalId,
      title,
      organizer,
      eventDate: period.eventDate,
      ...(period.eventEndDate ? { eventEndDate: period.eventEndDate } : {}),
      ...(location ? { location } : {}),
      sourceUrl,
    });
  }

  return { records, skippedCount };
}

function createImportedTournamentId(year: number, externalId: string) {
  return `tournament-kja-${year}-${externalId}`;
}

function hasTournamentSourceChanges(
  tournament: Tournament,
  record: KoreaJudoTournamentRecord,
) {
  return (
    tournament.title !== record.title ||
    tournament.organizer !== record.organizer ||
    tournament.eventDate !== record.eventDate ||
    tournament.eventEndDate !== record.eventEndDate ||
    tournament.location !== record.location ||
    tournament.sourceUrl !== record.sourceUrl ||
    tournament.sourceAvailability === "missing" ||
    tournament.scope !== "global" ||
    tournament.branchId !== null
  );
}

export function mergeKoreaJudoTournaments(
  tournaments: readonly Tournament[],
  records: readonly KoreaJudoTournamentRecord[],
  year: number,
  actorUserId: string,
  syncedAt: string,
): KoreaJudoTournamentMergeResult {
  const importedBySourceId = new Map(
    tournaments
      .filter(
        (tournament) =>
          tournament.source === koreaJudoAssociationTournamentSource &&
          typeof tournament.sourceId === "string",
      )
      .map((tournament) => [tournament.sourceId as string, tournament]),
  );
  const mergedById = new Map(tournaments.map((tournament) => [tournament.id, tournament]));
  const currentSourceIds = new Set(records.map((record) => `${year}:${record.externalId}`));
  let createdCount = 0;
  let missingCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  for (const record of records) {
    const sourceId = `${year}:${record.externalId}`;
    const existing =
      importedBySourceId.get(sourceId) ??
      mergedById.get(createImportedTournamentId(year, record.externalId));
    const sourceChanged = existing ? hasTournamentSourceChanges(existing, record) : true;
    const nextTournament: Tournament = {
      ...(existing ?? {
        id: createImportedTournamentId(year, record.externalId),
        createdAt: syncedAt,
        createdByUserId: actorUserId,
      }),
      scope: "global",
      branchId: null,
      title: record.title,
      organizer: record.organizer,
      eventDate: record.eventDate,
      ...(record.eventEndDate ? { eventEndDate: record.eventEndDate } : { eventEndDate: undefined }),
      ...(record.location ? { location: record.location } : { location: undefined }),
      sourceUrl: record.sourceUrl,
      source: koreaJudoAssociationTournamentSource,
      sourceId,
      sourceSyncedAt: syncedAt,
      sourceAvailability: "active",
      sourceMissingAt: undefined,
      description: "대한유도회 국내대회 일정에서 가져온 정보입니다.",
      ...(existing && sourceChanged ? { updatedAt: syncedAt } : {}),
    };

    mergedById.set(nextTournament.id, nextTournament);

    if (!existing) {
      createdCount += 1;
    } else if (sourceChanged) {
      updatedCount += 1;
    } else {
      unchangedCount += 1;
    }
  }

  for (const tournament of tournaments) {
    if (
      tournament.source !== koreaJudoAssociationTournamentSource ||
      !tournament.sourceId?.startsWith(`${year}:`) ||
      currentSourceIds.has(tournament.sourceId)
    ) {
      continue;
    }

    missingCount += 1;

    if (tournament.sourceAvailability === "missing") {
      continue;
    }

    mergedById.set(tournament.id, {
      ...tournament,
      sourceAvailability: "missing",
      sourceMissingAt: syncedAt,
      updatedAt: syncedAt,
    });
    updatedCount += 1;
  }

  return {
    tournaments: [...mergedById.values()],
    createdCount,
    missingCount,
    updatedCount,
    unchangedCount,
  };
}

export async function fetchKoreaJudoTournaments(year: number) {
  const sourceUrl = process.env.FINAL_JUDO_KJA_TOURNAMENT_SOURCE_URL?.trim() || defaultTournamentListUrl;
  const parsedSourceUrl = new URL(sourceUrl);

  if (!isAllowedTournamentSourceUrl(parsedSourceUrl)) {
    throw new Error("대한유도회 일정 원본 주소가 올바르지 않습니다.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), fetchTimeoutMs);

  try {
    const response = await fetch(parsedSourceUrl, {
      method: "POST",
      body: new URLSearchParams({
        GameTitleIDX: "",
        GameYear: String(year),
        HostCode: "",
        PageSeq: "0",
        PageSize: "0",
        SportsGb: "judo",
        typeId: "schedule",
      }),
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": "FinalJudo/1.0 (+https://final-judo.vercel.app/privacy)",
      },
      redirect: "error",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`대한유도회 일정 원본이 HTTP ${response.status}를 반환했습니다.`);
    }

    const html = await readBoundedTournamentSource(response);

    const parsed = parseKoreaJudoTournamentList(html, year);

    if (parsed.records.length === 0) {
      throw new Error(`${year}년 대한유도회 대회 일정을 찾지 못했습니다.`);
    }

    return parsed;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("대한유도회 일정 서버 응답 시간이 초과되었습니다.");
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
