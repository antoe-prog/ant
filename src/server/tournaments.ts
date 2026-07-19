export type TournamentBody = {
  title?: string;
  organizer?: string;
  eventDate?: string;
  location?: string;
  registrationDeadline?: string;
  sourceUrl?: string;
  description?: string;
};

export type TournamentValue = {
  title: string;
  organizer: string;
  eventDate: string;
  location: string | undefined;
  registrationDeadline: string | undefined;
  sourceUrl: string | undefined;
  description: string | undefined;
};

export type TournamentValidation =
  | { ok: false; error: string }
  | { ok: true; value: TournamentValue };

const tournamentBodyFields = [
  "title",
  "organizer",
  "eventDate",
  "location",
  "registrationDeadline",
  "sourceUrl",
  "description",
] as const;

export const tournamentStateLockKey = "tournament-state";

function isDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  return (
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day)
  );
}

export function getTournamentBodyTypeError(value: unknown, requireSupportedField = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "대회 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;

  for (const field of tournamentBodyFields) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return "대회 정보 값의 형식이 올바르지 않습니다.";
    }
  }

  if (requireSupportedField && !tournamentBodyFields.some((field) => body[field] !== undefined)) {
    return "변경할 대회 정보를 입력해 주세요.";
  }

  return null;
}

export function validateTournamentBody(value: unknown): TournamentValidation {
  const bodyTypeError = getTournamentBodyTypeError(value);

  if (bodyTypeError) {
    return { ok: false, error: bodyTypeError };
  }

  const body = value as TournamentBody;
  const title = body.title?.trim() ?? "";
  const organizer = body.organizer?.trim() ?? "";
  const eventDate = body.eventDate?.trim() ?? "";
  const location = body.location?.trim() || undefined;
  const registrationDeadline = body.registrationDeadline?.trim() || undefined;
  const sourceUrl = body.sourceUrl?.trim() || undefined;
  const description = body.description?.trim() || undefined;

  if (!title || title.length > 80) {
    return { ok: false, error: "대회명을 80자 이내로 입력해 주세요." };
  }

  if (!organizer || organizer.length > 40) {
    return { ok: false, error: "주최 단체를 40자 이내로 입력해 주세요." };
  }

  if (!isDateOnly(eventDate)) {
    return { ok: false, error: "대회일은 YYYY-MM-DD 형식으로 입력해 주세요." };
  }

  if (registrationDeadline !== undefined) {
    if (!isDateOnly(registrationDeadline)) {
      return { ok: false, error: "접수 마감일은 YYYY-MM-DD 형식으로 입력해 주세요." };
    }

    if (registrationDeadline > eventDate) {
      return { ok: false, error: "접수 마감일은 대회일 이전이어야 합니다." };
    }
  }

  if (location !== undefined && location.length > 80) {
    return { ok: false, error: "장소는 80자 이내로 입력해 주세요." };
  }

  if (sourceUrl !== undefined && (!/^https?:\/\//.test(sourceUrl) || sourceUrl.length > 300)) {
    return { ok: false, error: "공지 링크는 http(s) 주소로 300자 이내여야 합니다." };
  }

  if (description !== undefined && description.length > 500) {
    return { ok: false, error: "설명은 500자 이내로 입력해 주세요." };
  }

  return {
    ok: true,
    value: { title, organizer, eventDate, location, registrationDeadline, sourceUrl, description },
  };
}

export function canManageTournaments(role: string) {
  return role === "coach" || role === "owner" || role === "admin";
}
