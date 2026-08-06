import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { createMockData } from "../src/lib/mock-data.ts";
import {
  mergeKoreaJudoTournaments,
  parseKoreaJudoTournamentList,
  parseKoreaJudoTournamentPeriod,
  readBoundedTournamentSource,
} from "../src/server/korea-judo-tournaments.ts";
import { canMutateTournament } from "../src/lib/tournament-policy.ts";

const nextBin = "node_modules/next/dist/bin/next";
const sourceFixture = `
  <div class="panel panel-default day_count">
    <span class="left_name">기간</span>
    <span class="right_text">2026년08월01일(토)~03일(월)(3일간)</span>
    <span class="left_name">장소</span>
    <span class="right_text">익산실내체육관</span>
    <span class="left_name">주최</span>
    <span class="right_text">대한유도회</span>
    <input type="hidden" name="GameTitleIDX" value="523" />
    <input type="hidden" name="GameTitleName" value="2026 백제왕도 익산 생활체육전국유도대회" />
  </div>
  <div class="panel panel-default day_count">
    <span class="left_name">기간</span>
    <span class="right_text">2026년11월30일(월)~12월04일(금)(5일간)</span>
    <span class="left_name">장소</span>
    <span class="right_text">테스트 &amp; 체육관</span>
    <span class="left_name">주최</span>
    <span class="right_text">대한유도회</span>
    <input type="hidden" name="GameTitleIDX" value="600" />
    <input type="hidden" name="GameTitleName" value="월 경계 대회" />
  </div>
  <div class="panel panel-default day_count">
    <span class="left_name">기간</span>
    <span class="right_text">2026년08월01일(토)~03일(월)(3일간)</span>
    <span class="left_name">장소</span>
    <span class="right_text">중복 일정</span>
    <span class="left_name">주최</span>
    <span class="right_text">대한유도회</span>
    <input type="hidden" name="GameTitleIDX" value="523" />
    <input type="hidden" name="GameTitleName" value="중복된 백제왕도 대회" />
  </div>
  <div class="panel panel-default day_count">
    <span class="left_name">기간</span>
    <span class="right_text">날짜 미정</span>
    <input type="hidden" name="GameTitleIDX" value="601" />
    <input type="hidden" name="GameTitleName" value="파싱 제외 대회" />
  </div>
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address?.port
          ? resolve(address.port)
          : reject(new Error("Could not allocate a tournament sync test port.")),
      );
    });
  });
}

async function waitForServer(baseUrl, child, timeoutMs = 45_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error("Tournament sync test server exited before it became reachable.");
    }

    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) return;
    } catch {
      // Wait for the isolated server to bind its port.
    }

    await sleep(300);
  }

  throw new Error(`Timed out waiting for ${baseUrl}.`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;

  if (process.platform === "win32") child.kill("SIGTERM");
  else process.kill(-child.pid, "SIGTERM");

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(5_000).then(() => {
      if (child.exitCode === null) {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      }
    }),
  ]);
}

async function apiRequest(baseUrl, userId) {
  const response = await fetch(`${baseUrl}/api/v1/tournaments/korea-judo/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
    },
    body: JSON.stringify({ year: 2026 }),
  });

  return { response, payload: await response.json() };
}

async function registrationRequest(baseUrl, tournamentId, method, body) {
  const response = await fetch(`${baseUrl}/api/v1/tournaments/${tournamentId}/registrations`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-user-id": "user-member",
    },
    body: JSON.stringify(body),
  });

  return { response, payload: await response.json() };
}

async function main() {
  await assert.rejects(
    readBoundedTournamentSource(
      new Response("oversized", { headers: { "content-length": "500" } }),
      100,
    ),
    /크기 또는 형식/,
    "declared oversized source responses must be rejected before reading",
  );
  await assert.rejects(
    readBoundedTournamentSource(new Response("streamed oversized source"), 10),
    /크기 또는 형식/,
    "streamed source responses must stop when the byte limit is exceeded",
  );
  assert.equal(
    await readBoundedTournamentSource(new Response("정상 일정"), 32),
    "정상 일정",
    "bounded source reads must preserve multibyte text",
  );

  assert.deepEqual(
    parseKoreaJudoTournamentPeriod("2026년06월29일(월)~07월04일(토)(6일간)"),
    { eventDate: "2026-06-29", eventEndDate: "2026-07-04" },
    "cross-month periods must retain both dates",
  );
  assert.deepEqual(
    parseKoreaJudoTournamentPeriod("2026년09월21일(월)(1일간)"),
    { eventDate: "2026-09-21", eventEndDate: undefined },
    "single-day periods must not invent an end date",
  );

  const parsed = parseKoreaJudoTournamentList(sourceFixture, 2026);
  assert.equal(parsed.records.length, 2, "valid source panels must be parsed");
  assert.equal(parsed.skippedCount, 2, "malformed and duplicate source panels must be skipped");
  assert.equal(
    parsed.records[0].title,
    "2026 백제왕도 익산 생활체육전국유도대회",
    "the first valid record must win when the source repeats an external ID",
  );
  assert.equal(parsed.records[1].location, "테스트 & 체육관", "HTML entities must be decoded");
  assert.equal(parsed.records[1].eventEndDate, "2026-12-04", "source end dates must be normalized");
  const malformedEntitySource = sourceFixture.replace(
    "2026 백제왕도 익산 생활체육전국유도대회",
    "안전 &#9999999999; 대회",
  );
  assert.doesNotThrow(
    () => parseKoreaJudoTournamentList(malformedEntitySource, 2026),
    "out-of-range numeric HTML entities must not abort the full sync",
  );

  const manualTournament = {
    id: "tournament-manual",
    scope: "branch",
    branchId: "branch-gangnam",
    title: "도장 수동 대회",
    organizer: "강남 본관",
    eventDate: "2026-10-01",
    createdByUserId: "user-owner",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const merged = mergeKoreaJudoTournaments(
    [manualTournament],
    parsed.records,
    2026,
    "user-admin",
    "2026-07-28T00:00:00.000Z",
  );
  assert.equal(merged.createdCount, 2, "first sync must create imported tournaments");
  assert(merged.tournaments.some((tournament) => tournament.id === manualTournament.id), "manual tournaments must survive sync");
  const importedWithRegistration = {
    ...merged.tournaments.find((tournament) => tournament.sourceId === "2026:523"),
    registrations: [
      {
        id: "tournament-registration-preserved",
        memberId: "member-minjae",
        appliedByUserId: "user-member",
        status: "submitted",
        appliedAt: "2026-07-29T00:00:00.000Z",
      },
    ],
  };
  const changedRecords = parsed.records.map((record) =>
    record.externalId === "523" ? { ...record, location: "변경된 대회장" } : record,
  );
  const resynced = mergeKoreaJudoTournaments(
    [manualTournament, importedWithRegistration],
    changedRecords,
    2026,
    "user-admin",
    "2026-07-29T00:00:00.000Z",
  );
  assert.deepEqual(
    resynced.tournaments.find((tournament) => tournament.sourceId === "2026:523")?.registrations,
    importedWithRegistration.registrations,
    "source updates must preserve every existing tournament registration and status",
  );

  const tempRoot = path.join(process.cwd(), ".data", "test-runs");
  await mkdir(tempRoot, { recursive: true });
  const tempDir = await mkdtemp(path.join(tempRoot, "korea-judo-sync-"));
  const dbFile = path.join(tempDir, "final-judo-db.json");
  const stamp = `${process.pid}-${Date.now()}`;
  const distDir = `.next-korea-judo-sync-${stamp}`;
  const tsconfigPath = `.tsconfig.korea-judo-sync-${stamp}.json`;
  const db = createMockData();
  db.tournaments = [manualTournament];
  await Promise.all([
    writeFile(dbFile, `${JSON.stringify(db, null, 2)}\n`, "utf8"),
    writeFile(
      tsconfigPath,
      `${JSON.stringify(
        {
          extends: "./tsconfig.json",
          include: [
            "next-env.d.ts",
            "**/*.ts",
            "**/*.tsx",
            `${distDir}/types/**/*.ts`,
            `${distDir}/dev/types/**/*.ts`,
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  ]);

  let sourceRequestCount = 0;
  let sourceResponseBody = sourceFixture;
  let sourceResponseDelayMs = 0;
  let activeSourceRequests = 0;
  let maximumConcurrentSourceRequests = 0;
  const sourceServer = createServer((request, response) => {
    sourceRequestCount += 1;
    activeSourceRequests += 1;
    maximumConcurrentSourceRequests = Math.max(maximumConcurrentSourceRequests, activeSourceRequests);
    assert.equal(request.method, "POST", "source adapter must use the official POST contract");
    const responseBody = sourceResponseBody;
    const completeResponse = () => {
      response.writeHead(200, { "content-type": "text/html;charset=utf-8" });
      response.end(responseBody);
      activeSourceRequests -= 1;
    };

    if (sourceResponseDelayMs > 0) {
      setTimeout(completeResponse, sourceResponseDelayMs);
    } else {
      completeResponse();
    }
  });
  const sourcePort = await getFreePort();
  await new Promise((resolve, reject) => {
    sourceServer.once("error", reject);
    sourceServer.listen(sourcePort, "127.0.0.1", resolve);
  });

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [nextBin, "dev", "--webpack", "--port", String(port), "--hostname", "127.0.0.1"],
    {
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        FINAL_JUDO_DB_DRIVER: "json",
        FINAL_JUDO_KJA_TOURNAMENT_SOURCE_URL: `http://127.0.0.1:${sourcePort}/match-list`,
        FINAL_JUDO_NEXT_DIST_DIR: distDir,
        FINAL_JUDO_NEXT_TSCONFIG_PATH: tsconfigPath,
        PILOT_DB_FILE: dbFile,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let serverOutput = "";
  child.stdout.on("data", (chunk) => {
    serverOutput += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    serverOutput += String(chunk);
  });

  try {
    await waitForServer(baseUrl, child);

    const memberAttempt = await apiRequest(baseUrl, "user-member");
    assert.equal(memberAttempt.response.status, 403, "members must not trigger external schedule sync");
    assert.equal(sourceRequestCount, 0, "forbidden calls must not reach the external source");

    const ownerAttempt = await apiRequest(baseUrl, "user-owner");
    assert.equal(ownerAttempt.response.status, 403, "branch owners must not mutate the global imported schedule");
    assert.equal(sourceRequestCount, 0, "owner calls must not reach the external source");

    const firstSync = await apiRequest(baseUrl, "user-admin");
    assert.equal(firstSync.response.status, 200, JSON.stringify(firstSync.payload));
    assert.equal(firstSync.payload.data.sync.createdCount, 2, "admin sync must report created records");
    assert.equal(firstSync.payload.data.sync.skippedCount, 2, "admin sync must report malformed and duplicate source records");
    const importedTournament = firstSync.payload.data.db.tournaments.find(
      (tournament) => tournament.source === "korea_judo_association",
    );
    assert(importedTournament, "sync response must include imported tournaments");
    assert.equal(
      canMutateTournament(firstSync.payload.data.user, importedTournament, ["branch-gangnam"]),
      false,
      "imported tournaments must remain read-only",
    );
    const registrationTournament = firstSync.payload.data.db.tournaments.find(
      (tournament) => tournament.sourceId === "2026:600",
    );
    assert(registrationTournament, "sync must expose the future imported tournament used for registration checks");
    const registrationApply = await registrationRequest(baseUrl, registrationTournament.id, "POST", {
      memberId: "member-minjae",
      division: "일반부",
      weightClass: "-73kg",
    });
    assert.equal(registrationApply.response.status, 200, JSON.stringify(registrationApply.payload));

    const memberBootstrap = await fetch(`${baseUrl}/api/v1/me/bootstrap`, {
      headers: { "x-user-id": "user-member" },
    });
    const memberBootstrapPayload = await memberBootstrap.json();
    assert.equal(memberBootstrap.status, 200, JSON.stringify(memberBootstrapPayload));
    assert(
      memberBootstrapPayload.data.db.tournaments.some(
        (tournament) => tournament.source === "korea_judo_association",
      ),
      "members must receive imported global tournaments",
    );

    const secondSync = await apiRequest(baseUrl, "user-admin");
    assert.equal(secondSync.response.status, 200, JSON.stringify(secondSync.payload));
    assert.equal(secondSync.payload.data.sync.createdCount, 0, "repeat sync must be idempotent");
    assert.equal(secondSync.payload.data.sync.unchangedCount, 2, "repeat sync must identify unchanged records");
    assert.equal(
      secondSync.payload.data.db.tournaments.find((tournament) => tournament.sourceId === "2026:600")
        ?.registrations?.[0]?.status,
      "pending",
      "repeat sync must preserve a persisted family registration",
    );

    sourceResponseBody = sourceFixture.replace('value="600"', 'value="missing-600"');
    const missingSourceSync = await apiRequest(baseUrl, "user-admin");
    assert.equal(missingSourceSync.response.status, 200, JSON.stringify(missingSourceSync.payload));
    assert.equal(missingSourceSync.payload.data.sync.missingCount, 1, "sync must report imported events absent from the source");
    const unavailableTournament = missingSourceSync.payload.data.db.tournaments.find(
      (tournament) => tournament.sourceId === "2026:600",
    );
    assert.equal(
      unavailableTournament?.sourceAvailability,
      "missing",
      "an imported event absent from the latest official list must require confirmation",
    );
    assert.equal(
      unavailableTournament?.registrations?.[0]?.status,
      "pending",
      "marking an imported event unavailable must preserve its registration history",
    );

    const unavailableUpdate = await registrationRequest(baseUrl, registrationTournament.id, "POST", {
      memberId: "member-minjae",
      division: "일반부",
      weightClass: "-81kg",
    });
    assert.equal(unavailableUpdate.response.status, 422, "a missing official event must reject new or updated applications");
    assert.match(
      unavailableUpdate.payload.error.message,
      /공식 일정에서 현재 확인되지 않는/,
      "the blocked application must explain the source state",
    );

    const unavailableCancellation = await registrationRequest(baseUrl, registrationTournament.id, "DELETE", {
      memberId: "member-minjae",
    });
    assert.equal(unavailableCancellation.response.status, 200, "families must still be able to cancel a pending stale application");

    sourceResponseBody = sourceFixture;
    sourceResponseDelayMs = 100;
    const concurrentSyncs = await Promise.all([
      apiRequest(baseUrl, "user-admin"),
      apiRequest(baseUrl, "user-admin"),
    ]);
    sourceResponseDelayMs = 0;
    assert(
      concurrentSyncs.every(({ response }) => response.status === 200),
      "concurrent authorized sync requests must both complete",
    );
    assert.equal(
      maximumConcurrentSourceRequests,
      1,
      "source fetches must be serialized so an older slow response cannot overwrite a newer sync",
    );
    assert.equal(sourceRequestCount, 5, "only authorized sync calls may reach the external source");

    const persisted = JSON.parse(await readFile(dbFile, "utf8"));
    assert(persisted.tournaments.some((tournament) => tournament.id === manualTournament.id), "manual data must be preserved");
    assert.equal(
      persisted.tournaments.filter((tournament) => tournament.source === "korea_judo_association").length,
      2,
      "imported records must be stored once",
    );
    assert.equal(
      persisted.auditLogs.filter((log) => log.action === "tournament.sync").length,
      5,
      "every successful sync must be audited",
    );

    const [screenSource, calendarSource, classesSource] = await Promise.all([
      readFile(path.join(process.cwd(), "src/components/screens/tournaments-screen.tsx"), "utf8"),
      readFile(path.join(process.cwd(), "src/components/domain/family-class-calendar.tsx"), "utf8"),
      readFile(path.join(process.cwd(), "src/components/screens/classes-screen.tsx"), "utf8"),
    ]);
    assert(screenSource.includes('data-testid="korea-judo-tournament-sync"'), "tournament screen must expose the admin sync action");
    assert(screenSource.includes("대한유도회 연동"), "imported tournament cards must identify their source");
    assert(screenSource.includes("공식 일정 확인 필요"), "missing official events must be visibly distinguished");
    assert(
      screenSource.includes("registrationSourceUnavailable"),
      "the family registration dialog must disable new or updated applications for missing official events",
    );
    assert(
      calendarSource.includes("getCalendarTournamentLabel(dayTournaments[0].title)"),
      "calendar dates must show a readable tournament title",
    );
    assert(calendarSource.includes('data-testid="family-calendar-tournament-dialog"'), "calendar must open tournament details in a dialog");
    assert(calendarSource.includes('aria-modal="true"'), "tournament details must be announced as a modal");
    assert(calendarSource.includes('event.key === "Escape"'), "the tournament dialog must close with Escape");
    assert(calendarSource.includes('data-testid="family-calendar-selected-tournaments"'), "dialog must render selected-day tournaments");
    assert(
      calendarSource.includes('tournament.sourceAvailability === "missing"'),
      "calendar tournament details must warn when the official event is no longer confirmed",
    );
    assert(classesSource.includes("familyTournamentDateKeys"), "tournament dates must be selectable in the family calendar");
  } catch (error) {
    if (serverOutput) {
      process.stderr.write(serverOutput);
    }
    throw error;
  } finally {
    await stopServer(child);
    await new Promise((resolve) => sourceServer.close(resolve));
    await rm(tempDir, { recursive: true, force: true });
    await rm(path.join(process.cwd(), distDir), { recursive: true, force: true });
    await rm(path.join(process.cwd(), tsconfigPath), { force: true });
  }

  console.log(
    JSON.stringify(
      {
        parsed: {
          records: parsed.records.length,
          skipped: parsed.skippedCount,
        },
        api: {
          authorizedSync: true,
          boundedSourceResponse: true,
          duplicateSourceIdsRejected: true,
          idempotent: true,
          manualTournamentPreserved: true,
          missingOfficialEventBlocked: true,
          registrationsPreserved: true,
          sourceFetchesSerialized: true,
          staleRegistrationCancellationPreserved: true,
          unauthorizedSourceRequests: 0,
        },
        ui: {
          calendarTournamentDialog: true,
          calendarTournamentDates: true,
          calendarTournamentTitles: true,
          sourceList: true,
          syncAction: true,
        },
      },
      null,
      2,
    ),
  );
}

await main();
