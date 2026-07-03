import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv, validateRows } from "./pilot-data-utils.mjs";

const args = process.argv.slice(2);
const fileArg = args.find((arg) => arg.startsWith("--file="))?.slice("--file=".length);
const reportArg = args.find((arg) => arg.startsWith("--report="))?.slice("--report=".length);
const allowTemplate = args.includes("--allow-template");
const evidenceFile = path.resolve(fileArg ?? ".data/pilot-field-evidence.json");
const pilotReportFile = reportArg ? path.resolve(reportArg) : null;
const requiredRoles = ["admin", "owner", "coach", "guardian", "member"];
const requiredMobileDeviceKinds = ["ios", "android", "tablet"];
const requiredScreenReaderTargets = ["attendance-status", "notice-read-state"];
const placeholderPattern = /\b(todo|tbd|placeholder)\b|미정|확인 필요/i;

function addIssue(blockers, code, message, detail = null) {
  blockers.push({ code, message, ...(detail ? { detail } : {}) });
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isFilled(value) {
  const stringValue = text(value);

  if (!stringValue) {
    return false;
  }

  return allowTemplate || !placeholderPattern.test(stringValue);
}

function requireFilled(blockers, code, label, value, detail = null) {
  if (!isFilled(value)) {
    addIssue(blockers, code, `${label} is required.`, detail);
  }
}

function requireBooleanShape(blockers, code, label, value, detail = null) {
  if (typeof value !== "boolean") {
    addIssue(blockers, code, `${label} must be a boolean.`, detail);
  }
}

function requireTrue(blockers, code, label, value, detail = null) {
  if (allowTemplate) {
    requireBooleanShape(blockers, code, label, value, detail);
    return;
  }

  if (value !== true) {
    addIssue(blockers, code, `${label} must be verified.`, detail);
  }
}

function parseDateOnly(value) {
  const stringValue = text(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
    return null;
  }

  const parsed = new Date(`${stringValue}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateTime(value) {
  const parsed = new Date(text(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getPilotPeriodEnd(manifest) {
  return parseDateOnly(asObject(manifest.pilot)?.period?.endsOn);
}

function getPilotPeriodStart(manifest) {
  return parseDateOnly(asObject(manifest.pilot)?.period?.startsOn);
}

function getMarkdownGeneratedAt(markdown) {
  const generatedAtMatch = markdown?.match(/^- Generated:\s*(.+)$/m);
  return {
    generatedAtMatch,
    generatedAt: parseDateTime(generatedAtMatch?.[1]),
  };
}

function inclusiveDaysBetween(start, end) {
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function numberValue(value) {
  return Number.isFinite(Number(value)) ? Number(value) : NaN;
}

function summarizePilotSourceRows(records) {
  const countRows = (type) => records.filter(({ row }) => row.type === type).length;
  const members = countRows("member");
  const branchNames = [...new Set(records.filter(({ row }) => row.type === "branch").map(({ row }) => row.branch_name))].sort();
  const userAccounts = records
    .filter(({ row }) => row.type === "user")
    .map(({ row }) => ({
      branchName: row.branch_name,
      email: row.email.toLowerCase(),
      name: row.name,
      role: row.role,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));

  return {
    branches: countRows("branch"),
    users: countRows("user"),
    members,
    classes: countRows("class"),
    payments: members,
    notices: countRows("notice"),
    branchNames,
    userAccounts,
  };
}

function validateSourceCsvScope(manifest, sourceCsvSummary, blockers) {
  if (!sourceCsvSummary) {
    return;
  }

  const manifestBranchNames = (asArray(asObject(manifest.pilot)?.branches) ?? []).map((branch) => text(asObject(branch)?.name)).filter(Boolean).sort();
  const sourceBranchNames = sourceCsvSummary.branchNames;
  const missingBranches = sourceBranchNames.filter((branchName) => !manifestBranchNames.includes(branchName));
  const extraBranches = manifestBranchNames.filter((branchName) => !sourceBranchNames.includes(branchName));

  if (missingBranches.length > 0 || extraBranches.length > 0) {
    addIssue(blockers, "PILOT_BRANCH_SOURCE_MISMATCH", "pilot.branches must match dataImport.sourceCsv branch rows.", {
      missingBranches,
      extraBranches,
      sourceBranchNames,
      manifestBranchNames,
    });
  }

  const manifestAccounts = (asArray(manifest.accounts) ?? [])
    .map((account) => {
      const accountObject = asObject(account);

      return {
        branchScope: text(accountObject?.branchScope),
        email: text(accountObject?.email).toLowerCase(),
        role: text(accountObject?.role),
      };
    })
    .filter((account) => account.email);
  const manifestAccountsByEmail = new Map(manifestAccounts.map((account) => [account.email, account]));
  const sourceAccountsByEmail = new Map(sourceCsvSummary.userAccounts.map((account) => [account.email, account]));
  const missingAccounts = sourceCsvSummary.userAccounts.filter((account) => !manifestAccountsByEmail.has(account.email));
  const extraAccounts = manifestAccounts.filter((account) => !sourceAccountsByEmail.has(account.email));
  const roleMismatches = sourceCsvSummary.userAccounts
    .map((sourceAccount) => {
      const manifestAccount = manifestAccountsByEmail.get(sourceAccount.email);

      if (!manifestAccount || manifestAccount.role === sourceAccount.role) {
        return null;
      }

      return {
        email: sourceAccount.email,
        sourceRole: sourceAccount.role,
        manifestRole: manifestAccount.role,
      };
    })
    .filter(Boolean);
  const branchScopeMismatches = sourceCsvSummary.userAccounts
    .map((sourceAccount) => {
      const manifestAccount = manifestAccountsByEmail.get(sourceAccount.email);

      if (!manifestAccount) {
        return null;
      }

      const branchScope = manifestAccount.branchScope;
      const matches =
        sourceAccount.role === "admin"
          ? branchScope.toLowerCase() === "all" || branchScope.toLowerCase().includes("all")
          : branchScope.includes(sourceAccount.branchName);

      if (matches) {
        return null;
      }

      return {
        email: sourceAccount.email,
        role: sourceAccount.role,
        sourceBranch: sourceAccount.branchName,
        branchScope,
      };
    })
    .filter(Boolean);

  if (missingAccounts.length > 0) {
    addIssue(blockers, "ACCOUNT_SOURCE_MISSING", "every source CSV user account must be listed in accounts evidence.", {
      missingAccounts,
    });
  }

  if (extraAccounts.length > 0) {
    addIssue(blockers, "ACCOUNT_SOURCE_EXTRA", "accounts evidence must not include emails outside dataImport.sourceCsv.", {
      extraAccounts,
    });
  }

  if (roleMismatches.length > 0) {
    addIssue(blockers, "ACCOUNT_SOURCE_ROLE_MISMATCH", "account roles must match dataImport.sourceCsv user rows.", {
      roleMismatches,
    });
  }

  if (branchScopeMismatches.length > 0) {
    addIssue(blockers, "ACCOUNT_SOURCE_BRANCH_SCOPE_MISMATCH", "account branchScope must include its dataImport.sourceCsv branch.", {
      branchScopeMismatches,
    });
  }
}

function validatePilotScope(manifest, blockers) {
  const pilot = asObject(manifest.pilot);

  if (!pilot) {
    addIssue(blockers, "PILOT_SCOPE_MISSING", "pilot scope is required.");
    return;
  }

  const branches = asArray(pilot.branches);
  if (!branches || branches.length < 1 || branches.length > 2) {
    addIssue(blockers, "PILOT_BRANCH_SCOPE_INVALID", "pilot.branches must contain one or two pilot branches.");
  } else {
    branches.forEach((branch, index) => {
      const branchObject = asObject(branch);

      if (!branchObject) {
        addIssue(blockers, "PILOT_BRANCH_INVALID", "pilot branch must be an object.", { index });
        return;
      }

      requireFilled(blockers, "PILOT_BRANCH_NAME_MISSING", "pilot branch name", branchObject.name, { index });
      requireFilled(blockers, "PILOT_BRANCH_OWNER_MISSING", "pilot branch owner", branchObject.owner, { index });
      requireFilled(blockers, "PILOT_BRANCH_EVIDENCE_MISSING", "pilot branch evidence", branchObject.evidence, { index });
    });
  }

  const period = asObject(pilot.period);
  if (!period) {
    addIssue(blockers, "PILOT_PERIOD_MISSING", "pilot.period is required.");
  } else {
    const startsOn = parseDateOnly(period.startsOn);
    const endsOn = parseDateOnly(period.endsOn);

    if (!startsOn || !endsOn) {
      addIssue(blockers, "PILOT_PERIOD_DATE_INVALID", "pilot period dates must use YYYY-MM-DD.");
    } else if (inclusiveDaysBetween(startsOn, endsOn) < 14) {
      addIssue(blockers, "PILOT_PERIOD_TOO_SHORT", "pilot period must span at least 14 calendar days.");
    }

    if (!allowTemplate && Number(period.operatingDays) < 14) {
      addIssue(blockers, "PILOT_OPERATING_DAYS_INCOMPLETE", "pilot.period.operatingDays must be at least 14.");
    }
  }

  requireFilled(blockers, "PILOT_SIGNOFF_MISSING", "pilot signedOffBy", pilot.signedOffBy);
  requireFilled(blockers, "PILOT_SIGNOFF_TIME_MISSING", "pilot signedOffAt", pilot.signedOffAt);

  if (!allowTemplate && Number.isNaN(Date.parse(text(pilot.signedOffAt)))) {
    addIssue(blockers, "PILOT_SIGNOFF_TIME_INVALID", "pilot.signedOffAt must be a valid date-time.");
  }
}

function validateFinalSignoffChronology(manifest, pilotReport, markdown, blockers) {
  if (allowTemplate) {
    return;
  }

  const pilot = asObject(manifest.pilot);
  const signedOffAt = parseDateTime(pilot?.signedOffAt);
  const pilotPeriodEnd = getPilotPeriodEnd(manifest);
  const reportGeneratedAt = parseDateTime(pilotReport?.generatedAt);
  const { generatedAt: markdownGeneratedAt } = getMarkdownGeneratedAt(markdown);

  if (!signedOffAt) {
    return;
  }

  if (pilotPeriodEnd && signedOffAt < pilotPeriodEnd) {
    addIssue(blockers, "PILOT_SIGNOFF_BEFORE_PERIOD_END", "pilot signedOffAt must be on or after the pilot period ends.", {
      signedOffAt: signedOffAt.toISOString(),
      pilotPeriodEndsOn: text(pilot?.period?.endsOn),
    });
  }

  if (reportGeneratedAt && signedOffAt < reportGeneratedAt) {
    addIssue(blockers, "PILOT_SIGNOFF_BEFORE_JSON_REPORT", "pilot signedOffAt must be after the post-pilot JSON evidence report is generated.", {
      signedOffAt: signedOffAt.toISOString(),
      reportGeneratedAt: reportGeneratedAt.toISOString(),
    });
  }

  if (markdownGeneratedAt && signedOffAt < markdownGeneratedAt) {
    addIssue(blockers, "PILOT_SIGNOFF_BEFORE_MARKDOWN_REPORT", "pilot signedOffAt must be after the post-pilot Markdown evidence report is generated.", {
      signedOffAt: signedOffAt.toISOString(),
      markdownGeneratedAt: markdownGeneratedAt.toISOString(),
    });
  }
}

function validateAccounts(manifest, blockers) {
  const accounts = asArray(manifest.accounts);

  if (!accounts) {
    addIssue(blockers, "ACCOUNTS_MISSING", "accounts array is required.");
    return;
  }

  const roles = new Set();
  for (const [index, account] of accounts.entries()) {
    const accountObject = asObject(account);

    if (!accountObject) {
      addIssue(blockers, "ACCOUNT_INVALID", "account must be an object.", { index });
      continue;
    }

    const role = text(accountObject.role);
    roles.add(role);
    requireFilled(blockers, "ACCOUNT_ROLE_MISSING", "account role", accountObject.role, { index });
    requireFilled(blockers, "ACCOUNT_EMAIL_MISSING", "account email", accountObject.email, { role, index });
    requireFilled(blockers, "ACCOUNT_BRANCH_SCOPE_MISSING", "account branchScope", accountObject.branchScope, { role, index });
    requireFilled(blockers, "ACCOUNT_EVIDENCE_MISSING", "account evidence", accountObject.evidence, { role, index });
    requireTrue(blockers, "ACCOUNT_PASSWORD_NOT_ROTATED", "account passwordRotated", accountObject.passwordRotated, { role, index });
    requireTrue(blockers, "ACCOUNT_LOGIN_NOT_VERIFIED", "account loginVerified", accountObject.loginVerified, { role, index });
  }

  for (const role of requiredRoles) {
    if (!roles.has(role)) {
      addIssue(blockers, "ACCOUNT_ROLE_MISSING", `pilot account for role ${role} is required.`, { role });
    }
  }
}

function validateDataImport(manifest, blockers) {
  const dataImport = asObject(manifest.dataImport);

  if (!dataImport) {
    addIssue(blockers, "DATA_IMPORT_MISSING", "dataImport is required.");
    return;
  }

  requireFilled(blockers, "DATA_IMPORT_SOURCE_MISSING", "dataImport.sourceCsv", dataImport.sourceCsv);
  requireFilled(blockers, "DATA_IMPORT_DRY_RUN_MISSING", "dataImport.dryRunCommand", dataImport.dryRunCommand);
  requireFilled(blockers, "DATA_IMPORT_COMMAND_MISSING", "dataImport.importCommand", dataImport.importCommand);
  requireFilled(blockers, "DATA_IMPORT_PREFLIGHT_MISSING", "dataImport.preflightCommand", dataImport.preflightCommand);
  requireFilled(blockers, "DATA_IMPORT_REPORT_MISSING", "dataImport.evidenceReport", dataImport.evidenceReport);
  requireFilled(blockers, "DATA_IMPORT_EVIDENCE_MISSING", "dataImport.evidence", dataImport.evidence);
  requireTrue(blockers, "SENSITIVE_DATA_REVIEW_MISSING", "dataImport.sensitiveDataReviewed", dataImport.sensitiveDataReviewed);
  requireTrue(blockers, "DATA_IMPORT_NOT_VERIFIED", "dataImport.verified", dataImport.verified);

  if (!allowTemplate && !text(dataImport.dryRunCommand).includes("test:pilot-import")) {
    addIssue(blockers, "DATA_IMPORT_DRY_RUN_COMMAND_INVALID", "dry-run command must include test:pilot-import.");
  }

  if (!allowTemplate && !text(dataImport.importCommand).includes("pilot:import")) {
    addIssue(blockers, "DATA_IMPORT_COMMAND_INVALID", "import command must include pilot:import.");
  }

  if (!allowTemplate && !text(dataImport.preflightCommand).includes("preflight:pilot")) {
    addIssue(blockers, "DATA_IMPORT_PREFLIGHT_COMMAND_INVALID", "preflight command must include preflight:pilot.");
  }

  if (!allowTemplate && !text(dataImport.preflightCommand).includes("--out=")) {
    addIssue(blockers, "DATA_IMPORT_PREFLIGHT_ARTIFACT_MISSING", "pre-pilot preflight command must write a JSON artifact with --out=.");
  }
}

function commandReferencesSourceCsv(command, sourceCsv) {
  const commandText = text(command);
  const sourceText = text(sourceCsv);

  if (!commandText || !sourceText) {
    return false;
  }

  const resolvedSource = path.resolve(sourceText);
  const sourceBasename = path.basename(sourceText);

  return commandText.includes(sourceText) || commandText.includes(resolvedSource) || commandText.includes(sourceBasename);
}

async function validateDataImportSourceCsv(manifest, blockers) {
  if (allowTemplate) {
    return null;
  }

  const dataImport = asObject(manifest.dataImport);
  const sourceCsv = text(dataImport?.sourceCsv);

  if (!sourceCsv) {
    return null;
  }

  const resolvedSource = path.resolve(sourceCsv);

  if (!sourceCsv.endsWith(".csv")) {
    addIssue(blockers, "DATA_IMPORT_SOURCE_NOT_CSV", "dataImport.sourceCsv must point to a CSV file.", {
      sourceCsv,
    });
  }

  if (!commandReferencesSourceCsv(dataImport.dryRunCommand, sourceCsv)) {
    addIssue(blockers, "DATA_IMPORT_DRY_RUN_SOURCE_MISMATCH", "dataImport.dryRunCommand must reference dataImport.sourceCsv.", {
      sourceCsv,
      dryRunCommand: dataImport.dryRunCommand,
    });
  }

  if (!commandReferencesSourceCsv(dataImport.importCommand, sourceCsv)) {
    addIssue(blockers, "DATA_IMPORT_COMMAND_SOURCE_MISMATCH", "dataImport.importCommand must reference dataImport.sourceCsv.", {
      sourceCsv,
      importCommand: dataImport.importCommand,
    });
  }

  let rawCsv = "";
  try {
    rawCsv = await readFile(resolvedSource, "utf8");
  } catch (error) {
    addIssue(blockers, "DATA_IMPORT_SOURCE_UNREADABLE", "dataImport.sourceCsv could not be read.", {
      file: resolvedSource,
      error: error.message,
    });
    return null;
  }

  const parsed = parseCsv(rawCsv);
  const { errors, warnings, records } = validateRows(parsed);

  if (errors.length > 0) {
    addIssue(blockers, "DATA_IMPORT_SOURCE_INVALID", "dataImport.sourceCsv does not pass pilot CSV validation.", {
      file: resolvedSource,
      errors,
      warnings,
    });
    return null;
  }

  if (records.length < 5) {
    addIssue(blockers, "DATA_IMPORT_SOURCE_TOO_SMALL", "dataImport.sourceCsv must include enough pilot rows for launch validation.", {
      file: resolvedSource,
      rows: records.length,
      warnings,
    });
  }

  return summarizePilotSourceRows(records);
}

function validateFieldChecks(manifest, blockers) {
  const fieldChecks = asObject(manifest.fieldChecks);

  if (!fieldChecks) {
    addIssue(blockers, "FIELD_CHECKS_MISSING", "fieldChecks is required.");
    return;
  }

  const mobileAttendance = asArray(fieldChecks.mobileAttendance);
  const coveredKinds = new Set();
  let offlineVerified = false;

  if (!mobileAttendance) {
    addIssue(blockers, "MOBILE_ATTENDANCE_MISSING", "fieldChecks.mobileAttendance array is required.");
  } else {
    mobileAttendance.forEach((check, index) => {
      const checkObject = asObject(check);

      if (!checkObject) {
        addIssue(blockers, "MOBILE_CHECK_INVALID", "mobile attendance check must be an object.", { index });
        return;
      }

      const deviceKind = text(checkObject.deviceKind);
      coveredKinds.add(deviceKind);
      offlineVerified = offlineVerified || checkObject.offlineQueueVerified === true;

      requireFilled(blockers, "MOBILE_DEVICE_KIND_MISSING", "mobile deviceKind", checkObject.deviceKind, { index });
      requireFilled(blockers, "MOBILE_DEVICE_MISSING", "mobile device", checkObject.device, { index });
      requireFilled(blockers, "MOBILE_BROWSER_MISSING", "mobile browser", checkObject.browser, { index });
      requireFilled(blockers, "MOBILE_EVIDENCE_MISSING", "mobile evidence", checkObject.evidence, { index });
      requireTrue(blockers, "MOBILE_TOUCH_TARGETS_UNVERIFIED", "mobile touchTargetsVerified", checkObject.touchTargetsVerified, { index });
      requireTrue(blockers, "MOBILE_OVERFLOW_UNVERIFIED", "mobile noHorizontalOverflow", checkObject.noHorizontalOverflow, { index });

      if (!allowTemplate && !requiredMobileDeviceKinds.includes(deviceKind)) {
        addIssue(blockers, "MOBILE_DEVICE_KIND_INVALID", "mobile deviceKind must be ios, android, or tablet.", { deviceKind, index });
      }

      if (!allowTemplate && (Number(checkObject.durationSeconds) <= 0 || Number(checkObject.durationSeconds) > 30)) {
        addIssue(blockers, "MOBILE_ATTENDANCE_TOO_SLOW", "mobile attendance duration must be 30 seconds or less.", {
          durationSeconds: checkObject.durationSeconds,
          index,
        });
      }
    });
  }

  if (!allowTemplate) {
    const missingKinds = requiredMobileDeviceKinds.filter((kind) => !coveredKinds.has(kind));
    if (missingKinds.length > 0) {
      addIssue(blockers, "MOBILE_DEVICE_COVERAGE_INCOMPLETE", "iOS, Android, and tablet field checks are required.", {
        missingKinds,
      });
    }
    if (!offlineVerified) {
      addIssue(blockers, "MOBILE_OFFLINE_QUEUE_UNVERIFIED", "at least one mobile field check must verify offline queue recovery.");
    }
  }

  const screenReader = asArray(fieldChecks.screenReader);
  const coveredScreenReaderTargets = new Set();
  if (!screenReader || screenReader.length === 0) {
    addIssue(blockers, "SCREEN_READER_MISSING", "fieldChecks.screenReader must contain at least one check.");
  } else {
    screenReader.forEach((check, index) => {
      const checkObject = asObject(check);

      if (!checkObject) {
        addIssue(blockers, "SCREEN_READER_CHECK_INVALID", "screen reader check must be an object.", { index });
        return;
      }

      const target = text(checkObject.target);
      coveredScreenReaderTargets.add(target);
      requireFilled(blockers, "SCREEN_READER_TOOL_MISSING", "screen reader tool", checkObject.tool, { index });
      requireFilled(blockers, "SCREEN_READER_ROLE_MISSING", "screen reader role", checkObject.role, { index });
      requireFilled(blockers, "SCREEN_READER_ROUTE_MISSING", "screen reader route", checkObject.route, { index });
      requireFilled(blockers, "SCREEN_READER_TARGET_MISSING", "screen reader target", checkObject.target, { index });
      requireFilled(blockers, "SCREEN_READER_EXPECTED_ANNOUNCEMENT_MISSING", "screen reader expectedAnnouncement", checkObject.expectedAnnouncement, { index });
      requireFilled(blockers, "SCREEN_READER_ACTUAL_ANNOUNCEMENT_MISSING", "screen reader actualAnnouncement", checkObject.actualAnnouncement, { index });
      requireFilled(blockers, "SCREEN_READER_NOTES_MISSING", "screen reader notes", checkObject.notes, { index });
      requireFilled(blockers, "SCREEN_READER_EVIDENCE_MISSING", "screen reader evidence", checkObject.evidence, { index });
      requireTrue(blockers, "SCREEN_READER_NOT_PASSED", "screen reader passed", checkObject.passed, { index });
      requireTrue(blockers, "SCREEN_READER_ISSUE_OPEN", "screen reader issueFree", checkObject.issueFree, { index });

      if (!allowTemplate && !requiredScreenReaderTargets.includes(target)) {
        addIssue(blockers, "SCREEN_READER_TARGET_INVALID", "screen reader target must be attendance-status or notice-read-state.", {
          target,
          index,
        });
      }
    });
  }

  if (!allowTemplate) {
    const missingScreenReaderTargets = requiredScreenReaderTargets.filter((target) => !coveredScreenReaderTargets.has(target));
    if (missingScreenReaderTargets.length > 0) {
      addIssue(blockers, "SCREEN_READER_COVERAGE_INCOMPLETE", "attendance status and notice read-state screen reader checks are required.", {
        missingScreenReaderTargets,
      });
    }
  }

  const keyboardNavigation = asObject(fieldChecks.keyboardNavigation);
  if (!keyboardNavigation) {
    addIssue(blockers, "KEYBOARD_NAVIGATION_MISSING", "fieldChecks.keyboardNavigation is required.");
  } else {
    requireFilled(blockers, "KEYBOARD_NAVIGATION_EVIDENCE_MISSING", "keyboard navigation evidence", keyboardNavigation.evidence);
    requireTrue(blockers, "KEYBOARD_NAVIGATION_NOT_PASSED", "keyboard navigation passed", keyboardNavigation.passed);
  }

  const incidentChannel = asObject(fieldChecks.incidentChannel);
  if (!incidentChannel) {
    addIssue(blockers, "INCIDENT_CHANNEL_MISSING", "fieldChecks.incidentChannel is required.");
  } else {
    requireFilled(blockers, "INCIDENT_CHANNEL_NAME_MISSING", "incident channel name", incidentChannel.name);
    requireFilled(blockers, "INCIDENT_CHANNEL_OWNER_MISSING", "incident channel owner", incidentChannel.owner);
    requireFilled(blockers, "INCIDENT_CHANNEL_EVIDENCE_MISSING", "incident channel evidence", incidentChannel.evidence);
    requireTrue(blockers, "INCIDENT_CHANNEL_NOT_VERIFIED", "incident channel verified", incidentChannel.verified);
  }

  requireTrue(blockers, "PRIVACY_MASKING_NOT_VERIFIED", "fieldChecks.privacyMaskingVerified", fieldChecks.privacyMaskingVerified);
}

function validateOperations(manifest, blockers) {
  const operations = asObject(manifest.operations);

  if (!operations) {
    addIssue(blockers, "OPERATIONS_MISSING", "operations is required.");
    return;
  }

  requireFilled(blockers, "POST_PILOT_PREFLIGHT_MISSING", "operations.postPilotPreflightCommand", operations.postPilotPreflightCommand);
  requireFilled(blockers, "POST_PILOT_JSON_REPORT_MISSING", "operations.postPilotEvidenceJson", operations.postPilotEvidenceJson);
  requireFilled(blockers, "POST_PILOT_MARKDOWN_REPORT_MISSING", "operations.postPilotEvidenceMarkdown", operations.postPilotEvidenceMarkdown);
  requireFilled(blockers, "OPERATIONS_EVIDENCE_MISSING", "operations.evidence", operations.evidence);
  requireTrue(blockers, "OPERATIONS_NOT_VERIFIED", "operations.verified", operations.verified);
  requireTrue(blockers, "FEEDBACK_NOT_COLLECTED", "operations.feedbackCollected", operations.feedbackCollected);

  if (!allowTemplate && Number(operations.operationLogCount) < 14) {
    addIssue(blockers, "PILOT_OPERATION_DAYS_INCOMPLETE", "operations.operationLogCount must be at least 14.");
  }

  if (!allowTemplate && Number(operations.attendanceRecords) <= 0) {
    addIssue(blockers, "PILOT_OPERATION_ATTENDANCE_MISSING", "operations.attendanceRecords must be greater than zero.");
  }

  if (!allowTemplate && Number(operations.paymentChecks) <= 0) {
    addIssue(blockers, "PILOT_OPERATION_PAYMENT_MISSING", "operations.paymentChecks must be greater than zero.");
  }

  if (!allowTemplate && Number(operations.noticeFollowupChecks) <= 0) {
    addIssue(blockers, "PILOT_OPERATION_NOTICE_FOLLOWUPS_MISSING", "operations.noticeFollowupChecks must be greater than zero.");
  }

  if (!allowTemplate && Number(operations.noticeChecks) <= 0) {
    addIssue(blockers, "PILOT_OPERATION_NOTICES_MISSING", "operations.noticeChecks must be greater than zero.");
  }

  if (!allowTemplate && Number(operations.unresolvedP0Count) !== 0) {
    addIssue(blockers, "P0_INCIDENTS_UNRESOLVED", "operations.unresolvedP0Count must be zero.");
  }

  if (!allowTemplate && !text(operations.postPilotPreflightCommand).includes("preflight:pilot")) {
    addIssue(blockers, "POST_PILOT_PREFLIGHT_COMMAND_INVALID", "post-pilot preflight command must include preflight:pilot.");
  }

  if (!allowTemplate && !text(operations.postPilotPreflightCommand).includes("--require-retro")) {
    addIssue(blockers, "POST_PILOT_PREFLIGHT_MODE_INVALID", "post-pilot preflight command must include --require-retro.");
  }

  if (!allowTemplate && !text(operations.postPilotPreflightCommand).includes("--out=")) {
    addIssue(blockers, "POST_PILOT_PREFLIGHT_ARTIFACT_MISSING", "post-pilot preflight command must write a JSON artifact with --out=.");
  }

  if (!allowTemplate && !text(operations.postPilotEvidenceJson).endsWith(".json")) {
    addIssue(blockers, "POST_PILOT_JSON_REPORT_INVALID", "operations.postPilotEvidenceJson must point to a JSON report.");
  }

  if (!allowTemplate && !text(operations.postPilotEvidenceMarkdown).endsWith(".md")) {
    addIssue(blockers, "POST_PILOT_MARKDOWN_REPORT_INVALID", "operations.postPilotEvidenceMarkdown must point to a Markdown report.");
  }

  if (!allowTemplate && pilotReportFile && path.resolve(text(operations.postPilotEvidenceJson)) !== pilotReportFile) {
    addIssue(blockers, "PILOT_EVIDENCE_REPORT_PATH_MISMATCH", "--report must match operations.postPilotEvidenceJson.", {
      manifestReport: path.resolve(text(operations.postPilotEvidenceJson)),
      providedReport: pilotReportFile,
    });
  }
}

function validateEnvironment(manifest, blockers) {
  const environment = asObject(manifest.environment);

  if (!environment) {
    addIssue(blockers, "ENVIRONMENT_MISSING", "environment is required.");
    return;
  }

  requireTrue(blockers, "PRODUCTION_PREFLIGHT_NOT_PASSED", "environment.productionPreflightPassed", environment.productionPreflightPassed);
  requireTrue(blockers, "DEMO_LOGIN_NOT_DISABLED", "environment.demoLoginDisabled", environment.demoLoginDisabled);
  requireTrue(blockers, "DEV_RESET_NOT_DISABLED", "environment.devResetDisabled", environment.devResetDisabled);
  requireFilled(blockers, "ENVIRONMENT_EVIDENCE_MISSING", "environment evidence", environment.evidence);
}

async function readPilotEvidenceReport(blockers) {
  if (allowTemplate) {
    return null;
  }

  if (!pilotReportFile) {
    addIssue(blockers, "PILOT_EVIDENCE_REPORT_NOT_PROVIDED", "post-pilot pilot:evidence JSON report must be provided with --report.");
    return null;
  }

  try {
    return JSON.parse(await readFile(pilotReportFile, "utf8"));
  } catch (error) {
    addIssue(blockers, "PILOT_EVIDENCE_REPORT_UNREADABLE", "post-pilot pilot:evidence JSON report could not be read.", {
      file: pilotReportFile,
      error: error.message,
    });
    return null;
  }
}

async function readPrePilotEvidenceReport(manifest, blockers) {
  if (allowTemplate) {
    return null;
  }

  const dataImport = asObject(manifest.dataImport);
  const reportPath = text(dataImport?.evidenceReport);

  if (!reportPath) {
    return null;
  }

  const resolvedPath = path.resolve(reportPath);

  try {
    return JSON.parse(await readFile(resolvedPath, "utf8"));
  } catch (error) {
    addIssue(blockers, "DATA_IMPORT_EVIDENCE_REPORT_UNREADABLE", "pre-pilot data import evidence report could not be read.", {
      file: resolvedPath,
      error: error.message,
    });
    return null;
  }
}

async function readPostPilotMarkdownReport(manifest, blockers) {
  if (allowTemplate) {
    return null;
  }

  const operations = asObject(manifest.operations);
  const markdownPath = text(operations?.postPilotEvidenceMarkdown);

  if (!markdownPath) {
    return null;
  }

  const resolvedPath = path.resolve(markdownPath);

  try {
    return await readFile(resolvedPath, "utf8");
  } catch (error) {
    addIssue(blockers, "POST_PILOT_MARKDOWN_REPORT_UNREADABLE", "post-pilot Markdown evidence report could not be read.", {
      file: resolvedPath,
      error: error.message,
    });
    return null;
  }
}

function validatePrePilotEvidenceReport(manifest, report, sourceCsvSummary, blockers) {
  if (!report) {
    return;
  }

  const generatedAt = parseDateTime(report.generatedAt);
  const pilotPeriodStart = getPilotPeriodStart(manifest);

  if (!generatedAt) {
    addIssue(blockers, "DATA_IMPORT_EVIDENCE_REPORT_GENERATED_AT_INVALID", "pre-pilot evidence report generatedAt must be a valid date-time.", {
      generatedAt: report.generatedAt ?? null,
    });
  } else if (pilotPeriodStart && generatedAt > pilotPeriodStart) {
    addIssue(blockers, "DATA_IMPORT_EVIDENCE_REPORT_LATE", "pre-pilot evidence report must be generated before the pilot period starts.", {
      generatedAt: generatedAt.toISOString(),
      pilotPeriodStartsOn: text(asObject(manifest.pilot)?.period?.startsOn),
    });
  }

  if (report.mode !== "pre-pilot") {
    addIssue(blockers, "DATA_IMPORT_EVIDENCE_REPORT_MODE_INVALID", "pre-pilot evidence report must be generated without --require-retro.", {
      mode: report.mode,
    });
  }

  if (report.releaseDecision !== "ready") {
    addIssue(blockers, "DATA_IMPORT_EVIDENCE_REPORT_NOT_READY", "pre-pilot evidence report releaseDecision must be ready.", {
      releaseDecision: report.releaseDecision,
    });
  }

  const blockerCodes = report.preflight?.blockerCodes ?? [];
  if (blockerCodes.length > 0) {
    addIssue(blockers, "DATA_IMPORT_EVIDENCE_REPORT_HAS_BLOCKERS", "pre-pilot evidence report still contains preflight blockers.", {
      blockerCodes,
    });
  }

  if (sourceCsvSummary) {
    const comparisons = [
      ["branches", sourceCsvSummary.branches],
      ["users", sourceCsvSummary.users],
      ["members", sourceCsvSummary.members],
      ["classes", sourceCsvSummary.classes],
      ["payments", sourceCsvSummary.payments],
      ["notices", sourceCsvSummary.notices],
    ];

    for (const [reportKey, expectedValue] of comparisons) {
      const reportValue = numberValue(report.counts?.[reportKey]);

      if (reportValue !== expectedValue) {
        addIssue(
          blockers,
          "DATA_IMPORT_EVIDENCE_REPORT_COUNT_MISMATCH",
          "pre-pilot evidence report count does not match dataImport.sourceCsv.",
          {
            reportKey,
            reportValue: Number.isNaN(reportValue) ? null : reportValue,
            expectedValue,
          },
        );
      }
    }
  }
}

function validatePilotEvidenceReport(manifest, report, blockers) {
  if (!report) {
    return;
  }

  const generatedAt = parseDateTime(report.generatedAt);
  const pilotPeriodEnd = getPilotPeriodEnd(manifest);

  if (!generatedAt) {
    addIssue(blockers, "PILOT_EVIDENCE_REPORT_GENERATED_AT_INVALID", "pilot evidence report generatedAt must be a valid date-time.", {
      generatedAt: report.generatedAt ?? null,
    });
  } else if (pilotPeriodEnd && generatedAt < pilotPeriodEnd) {
    addIssue(blockers, "PILOT_EVIDENCE_REPORT_STALE", "pilot evidence report must be generated on or after the pilot period ends.", {
      generatedAt: generatedAt.toISOString(),
      pilotPeriodEndsOn: text(asObject(manifest.pilot)?.period?.endsOn),
    });
  }

  if (report.mode !== "post-pilot") {
    addIssue(blockers, "PILOT_EVIDENCE_REPORT_MODE_INVALID", "pilot evidence report must be generated with --require-retro.", {
      mode: report.mode,
    });
  }

  if (report.releaseDecision !== "ready") {
    addIssue(blockers, "PILOT_EVIDENCE_REPORT_NOT_READY", "pilot evidence report releaseDecision must be ready.", {
      releaseDecision: report.releaseDecision,
    });
  }

  const blockerCodes = report.preflight?.blockerCodes ?? [];
  if (blockerCodes.length > 0) {
    addIssue(blockers, "PILOT_EVIDENCE_REPORT_HAS_BLOCKERS", "pilot evidence report still contains preflight blockers.", {
      blockerCodes,
    });
  }

  const operations = manifest.operations ?? {};
  const counts = report.counts ?? {};
  const comparisons = [
    ["operationLogCount", "operationDays"],
    ["operationLogCount", "verifiedOperationDays"],
    ["attendanceRecords", "attendanceRecordsLogged"],
    ["paymentChecks", "paymentChecksLogged"],
    ["noticeFollowupChecks", "noticeFollowupChecksLogged"],
    ["noticeChecks", "noticeChecksLogged"],
  ];

  for (const [manifestKey, reportKey] of comparisons) {
    const manifestValue = numberValue(operations[manifestKey]);
    const reportValue = numberValue(counts[reportKey]);

    if (manifestValue !== reportValue) {
      addIssue(blockers, "PILOT_EVIDENCE_REPORT_COUNT_MISMATCH", "field evidence count does not match pilot:evidence report.", {
        manifestKey,
        manifestValue: Number.isNaN(manifestValue) ? null : manifestValue,
        reportKey,
        reportValue: Number.isNaN(reportValue) ? null : reportValue,
      });
    }
  }
}

function validatePostPilotMarkdownReport(manifest, markdown, blockers) {
  if (!markdown) {
    return;
  }

  const operations = manifest.operations ?? {};
  const { generatedAtMatch, generatedAt } = getMarkdownGeneratedAt(markdown);
  const pilotPeriodEnd = getPilotPeriodEnd(manifest);
  const requiredSnippets = [
    "# Final Judo Pilot Evidence Report",
    "- Mode: post-pilot",
    "- Decision: ready",
    "- Preflight blockers: none",
    "## Operations",
  ];
  const countSnippets = [
    ["operationLogCount", "Verified operation days"],
    ["attendanceRecords", "Attendance records logged"],
    ["paymentChecks", "Payment checks logged"],
    ["noticeFollowupChecks", "Notice follow-up checks logged"],
    ["noticeChecks", "Notice checks logged"],
  ];

  for (const [manifestKey, label] of countSnippets) {
    const value = numberValue(operations[manifestKey]);

    if (!Number.isNaN(value)) {
      requiredSnippets.push(`- ${label}: ${value}`);
    }
  }

  const missing = requiredSnippets.filter((snippet) => !markdown.includes(snippet));

  if (missing.length > 0) {
    addIssue(blockers, "POST_PILOT_MARKDOWN_REPORT_INVALID", "post-pilot Markdown evidence report is missing required content.", {
      missing,
    });
  }

  if (!generatedAtMatch || !generatedAt) {
    addIssue(blockers, "POST_PILOT_MARKDOWN_REPORT_GENERATED_AT_INVALID", "post-pilot Markdown evidence report must include a valid Generated timestamp.", {
      generatedAt: generatedAtMatch?.[1] ?? null,
    });
  } else if (pilotPeriodEnd && generatedAt < pilotPeriodEnd) {
    addIssue(blockers, "POST_PILOT_MARKDOWN_REPORT_STALE", "post-pilot Markdown evidence report must be generated on or after the pilot period ends.", {
      generatedAt: generatedAt.toISOString(),
      pilotPeriodEndsOn: text(asObject(manifest.pilot)?.period?.endsOn),
    });
  }
}

async function main() {
  const raw = await readFile(evidenceFile, "utf8");
  const manifest = JSON.parse(raw);
  const blockers = [];
  const prePilotReport = await readPrePilotEvidenceReport(manifest, blockers);
  const pilotReport = await readPilotEvidenceReport(blockers);
  const markdownReport = await readPostPilotMarkdownReport(manifest, blockers);

  if (manifest.version !== 1) {
    addIssue(blockers, "VERSION_INVALID", "pilot field evidence version must be 1.");
  }

  validatePilotScope(manifest, blockers);
  validateAccounts(manifest, blockers);
  validateDataImport(manifest, blockers);
  const sourceCsvSummary = await validateDataImportSourceCsv(manifest, blockers);
  validateSourceCsvScope(manifest, sourceCsvSummary, blockers);
  validateFieldChecks(manifest, blockers);
  validateOperations(manifest, blockers);
  validateEnvironment(manifest, blockers);
  validatePrePilotEvidenceReport(manifest, prePilotReport, sourceCsvSummary, blockers);
  validatePilotEvidenceReport(manifest, pilotReport, blockers);
  validatePostPilotMarkdownReport(manifest, markdownReport, blockers);
  validateFinalSignoffChronology(manifest, pilotReport, markdownReport, blockers);

  const checked = [
    "pilot branch scope and 14-day period",
    "five role account signoff and password rotation",
    "pilot data import, masking, and preflight evidence",
    "pilot source CSV validation and command cross-check",
    "pilot branch/account source CSV scope cross-check",
    "pre-pilot evidence source CSV count cross-check",
    "pre-pilot evidence report readiness",
    "iOS/Android/tablet mobile attendance field checks",
    "screen reader announcement quality evidence",
    "keyboard, privacy, and incident channel evidence",
    "14-day attendance/payment/notice follow-up/notice operation evidence",
    "post-pilot preflight and feedback evidence",
    "post-pilot pilot:evidence report count cross-check",
    "post-pilot Markdown evidence report content",
    "post-pilot evidence report freshness",
    "final PM signoff chronology",
    "production demo/reset flag shutdown evidence",
  ];

  console.log(
    JSON.stringify(
      {
        ok: blockers.length === 0,
        mode: allowTemplate ? "template" : "strict",
        file: evidenceFile,
        reportFile: pilotReportFile,
        checked,
        blockers,
      },
      null,
      2,
    ),
  );

  if (blockers.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
