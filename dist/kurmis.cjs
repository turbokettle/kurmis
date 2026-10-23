#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/version.ts
var kurmisVersion = true ? "0.1.0" : "dev";

// src/cli/command.ts
var import_node_util = require("node:util");
var EXIT_OK = 0;
var EXIT_FAILURE = 1;
var EXIT_USAGE = 2;
function writeLine(output, text = "") {
  output.write(`${text}
`);
}
function usageError(command, message, context) {
  writeLine(context.stderr, `kurmis ${command}: ${message}`);
  writeLine(context.stderr, `Run "kurmis help ${command}" for its options.`);
  return EXIT_USAGE;
}
function isHelpFlag(arg) {
  return arg === "--help" || arg === "-h";
}
function parseCommandArgs(command, args, options, context, allowPositionals = false) {
  try {
    const parsed = (0, import_node_util.parseArgs)({ args, options, allowPositionals, strict: true });
    return { values: parsed.values, positionals: parsed.positionals };
  } catch (error) {
    return usageError(command, error instanceof Error ? error.message : String(error), context);
  }
}

// src/cli/commands/claude.ts
var import_node_fs11 = require("node:fs");
var import_node_os7 = require("node:os");

// src/core/claude-usage.ts
var FIVE_HOUR_MINS = 5 * 60;
var SEVEN_DAY_MINS = 7 * 24 * 60;
var CLAUDE_WINDOWS = [
  {
    key: "five_hour",
    field: "fiveHour",
    label: "5 hour",
    short: "5h",
    windowDurationMins: FIVE_HOUR_MINS,
    plan: true
  },
  {
    key: "seven_day",
    field: "sevenDay",
    label: "7 day",
    short: "7d",
    windowDurationMins: SEVEN_DAY_MINS,
    plan: true
  },
  {
    key: "seven_day_overage_included",
    field: "sevenDayOverage",
    label: "7 day (extra usage)",
    short: "7d+",
    windowDurationMins: SEVEN_DAY_MINS,
    plan: true
  },
  {
    key: "seven_day_opus",
    field: "sevenDayOpus",
    label: "7 day Opus",
    short: "7d Opus",
    windowDurationMins: SEVEN_DAY_MINS,
    plan: false
  },
  {
    key: "seven_day_sonnet",
    field: "sevenDaySonnet",
    label: "7 day Sonnet",
    short: "7d Sonnet",
    windowDurationMins: SEVEN_DAY_MINS,
    plan: false
  }
];
function claudeWindowSpec(key) {
  return CLAUDE_WINDOWS.find((window) => window.key === key) ?? null;
}
function roundTenth(value) {
  return Math.round(value * 10) / 10;
}
function isoFromSeconds(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1e3);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// src/core/usage.ts
function emptyAccountUsage(accountId, now) {
  return {
    accountId,
    fetchedAt: now,
    source: "probe",
    subscriptionType: null,
    rateLimitsAvailable: false,
    fiveHour: null,
    sevenDay: null,
    sevenDayOverage: null,
    sevenDayOpus: null,
    sevenDaySonnet: null,
    modelScoped: [],
    extraUsage: null,
    status: null,
    limited: null,
    error: null
  };
}
function usageFromGetUsage(accountId, raw, now, previous = null) {
  const body = asRecord(raw);
  const limits = asRecord(body.rate_limits);
  const windows = percentWindows(limits);
  const carried = statusAfterProbe(previous, windows, now);
  return {
    ...emptyAccountUsage(accountId, now),
    subscriptionType: asString(body.subscription_type),
    rateLimitsAvailable: body.rate_limits_available === true,
    ...windows,
    modelScoped: modelScopedWindows(limits.model_scoped),
    extraUsage: extraUsage(limits.extra_usage),
    status: carried.status,
    limited: carried.limited
  };
}
function usageFromRateLimitEvent(accountId, previous, info, now) {
  const event = asRecord(info);
  const base = previous ?? emptyAccountUsage(accountId, now);
  const windows = eventWindows(event);
  const status2 = readStatus(event.status);
  const limited = limitedWindow(event);
  return {
    ...base,
    accountId,
    fetchedAt: now,
    source: "session",
    // A report with windows proves the token can read rate limits, whatever a failed probe said.
    rateLimitsAvailable: base.rateLimitsAvailable || countWindows(windows) > 0,
    fiveHour: windows.fiveHour ?? base.fiveHour,
    sevenDay: windows.sevenDay ?? base.sevenDay,
    sevenDayOverage: windows.sevenDayOverage ?? base.sevenDayOverage,
    sevenDayOpus: windows.sevenDayOpus ?? base.sevenDayOpus,
    sevenDaySonnet: windows.sevenDaySonnet ?? base.sevenDaySonnet,
    status: status2 ?? base.status,
    limited: limited ?? (status2 === null ? base.limited : null),
    // Fresh numbers, so whatever the last probe failed at no longer stands.
    error: null
  };
}
function statusAfterProbe(previous, fresh, now) {
  const status2 = previous?.status ?? null;
  if (previous === null || status2 === null) return { status: null, limited: null };
  const limited = previous.limited;
  if (limited === null) return { status: status2, limited: null };
  const resetAt = limited.resetsAt === null ? null : Date.parse(limited.resetsAt);
  if (resetAt !== null && Number.isFinite(resetAt) && resetAt <= now) {
    return { status: null, limited: null };
  }
  const spec = claudeWindowSpec(limited.window);
  const measured = spec === null ? void 0 : fresh[spec.field];
  if (measured === void 0) return { status: status2, limited };
  if (measured.utilization < (limited.threshold ?? 100)) return { status: null, limited: null };
  return {
    status: status2,
    limited: { ...limited, utilization: measured.utilization, resetsAt: measured.resetsAt }
  };
}
function limitedWindow(event) {
  const name = asString(event.rateLimitType);
  if (name === null) return null;
  const unified = asRecord(asRecord(event.unifiedWindows)[name]);
  const utilization = asNumber(event.utilization) ?? asNumber(unified.utilization);
  const threshold = asNumber(event.surpassedThreshold);
  return {
    window: name,
    utilization: utilization === null ? null : roundTenth(utilization * 100),
    threshold: threshold === null ? null : roundTenth(threshold * 100),
    resetsAt: isoFromSeconds(event.resetsAt) ?? isoFromSeconds(unified.resetsAt)
  };
}
function eventWindows(event) {
  const out = {};
  const unified = asRecord(event.unifiedWindows);
  for (const spec of CLAUDE_WINDOWS) {
    const window = fractionWindow(unified[spec.key]);
    if (window !== null) out[spec.field] = window;
  }
  const named = claudeWindowSpec(event.rateLimitType);
  if (named !== null && out[named.field] === void 0) {
    const window = fractionWindow(event);
    if (window !== null) out[named.field] = window;
  }
  return out;
}
function percentWindows(limits) {
  const out = {};
  for (const spec of CLAUDE_WINDOWS) {
    const window = percentWindow(limits[spec.key]);
    if (window !== null) out[spec.field] = window;
  }
  return out;
}
function countWindows(windows) {
  return Object.keys(windows).length;
}
function percentWindow(value) {
  const row = asRecord(value);
  const utilization = asNumber(row.utilization);
  if (utilization === null) return null;
  return { utilization: roundTenth(utilization), resetsAt: asString(row.resets_at) };
}
function fractionWindow(value) {
  const row = asRecord(value);
  const utilization = asNumber(row.utilization);
  if (utilization === null) return null;
  return { utilization: roundTenth(utilization * 100), resetsAt: isoFromSeconds(row.resetsAt) };
}
function modelScopedWindows(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    const row = asRecord(entry);
    const window = percentWindow(row);
    const displayName = asString(row.display_name);
    if (window === null || displayName === null) continue;
    out.push({ ...window, displayName });
  }
  return out;
}
function extraUsage(value) {
  if (typeof value !== "object" || value === null) return null;
  const row = value;
  return {
    isEnabled: row.is_enabled === true,
    monthlyLimit: asNumber(row.monthly_limit),
    usedCredits: asNumber(row.used_credits),
    utilization: asNumber(row.utilization),
    currency: asString(row.currency)
  };
}
function readStatus(value) {
  return value === "allowed" || value === "allowed_warning" || value === "rejected" ? value : null;
}
function asRecord(value) {
  return typeof value === "object" && value !== null ? value : {};
}
function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// src/core/countdown.ts
function parseTime(value) {
  if (value === null || value === void 0) return null;
  const at = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(at) ? at : null;
}
function spanText(milliseconds) {
  const totalMinutes = Number.isFinite(milliseconds) ? Math.max(0, Math.floor(milliseconds / 6e4)) : 0;
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}
function resetsInText(resetsAt, now = Date.now()) {
  const at = parseTime(resetsAt);
  if (at === null || at <= now) return null;
  return `resets in ${spanText(at - now)}`;
}

// src/core/usage-rules.ts
function allUsageWindows(usage) {
  if (!usage) return [];
  const out = [];
  for (const spec of CLAUDE_WINDOWS) {
    const window = spec.field === "sevenDayOverage" ? extraUsageWindow(usage) : usage[spec.field];
    if (window === null) continue;
    out.push({
      key: spec.key,
      label: spec.label,
      name: spec.label,
      windowDurationMins: spec.windowDurationMins,
      ...window
    });
  }
  for (const entry of usage.modelScoped) {
    if (repeatsModelWindow(usage, entry)) continue;
    out.push({
      key: entry.displayName,
      label: entry.displayName,
      name: `${entry.displayName} 7 day`,
      windowDurationMins: SEVEN_DAY_MINS,
      ...entry
    });
  }
  return out;
}
function repeatsModelWindow(usage, entry) {
  const name = entry.displayName.trim().toLowerCase();
  const fixed = name === "opus" ? usage.sevenDayOpus : name === "sonnet" ? usage.sevenDaySonnet : null;
  return fixed !== null && fixed.utilization === entry.utilization && sameTime(fixed.resetsAt, entry.resetsAt);
}
function sameTime(a, b) {
  return a === b || a !== null && b !== null && Date.parse(a) === Date.parse(b);
}
function extraUsageWindow(usage) {
  if (usage?.extraUsage?.isEnabled !== true) return null;
  const overage = usage.sevenDayOverage ?? null;
  const plain = usage.sevenDay;
  if (overage === null || plain === null) return overage;
  return overage.utilization === plain.utilization && sameTime(overage.resetsAt, plain.resetsAt) ? null : overage;
}
function planUsageWindows(usage) {
  if (!usage) return [];
  const plan = new Set(CLAUDE_WINDOWS.filter((spec) => spec.plan).map((spec) => spec.key));
  return allUsageWindows(usage).filter((window) => plan.has(window.key));
}
function busiestPlanWindow(usage) {
  let busiest = null;
  for (const window of planUsageWindows(usage)) {
    if (busiest === null || window.utilization > busiest.utilization) busiest = window;
  }
  return busiest;
}
function windowHasReset(window, now) {
  const at = parseTime(window?.resetsAt ?? null);
  return at !== null && at <= now;
}
function usageResetPassed(usage, now) {
  if (!usage) return false;
  return everyWindowOf(usage).some((window) => windowHasReset(window, now));
}
function usageAsOf(usage, now) {
  if (!usage) return usage;
  if (!usageResetPassed(usage, now)) return usage;
  const next = {
    ...usage,
    fiveHour: fieldAsOf(usage.fiveHour, now),
    sevenDay: fieldAsOf(usage.sevenDay, now),
    sevenDayOverage: fieldAsOf(usage.sevenDayOverage, now),
    sevenDayOpus: fieldAsOf(usage.sevenDayOpus, now),
    sevenDaySonnet: fieldAsOf(usage.sevenDaySonnet, now),
    modelScoped: usage.modelScoped.map((window) => emptyIfReset(window, now))
  };
  if (usage.limited !== null && windowHasReset(usage.limited, now)) {
    next.limited = null;
    next.status = null;
  }
  return next;
}
function emptyIfReset(window, now) {
  return windowHasReset(window, now) ? { ...window, utilization: 0 } : window;
}
function fieldAsOf(window, now) {
  return window === null ? null : emptyIfReset(window, now);
}
function everyWindowOf(usage) {
  const out = [];
  for (const spec of CLAUDE_WINDOWS) {
    const window = usage[spec.field];
    if (window !== null && window !== void 0) out.push(window);
  }
  for (const window of usage.modelScoped) out.push(window);
  return out;
}
function resetsAtFromUsage(usage) {
  if (!usage) return null;
  const full = planUsageWindows(usage).filter((window) => window.utilization >= 100).map((window) => usableReset(window.resetsAt)).filter(isString);
  if (full.length > 0) return latest(full);
  if (usage.status !== "rejected") return null;
  const named = usableReset(usage.limited?.resetsAt ?? null);
  if (named !== null) return named;
  return busiestReset(allUsageWindows(usage));
}
function busiestReset(windows) {
  let best = null;
  for (const window of windows) {
    const resetsAt = usableReset(window.resetsAt);
    if (resetsAt === null) continue;
    if (best === null || window.utilization > best.utilization) {
      best = { utilization: window.utilization, resetsAt };
    }
  }
  return best?.resetsAt ?? null;
}
function usableReset(resetsAt) {
  if (resetsAt === null || !Number.isFinite(Date.parse(resetsAt))) return null;
  return resetsAt;
}
function isString(value) {
  return value !== null;
}
function latest(times) {
  let best = null;
  let bestAt = -Infinity;
  for (const time of times) {
    const at = Date.parse(time);
    if (!Number.isFinite(at) || at <= bestAt) continue;
    best = time;
    bestAt = at;
  }
  return best;
}
function isSevenDayWindow(window) {
  return window.windowDurationMins === SEVEN_DAY_MINS;
}

// src/core/account-router.ts
var PREFIX = "anthropic-ratelimit-unified-";
var WINDOW_NAMES = {
  "5h": "five_hour",
  "7d": "seven_day",
  "7d_oi": "seven_day_overage_included",
  overage: "overage"
};
function parseUnifiedHeaders(get, now) {
  const windows = {};
  for (const suffix of Object.keys(WINDOW_NAMES)) {
    const utilization = get(`${PREFIX}${suffix}-utilization`);
    const reset = get(`${PREFIX}${suffix}-reset`);
    const status2 = get(`${PREFIX}${suffix}-status`);
    if (utilization == null && reset == null && status2 == null) continue;
    const fraction = headerNumber(utilization);
    windows[suffix] = {
      utilization: fraction !== null && fraction >= 0 && fraction <= 1 ? fraction : null,
      resetsAt: isoFromSeconds(headerNumber(reset)),
      status: readStatus2(status2)
    };
  }
  return {
    observedAt: now,
    status: readStatus2(get(`${PREFIX}status`)),
    resetsAt: isoFromSeconds(headerNumber(get(`${PREFIX}reset`))),
    representativeClaim: headerText(get(`${PREFIX}representative-claim`)),
    windows,
    overageStatus: readStatus2(get(`${PREFIX}overage-status`)),
    overageDisabledReason: headerText(get(`${PREFIX}overage-disabled-reason`))
  };
}
function usageFromUnifiedHeaders(accountId, previous, observation) {
  const unifiedWindows = {};
  for (const [suffix, window] of Object.entries(observation.windows)) {
    unifiedWindows[windowName(suffix)] = {
      utilization: window.utilization,
      resetsAt: secondsFromIso(window.resetsAt)
    };
  }
  return usageFromRateLimitEvent(accountId, previous, {
    status: observation.status,
    resetsAt: secondsFromIso(observation.resetsAt),
    rateLimitType: observation.representativeClaim === null ? null : windowName(observation.representativeClaim),
    unifiedWindows
  }, observation.observedAt);
}
function isDefinitiveQuotaRejection(status2, get) {
  return status2 === 429 && (readStatus2(get(`${PREFIX}status`)) === "rejected" || get(`${PREFIX}representative-claim`) != null || get(`${PREFIX}overage-status`) != null);
}
function quotaCooldownUntil(status2, get) {
  if (!isDefinitiveQuotaRejection(status2, get)) return null;
  const observation = parseUnifiedHeaders(get, 0);
  const named = observation.representativeClaim;
  const window = Object.entries(observation.windows).find(([suffix]) => named !== null && windowName(suffix) === windowName(named))?.[1];
  const reset = observation.resetsAt ?? window?.resetsAt ?? null;
  if (reset !== null) return Date.parse(reset);
  const rejected = Object.values(observation.windows).filter((entry) => entry.status === "rejected");
  return rejected.length === 0 ? Infinity : Math.max(
    ...rejected.map((entry) => entry.resetsAt === null ? Infinity : Date.parse(entry.resetsAt))
  );
}
function worstUtilisation(usage) {
  return busiestPlanWindow(usage)?.utilization ?? null;
}
var TOKEN_MARGIN_MS = 5 * 6e4;
function tokenIsFresh(expiresAt, now) {
  return expiresAt === null || expiresAt > now + TOKEN_MARGIN_MS;
}
function limitForWindow(account, window) {
  return isSevenDayWindow(window) ? account.weeklyLimitPercent : account.fiveHourLimitPercent;
}
function windowsAsOf(account, now) {
  return planUsageWindows(usageAsOf(account.usage, now));
}
function windowOverLimit(account, now) {
  let worst = null;
  for (const window of windowsAsOf(account, now)) {
    if (window.utilization < limitForWindow(account, window)) continue;
    if (worst === null || window.utilization > worst.utilization) worst = window;
  }
  return worst;
}
function routeBlock(account, now) {
  if (!account.autoRoute) return { kind: "auto-route-off" };
  if (!account.loggedIn) return { kind: "signed-out" };
  if (!account.credentialsReadable) return { kind: "no-credentials" };
  if (!tokenIsFresh(account.tokenExpiresAt, now)) return { kind: "token-expiring" };
  if (account.cooldownUntil !== null && account.cooldownUntil > now) {
    return { kind: "cooldown", until: Number.isFinite(account.cooldownUntil) ? account.cooldownUntil : null };
  }
  const over = windowOverLimit(account, now);
  if (over !== null) {
    return {
      kind: "over-limit",
      utilization: over.utilization,
      limitPercent: limitForWindow(account, over),
      window: over.label,
      resetsAt: over.resetsAt
    };
  }
  return null;
}
function eligible(account, now) {
  return routeBlock(account, now) === null;
}
function sevenDayResetOf(account) {
  for (const window of planUsageWindows(account.usage)) {
    if (!isSevenDayWindow(window) || window.resetsAt === null) continue;
    if (Number.isFinite(Date.parse(window.resetsAt))) return window.resetsAt;
  }
  return null;
}
function sevenDayResetTime(account) {
  const resetsAt = sevenDayResetOf(account);
  return resetsAt === null ? Infinity : Date.parse(resetsAt);
}
function effectivePin(session, accounts) {
  if (session.pinnedAccountId != null) return session.pinnedAccountId;
  if (accounts.some((account) => account.autoRoute)) return null;
  return session.homeAccountId;
}
function autoStartLogin(accounts, preferred) {
  const own = accounts.find((account) => account.usedByPlainClaude);
  if (own === void 0) throw new Error("autoStartLogin: the list has no login that plain claude uses");
  if (own.loggedIn) return own.id;
  const pool = accounts.filter((account) => account.autoRoute);
  const signedIn = pool.filter((account) => account.loggedIn);
  const from = signedIn.length > 0 ? signedIn : pool;
  return (from.find((account) => account.id === preferred) ?? from[0])?.id ?? own.id;
}
function rankAccounts(session, accounts, now, exclude) {
  return accounts.filter((account) => !exclude.has(account.id) && eligible(account, now)).sort((a, b) => {
    if (a.useFirst !== b.useFirst) return a.useFirst ? -1 : 1;
    const current = Number(b.id === session.currentAccountId) - Number(a.id === session.currentAccountId);
    if (current !== 0) return current;
    const resetA = sevenDayResetTime(a);
    const resetB = sevenDayResetTime(b);
    if (resetA !== resetB) return resetA < resetB ? -1 : 1;
    return Number(b.id === session.homeAccountId) - Number(a.id === session.homeAccountId) || (worstUtilisation(usageAsOf(a.usage, now)) ?? 100) - (worstUtilisation(usageAsOf(b.usage, now)) ?? 100);
  });
}
function chooseAccount(session, accounts, now, exclude) {
  const pinned = effectivePin(session, accounts);
  if (pinned !== null) {
    return accounts.find((account) => account.id === pinned && !exclude.has(account.id) && account.loggedIn && account.credentialsReadable) ?? null;
  }
  return rankAccounts(session, accounts, now, exclude)[0] ?? null;
}
function replayDecision(input) {
  const { status: status2, get, servedBy, session, attempted } = input;
  if (session.pinnedAccountId != null || input.responseStarted || input.deadlineExpired) return { kind: "pass" };
  const previous = session.currentAccountId;
  if (status2 === 400 && previous !== null && previous !== servedBy && !attempted.has(previous)) {
    return { kind: "pin-back", to: previous };
  }
  const cooldownUntil = quotaCooldownUntil(status2, get);
  if (cooldownUntil === null) return { kind: "pass" };
  return { kind: "replay", reason: "quota", cooldownUntil };
}
function accountsInScope(session, accounts) {
  const pinned = effectivePin(session, accounts);
  return accounts.filter((account) => account.loggedIn && account.credentialsReadable && (pinned === null ? account.autoRoute : account.id === pinned));
}
function poolReadyAt(accounts, now, pinnedAccountId, homeAccountId) {
  const session = { homeAccountId, currentAccountId: null, pinnedAccountId };
  const pinned = effectivePin(session, accounts);
  let earliest = Infinity;
  for (const account of accountsInScope(session, accounts)) {
    let ready = Math.max(now, account.cooldownUntil ?? now);
    const full = windowsAsOf(account, now).filter((window) => window.utilization >= (pinned === null ? limitForWindow(account, window) : 100));
    for (const window of full) {
      const reset = window.resetsAt === null ? NaN : Date.parse(window.resetsAt);
      ready = Number.isFinite(reset) && reset > now ? Math.max(ready, reset) : Infinity;
    }
    earliest = Math.min(earliest, ready);
  }
  return Number.isFinite(earliest) ? earliest : null;
}
function readStatus2(value) {
  return value === "allowed" || value === "allowed_warning" || value === "rejected" ? value : null;
}
function headerText(value) {
  return value == null || value.trim() === "" ? null : value.trim();
}
function headerNumber(value) {
  const text = headerText(value);
  if (text === null) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
function secondsFromIso(value) {
  return value === null ? null : Date.parse(value) / 1e3;
}
function windowName(value) {
  return Object.hasOwn(WINDOW_NAMES, value) ? WINDOW_NAMES[value] : value;
}

// src/core/route-headers.ts
var import_node_crypto = require("node:crypto");

// src/core/accounts.ts
var DEFAULT_FIVE_HOUR_LIMIT_PERCENT = 100;
var DEFAULT_WEEKLY_LIMIT_PERCENT = 100;
var DEFAULT_AUTO_ROUTE = true;
var LOGIN_ID = /^[a-z0-9]{1,32}$/;
var RESERVED_IDS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|none|invalid)$/;
function isLoginIdText(text) {
  return LOGIN_ID.test(text) && !RESERVED_IDS.test(text);
}

// src/core/route-headers.ts
var KEY_HEADER = "x-kurmis-key";
var LOGIN_HEADER = "x-kurmis-login";
var STARTED_ON_HEADER = "x-kurmis-started-on";
var STARTED_ON_NONE = "none";
var SESSION_HEADER = "x-claude-code-session-id";
var KURMIS_HEADERS = [KEY_HEADER, LOGIN_HEADER, STARTED_ON_HEADER];
function parseCustomHeaders(value) {
  const out = [];
  for (const line of (value ?? "").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim();
    if (name.length === 0) continue;
    out.push({ name, value: line.slice(colon + 1).trim() });
  }
  return out;
}
function formatCustomHeaders(headers) {
  return headers.map((header) => `${header.name}: ${header.value}`).join("\n");
}
function withRouteHeaders(existing, key, login, startedOn = null) {
  const own = parseCustomHeaders(existing).filter((header) => !KURMIS_HEADERS.includes(header.name.toLowerCase()));
  const added = [{ name: KEY_HEADER, value: key }];
  if (login !== null) added.push({ name: LOGIN_HEADER, value: login });
  if (startedOn !== null) added.push({ name: STARTED_ON_HEADER, value: startedOn });
  return formatCustomHeaders([...own, ...added]);
}
function readRouteRequest(get, ownClaude) {
  const key = nonEmpty(get(KEY_HEADER));
  const named = nonEmpty(get(LOGIN_HEADER));
  const startedOn = nonEmpty(get(STARTED_ON_HEADER));
  return {
    key,
    login: named === null ? null : loginIdOrInvalid(named),
    startedOn: startedOn === null ? ownClaude : startedOn.toLowerCase() === STARTED_ON_NONE ? null : loginIdOrInvalid(startedOn),
    sessionId: nonEmpty(get(SESSION_HEADER))
  };
}
function loginIdOrInvalid(value) {
  return isLoginIdText(value) ? value : "invalid";
}
function routeKeyMatches(given, secret) {
  if (given === null || secret.length === 0) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && (0, import_node_crypto.timingSafeEqual)(a, b);
}
function nonEmpty(value) {
  const text = value?.trim() ?? "";
  return text.length === 0 ? null : text;
}

// src/core/routed-env.ts
var ROUTED_CLI_MAX_RETRIES = 15;
var UNROUTED_KEY_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
var OAUTH_TOKEN_VARIABLES = ["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR"];
var ROUTING_VARIABLES = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ENABLE_TOOL_SEARCH",
  "CLAUDE_CODE_MAX_RETRIES"
];
var USER_OWNED_ROUTING_VARIABLES = ["ENABLE_TOOL_SEARCH", "CLAUDE_CODE_MAX_RETRIES"];
function withoutRoutedVariables(routed, names) {
  const set = {};
  for (const [name, value] of Object.entries(routed.set)) if (!names.includes(name)) set[name] = value;
  return { set, unset: routed.unset };
}
var DEFAULT_SECURE_STORAGE_DIR = "";
function routedClaudeEnv(input) {
  const startedOn = input.startedOn ?? null;
  if (input.login !== null && startedOn !== null && startedOn !== input.login) {
    throw new Error(`routedClaudeEnv: a CLI pinned to ${input.login} is started on that login, not on ${startedOn}`);
  }
  const set = {
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${String(input.port)}`,
    ANTHROPIC_CUSTOM_HEADERS: withRouteHeaders(input.inheritedCustomHeaders, input.key, input.login, startedOn),
    ENABLE_TOOL_SEARCH: "true",
    CLAUDE_CODE_MAX_RETRIES: String(ROUTED_CLI_MAX_RETRIES)
  };
  const unset = [...UNROUTED_KEY_VARIABLES, ...OAUTH_TOKEN_VARIABLES];
  if (input.secureStorageDir !== null && input.secureStorageDir.length === 0) {
    throw new Error("routedClaudeEnv: the folder of an extra login cannot be the empty string");
  }
  set["CLAUDE_SECURESTORAGE_CONFIG_DIR"] = input.secureStorageDir ?? DEFAULT_SECURE_STORAGE_DIR;
  return { set, unset };
}
function applyRoutedEnv(env, routed, windows = false) {
  const same = (a, b) => windows ? a.toUpperCase() === b.toUpperCase() : a === b;
  const replaced = [...routed.unset, ...Object.keys(routed.set)];
  const out = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === void 0 || replaced.some((other) => same(name, other))) continue;
    out[name] = value;
  }
  return { ...out, ...routed.set };
}
function inheritedOAuthTokenVariables(env, windows = false) {
  return Object.entries(env).filter(([name, value]) => value !== void 0 && value !== "" && OAUTH_TOKEN_VARIABLES.some((other) => windows ? other.toUpperCase() === name.toUpperCase() : other === name)).map(([name]) => name);
}

// src/daemon/lifecycle.ts
var import_node_http = require("node:http");
var import_node_net = require("node:net");

// src/core/proxy-rules.ts
var ROUTE_PATHS = [
  { method: "POST", path: "/v1/messages" },
  { method: "POST", path: "/v1/messages/count_tokens" },
  { method: "GET", path: "/v1/models" }
];
var HELLO_PATH = "/api/hello";
var CONTROL_PREFIX = "/_kurmis/";
function requestKind(method, url) {
  const path = (url ?? "").split("?")[0] ?? "";
  if (path === HELLO_PATH && (method === "HEAD" || method === "GET")) return { kind: "hello" };
  if (path.startsWith(CONTROL_PREFIX)) return { kind: "control", path };
  if (ROUTE_PATHS.some((entry) => entry.method === method && entry.path === path)) return { kind: "route", path };
  return { kind: "unknown" };
}
var ROUTER_REFUSAL_STATUS = 599;
var HOP_HEADERS = /* @__PURE__ */ new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);
var REPLACED_REQUEST_HEADERS = /* @__PURE__ */ new Set([
  "authorization",
  "x-api-key",
  "host",
  "content-length",
  "accept-encoding"
]);
function droppedHeaders(connection) {
  return /* @__PURE__ */ new Set([...HOP_HEADERS, ...(connection ?? "").toLowerCase().split(",").map((name) => name.trim())]);
}
function upstreamRequest(incoming, body, authorization, accountUuid) {
  const connection = incoming["connection"];
  const drop = droppedHeaders(Array.isArray(connection) ? connection.join(",") : connection);
  const headers = {};
  for (const [rawName, value] of Object.entries(incoming)) {
    const name = rawName.toLowerCase();
    if (value === void 0 || drop.has(name) || REPLACED_REQUEST_HEADERS.has(name) || KURMIS_HEADERS.includes(name)) continue;
    headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  headers["authorization"] = authorization;
  headers["accept-encoding"] = "identity";
  const outgoing = body === void 0 ? void 0 : outgoingBody(body, accountUuid);
  if (outgoing !== void 0) headers["content-length"] = String(outgoing.length);
  return { headers, body: outgoing };
}
function downstreamResponseHeaders(upstream) {
  const entries = [...upstream].map(([name, value]) => [name.toLowerCase(), value]);
  const drop = droppedHeaders(entries.find(([name]) => name === "connection")?.[1]);
  return entries.filter(([name]) => !drop.has(name) && name !== "content-length");
}
function rewriteUserId(userId, accountUuid) {
  let value;
  try {
    value = JSON.parse(userId);
  } catch {
    return userId;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return userId;
  if (value["account_uuid"] === accountUuid) return userId;
  const bytes = Buffer.from(userId, "utf8");
  const open3 = skipWhitespace(bytes, 0);
  const found = memberValue(bytes, open3, "account_uuid");
  const uuid = Buffer.from(JSON.stringify(accountUuid), "utf8");
  if (found.span !== null) return splice(bytes, found.span.start, found.span.end, uuid).toString("utf8");
  const close = skipValue(bytes, open3) - 1;
  const member = Buffer.concat([Buffer.from(`${found.members > 0 ? "," : ""}"account_uuid":`, "utf8"), uuid]);
  return splice(bytes, close, close, member).toString("utf8");
}
function outgoingBody(body, accountUuid) {
  if (accountUuid === null) return body;
  const open3 = skipWhitespace(body, 0);
  if (body[open3] !== BRACE_OPEN) return body;
  const metadata = memberValue(body, open3, "metadata").span;
  if (metadata === null || body[metadata.start] !== BRACE_OPEN) return body;
  const userId = memberValue(body, metadata.start, "user_id").span;
  if (userId === null || body[userId.start] !== QUOTE) return body;
  const current = JSON.parse(body.subarray(userId.start, userId.end).toString("utf8"));
  const rewritten = rewriteUserId(current, accountUuid);
  if (rewritten === current) return body;
  return splice(body, userId.start, userId.end, Buffer.from(JSON.stringify(rewritten), "utf8"));
}
var QUOTE = 34;
var BACKSLASH = 92;
var BRACE_OPEN = 123;
var BRACE_CLOSE = 125;
var BRACKET_OPEN = 91;
var BRACKET_CLOSE = 93;
var COMMA = 44;
var COLON = 58;
function isWhitespace(byte) {
  return byte === 32 || byte === 9 || byte === 10 || byte === 13;
}
function skipWhitespace(bytes, index) {
  let at = index;
  while (at < bytes.length && isWhitespace(bytes[at])) at++;
  return at;
}
function skipString(bytes, index) {
  let at = index + 1;
  while (at < bytes.length) {
    const byte = bytes[at];
    if (byte === BACKSLASH) at += 2;
    else if (byte === QUOTE) return at + 1;
    else at++;
  }
  return at;
}
function skipValue(bytes, index) {
  const first = bytes[index];
  if (first === QUOTE) return skipString(bytes, index);
  if (first === BRACE_OPEN || first === BRACKET_OPEN) {
    let depth = 0;
    let at2 = index;
    while (at2 < bytes.length) {
      const byte = bytes[at2];
      if (byte === QUOTE) {
        at2 = skipString(bytes, at2);
        continue;
      }
      if (byte === BRACE_OPEN || byte === BRACKET_OPEN) depth++;
      else if (byte === BRACE_CLOSE || byte === BRACKET_CLOSE) {
        depth--;
        if (depth === 0) return at2 + 1;
      }
      at2++;
    }
    return at2;
  }
  let at = index;
  while (at < bytes.length) {
    const byte = bytes[at];
    if (byte === COMMA || byte === BRACE_CLOSE || byte === BRACKET_CLOSE || isWhitespace(byte)) break;
    at++;
  }
  return at;
}
function memberValue(bytes, open3, name) {
  let span = null;
  let members = 0;
  let at = skipWhitespace(bytes, open3 + 1);
  while (at < bytes.length && bytes[at] === QUOTE) {
    const keyEnd = skipString(bytes, at);
    const key = JSON.parse(bytes.subarray(at, keyEnd).toString("utf8"));
    at = skipWhitespace(bytes, keyEnd);
    if (bytes[at] !== COLON) break;
    const start2 = skipWhitespace(bytes, at + 1);
    const end = skipValue(bytes, start2);
    members++;
    if (key === name) span = { start: start2, end };
    at = skipWhitespace(bytes, end);
    if (bytes[at] !== COMMA) break;
    at = skipWhitespace(bytes, at + 1);
  }
  return { span, members };
}
function splice(bytes, start2, end, insert) {
  return Buffer.concat([bytes.subarray(0, start2), insert, bytes.subarray(end)]);
}
function staleUsageLogins(session, rows, now, refreshed) {
  const pinned = effectivePin(session, rows);
  return rows.filter((row) => {
    const reset = busiestPlanWindow(row.usage)?.resetsAt;
    return !refreshed.has(row.id) && row.loggedIn && row.credentialsReadable && (pinned === null ? row.autoRoute : row.id === pinned) && reset != null && Date.parse(reset) <= now;
  }).map((row) => row.id);
}
function withoutExpiringTokens(rows, now, session) {
  const pinned = effectivePin(session, rows);
  return rows.map((row) => row.tokenExpiresAt !== null && !tokenIsFresh(row.tokenExpiresAt, now) && (pinned === null || poolReadyAt([row], now, pinned, session.homeAccountId) === now) ? { ...row, credentialsReadable: false } : row);
}
function refusalAnswer(session, rows, now, cliOnOwnCredentials = false) {
  const usable2 = withoutExpiringTokens(rows, now, session);
  if (accountsInScope(session, usable2).length === 0) return { ...noSignerAnswer(cliOnOwnCredentials), kind: "no-signer", resetAt: null };
  return { ...poolLimitAnswer(session, usable2, now), kind: "pool-limit" };
}
function noSignerAnswer(cliOnOwnCredentials = false) {
  const message = cliOnOwnCredentials ? "No Claude login kurmis may use for this session could sign the request. This Claude CLI runs with CLAUDE_CONFIG_DIR set, so it is signed in with the login in that folder, which is not the login a plain `claude` uses, and kurmis signs its requests only with its extra logins. Add one with `kurmis login claude`, start Claude with `kurmis claude`, or run `kurmis setup --pause` with that CLAUDE_CONFIG_DIR." : "No Claude login kurmis may use for this session could sign the request. Run `kurmis status` to see which logins are signed in.";
  return {
    status: ROUTER_REFUSAL_STATUS,
    headers: { "content-type": "application/json", "retry-after": "5" },
    body: JSON.stringify({ type: "error", error: { type: "api_error", message } })
  };
}
function poolLimitAnswer(session, all, now) {
  const pinned = effectivePin(session, all);
  const rows = all.filter((row) => pinned === null || row.id === pinned);
  const reset = poolReadyAt(rows, now, pinned, session.homeAccountId);
  const next = reset === null ? void 0 : rows.find((row) => poolReadyAt([row], now, pinned, session.homeAccountId) === reset);
  const blocking = next === void 0 ? void 0 : planUsageWindows(usageAsOf(next.usage, now)).filter((window) => window.utilization >= (pinned === null ? limitForWindow(next, window) : 100)).sort((a, b) => Date.parse(b.resetsAt ?? "") - Date.parse(a.resetsAt ?? ""))[0];
  const claim = blocking?.key ?? next?.usage?.limited?.window ?? "five_hour";
  const message = `Usage limit reached for every login kurmis may use.${reset === null ? "" : ` Resets at ${new Date(reset).toISOString()}.`}`;
  return {
    status: 429,
    headers: {
      "content-type": "application/json",
      "anthropic-ratelimit-unified-status": "rejected",
      "anthropic-ratelimit-unified-representative-claim": claim,
      ...reset === null ? {} : { "anthropic-ratelimit-unified-reset": String(reset / 1e3) },
      "retry-after": String(reset === null ? 1 : Math.max(1, Math.ceil((reset - now) / 1e3)))
    },
    body: JSON.stringify({ type: "error", error: { type: "rate_limit_error", message } }),
    resetAt: reset
  };
}
function cooldownAfterProbe(cooldownUntil, snapshot) {
  if (cooldownUntil !== Infinity || snapshot.source !== "probe" || snapshot.error !== null || !snapshot.rateLimitsAvailable) {
    return cooldownUntil;
  }
  const reset = resetsAtFromUsage(snapshot);
  if (reset !== null && Number.isFinite(Date.parse(reset))) return Date.parse(reset);
  return snapshot.status === "rejected" ? cooldownUntil : null;
}
function routeBlockText(block, keychain = false, startedOn = false, platform = process.platform) {
  switch (block.kind) {
    case "auto-route-off":
      return "not opted in to routing";
    case "signed-out":
      return "signed out";
    case "no-credentials":
      if (!keychain) {
        return platform === "win32" ? "no token, neither Windows Credential Manager nor its .credentials.json gave one" : "no token, its .credentials.json did not read";
      }
      return startedOn ? "no token, its Keychain item did not read and the request carried no authorization header of its own" : "no token, its Keychain item did not read and the CLI signs only for the login it was started on";
    case "token-expiring":
      return "its token expires within 5 minutes";
    case "cooldown":
      return block.until === null ? "cooling down until a usage probe says it is back" : `cooling down until ${new Date(block.until).toISOString()}`;
    case "over-limit":
      return `at its limit, the ${block.window} window is at ${String(Math.round(block.utilization))}% of ${String(block.limitPercent)}%`;
  }
}

// src/core/control-api.ts
var CONTROL_API_VERSION = 4;
var CONTROL_PATHS = {
  /** `GET`: `StatusAnswer`. */
  status: `${CONTROL_PREFIX}status`,
  /** `POST` with a `ProbeRequest`: probes the logins now and answers `StatusAnswer` when done. */
  probe: `${CONTROL_PREFIX}probe`,
  /** `POST`: reads `config.json` again. Answers `OkAnswer`. */
  reload: `${CONTROL_PREFIX}reload`,
  /**
   * `POST` with an optional `StopRequest` (no body is the same as `{}`): answers `OkAnswer`,
   * then stops taking new requests and exits once the open ones have finished.
   */
  stop: `${CONTROL_PREFIX}stop`
};
var MAX_CONTROL_BODY_BYTES = 64 * 1024;

// src/data/validate.ts
var DataFileError = class extends Error {
  constructor(file, field, problem) {
    super(field === null ? `${file}: ${problem}` : `${file}: ${field} ${problem}`);
    this.file = file;
    this.field = field;
    this.name = "DataFileError";
  }
  file;
  field;
};
function topOf(file) {
  return { file, field: "" };
}
function child(where, key) {
  if (typeof key === "number") return { file: where.file, field: `${where.field}[${String(key)}]` };
  return { file: where.file, field: where.field === "" ? key : `${where.field}.${key}` };
}
function fail(where, problem) {
  throw new DataFileError(where.file, where.field === "" ? null : where.field, problem);
}
function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "string") return "a string";
  if (typeof value === "object") return "an object";
  return String(value);
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function expectObject(value, where) {
  if (!isPlainObject(value)) fail(where, `must be an object, not ${describe(value)}`);
  return value;
}
function expectArray(value, where) {
  if (!Array.isArray(value)) fail(where, `must be a list, not ${describe(value)}`);
  return value;
}
function expectString(value, where) {
  if (typeof value !== "string") fail(where, `must be a string, not ${describe(value)}`);
  return value;
}
function expectBoolean(value, where) {
  if (typeof value !== "boolean") fail(where, `must be true or false, not ${describe(value)}`);
  return value;
}
function expectInteger(value, where, min, max) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(where, `must be a whole number from ${String(min)} to ${String(max)}, not ${describe(value)}`);
  }
  return value;
}

// src/daemon/lifecycle.ts
var DAEMON_HOST = "127.0.0.1";
var CONTROL_TIMEOUT_MS = 5e3;
var START_WAIT_MS = 1e4;
var CLOSE_WAIT_MS = 1e4;
var STOP_FINISH_MAX_MS = START_WAIT_MS + CLOSE_WAIT_MS;
var MAX_ANSWER_BYTES = 4 * 1024 * 1024;
function controlRequest(options) {
  const timeoutMs = options.timeoutMs ?? CONTROL_TIMEOUT_MS;
  const payload = options.body === void 0 ? void 0 : JSON.stringify(options.body);
  return new Promise((resolve8) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve8(result);
    };
    const headers = { [KEY_HEADER]: options.key, connection: "close" };
    if (payload !== void 0) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(payload));
    }
    const outgoing = (0, import_node_http.request)(
      {
        host: DAEMON_HOST,
        port: options.port,
        method: options.method,
        path: options.path,
        headers,
        agent: false,
        signal: options.signal
      },
      (incoming) => {
        const chunks = [];
        let size = 0;
        incoming.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_ANSWER_BYTES) {
            finish({ kind: "failed", reason: "the answer was too large" });
            outgoing.destroy();
            return;
          }
          chunks.push(chunk);
        });
        incoming.on("error", (error) => finish({ kind: "failed", reason: error.message }));
        incoming.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body;
          try {
            body = text === "" ? null : JSON.parse(text);
          } catch {
            body = null;
          }
          finish({ kind: "answered", status: incoming.statusCode ?? 0, body });
        });
      }
    );
    const timer = setTimeout(() => {
      finish({ kind: "failed", reason: `no answer within ${String(timeoutMs)} ms` });
      outgoing.destroy();
    }, timeoutMs);
    outgoing.on("error", (error) => {
      finish(error.code === "ECONNREFUSED" ? { kind: "refused" } : { kind: "failed", reason: error.code ?? error.message });
    });
    outgoing.end(payload);
  });
}
function isStatusAnswer(value) {
  return isPlainObject(value) && value.ok === true && typeof value.version === "string" && typeof value.pid === "number" && typeof value.port === "number" && typeof value.startedAt === "number" && Array.isArray(value.logins);
}
async function portHolder(port, key, timeoutMs = CONTROL_TIMEOUT_MS) {
  const result = await controlRequest({ port, key, method: "GET", path: CONTROL_PATHS.status, timeoutMs });
  if (result.kind === "refused") return { kind: "free" };
  if (result.kind === "failed") return { kind: "other", reason: result.reason };
  if (result.status === 200 && isStatusAnswer(result.body)) return { kind: "kurmis", status: result.body };
  return { kind: "other", reason: `it answered ${String(result.status)} to a kurmis status request`, status: result.status };
}
function portAcceptsConnections(port, timeoutMs = 1e3) {
  return new Promise((resolve8) => {
    const socket = (0, import_node_net.createConnection)({ host: DAEMON_HOST, port });
    const done = (accepted) => {
      clearTimeout(timer);
      socket.destroy();
      resolve8(accepted);
    };
    const timer = setTimeout(() => done(true), timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", (error) => done(error.code !== "ECONNREFUSED"));
  });
}
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null || right === null) return null;
  const length = Math.max(left.parts.length, right.parts.length);
  for (let index = 0; index < length; index++) {
    const x = left.parts[index] ?? 0;
    const y = right.parts[index] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return left.pre < right.pre ? -1 : 1;
}
function parseVersion(text) {
  const match = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim());
  if (match === null) return null;
  return { parts: (match[1] ?? "").split(".").map(Number), pre: match[2] ?? null };
}
function daemonAge(daemon, version, apiVersion = CONTROL_API_VERSION) {
  const order = compareVersions(daemon.version, version);
  if (order === null) return "unknown";
  if (order !== 0) return order === -1 ? "older" : "newer";
  if (daemon.apiVersion === apiVersion) return "same";
  return daemon.apiVersion === void 0 || daemon.apiVersion < apiVersion ? "older" : "newer";
}
function shouldReplaceDaemon(daemon, version, apiVersion = CONTROL_API_VERSION) {
  return daemonAge(daemon, version, apiVersion) === "older";
}
function canUseDaemon(daemon, apiVersion = CONTROL_API_VERSION) {
  return daemon.apiVersion === apiVersion;
}
function versionText(version, apiVersion) {
  return `${version} with ${apiVersion === void 0 ? "no control API version" : `control API version ${String(apiVersion)}`}`;
}
function delay(ms) {
  return new Promise((resolve8) => {
    setTimeout(resolve8, ms);
  });
}
function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// src/data/config.ts
var import_node_crypto5 = require("node:crypto");
var import_node_fs4 = require("node:fs");

// src/core/login-alias.ts
var ALIAS = /^[a-z0-9][a-z0-9_-]{0,31}$/;
var MAX_ALIAS_LENGTH = 32;
var ALIAS_RULE = '1 to 32 lowercase letters, digits, "-" or "_", starting with a letter or digit';
function isAliasText(text) {
  return ALIAS.test(text);
}
function aliasFromEmail(email) {
  const text = email.trim().toLowerCase();
  const at = text.lastIndexOf("@");
  const domainDot = at < 0 ? -1 : text.lastIndexOf(".");
  const withoutTld = domainDot > at ? text.slice(0, domainDot) : text;
  return trimDashes(trimDashes(withoutTld.replace(/[^a-z0-9]+/g, "-")).slice(0, MAX_ALIAS_LENGTH));
}
function trimDashes(text) {
  return text.replace(/^-+|-+$/g, "");
}
function automaticAlias(email, id, current, neighbours) {
  const base = email === null ? "" : aliasFromEmail(email);
  if (base === "") return id;
  const taken = /* @__PURE__ */ new Set([...neighbours.aliases, ...neighbours.ids]);
  const free = (alias) => !taken.has(alias);
  if (current !== null && free(current) && isNumbered(current, base)) return current;
  if (free(base)) return base;
  for (let number = 2; ; number++) {
    const suffix = `-${String(number)}`;
    const candidate = trimDashes(base.slice(0, MAX_ALIAS_LENGTH - suffix.length)) + suffix;
    if (free(candidate)) return candidate;
  }
}
function isNumbered(alias, base) {
  if (alias === base) return true;
  const match = /^(.*)-([2-9]|[1-9][0-9]+)$/.exec(alias);
  if (match === null) return false;
  const suffix = `-${match[2]}`;
  return match[1] === trimDashes(base.slice(0, MAX_ALIAS_LENGTH - suffix.length));
}

// src/data/json-file.ts
var import_node_crypto2 = require("node:crypto");
var import_node_fs2 = require("node:fs");
var import_promises2 = require("node:fs/promises");
var import_node_path = require("node:path");

// src/platform/files.ts
var import_node_fs = require("node:fs");
var import_promises = require("node:fs/promises");
var PRIVATE_FILE_MODE = 384;
var PRIVATE_DIR_MODE = 448;
function userOnlyMode(mode) {
  return mode & 448;
}
function restrictToUserSync(path, platform = process.platform) {
  if (platform === "win32") return null;
  const mode = (0, import_node_fs.statSync)(path).mode & 511;
  if (userOnlyMode(mode) === mode) return null;
  (0, import_node_fs.chmodSync)(path, userOnlyMode(mode));
  return mode;
}
var LOCKED_FILE_CODES = ["EPERM", "EBUSY", "EACCES"];
var RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80, 160, 200, 200, 200, 200];
function isLockedFileError(error) {
  if (typeof error !== "object" || error === null) return false;
  return LOCKED_FILE_CODES.includes(String(error.code));
}
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function retryWhileLockedSync(operation, platform = process.platform) {
  for (let attempt = 0; ; attempt++) {
    try {
      return operation();
    } catch (error) {
      const delay2 = RENAME_RETRY_DELAYS_MS[attempt];
      if (platform !== "win32" || delay2 === void 0 || !isLockedFileError(error)) throw error;
      sleepSync(delay2);
    }
  }
}
async function retryWhileLocked(operation, platform = process.platform) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const delay2 = RENAME_RETRY_DELAYS_MS[attempt];
      if (platform !== "win32" || delay2 === void 0 || !isLockedFileError(error)) throw error;
      await new Promise((resolve8) => setTimeout(resolve8, delay2));
    }
  }
}
function replaceFileSync(from, to) {
  retryWhileLockedSync(() => (0, import_node_fs.renameSync)(from, to));
}
async function replaceFile(from, to) {
  await retryWhileLocked(() => (0, import_promises.rename)(from, to));
}
function syncDirectorySync(dir) {
  if (process.platform === "win32") return;
  let fd = -1;
  try {
    fd = (0, import_node_fs.openSync)(dir, "r");
    (0, import_node_fs.fsyncSync)(fd);
  } catch {
  } finally {
    if (fd >= 0) (0, import_node_fs.closeSync)(fd);
  }
}
async function syncDirectory(dir) {
  if (process.platform === "win32") return;
  try {
    const handle = await (0, import_promises.open)(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
  }
}
function makePrivateDirSync(dir) {
  (0, import_node_fs.mkdirSync)(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
}

// src/data/json-file.ts
var TEMP_FLAGS = import_node_fs2.constants.O_WRONLY | import_node_fs2.constants.O_CREAT | import_node_fs2.constants.O_EXCL;
function tempPathFor(path) {
  return `${path}.${String(process.pid)}.${(0, import_node_crypto2.randomBytes)(4).toString("hex")}.tmp`;
}
function writeFileAtomicSync(path, contents, options = {}) {
  const dir = (0, import_node_path.dirname)(path);
  makePrivateDirSync(dir);
  const temp = tempPathFor(path);
  const fd = (0, import_node_fs2.openSync)(temp, TEMP_FLAGS, options.mode ?? 420);
  try {
    try {
      (0, import_node_fs2.writeSync)(fd, contents);
      (0, import_node_fs2.fsyncSync)(fd);
    } finally {
      (0, import_node_fs2.closeSync)(fd);
    }
    replaceFileSync(temp, path);
  } catch (error) {
    (0, import_node_fs2.rmSync)(temp, { force: true });
    throw error;
  }
  syncDirectorySync(dir);
}
async function writeFileAtomic(path, contents, options = {}) {
  const dir = (0, import_node_path.dirname)(path);
  makePrivateDirSync(dir);
  const temp = tempPathFor(path);
  const handle = await (0, import_promises2.open)(temp, TEMP_FLAGS, options.mode ?? 420);
  try {
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await replaceFile(temp, path);
  } catch (error) {
    await (0, import_promises2.rm)(temp, { force: true });
    throw error;
  }
  await syncDirectory(dir);
}
function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}
`;
}
function writeJsonFileSync(path, value, options) {
  writeFileAtomicSync(path, formatJson(value), options);
}
async function writeJsonFile(path, value, options) {
  await writeFileAtomic(path, formatJson(value), options);
}
function isMissing(error) {
  return error?.code === "ENOENT";
}
function parseJsonText(text) {
  try {
    return { status: "ok", value: JSON.parse(text), text };
  } catch (error) {
    return { status: "corrupt", reason: error instanceof Error ? error.message : String(error) };
  }
}
function readJsonFileSync(path) {
  let text;
  try {
    text = (0, import_node_fs2.readFileSync)(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return { status: "missing" };
    throw error;
  }
  return parseJsonText(text);
}

// src/data/login-id.ts
var import_node_crypto3 = require("node:crypto");
var NEW_LOGIN_ID_LENGTH = 10;
var ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function isLoginId(text) {
  return typeof text === "string" && isLoginIdText(text);
}
function toLoginId(text) {
  if (!isLoginId(text)) {
    throw new Error(`"${text}" is not a login id. A login id is 1 to 32 lowercase letters and digits.`);
  }
  return text;
}
function newLoginId(taken = []) {
  const used = new Set(taken);
  for (; ; ) {
    let id = "";
    for (let index = 0; index < NEW_LOGIN_ID_LENGTH; index++) id += ID_ALPHABET[(0, import_node_crypto3.randomInt)(ID_ALPHABET.length)];
    if (!used.has(id) && isLoginIdText(id)) return id;
  }
}

// src/data/lock.ts
var import_node_crypto4 = require("node:crypto");
var import_node_fs3 = require("node:fs");
var import_node_path2 = require("node:path");
var DEFAULT_LOCK_TIMEOUT_MS = 15e3;
var DEFAULT_LOCK_STALE_MS = 1e4;
var DEFAULT_LOCK_RETRY_MS = 25;
var LockTimeoutError = class extends Error {
  constructor(path, holder, waitedMs) {
    const who = holder === null ? "Another kurmis process holds it" : `kurmis process ${String(holder.pid)} has held it since ${new Date(holder.createdAt).toISOString()}`;
    const waited = waitedMs < 1e3 ? `${String(Math.round(waitedMs))} ms` : `${String(Math.round(waitedMs / 1e3))} s`;
    super(
      `Could not lock ${path} within ${waited}. ${who}. If no other kurmis command is running, delete the file and try again.`
    );
    this.path = path;
    this.holder = holder;
    this.name = "LockTimeoutError";
  }
  path;
  holder;
};
var heldByThisProcess = /* @__PURE__ */ new Set();
function isProcessAlive(pid, kill = (p, s) => process.kill(p, s)) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function readLock(path) {
  const text = (0, import_node_fs3.readFileSync)(path, "utf8");
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object") return null;
    const { pid, createdAt, token } = value;
    if (typeof pid !== "number" || typeof createdAt !== "number" || typeof token !== "string") return null;
    return { pid, createdAt, token };
  } catch {
    return null;
  }
}
function readLockHolder(path) {
  try {
    const contents = readLock(path);
    return contents === null ? null : { pid: contents.pid, createdAt: contents.createdAt };
  } catch {
    return null;
  }
}
function sleepSync2(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function codeOf(error) {
  return error?.code;
}
function createExclusive(path, text, platform) {
  let fd;
  try {
    fd = (0, import_node_fs3.openSync)(path, "wx", PRIVATE_FILE_MODE);
  } catch (error) {
    if (codeOf(error) === "EEXIST") return false;
    if (platform === "win32" && isLockedFileError(error)) return false;
    throw error;
  }
  try {
    (0, import_node_fs3.writeSync)(fd, text);
  } catch (error) {
    (0, import_node_fs3.closeSync)(fd);
    (0, import_node_fs3.rmSync)(path, { force: true });
    throw error;
  }
  (0, import_node_fs3.closeSync)(fd);
  return true;
}
function removeFile(path, platform) {
  retryWhileLockedSync(() => (0, import_node_fs3.rmSync)(path, { force: true }), platform);
}
function isStale(path, contents, options) {
  if (contents === null) {
    let modified;
    try {
      modified = (0, import_node_fs3.statSync)(path).mtimeMs;
    } catch {
      return false;
    }
    return options.now() - modified > options.staleMs;
  }
  if (!options.isAlive(contents.pid)) return true;
  return options.now() - contents.createdAt > options.staleMs;
}
function tryTakeBreakLock(path, options) {
  const breakPath = `${path}.break`;
  if (createExclusive(breakPath, String(process.pid), options.platform)) return true;
  try {
    if (options.now() - (0, import_node_fs3.statSync)(breakPath).mtimeMs > options.staleMs) removeFile(breakPath, options.platform);
  } catch {
  }
  return false;
}
function breakIfStale(path, options) {
  const breakPath = `${path}.break`;
  if (!tryTakeBreakLock(path, options)) return;
  try {
    let contents;
    try {
      contents = readLock(path);
    } catch {
      return;
    }
    if (isStale(path, contents, options)) removeFile(path, options.platform);
  } finally {
    removeFile(breakPath, options.platform);
  }
}
function acquireFileLockSync(path, options = {}) {
  if (heldByThisProcess.has(path)) throw new Error(`${path} is already locked by this process.`);
  const settings = {
    staleMs: options.staleMs ?? DEFAULT_LOCK_STALE_MS,
    isAlive: options.isAlive ?? ((pid) => isProcessAlive(pid)),
    now: options.now ?? Date.now,
    platform: options.platform ?? process.platform
  };
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const retryMs = options.retryMs ?? DEFAULT_LOCK_RETRY_MS;
  const token = (0, import_node_crypto4.randomBytes)(16).toString("hex");
  const started = Date.now();
  makePrivateDirSync((0, import_node_path2.dirname)(path));
  for (; ; ) {
    const contents = { pid: process.pid, createdAt: settings.now(), token };
    if (createExclusive(path, `${JSON.stringify(contents)}
`, settings.platform)) break;
    breakIfStale(path, settings);
    const waited = Date.now() - started;
    if (waited >= timeoutMs) throw new LockTimeoutError(path, readLockHolder(path), waited);
    sleepSync2(Math.min(timeoutMs - waited, 1 + Math.floor(Math.random() * retryMs)));
  }
  heldByThisProcess.add(path);
  let released = false;
  return {
    path,
    release() {
      if (released) return;
      released = true;
      heldByThisProcess.delete(path);
      const waitUntil = Date.now() + timeoutMs;
      let holdsBreak = tryTakeBreakLock(path, settings);
      while (!holdsBreak && Date.now() < waitUntil) {
        sleepSync2(1 + Math.floor(Math.random() * retryMs));
        holdsBreak = tryTakeBreakLock(path, settings);
      }
      try {
        let current;
        try {
          current = retryWhileLockedSync(() => readLock(path), settings.platform);
        } catch {
          return;
        }
        if (current?.token === token) removeFile(path, settings.platform);
      } finally {
        if (holdsBreak) removeFile(`${path}.break`, settings.platform);
      }
    }
  };
}
function withFileLockSync(path, work, options = {}) {
  const lock = acquireFileLockSync(path, options);
  try {
    return work();
  } finally {
    lock.release();
  }
}

// src/data/paths.ts
var import_node_os = require("node:os");
var import_node_path3 = require("node:path");
function kurmisHome() {
  const override = process.env.KURMIS_HOME;
  if (override !== void 0 && override !== "") return (0, import_node_path3.resolve)(override);
  return (0, import_node_path3.join)((0, import_node_os.homedir)(), ".kurmis");
}
function configPath() {
  return (0, import_node_path3.join)(kurmisHome(), "config.json");
}
function daemonFilePath() {
  return (0, import_node_path3.join)(kurmisHome(), "daemon.json");
}
function keyPath() {
  return (0, import_node_path3.join)(kurmisHome(), "key");
}
function statePath() {
  return (0, import_node_path3.join)(kurmisHome(), "state.json");
}
function logPath() {
  return (0, import_node_path3.join)(kurmisHome(), "daemon.log");
}
function previousLogPath() {
  return (0, import_node_path3.join)(kurmisHome(), "daemon.log.1");
}
function configLockPath() {
  return (0, import_node_path3.join)(kurmisHome(), "config.json.lock");
}
function ownClaudeProbeFolder() {
  return (0, import_node_path3.join)(kurmisHome(), "probe", "claude-own");
}
function wrapperSettingsFolder() {
  return (0, import_node_path3.join)(kurmisHome(), "settings");
}
function probeWorkFolder() {
  return (0, import_node_path3.join)(kurmisHome(), "probe", "cwd");
}
function windowsAutostartScriptPath() {
  return (0, import_node_path3.join)(kurmisHome(), "autostart.js");
}
function pausedFilePath() {
  return (0, import_node_path3.join)(kurmisHome(), "paused.json");
}
function setupSettingsRecordPath() {
  return (0, import_node_path3.join)(kurmisHome(), "settings-files.json");
}
function extraLoginsFolder() {
  return (0, import_node_path3.join)(kurmisHome(), "claude");
}
function loginFolder(login) {
  const id = toLoginId(login.id);
  if (login.usedByPlainClaude) {
    throw new Error(`${id} is the login plain claude uses and has no folder in the kurmis data folder.`);
  }
  return (0, import_node_path3.join)(extraLoginsFolder(), id);
}
function loginLockPath(id) {
  return (0, import_node_path3.join)(kurmisHome(), "locks", `${toLoginId(id)}.lock`);
}

// src/data/config.ts
var CONFIG_VERSION = 3;
var DEFAULT_PORT = 28411;
var MIN_PORT = 1024;
var MAX_PORT = 65535;
var ConfigError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ConfigError";
  }
};
function plainClaudeLogin(config) {
  const own = config.logins.find((login) => login.usedByPlainClaude);
  if (own === void 0) throw new ConfigError("The config has no login that plain claude uses.");
  return own;
}
function extraLogins(config) {
  return config.logins.filter((login) => !login.usedByPlainClaude);
}
function newLoginSettings(ref, patch = {}) {
  const login = {
    id: ref.id,
    usedByPlainClaude: ref.usedByPlainClaude,
    alias: ref.id,
    aliasSetByUser: false,
    routing: DEFAULT_AUTO_ROUTE,
    fiveHourLimit: DEFAULT_FIVE_HOUR_LIMIT_PERCENT,
    weeklyLimit: DEFAULT_WEEKLY_LIMIT_PERCENT,
    useFirst: false
  };
  return withConfigErrors(() => applyPatch(login, patch, topOf(`settings of ${ref.id}`)));
}
function withConfigErrors(check) {
  try {
    return check();
  } catch (error) {
    if (error instanceof DataFileError) throw new ConfigError(error.message);
    throw error;
  }
}
function emptyConfig() {
  return { version: CONFIG_VERSION, port: DEFAULT_PORT, logins: [] };
}
function defaultConfig() {
  return ensurePlainClaudeLogin(emptyConfig());
}
function ensurePlainClaudeLogin(config) {
  if (config.logins.some((login) => login.usedByPlainClaude)) return config;
  const id = newLoginId([...loginIds(config), ...config.logins.map((login) => login.alias)]);
  return { ...config, logins: ordered([...config.logins, newLoginSettings({ id, usedByPlainClaude: true })]) };
}
function ordered(logins) {
  return [...logins.filter((login) => login.usedByPlainClaude), ...logins.filter((login) => !login.usedByPlainClaude)];
}
function checkLimit(value, where) {
  return expectInteger(value, where, 1, 100);
}
function checkAlias(value, where) {
  const alias = expectString(value, where);
  if (!isAliasText(alias)) fail(where, `must be ${ALIAS_RULE}`);
  return alias;
}
function applyPatch(login, patch, where) {
  const next = { ...login };
  if (patch.alias !== void 0) {
    next.alias = checkAlias(patch.alias, child(where, "alias"));
    next.aliasSetByUser = true;
  }
  if (patch.routing !== void 0) next.routing = expectBoolean(patch.routing, child(where, "routing"));
  if (patch.fiveHourLimit !== void 0) next.fiveHourLimit = checkLimit(patch.fiveHourLimit, child(where, "fiveHourLimit"));
  if (patch.weeklyLimit !== void 0) next.weeklyLimit = checkLimit(patch.weeklyLimit, child(where, "weeklyLimit"));
  if (patch.useFirst !== void 0) next.useFirst = expectBoolean(patch.useFirst, child(where, "useFirst"));
  return next;
}
function parseLogin(value, where) {
  const raw = expectObject(value, where);
  const id = expectString(raw.id, child(where, "id"));
  if (!isLoginId(id)) fail(child(where, "id"), "must be 1 to 32 lowercase letters and digits");
  const usedByPlainClaude = raw.usedByPlainClaude === void 0 ? false : expectBoolean(raw.usedByPlainClaude, child(where, "usedByPlainClaude"));
  const patch = {};
  for (const key of ["routing", "fiveHourLimit", "weeklyLimit", "useFirst"]) {
    if (raw[key] !== void 0) patch[key] = raw[key];
  }
  const login = applyPatch(newLoginSettings({ id, usedByPlainClaude }), patch, where);
  if (raw.alias !== void 0) login.alias = checkAlias(raw.alias, child(where, "alias"));
  if (raw.aliasSetByUser !== void 0) login.aliasSetByUser = expectBoolean(raw.aliasSetByUser, child(where, "aliasSetByUser"));
  return login;
}
function checkVersion(raw, file) {
  const version = raw.version;
  if (version === void 0) fail(topOf(file), 'has no "version" field');
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    fail(child(topOf(file), "version"), "must be a whole number of 1 or more");
  }
  if (version > CONFIG_VERSION) {
    fail(
      topOf(file),
      `was written by a newer kurmis (config version ${String(version)}); this kurmis reads version ${String(CONFIG_VERSION)}. Update kurmis.`
    );
  }
  if (version < CONFIG_VERSION) {
    fail(
      topOf(file),
      `was written by an older kurmis (config version ${String(version)}), and this kurmis reads only version ${String(CONFIG_VERSION)}. Delete the file, then add the extra logins again with "kurmis login"`
    );
  }
}
function parseConfig(value, file) {
  const raw = expectObject(value, topOf(file));
  checkVersion(raw, file);
  const where = topOf(file);
  const port = raw.port === void 0 ? DEFAULT_PORT : expectInteger(raw.port, child(where, "port"), MIN_PORT, MAX_PORT);
  const listed = raw.logins === void 0 ? [] : expectArray(raw.logins, child(where, "logins"));
  const logins = [];
  listed.forEach((entry, index) => {
    const at = child(child(where, "logins"), index);
    const login = parseLogin(entry, at);
    if (logins.some((other) => other.id === login.id)) fail(child(at, "id"), `repeats "${login.id}"`);
    if (login.usedByPlainClaude && logins.some((other) => other.usedByPlainClaude)) {
      fail(child(at, "usedByPlainClaude"), "is true for a second login; only one login can be the one plain claude uses");
    }
    const clash = logins.find((other) => other.id === login.alias || other.alias === login.id || other.alias === login.alias);
    if (clash !== void 0) {
      fail(child(at, "alias"), clash.alias === login.alias ? `repeats "${login.alias}" of another login` : `"${login.alias}" and the id "${login.id}" must not be the id or alias of another login`);
    }
    logins.push(login);
  });
  return { version: CONFIG_VERSION, port, logins: ordered(logins) };
}
function readConfigFile(path) {
  const read = readJsonFileSync(path);
  if (read.status === "missing") return emptyConfig();
  if (read.status === "corrupt") throw new ConfigError(`${path} is not valid JSON: ${read.reason}`);
  return withConfigErrors(() => parseConfig(read.value, path));
}
function readConfig(path = configPath()) {
  return readConfigFile(path);
}
function loadConfig(path = configPath(), lockOptions = {}) {
  const config = readConfigFile(path);
  if (ensurePlainClaudeLogin(config) === config) return config;
  return changeConfig((current) => current, path, lockOptions);
}
function saveConfig(config, path = configPath()) {
  writeJsonFileSync(path, { version: CONFIG_VERSION, port: config.port, logins: config.logins });
}
function findLogin(config, id) {
  return config.logins.find((login) => login.id === id);
}
function loginIds(config) {
  return config.logins.map((login) => login.id);
}
function newLoginIdFor(config) {
  return newLoginId([...loginIds(config), ...config.logins.map((login) => login.alias)]);
}
function resolveLogin(config, text) {
  const name = text.trim().toLowerCase();
  const found = config.logins.find((login) => login.id === name) ?? config.logins.find((login) => login.alias === name);
  if (found !== void 0) return { login: found };
  return { error: `there is no login called "${name}"` };
}
function aliasProblem(config, login, alias) {
  if (!isAliasText(alias)) return `"${alias}" is not an alias; an alias is ${ALIAS_RULE}`;
  for (const other of config.logins) {
    if (other.id === login.id) continue;
    if (other.id === alias) return `"${alias}" is the id of another login`;
    if (other.alias === alias) return `another login is already called "${alias}"`;
  }
  return null;
}
function addLogin(config, id, patch = {}) {
  if (!isLoginId(id)) throw new ConfigError(`"${id}" is not a login id.`);
  if (findLogin(config, id) !== void 0) throw new ConfigError(`There is already a login ${id}.`);
  if (config.logins.some((other) => other.alias === id)) throw new ConfigError(`"${id}" is the alias of another login.`);
  const login = newLoginSettings({ id, usedByPlainClaude: false }, patch);
  const problem = aliasProblem(config, login, login.alias);
  if (problem !== null) throw new ConfigError(`${capitalized(problem)}.`);
  return { ...config, logins: [...config.logins, login] };
}
function removeLogin(config, id) {
  const login = findLogin(config, id);
  if (login === void 0) throw new ConfigError(`There is no login ${id}.`);
  if (login.usedByPlainClaude) throw new ConfigError(`${login.alias} is the login plain claude uses and cannot be removed.`);
  return { ...config, logins: config.logins.filter((other) => other.id !== id) };
}
function updateLogin(config, id, patch) {
  const current = findLogin(config, id);
  if (current === void 0) throw new ConfigError(`There is no login ${id}.`);
  const next = withConfigErrors(() => applyPatch(current, patch, topOf(`settings of ${current.alias}`)));
  if (patch.alias !== void 0) {
    const problem = aliasProblem(config, current, next.alias);
    if (problem !== null) throw new ConfigError(`${capitalized(problem)}.`);
  }
  return { ...config, logins: config.logins.map((login) => login.id === id ? next : login) };
}
function followEmail(config, id, email) {
  const login = findLogin(config, id);
  if (email === null || login === void 0 || login.aliasSetByUser) return config;
  const others = config.logins.filter((other) => other.id !== id);
  const alias = automaticAlias(email, login.id, login.alias, {
    aliases: others.map((other) => other.alias),
    ids: others.map((other) => other.id)
  });
  if (alias === login.alias) return config;
  return { ...config, logins: config.logins.map((other) => other.id === id ? { ...login, alias } : other) };
}
function capitalized(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
function changeConfig(change, path = configPath(), lockOptions = {}) {
  const lockPath = path === configPath() ? configLockPath() : `${path}.lock`;
  try {
    return withFileLockSync(lockPath, () => {
      const next = change(ensurePlainClaudeLogin(readConfigFile(path)));
      saveConfig(next, path);
      return next;
    }, lockOptions);
  } catch (error) {
    if (error instanceof LockTimeoutError) throw new ConfigError(error.message, { cause: error });
    throw error;
  }
}
function configStamp(path = configPath()) {
  try {
    return (0, import_node_crypto5.createHash)("sha256").update((0, import_node_fs4.readFileSync)(path)).digest("hex");
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
}

// src/data/login-env.ts
var import_node_fs5 = require("node:fs");
var import_node_os2 = require("node:os");
var import_node_path4 = require("node:path");
var NOT_INHERITED = {
  ANTHROPIC_API_KEY: void 0,
  ANTHROPIC_AUTH_TOKEN: void 0,
  CLAUDE_CODE_OAUTH_TOKEN: void 0,
  CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: void 0,
  ANTHROPIC_BASE_URL: void 0,
  ANTHROPIC_CUSTOM_HEADERS: void 0
};
var FORCE_CREDENTIAL_MANAGER_VARIABLE = "CLAUDE_CODE_FORCE_WINDOWS_CREDMAN";
function claudeLoginEnv(login, forceCredentialManager = false) {
  const force = forceCredentialManager ? { [FORCE_CREDENTIAL_MANAGER_VARIABLE]: "1" } : {};
  if (login.usedByPlainClaude) {
    return { CLAUDE_CONFIG_DIR: void 0, CLAUDE_SECURESTORAGE_CONFIG_DIR: void 0, ...NOT_INHERITED, ...force };
  }
  return { CLAUDE_CONFIG_DIR: loginFolder(login), CLAUDE_SECURESTORAGE_CONFIG_DIR: void 0, ...NOT_INHERITED, ...force };
}
function claudeProbeEnv(login) {
  if (login.usedByPlainClaude) {
    return { CLAUDE_CONFIG_DIR: ownClaudeProbeFolder(), CLAUDE_SECURESTORAGE_CONFIG_DIR: "", ...NOT_INHERITED };
  }
  return claudeLoginEnv(login);
}
function configDirHasOwnCredentials(env, platform = process.platform, home = (0, import_node_os2.homedir)()) {
  const value = env["CLAUDE_CONFIG_DIR"];
  if (value === void 0 || value === "") return false;
  if (platform === "darwin" || platform === "win32") return true;
  return !namesDefaultClaudeFolder(value, platform, home);
}
function namesDefaultClaudeFolder(value, platform = process.platform, home = (0, import_node_os2.homedir)()) {
  if (value === "") return false;
  const real = (path) => {
    const absolute = (0, import_node_path4.resolve)(path);
    try {
      return import_node_fs5.realpathSync.native(absolute);
    } catch {
      return absolute;
    }
  };
  const comparable = (path) => platform === "darwin" || platform === "win32" ? real(path).normalize("NFC").toLowerCase() : real(path);
  return comparable(value) === comparable((0, import_node_path4.join)(home, ".claude"));
}
function sharesDefaultSettingsFile(value, platform = process.platform, home = (0, import_node_os2.homedir)()) {
  if (value === "") return false;
  const comparable = (path) => {
    const real = realFilePath((0, import_node_path4.resolve)(path));
    return platform === "darwin" || platform === "win32" ? real.normalize("NFC").toLowerCase() : real;
  };
  return comparable((0, import_node_path4.join)(value, "settings.json")) === comparable((0, import_node_path4.join)(home, ".claude", "settings.json"));
}
function realFilePath(path, hops = 0) {
  try {
    return import_node_fs5.realpathSync.native(path);
  } catch {
  }
  if (hops < 40) {
    try {
      if ((0, import_node_fs5.lstatSync)(path).isSymbolicLink()) return realFilePath((0, import_node_path4.resolve)((0, import_node_path4.dirname)(path), (0, import_node_fs5.readlinkSync)(path)), hops + 1);
    } catch {
    }
  }
  const parent = (0, import_node_path4.dirname)(path);
  return parent === path ? path : (0, import_node_path4.join)(realFilePath(parent, hops + 1), (0, import_node_path4.basename)(path));
}
function applyEnvPatch(env, patch, windows = process.platform === "win32") {
  const same = (a, b) => windows ? a.toUpperCase() === b.toUpperCase() : a === b;
  const names = Object.keys(patch);
  const out = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === void 0 || names.some((other) => same(name, other))) continue;
    out[name] = value;
  }
  for (const [name, value] of Object.entries(patch)) {
    if (value !== void 0) out[name] = value;
  }
  return out;
}

// src/platform/programs.ts
var import_node_fs8 = require("node:fs");
var import_node_path8 = require("node:path");

// src/platform/detach.ts
var import_node_child_process = require("node:child_process");
var import_node_fs7 = require("node:fs");
var import_node_os3 = require("node:os");
var import_node_path6 = require("node:path");

// src/platform/system-program-guard.ts
var import_node_fs6 = require("node:fs");
var import_node_path5 = require("node:path");
var GUARD_VARIABLE = "KURMIS_REFUSE_SYSTEM_PROGRAMS";
var REFUSAL_LOG_VARIABLE = "KURMIS_REFUSED_PROGRAMS_LOG";
var GUARDED_PROGRAMS = /* @__PURE__ */ new Set([
  "launchctl",
  "security",
  "powershell",
  "pwsh",
  "reg",
  "taskkill",
  "wscript",
  "cscript",
  "wmic",
  "schtasks",
  "cmd",
  "claude"
]);
function guardOn(env) {
  return process.env[GUARD_VARIABLE] === "1" || env?.[GUARD_VARIABLE] === "1";
}
var REAL_CLI_PATHS = [
  /\/@anthropic-ai\/claude-code[^/]*\//,
  /\/\.local\/share\/claude\/versions\//
];
var TEST_HOME_VARIABLES = ["HOME", "USERPROFILE", "KURMIS_HOME", "KURMIS_CLAUDE_BIN", "KURMIS_UPSTREAM_URL"];
function refusedByGuard(command, env, args = []) {
  if (!guardOn(env)) return null;
  let refused = isRealProgram(command);
  if (!refused && isNode(command)) {
    const script = args.find((arg) => !arg.startsWith("-"));
    refused = script !== void 0 && isRealProgram(script);
  }
  if (!refused) return null;
  const shown = isRealProgram(command) ? command : `${command} ${args.join(" ")}`;
  recordRefusal(shown, env);
  return `${shown} is a real system program, which kurmis does not start while ${GUARD_VARIABLE}=1 (tests)`;
}
function pathsOf(path) {
  const paths = [path.replaceAll("\\", "/")];
  try {
    const real = (0, import_node_fs6.realpathSync)(path).replaceAll("\\", "/");
    if (real !== paths[0]) paths.push(real);
  } catch {
  }
  return paths;
}
function isRealProgram(path) {
  return pathsOf(path).some((each) => {
    const name = (0, import_node_path5.basename)(each).toLowerCase().replace(/\.exe$/, "");
    const lower = each.toLowerCase();
    return GUARDED_PROGRAMS.has(name) || REAL_CLI_PATHS.some((pattern) => pattern.test(lower));
  });
}
function isNode(command) {
  if (command === process.execPath) return true;
  return pathsOf(command).some((each) => /^node(\.exe)?$/i.test((0, import_node_path5.basename)(each)));
}
function refusalLog(env) {
  const named = env?.[REFUSAL_LOG_VARIABLE] || process.env[REFUSAL_LOG_VARIABLE];
  return named === void 0 || named === "" ? void 0 : named;
}
function recordRefusal(command, env) {
  const log = refusalLog(env);
  if (log === void 0) return;
  try {
    (0, import_node_fs6.appendFileSync)(log, `${command}
`, "utf8");
  } catch {
  }
}
function withGuard(env) {
  if (!guardOn(env)) return env;
  const log = refusalLog(env);
  const out = { ...env ?? process.env, [GUARD_VARIABLE]: "1", ...log === void 0 ? {} : { [REFUSAL_LOG_VARIABLE]: log } };
  for (const name of TEST_HOME_VARIABLES) {
    const value = process.env[name];
    if (!hasVariable(out, name) && value !== void 0 && value !== "") out[name] = value;
  }
  return out;
}
function hasVariable(env, name) {
  const upper = name.toUpperCase();
  return Object.keys(env).some((key) => key.toUpperCase() === upper && env[key] !== void 0);
}

// src/platform/detach.ts
var ENTRY_VARIABLE = "KURMIS_ENTRY";
function bundleFile() {
  const file = typeof __filename === "string" ? __filename : null;
  return file !== null && /\.c?js$/i.test(file) ? file : null;
}
function kurmisEntry(options = {}) {
  const env = options.env ?? process.env;
  const named = env[ENTRY_VARIABLE];
  if (named !== void 0 && named !== "") return named;
  const file = options.moduleFile === void 0 ? bundleFile() : options.moduleFile;
  if (file === null) return null;
  try {
    return (0, import_node_fs7.realpathSync)(file);
  } catch {
    return file;
  }
}
function temporaryFolders(env = process.env, platform = process.platform) {
  const named = ["TMPDIR", "TEMP", "TMP"].map((name) => platform === "win32" ? windowsEnv(env, name) : env[name]);
  const fixed = platform === "win32" ? [] : ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders"];
  return [...new Set([(0, import_node_os3.tmpdir)(), ...named, ...fixed].filter((folder) => folder !== void 0 && folder !== ""))];
}
function isTemporaryPath(path, folders, platform) {
  const separators = platform === "win32" ? /[\\/]+/ : /\/+/;
  const fold = (text) => platform === "win32" ? text.toLowerCase() : text;
  if (path.split(separators).some((part) => fold(part) === "fnm_multishells")) return true;
  const join16 = platform === "win32" ? "\\" : "/";
  const plain = fold(path.split(separators).join(join16));
  return folders.some((folder) => {
    const root = fold(folder.split(separators).join(join16)).replace(/[\\/]+$/, "");
    return root !== "" && (plain === root || plain.startsWith(root + join16));
  });
}
function nodeForJobs(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  const realpath = options.realpath ?? import_node_fs7.realpathSync;
  const temporary = options.temporaryFolders ?? temporaryFolders(env, platform);
  let target;
  try {
    target = realpath(execPath);
  } catch {
    return execPath;
  }
  const running = isTemporaryPath(execPath, temporary, platform) && !isTemporaryPath(target, temporary, platform) ? target : execPath;
  const windows = platform === "win32";
  const folders = windows ? windowsPathFolders(windowsEnv(env, "PATH")) : posixPathFolders(env.PATH);
  for (const folder of folders) {
    const candidate = windows ? import_node_path6.win32.join(folder, "node.exe") : import_node_path6.posix.join(folder, "node");
    try {
      if (!(0, import_node_fs7.statSync)(candidate).isFile()) continue;
    } catch {
      continue;
    }
    if (isTemporaryPath(candidate, temporary, platform)) continue;
    try {
      return realpath(candidate) === target ? candidate : running;
    } catch {
      continue;
    }
  }
  return running;
}
function spawnDetached(start2) {
  return new Promise((resolve8, reject) => {
    const guarded = refusedByGuard(start2.command, start2.env, start2.args);
    if (guarded !== null) {
      reject(new Error(guarded));
      return;
    }
    const child2 = (0, import_node_child_process.spawn)(start2.command, [...start2.args], {
      detached: true,
      stdio: "ignore",
      env: withGuard(start2.env),
      cwd: start2.cwd,
      shell: false,
      windowsHide: true
    });
    const exited = new Promise((done) => {
      child2.once("exit", (code) => done(code));
    });
    child2.once("error", (error) => {
      if (child2.pid === void 0) reject(error);
    });
    child2.once("spawn", () => {
      child2.unref();
      if (child2.pid === void 0) reject(new Error(`${start2.command} could not be started`));
      else resolve8({ pid: child2.pid, exited });
    });
  });
}
function windowsCommandLine(argv) {
  return argv.map(quoteWindowsArgument).join(" ");
}
function quoteWindowsArgument(arg) {
  if (arg !== "" && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const char of arg) {
    if (char === "\\") {
      backslashes++;
      continue;
    }
    if (char === '"') out += "\\".repeat(backslashes * 2 + 1) + '"';
    else out += "\\".repeat(backslashes) + char;
    backslashes = 0;
  }
  return `${out}${"\\".repeat(backslashes * 2)}"`;
}

// src/platform/npm-shim.ts
var import_node_path7 = require("node:path");
function decodeCmdShim(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
function parseCmdShim(text, shimPath) {
  const folder = import_node_path7.win32.dirname(import_node_path7.win32.resolve(shimPath));
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const progValues = lines.map((line) => /^@?set\s+"_prog=([^"]*)"$/i.exec(line)?.[1]).filter((value) => value !== void 0);
  const runLines = [];
  for (const line of lines) {
    if (!/(^|\s)%\*$/.test(line)) continue;
    const command = lastCommand(line.replace(/^@/, ""));
    const tokens = tokenize(command);
    if (tokens === null) return { unreadable: `the line ${JSON.stringify(line)} is not a plain command` };
    tokens.pop();
    const [program, ...rest] = tokens;
    if (program === void 0) return { unreadable: `the line ${JSON.stringify(line)} names no program` };
    const programs = /^@?%_prog%$/i.test(program) ? progValues : [program.replace(/^@/, "")];
    if (programs.length === 0) return { unreadable: "the shim starts %_prog% but never sets it" };
    runLines.push({ programs, rest });
  }
  if (runLines.length === 0) return { unreadable: "no line passes the arguments on (%*)" };
  let shim = null;
  for (const run2 of runLines) {
    const reading = readRunLine(run2, folder);
    if ("unreadable" in reading) return reading;
    if (shim === null) {
      shim = reading;
      continue;
    }
    if (!sameCall(shim, reading)) return { unreadable: "its lines start different programs" };
    for (const interpreter of reading.interpreters) {
      if (!shim.interpreters.includes(interpreter)) shim.interpreters.push(interpreter);
    }
  }
  return shim;
}
function cmdShimInvocation(shim, options) {
  if (/\.(cmd|bat)$/i.test(shim.target)) {
    return { refused: `${shim.target} is a batch file, which only cmd.exe can start` };
  }
  if (shim.interpreters.length === 0) {
    if (!/\.(exe|com)$/i.test(shim.target)) {
      return { refused: `the shim starts ${shim.target} directly, and that is not an .exe` };
    }
    return { command: shim.target, args: [...shim.targetArgs] };
  }
  for (const interpreter of shim.interpreters) {
    const command = isAbsoluteWindowsPath(interpreter) ? options.isFile(interpreter) ? interpreter : null : /^node(\.exe)?$/i.test(interpreter) ? options.nodePath : null;
    if (command !== null) {
      return { command, args: [...shim.interpreterArgs, shim.target, ...shim.targetArgs] };
    }
  }
  return { refused: `the shim starts ${shim.target} with ${shim.interpreters.join(" or ")}, which kurmis does not start` };
}
function isAbsoluteWindowsPath(path) {
  return /^[a-z]:\\/i.test(path) || path.startsWith("\\\\");
}
function readRunLine(run2, folder) {
  const expanded = [];
  for (const program of run2.programs) {
    const value = expand(program, folder);
    if (value === null) return { unreadable: `it starts ${program}, which is neither an absolute path nor a program name` };
    expanded.push(value);
  }
  if (run2.rest.length === 0) {
    const [target2] = expanded;
    if (expanded.length !== 1 || target2 === void 0 || !isAbsoluteWindowsPath(target2)) {
      return { unreadable: "it starts no file by its path" };
    }
    return { target: target2, interpreters: [], interpreterArgs: [], targetArgs: [] };
  }
  const targetIndex = run2.rest.findIndex((token) => /%~dp0|%dp0%/i.test(token) || isAbsoluteWindowsPath(token));
  if (targetIndex < 0) return { unreadable: "it starts no file by its path" };
  const rest = [];
  for (const token of run2.rest) {
    const value = expand(token, folder);
    if (value === null) return { unreadable: `it uses ${token}, which kurmis cannot work out` };
    rest.push(value);
  }
  const target = rest[targetIndex];
  if (!isAbsoluteWindowsPath(target)) return { unreadable: `its target ${run2.rest[targetIndex]} is not an absolute path` };
  return {
    target,
    interpreters: expanded,
    interpreterArgs: rest.slice(0, targetIndex),
    targetArgs: rest.slice(targetIndex + 1)
  };
}
function expand(token, folder) {
  let otherVariable = false;
  const replaced = token.replace(/%%|%~dp0|%dp0%|%/gi, (match) => {
    if (match === "%%") return "%";
    if (match === "%") {
      otherVariable = true;
      return match;
    }
    return `${folder}\\`;
  });
  if (otherVariable) return null;
  if (isAbsoluteWindowsPath(replaced)) return import_node_path7.win32.normalize(replaced);
  if (replaced.includes("\\") || replaced.includes("/")) return null;
  return replaced;
}
function lastCommand(line) {
  let quoted = false;
  let start2 = 0;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') quoted = !quoted;
    else if (char === "&" && !quoted) start2 = i + 1;
  }
  return line.slice(start2).trim();
}
function tokenize(command) {
  const tokens = [];
  for (const match of command.matchAll(/"([^"]*)"|([^\s"]+)/g)) {
    const quoted = match[1];
    const bare = match[2];
    if (bare !== void 0 && /[|<>^()]/.test(bare)) return null;
    tokens.push(quoted ?? bare ?? "");
  }
  return tokens;
}
function sameCall(a, b) {
  return a.target === b.target && a.interpreters.length === 0 === (b.interpreters.length === 0) && a.interpreterArgs.join("\0") === b.interpreterArgs.join("\0") && a.targetArgs.join("\0") === b.targetArgs.join("\0");
}

// src/platform/run.ts
var import_node_child_process2 = require("node:child_process");
var import_node_timers = require("node:timers");
var DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
function invocationFor(program, args, nodePath = process.execPath) {
  if (/\.(cmd|bat)$/i.test(program)) {
    return { refused: `${program} is a batch file, which only cmd.exe can start; kurmis never starts a program through a shell` };
  }
  if (/\.(js|cjs|mjs)$/i.test(program)) return { command: nodePath, args: [program, ...args] };
  return { command: program, args: [...args] };
}
function runProgram(program, args, options) {
  const invocation = invocationFor(program, args);
  if ("refused" in invocation) {
    return Promise.resolve({ stdout: "", stderr: "", code: null, timedOut: false, outputTooLarge: false, error: invocation.refused });
  }
  const guarded = refusedByGuard(invocation.command, options.env, invocation.args);
  if (guarded !== null) {
    return Promise.resolve({ stdout: "", stderr: "", code: null, timedOut: false, outputTooLarge: false, error: guarded });
  }
  const cap = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  let child2;
  try {
    child2 = (0, import_node_child_process2.spawn)(invocation.command, invocation.args, {
      // Standard input is closed, so a program that reads it gets end-of-file at once rather
      // than waiting on a terminal until the deadline.
      stdio: ["ignore", "pipe", "pipe"],
      env: withGuard(options.env ?? process.env),
      cwd: options.cwd,
      shell: false,
      windowsHide: true
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return Promise.resolve({
      stdout: "",
      stderr: "",
      code: null,
      timedOut: false,
      outputTooLarge: false,
      error: `${program} could not be started: ${reason}`
    });
  }
  return new Promise((resolve8) => {
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputTooLarge = false;
    let settled = false;
    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      (0, import_node_timers.clearTimeout)(timer);
      resolve8({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code,
        timedOut,
        outputTooLarge,
        error
      });
    };
    const kill = () => {
      child2.kill("SIGKILL");
      child2.stdout.destroy();
      child2.stderr.destroy();
    };
    const timer = (0, import_node_timers.setTimeout)(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);
    const keep = (chunks, chunk, kept) => {
      if (outputTooLarge || timedOut) return kept;
      if (kept + chunk.length > cap) {
        chunks.push(chunk.subarray(0, cap - kept));
        outputTooLarge = true;
        kill();
        return cap;
      }
      chunks.push(chunk);
      return kept + chunk.length;
    };
    child2.stdout.on("data", (chunk) => {
      stdoutBytes = keep(stdout, chunk, stdoutBytes);
    });
    child2.stderr.on("data", (chunk) => {
      stderrBytes = keep(stderr, chunk, stderrBytes);
    });
    child2.on("error", (error) => {
      if (child2.pid === void 0) finish(null, `${program} could not be started: ${error.message}`);
    });
    child2.on("close", (code, signal) => {
      if (timedOut) finish(null, `${program} did not finish within ${String(options.timeoutMs)} ms and was killed`);
      else if (outputTooLarge) finish(null, `${program} printed more than ${String(cap)} bytes and was killed`);
      else if (code === null) finish(null, `${program} was ended by ${signal ?? "a signal"}`);
      else finish(code, null);
    });
  });
}

// src/platform/programs.ts
var ProgramNotFoundError = class extends Error {
  constructor(tool, message) {
    super(message);
    this.tool = tool;
    this.name = "ProgramNotFoundError";
  }
  tool;
};
var PROGRAM_VARIABLE = "KURMIS_CLAUDE_BIN";
var DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";
var MAX_SHIM_BYTES = 64 * 1024;
function findProgram(tool, options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const nodePath = options.nodePath ?? process.execPath;
  const files = options.files ?? realFiles;
  const named = namedProgram(env, PROGRAM_VARIABLE, platform);
  if (named !== void 0) {
    const invocation = invocationFor(named, [], nodePath);
    if ("refused" in invocation) throw new ProgramNotFoundError(tool, `${PROGRAM_VARIABLE}: ${invocation.refused}`);
    return { command: invocation.command, args: invocation.args, source: "env" };
  }
  const ownEntry = options.ownEntry === void 0 ? kurmisEntry({ env }) : options.ownEntry;
  const own = ownEntry === null ? null : files.realPath(ownEntry) ?? ownEntry;
  return platform === "win32" ? findOnWindows(tool, env, nodePath, files, own) : findOnPosix(tool, env, nodePath, files, own);
}
function namedProgram(env, variable, platform) {
  const own = platform === "win32" ? windowsEnv(env, variable) : env[variable];
  if (own !== void 0 && own !== "") return own;
  if (!guardOn(env) || hasVariable(env, variable)) return void 0;
  const inherited = process.env[variable];
  return inherited === void 0 || inherited === "" ? void 0 : inherited;
}
var OWN_BUNDLE = "it is kurmis itself, not the real program";
function findOnPosix(tool, env, nodePath, files, own) {
  const folders = posixPathFolders(env.PATH);
  const skipped = [];
  for (const folder of folders) {
    const candidate = import_node_path8.posix.join(folder, tool);
    if (!files.isExecutable(candidate)) continue;
    const real = files.realPath(candidate);
    if (own !== null && real === own) {
      skipped.push(`${candidate}: ${OWN_BUNDLE}`);
      continue;
    }
    if (real !== null && /\.(js|cjs|mjs)$/i.test(real)) return { command: nodePath, args: [real], source: "path" };
    return { command: candidate, args: [], source: "path" };
  }
  const looked = [`the ${countFolders(folders.length)} on PATH`];
  if (env.HOME !== void 0 && import_node_path8.posix.isAbsolute(env.HOME)) {
    const native = import_node_path8.posix.join(env.HOME, ".local", "bin", "claude");
    if (files.isExecutable(native) && (own === null || files.realPath(native) !== own)) {
      return { command: native, args: [], source: "native-installer" };
    }
    looked.push(native);
  }
  throw notFound(tool, looked, skipped);
}
function findOnWindows(tool, env, nodePath, files, own) {
  const folders = windowsPathFolders(windowsEnv(env, "PATH"));
  const extensions = pathExtensions(windowsEnv(env, "PATHEXT"));
  const skipped = [];
  const isOwn = (path) => own !== null && path !== void 0 && (files.realPath(path) ?? path).toLowerCase() === own.toLowerCase();
  for (const folder of folders) {
    for (const extension of extensions) {
      const candidate = import_node_path8.win32.join(folder, tool + extension);
      if (!files.isFile(candidate)) continue;
      if (extension === ".exe" || extension === ".com") return { command: candidate, args: [], source: "path" };
      const resolved = resolveShim(candidate, nodePath, files);
      if ("refused" in resolved) skipped.push(`${candidate}: ${resolved.refused}`);
      else if (isOwn(resolved.args[0])) skipped.push(`${candidate}: ${OWN_BUNDLE}`);
      else return resolved;
    }
  }
  const looked = [`the ${countFolders(folders.length)} on PATH (as ${extensions.map((extension) => tool + extension).join(", ")})`];
  const home = windowsEnv(env, "USERPROFILE");
  if (home !== void 0 && isAbsoluteWindowsPath(home)) {
    const native = import_node_path8.win32.join(home, ".local", "bin", "claude.exe");
    if (files.isFile(native)) return { command: native, args: [], source: "native-installer" };
    looked.push(native);
  }
  throw notFound(tool, looked, skipped);
}
function resolveShim(shimPath, nodePath, files) {
  const bytes = files.read(shimPath, MAX_SHIM_BYTES);
  if (bytes === null) return { refused: "it could not be read" };
  const text = decodeCmdShim(bytes);
  if (text === null) return { refused: "it is not a package manager shim kurmis can read (it is not UTF-8 text)" };
  const shim = parseCmdShim(text, shimPath);
  if ("unreadable" in shim) return { refused: `it is not a package manager shim kurmis can read (${shim.unreadable})` };
  if (!files.isFile(shim.target)) return { refused: `it starts ${shim.target}, which does not exist` };
  const invocation = cmdShimInvocation(shim, { nodePath, isFile: (path) => files.isFile(path) });
  if ("refused" in invocation) return invocation;
  if (invocation.command === shim.target && !startsLikeWindowsProgram(files, shim.target)) {
    const wrapper = import_node_path8.win32.join(import_node_path8.win32.dirname(import_node_path8.win32.dirname(shim.target)), "cli-wrapper.cjs");
    if (files.isFile(wrapper)) {
      return { command: nodePath, args: [wrapper, ...invocation.args], source: "npm-shim" };
    }
    return {
      refused: `it starts ${shim.target}, which is not a Windows program; if this is the npm package, its install step did not run (reinstall it without --ignore-scripts)`
    };
  }
  return { command: invocation.command, args: invocation.args, source: "npm-shim" };
}
function startsLikeWindowsProgram(files, path) {
  const head = files.read(path, 2);
  return head !== null && head[0] === 77 && head[1] === 90;
}
function notFound(tool, looked, skipped) {
  const lines = [`Claude Code (${tool}) was not found. Looked in ${looked.join(" and at ")}.`];
  if (skipped.length > 0) lines.push(`Skipped:
${skipped.map((line) => `  ${line}`).join("\n")}`);
  lines.push(`Install Claude Code, or set ${PROGRAM_VARIABLE} to the full path of the program.`);
  return new ProgramNotFoundError(tool, lines.join("\n"));
}
function countFolders(count) {
  return count === 1 ? "1 folder" : `${String(count)} folders`;
}
function posixPathFolders(value) {
  return (value ?? "").split(":").filter((folder) => folder !== "" && import_node_path8.posix.isAbsolute(folder));
}
function windowsPathFolders(value) {
  return (value ?? "").split(";").map((folder) => folder.trim().replace(/^"(.*)"$/, "$1")).filter((folder) => isAbsoluteWindowsPath(folder));
}
function pathExtensions(value) {
  const listed = (value === void 0 || value.trim() === "" ? DEFAULT_PATHEXT : value).split(";").map((extension) => extension.trim().toLowerCase());
  return [...new Set(listed)].filter((extension) => [".com", ".exe", ".bat", ".cmd"].includes(extension));
}
function windowsEnv(env, name) {
  const exact = env[name];
  if (exact !== void 0 && exact !== "") return exact;
  const upper = name.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === upper && value !== void 0 && value !== "") return value;
  }
  return exact;
}
function regularFile(path) {
  try {
    return (0, import_node_fs8.statSync)(path, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    return false;
  }
}
var realFiles = {
  isFile(path) {
    return regularFile(path);
  },
  isExecutable(path) {
    if (!regularFile(path)) return false;
    try {
      (0, import_node_fs8.accessSync)(path, import_node_fs8.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  realPath(path) {
    try {
      return (0, import_node_fs8.realpathSync)(path);
    } catch {
      return null;
    }
  },
  read(path, maxBytes) {
    let fd;
    try {
      fd = (0, import_node_fs8.openSync)(path, "r");
    } catch {
      return null;
    }
    try {
      const buffer = Buffer.alloc(maxBytes);
      const length = (0, import_node_fs8.readSync)(fd, buffer, 0, maxBytes, 0);
      return buffer.subarray(0, length);
    } catch {
      return null;
    } finally {
      (0, import_node_fs8.closeSync)(fd);
    }
  }
};

// src/cli/daemon-client.ts
var import_node_os4 = require("node:os");
var import_node_path10 = require("node:path");

// src/data/daemon-file.ts
var import_node_crypto6 = require("node:crypto");
var import_node_fs9 = require("node:fs");
var import_node_path9 = require("node:path");
function generateDaemonSecret() {
  return (0, import_node_crypto6.randomBytes)(32).toString("hex");
}
var SECRET_PATTERN = /^[0-9a-f]{64}$/;
function readKey(path = keyPath()) {
  let text;
  try {
    text = (0, import_node_fs9.readFileSync)(path, "utf8").trim();
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return SECRET_PATTERN.test(text) ? text : null;
}
function readOrCreateKey(path = keyPath()) {
  const existing = readKey(path);
  if (existing !== null) return existing;
  makePrivateDirSync((0, import_node_path9.dirname)(path));
  const key = generateDaemonSecret();
  if (!createKeyFile(path, key)) {
    const theirs = readKeySettled(path);
    if (theirs !== null) return theirs;
    writeFileAtomicSync(path, `${key}
`, { mode: PRIVATE_FILE_MODE });
  }
  return key;
}
function createKeyFile(path, key) {
  const temporary = (0, import_node_path9.join)((0, import_node_path9.dirname)(path), `.key-${process.pid}-${(0, import_node_crypto6.randomBytes)(4).toString("hex")}`);
  writeFileAtomicSync(temporary, `${key}
`, { mode: PRIVATE_FILE_MODE });
  try {
    (0, import_node_fs9.linkSync)(temporary, path);
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
  } finally {
    (0, import_node_fs9.rmSync)(temporary, { force: true });
  }
  try {
    (0, import_node_fs9.writeFileSync)(path, `${key}
`, { flag: "wx", mode: PRIVATE_FILE_MODE });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}
function readKeySettled(path) {
  for (let attempt = 0; ; attempt++) {
    const key = readKey(path);
    if (key !== null || attempt >= 10) return key;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}
function isPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
function parseDaemonInfo(value) {
  if (!isPlainObject(value)) return "is not an object";
  if (!isPositiveInteger(value.pid)) return "pid must be a positive whole number";
  if (!isPositiveInteger(value.port) || value.port > 65535) return "port must be a whole number from 1 to 65535";
  if (typeof value.version !== "string" || value.version === "") return "version must be a string";
  if (typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt)) return "startedAt must be a number";
  return { pid: value.pid, port: value.port, version: value.version, startedAt: value.startedAt };
}
function readDaemonFile(path = daemonFilePath()) {
  let read;
  try {
    read = readJsonFileSync(path);
  } catch (error) {
    return { status: "invalid", reason: `${path} could not be read (${String(error.code)})` };
  }
  if (read.status === "missing") return { status: "missing" };
  if (read.status === "corrupt") return { status: "invalid", reason: `${path} is not valid JSON` };
  const info = parseDaemonInfo(read.value);
  return typeof info === "string" ? { status: "invalid", reason: `${path}: ${info}` } : { status: "ok", info };
}
function writeDaemonFile(info, path = daemonFilePath()) {
  writeJsonFileSync(path, info, { mode: PRIVATE_FILE_MODE });
}
function removeDaemonFile(pid, path = daemonFilePath(), afterCheck) {
  const read = readDaemonFile(path);
  if (read.status === "missing") return false;
  if (read.status === "ok" && read.info.pid !== pid) return false;
  afterCheck?.();
  const aside = `${path}.${String(process.pid)}-${(0, import_node_crypto6.randomBytes)(4).toString("hex")}.removing`;
  try {
    retryWhileLockedSync(() => {
      (0, import_node_fs9.renameSync)(path, aside);
    });
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  let keepAside = false;
  try {
    const moved = readDaemonFile(aside);
    if (moved.status === "ok" && moved.info.pid !== pid) {
      try {
        (0, import_node_fs9.linkSync)(aside, path);
      } catch (error) {
        if (error.code !== "EEXIST" && !(0, import_node_fs9.existsSync)(path)) {
          try {
            retryWhileLockedSync(() => {
              (0, import_node_fs9.renameSync)(aside, path);
            });
          } catch {
            keepAside = true;
          }
        }
      }
      return false;
    }
    return true;
  } finally {
    if (!keepAside) (0, import_node_fs9.rmSync)(aside, { force: true });
  }
}

// src/platform/system-programs.ts
var SYSTEM_PROGRAM_VARIABLES = {
  launchctl: "KURMIS_LAUNCHCTL_PROGRAM",
  security: "KURMIS_SECURITY_PROGRAM",
  powershell: "KURMIS_POWERSHELL_PROGRAM",
  reg: "KURMIS_REG_PROGRAM",
  taskkill: "KURMIS_TASKKILL_PROGRAM",
  wscript: "KURMIS_WSCRIPT_PROGRAM"
};
function lookup(env, name) {
  const exact = env[name];
  if (exact !== void 0 && exact !== "") return exact;
  const upper = name.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === upper && value !== void 0 && value !== "") return value;
  }
  return void 0;
}
function systemRoot(env = process.env) {
  const value = lookup(env, "SystemRoot") ?? lookup(env, "windir");
  return value === void 0 ? "C:\\Windows" : value.replace(/[\\/]+$/, "");
}
function realSystemProgram(program, env = process.env) {
  switch (program) {
    case "launchctl":
      return "/bin/launchctl";
    case "security":
      return "/usr/bin/security";
    case "powershell":
      return `${systemRoot(env)}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    case "reg":
      return `${systemRoot(env)}\\System32\\reg.exe`;
    case "taskkill":
      return `${systemRoot(env)}\\System32\\taskkill.exe`;
    case "wscript":
      return `${systemRoot(env)}\\System32\\wscript.exe`;
  }
}
function systemProgram(program, env = process.env, processEnv = process.env) {
  const variable = SYSTEM_PROGRAM_VARIABLES[program];
  return lookup(env, variable) ?? lookup(processEnv, variable) ?? realSystemProgram(program, env);
}
function inheritedTestHooks(env, processEnv = process.env) {
  const out = {};
  const guarded = lookup(env, GUARD_VARIABLE) === "1" || lookup(processEnv, GUARD_VARIABLE) === "1";
  const names = [...Object.values(SYSTEM_PROGRAM_VARIABLES), GUARD_VARIABLE, REFUSAL_LOG_VARIABLE, ...guarded ? TEST_HOME_VARIABLES : []];
  for (const name of names) {
    if (lookup(env, name) !== void 0) continue;
    const value = lookup(processEnv, name);
    if (value !== void 0) out[name] = value;
  }
  return out;
}

// src/cli/daemon-client.ts
var DaemonError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "DaemonError";
  }
};
var FIND_TIMEOUT_MS = 1e4;
var START_TIMEOUT_MS = 15e3;
var PROBE_TIMEOUT_MS = 9e4;
var STOP_TIMEOUT_MS = 3e4;
var NOW_STOP_TIMEOUT_MS = STOP_FINISH_MAX_MS + 5e3;
var STOP_GRACE_MS = STOP_FINISH_MAX_MS + 5e3;
var KILL_WAIT_MS = 5e3;
var PORT_FREE_TIMEOUT_MS = 5e3;
var POLL_MS = 100;
function configuredPort() {
  try {
    return loadConfig().port;
  } catch (error) {
    if (error instanceof ConfigError) throw new DaemonError(error.message);
    throw error;
  }
}
function connectionOf(status2, key) {
  const connection = { port: status2.port, key, pid: status2.pid, version: status2.version };
  if (typeof status2.apiVersion === "number") connection.apiVersion = status2.apiVersion;
  return connection;
}
async function findDaemon(options, timeoutMs) {
  void options;
  const until = timeoutMs === void 0 ? null : Date.now() + timeoutMs;
  const requestTimeout = () => until === null ? FIND_TIMEOUT_MS : Math.min(FIND_TIMEOUT_MS, Math.max(1, until - Date.now()));
  const key = readKey();
  if (key === null) return null;
  const read = readDaemonFile();
  let triedPort = null;
  if (read.status === "invalid") {
    removeDaemonFileIfDamaged();
  } else if (read.status === "ok") {
    const { pid, port: port2 } = read.info;
    if (!processExists(pid)) {
      try {
        removeDaemonFile(pid);
      } catch {
      }
    } else {
      triedPort = port2;
      const holder2 = await portHolder(port2, key, requestTimeout());
      if (holder2.kind === "kurmis") return connectionOf(holder2.status, key);
    }
  }
  let port;
  try {
    port = readConfig().port;
  } catch {
    return null;
  }
  if (port === triedPort) return null;
  const holder = await portHolder(port, key, requestTimeout());
  return holder.kind === "kurmis" ? connectionOf(holder.status, key) : null;
}
function removeDaemonFileIfDamaged() {
  const again = readDaemonFile();
  if (again.status !== "invalid") return;
  try {
    removeDaemonFile(-1);
  } catch {
  }
}
var NOT_FOR_THE_DAEMON = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_SECURESTORAGE_CONFIG_DIR"
];
function daemonEnvironment(env, processEnv = process.env) {
  const out = { ...env, ...inheritedTestHooks(env, processEnv) };
  for (const name of NOT_FOR_THE_DAEMON) delete out[name];
  if (out.KURMIS_HOME !== void 0 && out.KURMIS_HOME !== "") out.KURMIS_HOME = (0, import_node_path10.resolve)(out.KURMIS_HOME);
  return out;
}
function portBusyMessage(port, reason) {
  return `Port ${String(port)} on 127.0.0.1 is in use by another program (${reason}), so the kurmis daemon cannot listen there. Set "port" in ${configPath()} to a free port from 1024 to 65535, then run the command again.`;
}
function unusableDaemonText(daemon, version = kurmisVersion, apiVersion = CONTROL_API_VERSION) {
  if (canUseDaemon(daemon, apiVersion)) return null;
  const age = daemonAge(daemon, version, apiVersion);
  const where = `on port ${String(daemon.port)} (pid ${String(daemon.pid)})`;
  const versions = `The daemon is ${versionText(daemon.version, daemon.apiVersion)}, this kurmis is ${versionText(version, apiVersion)}.`;
  if (age === "newer") {
    return `A newer kurmis daemon runs ${where}, so this kurmis does not replace it, and it cannot use a daemon of another control API version. ${versions} Update this kurmis, or stop the daemon with "kurmis daemon stop" and run the command again.`;
  }
  if (age === "unknown") {
    return `The kurmis daemon ${where} has a version that cannot be compared with this kurmis' own, so this kurmis does not replace it, and it cannot use a daemon of another control API version. ${versions} Stop the daemon with "kurmis daemon stop" and run the command again.`;
  }
  return `The kurmis daemon ${where} is older than this kurmis and has another control API version. ${versions} "kurmis daemon restart" replaces it.`;
}
var DaemonNotUsableError = class extends DaemonError {
  constructor(message) {
    super(message);
    this.name = "DaemonNotUsableError";
  }
};
function usable(connection, version, apiVersion) {
  const problem = unusableDaemonText(connection, version, apiVersion);
  if (problem !== null) throw new DaemonNotUsableError(problem);
  return connection;
}
async function startDaemon(options) {
  const version = options.version ?? kurmisVersion;
  const apiVersion = options.apiVersion ?? CONTROL_API_VERSION;
  const port = configuredPort();
  const found = await findDaemon(options);
  let replaced = null;
  if (found !== null) {
    const age = daemonAge(found, version, apiVersion);
    if (found.port === port && age !== "older") {
      return { connection: usable(found, version, apiVersion), started: false, replaced: null };
    }
    replaced = found.version;
    if (found.port !== port) {
      if (age === "newer" || age === "unknown" && found.version !== version) {
        throw new DaemonError(`The kurmis daemon ${found.version} runs on port ${String(found.port)}, but ${configPath()} names port ${String(port)}. It is ${age === "newer" ? "newer than" : "not comparable with"} this kurmis (${versionText(found.version, found.apiVersion)}; this kurmis is ${versionText(version, apiVersion)}), so this kurmis does not stop it to move it. Update this kurmis, or stop the daemon with "kurmis daemon stop" and run the command again.`);
      }
      const stopped = await controlRequest({ port: found.port, key: found.key, method: "POST", path: CONTROL_PATHS.stop });
      if (stopped.kind === "failed" || stopped.kind === "answered" && stopped.status !== 200) {
        throw new DaemonError(`The kurmis daemon ${found.version} on port ${String(found.port)} (pid ${String(found.pid)}) could not be stopped to move it to port ${String(port)}, which ${configPath()} names: ${stopped.kind === "failed" ? stopped.reason : `it answered HTTP ${String(stopped.status)}`}. Stop it with "kurmis daemon stop" after setting the old port back, or end that process, and run the command again.`);
      }
    }
  }
  const key = readOrCreateKey();
  if (found === null) {
    const refusing = await keyRefusingDaemon(key);
    if (refusing !== null) throw new DaemonError(keyRefusedMessage(refusing, options.platform ?? process.platform));
    const holder = await portHolder(port, key, FIND_TIMEOUT_MS);
    if (holder.kind === "other") {
      const silent = silentDaemon();
      if (silent !== null && silent.port === port && holder.status === void 0) {
        throw new DaemonError(notAnsweringMessage(silent, holder.reason, options.platform ?? process.platform));
      }
      throw new DaemonError(portBusyMessage(port, holder.reason));
    }
    if (holder.kind === "kurmis" && !shouldReplaceDaemon(holder.status, version, apiVersion)) {
      return { connection: usable(connectionOf(holder.status, key), version, apiVersion), started: false, replaced: null };
    }
  }
  const entry = options.entry ?? kurmisEntry({ env: options.env });
  if (entry === null) {
    throw new DaemonError('This kurmis runs from its source tree, so there is no bundle to start the daemon from. Run "pnpm bundle" and use dist/kurmis.cjs, or set KURMIS_ENTRY to a built bundle.');
  }
  const env = daemonEnvironment(options.env);
  let child2;
  try {
    child2 = await spawnDetached({ command: process.execPath, args: [entry, "daemon", "run"], env, cwd: (0, import_node_os4.homedir)() });
  } catch (error) {
    throw new DaemonError(`The kurmis daemon could not be started: ${error instanceof Error ? error.message : String(error)}`);
  }
  const connection = await waitForDaemon({ port, version, apiVersion, child: child2, timeoutMs: options.startTimeoutMs ?? START_TIMEOUT_MS });
  return { connection: usable(connection, version, apiVersion), started: true, replaced };
}
async function waitForDaemon(wait) {
  const deadline = Date.now() + wait.timeoutMs;
  let exitCode;
  void wait.child.exited.then((code) => {
    exitCode = code;
  });
  for (; ; ) {
    const found = await findDaemon({ env: {} });
    if (found !== null && found.port === wait.port && !shouldReplaceDaemon(found, wait.version, wait.apiVersion)) return found;
    if (exitCode !== void 0 && exitCode !== 0) {
      throw new DaemonError(`The kurmis daemon exited at start (${exitCode === null ? "ended by a signal" : `exit code ${String(exitCode)}`}). Run "kurmis daemon run" to see why, or look in ${logPath()}.`);
    }
    if (Date.now() >= deadline) {
      throw new DaemonError(`The kurmis daemon did not answer on port ${String(wait.port)} within ${String(Math.round(wait.timeoutMs / 1e3))} seconds of starting. Run "kurmis daemon run" to see why, or look in ${logPath()}.`);
    }
    await delay(POLL_MS);
  }
}
async function ensureDaemon(options) {
  return (await startDaemon(options)).connection;
}
function failureOf(result, connection, what) {
  const port = String(connection.port);
  if (result.kind === "refused") return new DaemonError(`The kurmis daemon is not running (nothing answers on port ${port}).`);
  if (result.kind === "failed") return new DaemonError(`The kurmis daemon on port ${port} did not answer ${what}: ${result.reason}.`);
  if (result.status === 403) {
    return new DaemonError(`The program on port ${port} did not accept the key in ${keyPath()}. If it is a kurmis daemon of another data folder, stop it, or set another "port" in config.json.`);
  }
  const said = isPlainObject(result.body) && typeof result.body.error === "string" ? result.body.error : `HTTP ${String(result.status)}`;
  return new DaemonError(`The kurmis daemon refused ${what}: ${said}`);
}
async function readStatus3(connection) {
  const result = await controlRequest({ port: connection.port, key: connection.key, method: "GET", path: CONTROL_PATHS.status });
  if (result.kind === "answered" && result.status === 200 && isStatusAnswer(result.body)) return result.body;
  throw failureOf(result, connection, "a status request");
}
async function requestProbe(connection, logins, signal) {
  const result = await controlRequest({
    port: connection.port,
    key: connection.key,
    method: "POST",
    path: CONTROL_PATHS.probe,
    body: logins === void 0 ? {} : { logins },
    timeoutMs: PROBE_TIMEOUT_MS,
    ...signal === void 0 ? {} : { signal }
  });
  if (result.kind === "answered" && result.status === 200 && isStatusAnswer(result.body)) return result.body;
  throw failureOf(result, connection, "a usage probe");
}
async function requestReload(connection) {
  const result = await controlRequest({ port: connection.port, key: connection.key, method: "POST", path: CONTROL_PATHS.reload });
  if (result.kind === "answered" && result.status === 200 && isPlainObject(result.body) && result.body.ok === true) return;
  throw failureOf(result, connection, "a reload");
}
async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processExists(pid)) {
    if (Date.now() >= deadline) return false;
    await delay(POLL_MS);
  }
  return true;
}
async function waitForPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (await portAcceptsConnections(port)) {
    if (Date.now() >= deadline) return false;
    await delay(POLL_MS);
  }
  return true;
}
async function keyRefusingDaemon(key) {
  const read = readDaemonFile();
  if (read.status !== "ok" || !processExists(read.info.pid)) return null;
  const holder = await portHolder(read.info.port, key, FIND_TIMEOUT_MS);
  return holder.kind === "other" && holder.status === 403 ? read.info : null;
}
function notAnsweringMessage(info, reason, platform) {
  const pid = String(info.pid);
  const stopIt = platform === "win32" ? `taskkill /PID ${pid} /F` : `kill ${pid}`;
  return `The kurmis daemon (pid ${pid}, named in daemon.json) holds port ${String(info.port)} but did not answer a status request (${reason}). It may be busy, or finishing its open requests before it stops. Run the command again in a moment. If it keeps happening, look in ${logPath()}, and stop it with "${stopIt}".`;
}
function keyRefusedMessage(info, platform) {
  const pid = String(info.pid);
  const stopIt = platform === "win32" ? `taskkill /PID ${pid} /F` : `kill ${pid}`;
  return `The program on port ${String(info.port)} refused the key in ${keyPath()}, and daemon.json names pid ${pid} on that port, which still runs. Most likely that is a kurmis daemon started before the key file was changed or deleted, so its key no longer matches the key file. If pid ${pid} is that daemon, stop it with "${stopIt}" and run the command again. If you ran "kurmis setup", run it again after that, so your Claude Code settings hold the key from the key file.`;
}
async function keyRefusedProblem(options) {
  const refusing = await keyRefusingDaemon(readKey() ?? "");
  return refusing === null ? null : keyRefusedMessage(refusing, options.platform ?? process.platform);
}
async function stopDaemon(options) {
  const platform = options.platform ?? process.platform;
  const found = await findDaemon(options);
  if (found === null) {
    const problem = await keyRefusedProblem(options);
    if (problem !== null) throw new DaemonError(problem);
    return false;
  }
  const now = options.now === true;
  const waitMs = options.stopTimeoutMs ?? (now ? NOW_STOP_TIMEOUT_MS : STOP_TIMEOUT_MS);
  const body = { maxWaitMs: now ? 0 : waitMs };
  const result = await controlRequest({ port: found.port, key: found.key, method: "POST", path: CONTROL_PATHS.stop, body });
  if (result.kind === "answered" && result.status !== 200) throw failureOf(result, found, "the stop request");
  const graceMs = platform === "win32" && !now ? options.stopGraceMs ?? STOP_GRACE_MS : 0;
  if (await waitForExit(found.pid, waitMs + graceMs)) return true;
  const kill = options.kill ?? ((pid, signal) => process.kill(pid, signal));
  try {
    kill(found.pid, "SIGTERM");
  } catch (error) {
    const code = error.code;
    if (code === "ESRCH") return true;
    const stopIt = platform === "win32" ? `taskkill /PID ${String(found.pid)} /F` : `kill ${String(found.pid)}`;
    throw new DaemonError(`The kurmis daemon (pid ${String(found.pid)}) was asked to stop but is still running, and this command may not end it (${code ?? String(error)}). It probably runs as another user or as administrator; end it from there with "${stopIt}".`);
  }
  if (await waitForExit(found.pid, KILL_WAIT_MS)) return true;
  throw new DaemonError(`The kurmis daemon (pid ${String(found.pid)}) was asked to stop but is still running.`);
}
async function restartDaemon(options) {
  const version = options.version ?? kurmisVersion;
  const apiVersion = options.apiVersion ?? CONTROL_API_VERSION;
  const found = await findDaemon(options);
  if (found !== null) {
    if (daemonAge(found, version, apiVersion) === "newer") {
      throw new DaemonError(`The running kurmis daemon is newer than this kurmis (the daemon is ${versionText(found.version, found.apiVersion)}, this kurmis is ${versionText(version, apiVersion)}), so this kurmis does not replace it. Update this kurmis, or run "kurmis daemon stop" and then "kurmis daemon start".`);
    }
    const result = await controlRequest({ port: found.port, key: found.key, method: "POST", path: CONTROL_PATHS.stop });
    if (result.kind === "answered" && result.status !== 200) throw failureOf(result, found, "the stop request");
    if (!await waitForPortFree(found.port, PORT_FREE_TIMEOUT_MS)) {
      throw new DaemonError(`The kurmis daemon (pid ${String(found.pid)}) was asked to stop but still holds port ${String(found.port)}.`);
    }
  }
  const started = await startDaemon(options);
  return { ...started, replaced: found?.version ?? started.replaced };
}
function silentDaemon() {
  const read = readDaemonFile();
  if (read.status !== "ok" || !processExists(read.info.pid)) return null;
  return { pid: read.info.pid, port: read.info.port, version: read.info.version };
}

// src/cli/wrapper.ts
var import_node_child_process3 = require("node:child_process");
var import_node_os5 = require("node:os");
var WRAPPER_PIDS_VARIABLE = "KURMIS_WRAPPER_PIDS";
var MAX_WRAPPER_DEPTH = 8;
function wrapperPids(env) {
  return (env[WRAPPER_PIDS_VARIABLE] ?? "").split(",").map((text) => Number(text)).filter((pid) => Number.isInteger(pid) && pid > 0);
}
function wrapperLoop(env, parentPid) {
  const pids = wrapperPids(env);
  if (!pids.includes(parentPid) && pids.length < MAX_WRAPPER_DEPTH) return null;
  return `kurmis was started by the program it started, so that program runs kurmis again instead of being the real one (${pids.includes(parentPid) ? "its parent is a kurmis wrapper" : `${String(pids.length)} kurmis wrappers run inside each other`}). Take that program off PATH, or set KURMIS_CLAUDE_BIN to the real program`;
}
function withWrapperPid(env, pid) {
  return { ...env, [WRAPPER_PIDS_VARIABLE]: [...wrapperPids(env), pid].join(",") };
}
function ignoredSignals(platform, stdinIsTerminal = true) {
  if (platform === "win32") return ["SIGINT", "SIGBREAK", "SIGHUP"];
  return stdinIsTerminal ? ["SIGINT", "SIGQUIT"] : [];
}
function forwardedSignals(platform, stdinIsTerminal = true) {
  if (platform === "win32") return [];
  return stdinIsTerminal ? ["SIGTERM", "SIGHUP"] : ["SIGTERM", "SIGHUP", "SIGINT", "SIGQUIT"];
}
async function runInteractive(spec, options = {}) {
  const platform = options.platform ?? process.platform;
  const proc = options.process ?? process;
  const spawn4 = options.spawn ?? import_node_child_process3.spawn;
  const stdinIsTerminal = options.stdinIsTerminal ?? process.stdin.isTTY === true;
  return await new Promise((resolve8) => {
    const installed = [];
    let child2;
    let started = false;
    let settled = false;
    const finish = (end) => {
      if (settled) return;
      settled = true;
      for (const [signal, listener] of installed) proc.removeListener(signal, listener);
      resolve8(end);
    };
    const forward = (signal) => {
      if (child2?.pid === void 0) return;
      try {
        child2.kill(signal);
      } catch {
      }
    };
    for (const signal of ignoredSignals(platform, stdinIsTerminal)) {
      const listener = () => {
      };
      installed.push([signal, listener]);
      proc.on(signal, listener);
    }
    for (const signal of forwardedSignals(platform, stdinIsTerminal)) {
      const listener = () => forward(signal);
      installed.push([signal, listener]);
      proc.on(signal, listener);
    }
    const guarded = refusedByGuard(spec.command, spec.env, spec.args);
    if (guarded !== null) {
      finish(notStarted(spec.command, Object.assign(new Error(guarded), { code: "EACCES" })));
      return;
    }
    const loop = wrapperLoop(spec.env, options.parentPid ?? process.ppid);
    if (loop !== null) {
      finish(notStarted(spec.command, Object.assign(new Error(loop), { code: "ELOOP" })));
      return;
    }
    try {
      child2 = spawn4(spec.command, spec.args, {
        stdio: "inherit",
        env: withWrapperPid(withGuard(spec.env) ?? spec.env, proc.pid),
        cwd: spec.cwd,
        shell: false,
        // Interactive programs need their console window on Windows, so it is not hidden.
        windowsHide: false
      });
    } catch (error) {
      finish(notStarted(spec.command, error));
      return;
    }
    child2.once("spawn", () => {
      started = true;
    });
    child2.on("error", (error) => {
      if (!started) finish(notStarted(spec.command, error));
    });
    child2.once("exit", (code, signal) => {
      if (signal !== null) finish({ kind: "signal", signal });
      else finish({ kind: "exit", code: code ?? 1 });
    });
  });
}
function notStarted(command, error) {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "UNKNOWN";
  const why = {
    ENOENT: "there is no such program",
    EACCES: "it is not executable, or a folder on the way to it cannot be read",
    EPERM: "the system does not allow starting it",
    ENOEXEC: "it is not a program this system can run",
    EISDIR: "it is a folder"
  };
  const reason = why[code] ?? (error instanceof Error ? error.message : String(error));
  return { kind: "not-started", code, message: `could not start ${command}: ${reason} (${code})` };
}
function notStartedExitCode(code) {
  if (code === "ENOENT") return 127;
  if (code === "EACCES" || code === "EPERM" || code === "ENOEXEC" || code === "EISDIR") return 126;
  return 1;
}
var CORE_SIGNALS = /* @__PURE__ */ new Set([
  "SIGQUIT",
  "SIGABRT",
  "SIGILL",
  "SIGTRAP",
  "SIGFPE",
  "SIGBUS",
  "SIGSEGV",
  "SIGSYS",
  "SIGXCPU",
  "SIGXFSZ",
  "SIGIOT"
]);
function signalExitCode(signal) {
  const number = import_node_os5.constants.signals[signal];
  return 128 + (number ?? 0);
}
function finishLikeChild(end, options) {
  switch (end.kind) {
    case "exit":
      return end.code;
    case "not-started":
      options.stderr.write(`kurmis: ${options.name}: ${end.message}
`);
      return notStartedExitCode(end.code);
    case "signal": {
      const platform = options.platform ?? process.platform;
      if (platform !== "win32" && !CORE_SIGNALS.has(end.signal)) {
        const proc = options.process ?? process;
        proc.removeAllListeners(end.signal);
        try {
          proc.kill(proc.pid, end.signal);
        } catch {
        }
      }
      return signalExitCode(end.signal);
    }
  }
}

// src/cli/command-deps.ts
var realDaemonClient = { findDaemon, ensureDaemon, readStatus: readStatus3, requestProbe, requestReload };
var realChildRunner = { runInteractive, finishLikeChild };
var realFindProgram = findProgram;
async function reloadIfRunning(client, env) {
  try {
    const connection = await client.findDaemon({ env });
    if (connection === null) return { kind: "not-running" };
    await client.requestReload(connection);
    return { kind: "reloaded" };
  } catch (error) {
    return { kind: "failed", message: error instanceof DaemonError || error instanceof Error ? error.message : String(error) };
  }
}
function reloadText(result) {
  switch (result.kind) {
    case "reloaded":
      return "The running daemon has read the change.";
    case "not-running":
      return null;
    case "failed":
      return `The daemon could not be told about the change (${result.message}); it reads config.json again once it notices the change.`;
  }
}
async function settleWithin(start2, ms) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve8) => {
    timer = setTimeout(() => resolve8({ kind: "timeout" }), ms);
  });
  let promise;
  try {
    promise = start2(controller.signal);
  } catch (error) {
    clearTimeout(timer);
    return { kind: "failed", error };
  }
  const settled = promise.then(
    (value) => ({ kind: "done", value }),
    (error) => ({ kind: "failed", error })
  );
  try {
    const result = await Promise.race([settled, timeout]);
    if (result.kind === "timeout") controller.abort();
    return result;
  } finally {
    clearTimeout(timer);
  }
}

// src/cli/settings-arg.ts
var import_node_crypto7 = require("node:crypto");
var import_node_fs10 = require("node:fs");
var import_node_os6 = require("node:os");
var import_node_path11 = require("node:path");

// src/cli/json-error.ts
var NotJson = class extends Error {
  constructor(at) {
    super("not JSON");
    this.at = at;
  }
  at;
};
var WHITESPACE = /* @__PURE__ */ new Set([" ", "	", "\n", "\r"]);
function jsonErrorPlace(text) {
  let pos = 0;
  const fail4 = () => {
    throw new NotJson(pos);
  };
  const skip = () => {
    while (pos < text.length && WHITESPACE.has(text[pos])) pos++;
  };
  const expect = (char) => {
    if (text[pos] !== char) fail4();
    pos++;
  };
  const string = () => {
    expect('"');
    for (; ; ) {
      if (pos >= text.length) fail4();
      const char = text[pos];
      if (char === '"') {
        pos++;
        return;
      }
      if (char.charCodeAt(0) < 32) fail4();
      if (char === "\\") {
        pos++;
        const escaped = text[pos];
        if (escaped === "u") {
          for (let i = 1; i <= 4; i++) {
            if (!/[0-9a-fA-F]/.test(text[pos + i] ?? "")) {
              pos += i;
              fail4();
            }
          }
          pos += 5;
          continue;
        }
        if (escaped === void 0 || !'"\\/bfnrt'.includes(escaped)) fail4();
      }
      pos++;
    }
  };
  const digits = () => {
    if (!/[0-9]/.test(text[pos] ?? "")) fail4();
    while (/[0-9]/.test(text[pos] ?? "")) pos++;
  };
  const number = () => {
    if (text[pos] === "-") pos++;
    if (text[pos] === "0") pos++;
    else digits();
    if (text[pos] === ".") {
      pos++;
      digits();
    }
    if (text[pos] === "e" || text[pos] === "E") {
      pos++;
      if (text[pos] === "+" || text[pos] === "-") pos++;
      digits();
    }
  };
  const word = (expected) => {
    for (const char of expected) expect(char);
  };
  const value = () => {
    skip();
    const char = text[pos];
    if (char === "{") {
      pos++;
      skip();
      if (text[pos] === "}") {
        pos++;
        return;
      }
      for (; ; ) {
        skip();
        string();
        skip();
        expect(":");
        value();
        skip();
        if (text[pos] === "}") {
          pos++;
          return;
        }
        expect(",");
      }
    }
    if (char === "[") {
      pos++;
      skip();
      if (text[pos] === "]") {
        pos++;
        return;
      }
      for (; ; ) {
        value();
        skip();
        if (text[pos] === "]") {
          pos++;
          return;
        }
        expect(",");
      }
    }
    if (char === '"') return string();
    if (char === "t") return word("true");
    if (char === "f") return word("false");
    if (char === "n") return word("null");
    if (char === "-" || /[0-9]/.test(char ?? "")) return number();
    fail4();
  };
  try {
    value();
    skip();
    if (pos < text.length) fail4();
    return null;
  } catch (error) {
    if (!(error instanceof NotJson)) throw error;
    return placeOf(text, Math.min(error.at, text.length));
  }
}
function placeOf(text, at) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < at; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: at - lineStart + 1 };
}
function notJsonText(text) {
  const place = jsonErrorPlace(text);
  return place === null ? "not valid JSON" : `not valid JSON (line ${String(place.line)}, column ${String(place.column)})`;
}

// src/cli/settings-arg.ts
var FLAG = "--settings";
function readUserSettingsArg(args, options) {
  const rest = [];
  let value = null;
  let index = 0;
  for (; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") break;
    if (arg === FLAG) {
      const next = args[index + 1];
      if (next === void 0) return { error: `${FLAG} needs a value: a settings file or a JSON object` };
      value = next;
      index++;
      continue;
    }
    if (arg.startsWith(`${FLAG}=`)) {
      value = arg.slice(FLAG.length + 1);
      continue;
    }
    rest.push(arg);
  }
  rest.push(...args.slice(index));
  if (value === null) return { settings: null, source: null, rest };
  if (value.trim() === "") return { error: `${FLAG} needs a value: a settings file or a JSON object` };
  const text = value.trim();
  if (text.startsWith("{") && text.endsWith("}")) {
    const settings2 = parseSettings(text, `the JSON given to ${FLAG}`);
    return "error" in settings2 ? settings2 : { settings: settings2.value, source: "inline", rest };
  }
  const path = (0, import_node_path11.isAbsolute)(value) ? value : (0, import_node_path11.resolve)(options.cwd, value);
  let fileText;
  try {
    fileText = (options.readFile ?? ((file) => (0, import_node_fs10.readFileSync)(file, "utf8")))(path);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    const why = code === "ENOENT" ? "it does not exist" : error instanceof Error ? error.message : String(error);
    return { error: `${FLAG}: cannot read the settings file ${path}: ${why}` };
  }
  const settings = parseSettings(fileText, `the settings file ${path}`);
  return "error" in settings ? settings : { settings: settings.value, source: path, rest };
}
function parseSettings(text, what) {
  let value;
  try {
    value = JSON.parse(withoutBom(text));
  } catch {
    return { error: `${FLAG}: ${what} is ${notJsonText(withoutBom(text))}` };
  }
  if (!isPlainObject2(value)) return { error: `${FLAG}: ${what} is not a JSON object` };
  if (value.env !== void 0 && !isPlainObject2(value.env)) {
    return { error: `${FLAG}: the "env" in ${what} is not an object` };
  }
  return { value };
}
function withoutBom(text) {
  return text.charCodeAt(0) === 65279 ? text.slice(1) : text;
}
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function routingVariables(routed) {
  const out = {};
  for (const name of ROUTING_VARIABLES) {
    const value = routed.set[name];
    if (value !== void 0) out[name] = value;
  }
  return out;
}
function settingsEnv(routed) {
  const out = routingVariables(routed);
  for (const name of OAUTH_TOKEN_VARIABLES) out[name] = "";
  return out;
}
function mergeRoutingSettings(user, routing) {
  const userEnv = user !== null && isPlainObject2(user.env) ? user.env : {};
  return { ...user ?? {}, env: { ...userEnv, ...routing } };
}
function claudeArgsWithSettings(user, routing, store = storeSettings) {
  const stored = store(JSON.stringify(mergeRoutingSettings(user.settings, routing)), user.settings !== null);
  return { args: [FLAG, stored.path, ...user.rest], remove: () => stored.remove() };
}
var SETTINGS_FILE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1e3;
var SETTINGS_FILE_NAME = /^[0-9a-f]{32}\.json$/;
var RUN_SETTINGS_FILE_NAME = /^run-(\d+)-[0-9a-f]{16}\.json$/;
function storeSettings(text, holdsUserSettings, folder = wrapperSettingsFolder(), now = Date.now(), pid = process.pid) {
  if (!holdsUserSettings) return { path: storeSettingsFile(text, folder, now), remove: () => void 0 };
  pruneSettingsFiles(folder, now, null);
  const path = (0, import_node_path11.join)(folder, `run-${String(pid)}-${(0, import_node_crypto7.randomBytes)(8).toString("hex")}.json`);
  writeFileAtomicSync(path, text, { mode: PRIVATE_FILE_MODE });
  return {
    path,
    remove: () => {
      try {
        (0, import_node_fs10.rmSync)(path, { force: true });
      } catch {
      }
    }
  };
}
function storeSettingsFile(text, folder = wrapperSettingsFolder(), now = Date.now()) {
  const path = (0, import_node_path11.join)(folder, `${(0, import_node_crypto7.createHash)("sha256").update(text).digest("hex").slice(0, 32)}.json`);
  let current = false;
  try {
    current = (0, import_node_fs10.readFileSync)(path, "utf8") === text;
  } catch {
  }
  if (current) {
    try {
      (0, import_node_fs10.utimesSync)(path, now / 1e3, now / 1e3);
    } catch {
    }
  } else {
    writeFileAtomicSync(path, text, { mode: PRIVATE_FILE_MODE });
  }
  pruneSettingsFiles(folder, now, path);
  return path;
}
function pruneSettingsFiles(folder, now, keep) {
  let names;
  try {
    names = (0, import_node_fs10.readdirSync)(folder);
  } catch {
    return;
  }
  for (const name of names) {
    const file = (0, import_node_path11.join)(folder, name);
    const run2 = RUN_SETTINGS_FILE_NAME.exec(name);
    if (!SETTINGS_FILE_NAME.test(name) && run2 === null || file === keep) continue;
    try {
      const old = now - (0, import_node_fs10.statSync)(file).mtimeMs > SETTINGS_FILE_MAX_AGE_MS;
      if (old || run2 !== null && !isProcessAlive(Number(run2[1]))) (0, import_node_fs10.rmSync)(file, { force: true });
    } catch {
    }
  }
}
function claudeUserSettingsPath(env, home = (0, import_node_os6.homedir)()) {
  const configDir = env.CLAUDE_CONFIG_DIR;
  return configDir !== void 0 && configDir !== "" ? (0, import_node_path11.join)(configDir, "settings.json") : (0, import_node_path11.join)(home, ".claude", "settings.json");
}
function readUserSettingsEnv(path, readFile2 = (file) => (0, import_node_fs10.readFileSync)(file, "utf8")) {
  let text;
  try {
    text = readFile2(path);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "ENOENT" || code === "ENOTDIR") return { env: null, warning: null };
    return { env: null, warning: `could not read ${path} (${error instanceof Error ? error.message : String(error)})` };
  }
  let value;
  try {
    value = JSON.parse(withoutBom(text));
  } catch {
    return { env: null, warning: `${path} is ${notJsonText(withoutBom(text))}, so custom headers set there are not kept` };
  }
  if (!isPlainObject2(value) || !isPlainObject2(value.env)) return { env: null, warning: null };
  return { env: value.env, warning: null };
}
var CUSTOM_HEADERS = "ANTHROPIC_CUSTOM_HEADERS";
function inheritedVariable(layers, variable) {
  for (const env of [layers.flagEnv, layers.userSettingsEnv]) {
    if (env === null || !(variable in env)) continue;
    const value = env[variable];
    if (typeof value === "string") return value;
  }
  for (const [name, value] of Object.entries(layers.processEnv)) {
    const same = layers.windows === true ? name.toUpperCase() === variable.toUpperCase() : name === variable;
    if (same && value !== void 0) return value;
  }
  return null;
}
function inheritedCustomHeaders(layers) {
  return inheritedVariable(layers, CUSTOM_HEADERS);
}
function userOwnedRoutingVariables(layers) {
  return USER_OWNED_ROUTING_VARIABLES.filter((name) => {
    for (const env of [layers.flagEnv, layers.userSettingsEnv]) {
      if (env !== null && env[name] !== void 0 && env[name] !== null && env[name] !== "") return true;
    }
    const value = inheritedVariable({ flagEnv: null, userSettingsEnv: null, processEnv: layers.processEnv, windows: layers.windows }, name);
    return value !== null && value !== "";
  });
}

// src/cli/login-names.ts
function plainClaudeLoginText() {
  return "the login plain claude uses";
}

// src/cli/commands/claude.ts
var START_PROBE_WAIT_MS = 15e3;
var USAGE = `Usage: kurmis [--login <login>] claude [<claude arguments...>]

Starts Claude Code with the terminal attached. Its requests go through the kurmis daemon,
which signs each one with a login that has room, and the command exits with claude's exit code.
The daemon is started first when it is not running.

kurmis' options go before "claude", and claude's arguments after it, for example
"kurmis --login work-example claude --resume".

Options:
  --login <login>   Send every request of the session with one login, even when it is out
                    of usage. <login> is the login's alias or its id, as "kurmis status"
                    shows them. Without --login, each request goes to a login that has room
                    (Auto).

claude needs a signed-in login of its own to start, even though the daemon re-signs every
request. On Auto, kurmis starts it on the login plain claude uses, or on another signed-in login
when that one is signed out. This does not change where the requests go. Right after the daemon
starts, kurmis waits up to 15 seconds for its first usage probe to tell which.

kurmis passes its own settings to claude with --settings. When you give a --settings of your
own, kurmis adds its settings to yours and does not change your file.

To use kurmis every time you run claude: alias claude='kurmis claude'`;
function createClaudeCommand(overrides = {}) {
  const deps = {
    daemon: realDaemonClient,
    child: realChildRunner,
    findProgram: realFindProgram,
    loadConfig: () => loadConfig(),
    platform: process.platform,
    cwd: () => process.cwd(),
    homeDir: () => (0, import_node_os7.homedir)(),
    folderExists: (path) => (0, import_node_fs11.existsSync)(path) && (0, import_node_fs11.statSync)(path).isDirectory(),
    storeSettings: (text, holdsUserSettings) => storeSettings(text, holdsUserSettings),
    probeWaitMs: START_PROBE_WAIT_MS,
    ...overrides
  };
  return {
    name: "claude",
    summary: "Start Claude Code routed through the kurmis daemon",
    usage: USAGE,
    passesArguments: true,
    run: (args, context, login) => runClaude(args, login ?? null, context, deps)
  };
}
var claudeCommand = createClaudeCommand();
async function runClaude(args, login, context, deps) {
  const fail4 = (message, code = EXIT_FAILURE) => {
    writeLine(context.stderr, `kurmis claude: ${message}`);
    return code;
  };
  const userSettings = readUserSettingsArg(args, { cwd: deps.cwd(), readFile: deps.readFile });
  if ("error" in userSettings) return fail4(userSettings.error);
  let program;
  try {
    program = deps.findProgram("claude", { env: context.env, platform: deps.platform });
  } catch (error) {
    if (error instanceof ProgramNotFoundError) return fail4(error.message, notStartedExitCode("ENOENT"));
    return fail4(messageOf(error));
  }
  let config;
  try {
    config = deps.loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    if (login !== null) return fail4(error.message);
    writeLine(context.stderr, `kurmis claude: ${error.message} Starting claude on ${plainClaudeLoginText()}.`);
    config = null;
  }
  let pinned = null;
  if (login !== null && config !== null) {
    const resolved = resolveLogin(config, login);
    if ("error" in resolved) {
      return fail4(`${resolved.error}. "kurmis status" shows the logins, and "kurmis login" adds one.`);
    }
    pinned = resolved.login;
  }
  let connection;
  try {
    const running = config === null ? await deps.daemon.findDaemon({ env: context.env }) : null;
    connection = running !== null && canUseDaemon(running) ? running : await deps.daemon.ensureDaemon({ env: context.env });
  } catch (error) {
    return fail4(daemonUnreachable(error));
  }
  let startedOn;
  if (pinned !== null) {
    startedOn = pinned;
  } else {
    let status2;
    try {
      status2 = await deps.daemon.readStatus(connection);
    } catch (error) {
      return fail4(daemonUnreachable(error));
    }
    const ownRow = status2.logins.find((login2) => login2.usedByPlainClaude);
    if (config === null) {
      startedOn = ownRow ?? { id: null, alias: plainClaudeLoginText(), usedByPlainClaude: true };
    } else {
      status2 = await withFirstProbe(connection, status2, context, deps);
      const startId = autoStartLogin(startableLogins(status2));
      startedOn = status2.logins.find((login2) => login2.id === startId) ?? plainClaudeLogin(config);
      if (!startedOn.usedByPlainClaude) {
        const own = ownRow ?? plainClaudeLogin(config);
        writeLine(context.stderr, `kurmis claude: ${own.alias}, ${plainClaudeLoginText()}, is not signed in, so claude starts on ${startedOn.alias}'s credentials; requests are still routed on Auto.`);
      }
    }
  }
  let secureStorageDir = null;
  if (!startedOn.usedByPlainClaude && startedOn.id !== null) {
    secureStorageDir = loginFolder({ id: startedOn.id, usedByPlainClaude: false });
    if (!deps.folderExists(secureStorageDir)) {
      return fail4(`the folder of ${startedOn.alias} is missing (${secureStorageDir}). Sign it in again with "kurmis login ${startedOn.alias}".`);
    }
  }
  if (startedOn.usedByPlainClaude && configDirHasOwnCredentials(context.env, deps.platform)) {
    writeLine(context.stderr, `kurmis claude: ${configDirNote(context.env["CLAUDE_CONFIG_DIR"] ?? "", deps)}`);
  }
  const layers = settingsLayers(userSettings, context.env, deps);
  if (layers.warning !== null) writeLine(context.stderr, `kurmis claude: ${layers.warning}`);
  const routed = withoutRoutedVariables(routedClaudeEnv({
    port: connection.port,
    key: connection.key,
    login: pinned?.id ?? null,
    startedOn: startedOn.id,
    secureStorageDir,
    inheritedCustomHeaders: inheritedCustomHeaders(layers.layers)
  }), userOwnedRoutingVariables(layers.layers));
  for (const note of oauthTokenNotes(context.env, layers.layers, userSettings, claudeUserSettingsPath(context.env, deps.homeDir()))) {
    writeLine(context.stderr, `kurmis claude: ${note}`);
  }
  const env = applyRoutedEnv(context.env, routed, deps.platform === "win32");
  let claudeArgs;
  try {
    claudeArgs = claudeArgsWithSettings(userSettings, settingsEnv(routed), deps.storeSettings);
  } catch (error) {
    return fail4(`could not write the settings file for claude: ${error instanceof Error ? error.message : String(error)}`);
  }
  let end;
  try {
    end = await deps.child.runInteractive(
      { command: program.command, args: [...program.args, ...claudeArgs.args], env },
      { platform: deps.platform }
    );
  } finally {
    claudeArgs.remove();
  }
  return deps.child.finishLikeChild(end, { stderr: context.stderr, name: "claude", platform: deps.platform });
}
async function withFirstProbe(connection, status2, context, deps) {
  const unknown = status2.logins.filter((login) => login.signedIn === null);
  if (!unknown.some((login) => login.usedByPlainClaude)) return status2;
  const ids = unknown.map((login) => login.id);
  const probed = await settleWithin((signal) => deps.daemon.requestProbe(connection, ids, signal), deps.probeWaitMs);
  if (probed.kind === "done") return probed.value;
  writeLine(context.stderr, probed.kind === "timeout" ? `kurmis claude: the daemon did not finish its first usage probe within ${String(deps.probeWaitMs / 1e3)} s, so it is not known yet whether ${plainClaudeLoginText()} is signed in; claude starts on it.` : `kurmis claude: the usage probe failed (${messageOf(probed.error)}), so it is not known whether ${plainClaudeLoginText()} is signed in; claude starts on it.`);
  return status2;
}
function startableLogins(status2) {
  return status2.logins.map((login) => ({
    id: login.id,
    usedByPlainClaude: login.usedByPlainClaude,
    loggedIn: login.signedIn ?? login.usedByPlainClaude,
    autoRoute: login.routing
  }));
}
function settingsLayers(userSettings, env, deps) {
  const flagEnv = userSettings.settings?.env;
  const fromFile = readUserSettingsEnv(claudeUserSettingsPath(env, deps.homeDir()), deps.readFile);
  return {
    layers: {
      flagEnv: typeof flagEnv === "object" && flagEnv !== null && !Array.isArray(flagEnv) ? flagEnv : null,
      userSettingsEnv: fromFile.env,
      processEnv: env,
      windows: deps.platform === "win32"
    },
    warning: fromFile.warning
  };
}
function configDirNote(value, deps) {
  if (namesDefaultClaudeFolder(value, deps.platform, deps.homeDir())) {
    const keeps = deps.platform === "win32" ? "may keep its credentials in a Credential Manager entry" : "keeps its credentials in a Keychain item";
    return `CLAUDE_CONFIG_DIR names ~/.claude, the folder of the login plain claude uses, but a claude started with it set ${keeps} of its own, which may hold another account. Kurmis starts claude with the credentials of the login plain claude uses, the ones a claude without CLAUDE_CONFIG_DIR reads.`;
  }
  return "CLAUDE_CONFIG_DIR is set, but kurmis starts claude on the login plain claude uses, the one in ~/.claude, so claude signs in with that login's credentials, not with those in CLAUDE_CONFIG_DIR. Settings and transcripts still come from CLAUDE_CONFIG_DIR.";
}
function oauthTokenNotes(env, layers, userSettings, userSettingsPath) {
  const windows = layers.windows === true;
  const listed = (names) => ({
    names: names.join(" and "),
    verb: names.length === 1 ? "is" : "are",
    pronoun: names.length === 1 ? "it" : "them"
  });
  const notes = [];
  const inherited = inheritedOAuthTokenVariables(env, windows);
  if (inherited.length > 0) {
    const said = listed(inherited);
    notes.push(`${said.names} ${said.verb} set, so claude would sign its requests with that token instead of a kurmis login. Kurmis starts claude without ${said.pronoun}; unset ${said.pronoun} to stop this note.`);
  }
  const flagWhere = userSettings.source === "inline" || userSettings.source === null ? "your --settings" : userSettings.source;
  for (const [where, layer] of [[userSettingsPath, layers.userSettingsEnv], [flagWhere, layers.flagEnv]]) {
    if (layer === null) continue;
    const names = Object.entries(layer).filter(([name, value]) => typeof value === "string" && value !== "" && OAUTH_TOKEN_VARIABLES.some((other) => windows ? other.toUpperCase() === name.toUpperCase() : other === name)).map(([name]) => name);
    if (names.length === 0) continue;
    const said = listed(names);
    notes.push(`${said.names} ${said.verb} set in the "env" of ${where}, so claude would sign its requests with that token instead of a kurmis login. Kurmis sets ${said.pronoun} to an empty value for this claude, which Claude Code reads as unset; remove ${said.pronoun} there to stop this note.`);
  }
  return notes;
}
function daemonUnreachable(error) {
  if (error instanceof DaemonNotUsableError) return `${error.message} Claude is not started unrouted.`;
  return `the kurmis daemon could not be reached (${messageOf(error)}). Start it with "kurmis daemon start"; its log is ${logPath()}. Claude is not started unrouted.`;
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/daemon/main.ts
var import_node_http3 = require("node:http");

// src/data/log.ts
var import_node_fs12 = require("node:fs");
var import_node_path12 = require("node:path");
var LOG_EVENTS = [
  "daemon_started",
  "daemon_stopping",
  "daemon_stopped",
  "daemon_replacing_older",
  "drain_cut_short",
  "port_in_use",
  "config_loaded",
  "config_invalid",
  "alias_write_failed",
  "state_loaded",
  "state_write_failed",
  "control_request",
  "control_rejected",
  "proxy_rejected",
  "request_forwarded",
  "request_failed",
  "retry_other_login",
  "retry_after_backoff",
  "pool_exhausted",
  "cooldown_started",
  "cooldown_ended",
  "session_placed",
  "session_moved",
  "session_hold_ended",
  "token_read_failed",
  "token_renewal_started",
  "token_renewal_finished",
  "usage_probe_started",
  "usage_probe_finished",
  "usage_probe_failed",
  "internal_error"
];
var LOG_REASONS = [
  "usage_limit",
  "overload",
  "unauthorized",
  "bad_secret",
  "no_credentials",
  "token_expired",
  "timeout",
  /** A program the daemon started (a usage probe's CLI) ended before it answered. */
  "exited",
  "network",
  "upstream_error",
  "invalid",
  "missing",
  "corrupt",
  "wrong_version",
  "shutdown",
  /** A control `stop` named a wait of 0 (`kurmis daemon stop --now`). */
  "stop_now",
  "signal",
  "replaced",
  "error",
  "config_changed",
  "pinned",
  "out_of_pool",
  // The macOS Keychain refused the read: it is locked, or the daemon runs in an ssh session.
  "not_allowed",
  "other"
];
var LOG_ERROR_CODES = [
  "EADDRINUSE",
  "EACCES",
  "EPERM",
  "EBUSY",
  "ENOENT",
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ABORT_ERR",
  "other"
];
var LOG_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "other"];
var isNumber = (value) => typeof value === "number" && !Number.isNaN(value);
var oneOf = (words) => (value) => typeof value === "string" && words.includes(value);
var FIELD_CHECKS = {
  login: isLoginId,
  fromLogin: isLoginId,
  reason: oneOf(LOG_REASONS),
  code: oneOf(LOG_ERROR_CODES),
  method: oneOf(LOG_METHODS),
  status: isNumber,
  ms: isNumber,
  attempt: isNumber,
  count: isNumber,
  port: isNumber,
  pid: isNumber,
  until: isNumber,
  ok: (value) => typeof value === "boolean"
};
var REDACTED = "[redacted]";
function errorCodeOf(error) {
  const code = error?.code;
  return typeof code === "string" && LOG_ERROR_CODES.includes(code) ? code : "other";
}
function methodOf(method) {
  return method !== void 0 && LOG_METHODS.includes(method) ? method : "other";
}
function formatLogLine(event, fields = {}, now = Date.now()) {
  const name = LOG_EVENTS.includes(event) ? event : "invalid_event";
  const parts = [new Date(now).toISOString(), name];
  for (const [key, value] of Object.entries(fields)) {
    if (value === void 0) continue;
    const check = Object.hasOwn(FIELD_CHECKS, key) ? FIELD_CHECKS[key] : void 0;
    if (check === void 0) parts.push(`${REDACTED}=${REDACTED}`);
    else parts.push(`${key}=${check(value) ? String(value) : REDACTED}`);
  }
  return `${parts.join(" ")}
`;
}
var DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024;
function openDaemonLog(options = {}) {
  const path = options.path ?? logPath();
  const previous = options.previousPath ?? (options.path === void 0 ? previousLogPath() : `${path}.1`);
  const maxBytes = options.maxBytes ?? DEFAULT_LOG_MAX_BYTES;
  const now = options.now ?? Date.now;
  let size = null;
  const currentSize = () => {
    try {
      return (0, import_node_fs12.statSync)(path).size;
    } catch {
      return 0;
    }
  };
  const rotate = () => {
    try {
      retryWhileLockedSync(() => (0, import_node_fs12.renameSync)(path, previous));
    } catch {
      (0, import_node_fs12.rmSync)(path, { force: true });
    }
    size = 0;
  };
  return {
    write(event, fields) {
      try {
        const line = formatLogLine(event, fields, now());
        const bytes = Buffer.byteLength(line);
        if (size === null) {
          makePrivateDirSync((0, import_node_path12.dirname)(path));
          size = currentSize();
        }
        if (size + bytes > maxBytes) {
          size = currentSize();
          if (size + bytes > maxBytes && size > 0) rotate();
        }
        (0, import_node_fs12.appendFileSync)(path, line, { mode: PRIVATE_FILE_MODE });
        size += bytes;
      } catch {
      }
    }
  };
}

// src/data/identity.ts
var import_node_fs13 = require("node:fs");
var import_node_os8 = require("node:os");
var import_node_path13 = require("node:path");
var CLAUDE_PROFILE_FILE = ".claude.json";
function claudeIdentityFile(login, home = (0, import_node_os8.homedir)()) {
  if (!login.usedByPlainClaude) return (0, import_node_path13.join)(loginFolder(login), CLAUDE_PROFILE_FILE);
  const probed = (0, import_node_path13.join)(ownClaudeProbeFolder(), CLAUDE_PROFILE_FILE);
  return (0, import_node_fs13.existsSync)(probed) ? probed : (0, import_node_path13.join)(home, CLAUDE_PROFILE_FILE);
}
function parseClaudeIdentity(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object") return null;
    const block = parsed["oauthAccount"];
    if (block === null || typeof block !== "object") return null;
    const oauth = block;
    const identity = {
      accountUuid: textOf(oauth["accountUuid"]),
      email: textOf(oauth["emailAddress"]),
      organizationUuid: textOf(oauth["organizationUuid"]),
      organizationName: textOf(oauth["organizationName"])
    };
    return identity.accountUuid === null && identity.email === null ? null : identity;
  } catch {
    return null;
  }
}
function textOf(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
var ClaudeIdentityReader = class {
  constructor(home = import_node_os8.homedir) {
    this.home = home;
  }
  home;
  cache = /* @__PURE__ */ new Map();
  /** The login's identity, or null when its file names nobody. */
  read(login) {
    return this.readFile(claudeIdentityFile(login, this.home()));
  }
  readFile(file) {
    try {
      const stat = (0, import_node_fs13.statSync)(file);
      const cached = this.cache.get(file);
      if (cached?.mtime === stat.mtimeMs && cached.size === stat.size) return cached.value;
      let value = null;
      try {
        value = parseClaudeIdentity((0, import_node_fs13.readFileSync)(file, "utf8"));
      } catch {
      }
      this.cache.set(file, { mtime: stat.mtimeMs, size: stat.size, value });
      return value;
    } catch {
      this.cache.delete(file);
      return null;
    }
  }
};
function isSameClaudeAccount(a, b) {
  if (!isSameEmail(a.email, b.email)) return false;
  if (a.organizationUuid === null || b.organizationUuid === null) return true;
  return a.organizationUuid.trim().toLowerCase() === b.organizationUuid.trim().toLowerCase();
}
function isSameEmail(a, b) {
  return a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
}
function readClaudeIdentity(login, home = (0, import_node_os8.homedir)()) {
  return new ClaudeIdentityReader(() => home).read(login);
}

// src/platform/frame-process.ts
var import_node_child_process4 = require("node:child_process");
var import_node_timers2 = require("node:timers");
var DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
var DEFAULT_MAX_OUTPUT_BYTES2 = 8 * 1024 * 1024;
var PIPE_CLOSE_WAIT_MS = 1e3;
function treeKillCommand(pid, platform, env) {
  if (platform !== "win32") return null;
  return { command: systemProgram("taskkill", env), args: ["/PID", String(pid), "/T", "/F"] };
}
function createLineSplitter(maxLineBytes, onLine) {
  let pending = [];
  let pendingBytes = 0;
  return (chunk) => {
    let start2 = 0;
    for (; ; ) {
      const newline = chunk.indexOf(10, start2);
      if (newline === -1) break;
      const piece = chunk.subarray(start2, newline);
      if (pendingBytes + piece.length > maxLineBytes) return false;
      const line = pendingBytes === 0 ? piece : Buffer.concat([...pending, piece]);
      pending = [];
      pendingBytes = 0;
      onLine(line.toString("utf8").replace(/\r$/, ""));
      start2 = newline + 1;
    }
    if (start2 < chunk.length) {
      const rest = chunk.subarray(start2);
      pending.push(rest);
      pendingBytes += rest.length;
    }
    return pendingBytes <= maxLineBytes;
  };
}
function startFrameProcess(program, args, options) {
  const platform = options.platform ?? process.platform;
  const invocation = invocationFor(program, args);
  if ("refused" in invocation) return endedBeforeStart("refused", null);
  if (refusedByGuard(invocation.command, options.env, invocation.args) !== null) return endedBeforeStart("refused", null);
  if (options.signal?.aborted === true) return endedBeforeStart("aborted", null);
  let child2;
  try {
    child2 = (0, import_node_child_process4.spawn)(invocation.command, invocation.args, {
      stdio: ["pipe", "pipe", "ignore"],
      env: withGuard(options.env),
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      // Its own process group on macOS and Linux, so a kill reaches what it started. Never on
      // Windows, where `detached` would give the program a console window of its own.
      detached: platform !== "win32"
    });
  } catch (error) {
    return endedBeforeStart("start_failed", errorCode(error));
  }
  const stdin = child2.stdin;
  const stdout = child2.stdout;
  if (stdin === null || stdout === null) {
    child2.kill("SIGKILL");
    return endedBeforeStart("start_failed", null);
  }
  const maxFrame = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES2;
  let cause = null;
  let inputOpen = true;
  let outputBytes = 0;
  let exitedAt = null;
  let settled = false;
  let pipeTimer;
  let graceTimer;
  let resolveExited;
  const exited = new Promise((resolve8) => {
    resolveExited = resolve8;
  });
  const finish = (exit) => {
    if (settled) return;
    settled = true;
    (0, import_node_timers2.clearTimeout)(deadline);
    (0, import_node_timers2.clearTimeout)(pipeTimer);
    (0, import_node_timers2.clearTimeout)(graceTimer);
    options.signal?.removeEventListener("abort", onAbort);
    inputOpen = false;
    stdin.destroy();
    stdout.destroy();
    resolveExited(exit);
  };
  const kill = (why) => {
    if (settled) return;
    cause ??= why;
    inputOpen = false;
    killTree(child2, platform, options.env);
    stdin.destroy();
    stdout.destroy();
  };
  const deadline = (0, import_node_timers2.setTimeout)(() => kill("timeout"), options.timeoutMs);
  const onAbort = () => kill("aborted");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  stdin.on("error", () => {
    inputOpen = false;
  });
  const split = createLineSplitter(maxFrame, (line) => {
    if (cause !== null || line.trim() === "") return;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      return;
    }
    options.onFrame(frame);
  });
  stdout.on("data", (chunk) => {
    if (cause !== null) return;
    outputBytes += chunk.length;
    if (!split(chunk) || outputBytes > maxOutput) kill("output_too_large");
  });
  stdout.on("error", () => void 0);
  child2.on("error", (error) => {
    if (child2.pid === void 0) finish({ end: "start_failed", code: null, signal: null, errorCode: errorCode(error) });
  });
  child2.on("exit", (code, signal) => {
    exitedAt = { code, signal };
    pipeTimer = (0, import_node_timers2.setTimeout)(() => stdout.destroy(), PIPE_CLOSE_WAIT_MS);
  });
  child2.on("close", (code, signal) => {
    const status2 = exitedAt ?? { code, signal };
    finish({
      end: cause ?? "exited",
      code: cause === null ? status2.code : null,
      signal: status2.signal,
      errorCode: null
    });
  });
  const endInput = () => {
    if (!inputOpen) return;
    inputOpen = false;
    stdin.end();
  };
  return {
    pid: child2.pid,
    exited,
    send(frame) {
      if (!inputOpen || settled) return;
      stdin.write(`${JSON.stringify(frame)}
`);
    },
    endInput,
    close(graceMs) {
      endInput();
      if (!settled && graceTimer === void 0) graceTimer = (0, import_node_timers2.setTimeout)(() => kill("close_timeout"), graceMs);
      return exited;
    },
    kill() {
      kill("killed");
    }
  };
}
function endedBeforeStart(end, code) {
  const exit = { end, code: null, signal: null, errorCode: code };
  const exited = Promise.resolve(exit);
  return {
    pid: void 0,
    exited,
    send: () => void 0,
    endInput: () => void 0,
    close: () => exited,
    kill: () => void 0
  };
}
function killTree(child2, platform, env) {
  const pid = child2.pid;
  if (pid === void 0 || child2.exitCode !== null || child2.signalCode !== null) return;
  const command = treeKillCommand(pid, platform, env);
  if (command === null) {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      child2.kill("SIGKILL");
      return;
    }
  }
  const fallback = () => {
    if (child2.exitCode === null && child2.signalCode === null) child2.kill("SIGKILL");
  };
  const invocation = invocationFor(command.command, command.args);
  if ("refused" in invocation || refusedByGuard(invocation.command, env, invocation.args) !== null) {
    fallback();
    return;
  }
  try {
    const taskkill = (0, import_node_child_process4.spawn)(invocation.command, invocation.args, { stdio: "ignore", shell: false, windowsHide: true, env: withGuard(env) });
    taskkill.on("error", fallback);
    taskkill.on("exit", fallback);
  } catch {
    fallback();
  }
}
function errorCode(error) {
  const code = error?.code;
  return typeof code === "string" ? code : null;
}

// src/daemon/probe-result.ts
var PROBE_CLOSE_GRACE_MS = 5e3;
function programMissingText() {
  return 'The claude program was not found on the PATH the kurmis daemon was started with. Install Claude Code, or put claude on PATH, and run "kurmis daemon restart" from a shell that finds it; or set KURMIS_CLAUDE_BIN to the program.';
}
function probeFailure(signedIn, reason, error) {
  return { ok: false, signedIn, reason, error };
}
function abortedProbe(signedIn) {
  return probeFailure(signedIn, "shutdown", "The usage probe was stopped because the daemon is shutting down.");
}
function seconds(ms) {
  return String(Math.round(ms / 100) / 10);
}
function failureForExit(exit, timeoutMs, signedIn) {
  switch (exit.end) {
    case "aborted":
      return abortedProbe(signedIn);
    case "timeout":
      return probeFailure(signedIn, "timeout", `The usage probe timed out after ${seconds(timeoutMs)} s.`);
    case "output_too_large":
      return probeFailure(signedIn, "invalid", "claude printed more output than the usage probe accepts.");
    case "refused":
      return probeFailure(signedIn, "invalid", "claude is a batch file, which kurmis never starts.");
    case "start_failed":
      return probeFailure(signedIn, "missing", exit.errorCode === null ? "claude could not be started." : `claude could not be started (${safeCode(exit.errorCode)}).`);
    case "close_timeout":
    case "killed":
    case "exited":
      if (exit.code !== null) {
        return probeFailure(signedIn, "exited", `claude exited with code ${String(exit.code)} before it answered.`);
      }
      return probeFailure(signedIn, "exited", exit.signal === null ? "claude ended before it answered." : `claude was ended by ${exit.signal} before it answered.`);
  }
}
function safeCode(code) {
  return /^[A-Z0-9_]{1,32}$/.test(code) ? code : "unknown error";
}
function replyOrExit(reply, exited) {
  return Promise.race([
    reply.then((value) => ({ kind: "reply", value })),
    exited.then((exit) => ({ kind: "ended", exit }))
  ]);
}
var PendingReplies = class {
  waiting = /* @__PURE__ */ new Map();
  /** A promise for the reply to request `id`. Ask for it before the request is sent. */
  wait(id) {
    return new Promise((resolve8) => {
      this.waiting.set(id, resolve8);
    });
  }
  /** Hands a reply to whoever waits for it. A reply nobody waits for is dropped. */
  settle(id, value) {
    const resolve8 = this.waiting.get(id);
    if (resolve8 === void 0) return;
    this.waiting.delete(id);
    resolve8(value);
  }
};

// src/daemon/claude-probe.ts
var CLAUDE_PROBE_TIMEOUT_MS = 3e4;
var CLAUDE_PROBE_ARGS = [
  "-p",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  // The CLI refuses stream-json output without it.
  "--verbose",
  "--setting-sources=",
  "--strict-mcp-config",
  "--mcp-config",
  '{"mcpServers":{}}',
  "--no-session-persistence"
];
var TOKEN_VARIABLES = { CLAUDE_CODE_OAUTH_TOKEN: void 0, CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: void 0 };
var PROBE_SETTINGS = { DISABLE_AUTOUPDATER: "1" };
async function probeClaudeUsage(login, options) {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? CLAUDE_PROBE_TIMEOUT_MS;
  if (options.signal?.aborted === true) return abortedProbe(null);
  let program;
  try {
    program = findProgram("claude", { env: options.env });
  } catch (error) {
    if (error instanceof ProgramNotFoundError) {
      return probeFailure(null, "missing", programMissingText());
    }
    return probeFailure(null, "other", "The claude program could not be looked up.");
  }
  const env = applyEnvPatch(options.env, { ...claudeProbeEnv(login), ...TOKEN_VARIABLES, ...PROBE_SETTINGS });
  const cwd = probeWorkFolder();
  try {
    makePrivateDirSync(cwd);
    if (login.usedByPlainClaude) makePrivateDirSync(ownClaudeProbeFolder());
  } catch {
    return probeFailure(null, "other", "The usage probe could not create its folder in the kurmis data folder.");
  }
  const replies = new PendingReplies();
  const claude = startFrameProcess(program.command, [...program.args, ...CLAUDE_PROBE_ARGS], {
    env,
    cwd,
    timeoutMs,
    signal: options.signal,
    onFrame: (frame) => {
      const reply = controlReply(frame);
      if (reply !== null) replies.settle(reply.id, reply.reply);
    }
  });
  const result = await converse(claude, replies, login.id, timeoutMs, now, options.previous ?? null);
  const exit = await claude.close(PROBE_CLOSE_GRACE_MS);
  if (!result.ok && exit.end === "aborted") return abortedProbe(result.signedIn);
  return result;
}
async function converse(claude, replies, id, timeoutMs, now, previous) {
  const ask = (requestId, request2) => {
    const reply = replies.wait(requestId);
    claude.send({ type: "control_request", request_id: requestId, request: request2 });
    return replyOrExit(reply, claude.exited);
  };
  const init = await ask("kurmis_1", { subtype: "initialize" });
  if (init.kind === "ended") return failureForExit(init.exit, timeoutMs, null);
  if (!init.value.ok) return probeFailure(null, "upstream_error", "claude answered the start of the usage probe with an error.");
  const planAtStart = initializePlan(init.value.response);
  const usage = await ask("kurmis_2", { subtype: "get_usage", skip_behaviors: true });
  if (usage.kind === "ended") return failureForExit(usage.exit, timeoutMs, planAtStart);
  if (!usage.value.ok) return probeFailure(planAtStart, "upstream_error", "Claude answered the usage request with an error.");
  const answer2 = usage.value.response;
  if (!isRecord(answer2)) return probeFailure(planAtStart, "invalid", "Claude's answer to the usage request could not be read.");
  const available = answer2.rate_limits_available === true;
  const signedIn = available || typeof answer2.subscription_type === "string" && answer2.subscription_type !== "";
  if (available && !isRecord(answer2.rate_limits)) {
    return probeFailure(true, "upstream_error", "Claude could not fetch the plan usage from Anthropic.");
  }
  return { ok: true, signedIn, usage: usageFromGetUsage(id, answer2, now(), previous) };
}
function initializePlan(response) {
  if (!isRecord(response) || !isRecord(response.account)) return null;
  const plan = response.account.subscriptionType;
  return typeof plan === "string" && plan !== "";
}
function controlReply(frame) {
  if (!isRecord(frame) || frame.type !== "control_response" || !isRecord(frame.response)) return null;
  const response = frame.response;
  if (typeof response.request_id !== "string") return null;
  if (response.subtype === "success") return { id: response.request_id, reply: { ok: true, response: response.response } };
  return { id: response.request_id, reply: { ok: false } };
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/daemon/control.ts
var DISCARD_BODY_MS = 3e4;
function createControl(options) {
  const { table, tokens, identity, poller, log, now } = options;
  async function status2() {
    table.checkConfig();
    await tokens.prime(table.logins().map((login) => login.id));
    const rows = table.routeRows(table.plainClaudeLogin().id, false);
    const at = now();
    const logins = table.logins().map((login) => {
      const row = rows.find((each) => each.id === login.id);
      const cooldown = table.cooldown(login.id, at);
      const profile = identity.read(login);
      return {
        id: login.id,
        alias: login.alias,
        usedByPlainClaude: login.usedByPlainClaude,
        routing: login.routing,
        fiveHourLimit: login.fiveHourLimit,
        weeklyLimit: login.weeklyLimit,
        useFirst: login.useFirst,
        signedIn: table.claudeSignedIn(login.id),
        usage: table.usage(login.id),
        cooldownUntil: cooldown === null ? null : Number.isFinite(cooldown) ? cooldown : "unknown",
        block: row === void 0 ? null : routeBlock(row, at),
        sessions: table.sessionCount(login.id),
        email: profile?.email ?? null,
        organizationUuid: profile?.organizationUuid ?? null,
        probing: poller.isRunning(login.id)
      };
    });
    return {
      ok: true,
      apiVersion: CONTROL_API_VERSION,
      version: kurmisVersion,
      pid: options.pid,
      port: options.port,
      startedAt: options.startedAt,
      logins
    };
  }
  async function handle(req, res, path) {
    const key = req.headers[KEY_HEADER];
    if (!routeKeyMatches(typeof key === "string" ? key : null, options.key)) {
      log.write("control_rejected", { reason: "bad_secret", method: methodOf(req.method) });
      req.resume();
      res.writeHead(403).end();
      return;
    }
    log.write("control_request", { method: methodOf(req.method) });
    try {
      switch (path) {
        case CONTROL_PATHS.status:
          if (!allow(req, res, "GET")) return;
          req.resume();
          answer(res, 200, await status2());
          return;
        case CONTROL_PATHS.probe: {
          if (!allow(req, res, "POST")) return;
          const asked = await readProbeRequest(req);
          if (asked === TOO_LARGE) {
            refuseTooLarge(req, res);
            return;
          }
          if (typeof asked === "string") {
            answer(res, 400, failure(asked));
            return;
          }
          const unknown = asked.logins?.filter((id) => table.find(id) === void 0) ?? [];
          if (unknown.length > 0) {
            answer(res, 400, failure(`There is no login ${unknown.join(", ")}.`));
            return;
          }
          await poller.probeMany(asked.logins ?? poller.pollable(), "request");
          answer(res, 200, await status2());
          return;
        }
        case CONTROL_PATHS.reload: {
          if (!allow(req, res, "POST")) return;
          req.resume();
          const result = table.reloadConfig();
          if (!result.ok) {
            answer(res, 500, failure(result.error));
            return;
          }
          answer(res, 200, ok());
          return;
        }
        case CONTROL_PATHS.stop: {
          if (!allow(req, res, "POST")) return;
          const asked = await readStopRequest(req);
          if (asked === TOO_LARGE) {
            refuseTooLarge(req, res);
            return;
          }
          if (typeof asked === "string") {
            answer(res, 400, failure(asked));
            return;
          }
          res.once("finish", () => {
            options.onStopRequested(asked);
          });
          answer(res, 200, ok());
          return;
        }
        default:
          req.resume();
          answer(res, 404, failure(`The daemon has no control path ${path}.`));
      }
    } catch {
      log.write("internal_error", { method: methodOf(req.method) });
      if (!res.headersSent) answer(res, 500, failure("The daemon failed to answer the control request."));
      else res.destroy();
    }
  }
  return { handle, status: status2 };
}
function allow(req, res, method) {
  if (req.method === method) return true;
  req.resume();
  res.setHeader("allow", method);
  answer(res, 405, failure(`This control path takes ${method}.`));
  return false;
}
function answer(res, status2, body) {
  res.writeHead(status2, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
}
function ok() {
  return { ok: true };
}
function failure(error) {
  return { ok: false, error };
}
var TOO_LARGE = /* @__PURE__ */ Symbol("too large");
function readBody(req) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_CONTROL_BODY_BYTES) return Promise.resolve(TOO_LARGE);
  return new Promise((resolve8, reject) => {
    const chunks = [];
    let size = 0;
    const stopListening = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };
    const onData = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_CONTROL_BODY_BYTES) {
        stopListening();
        resolve8(TOO_LARGE);
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = () => {
      stopListening();
      resolve8(Buffer.concat(chunks).toString("utf8"));
    };
    const onError = (error) => {
      stopListening();
      reject(error);
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}
function refuseTooLarge(req, res) {
  answer(res, 413, failure(`The control request's body is larger than ${String(MAX_CONTROL_BODY_BYTES / 1024)} KB.`));
  if (req.complete) return;
  const timer = setTimeout(() => {
    req.socket.destroy();
  }, DISCARD_BODY_MS);
  timer.unref();
  const done = () => {
    clearTimeout(timer);
  };
  req.once("end", done);
  req.once("close", done);
  req.resume();
}
async function readJsonObject(req, what) {
  const body = await readBody(req);
  if (body === TOO_LARGE) return TOO_LARGE;
  const text = body.trim();
  if (text.length === 0) return {};
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return `The ${what} is not JSON.`;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return `The ${what} must be a JSON object.`;
  return value;
}
async function readStopRequest(req) {
  const value = await readJsonObject(req, "stop request");
  if (typeof value !== "object") return value;
  const maxWaitMs = value.maxWaitMs;
  if (maxWaitMs === void 0) return {};
  if (typeof maxWaitMs !== "number" || !Number.isFinite(maxWaitMs) || maxWaitMs < 0) {
    return '"maxWaitMs" must be a number of milliseconds, 0 or more.';
  }
  return { maxWaitMs };
}
async function readProbeRequest(req) {
  const value = await readJsonObject(req, "probe request");
  if (typeof value !== "object") return value;
  const logins = value.logins;
  if (logins === void 0) return {};
  if (!Array.isArray(logins) || !logins.every((id) => typeof id === "string")) return '"logins" must be a list of login ids.';
  return { logins };
}

// src/data/state.ts
var STATE_VERSION = 1;
var SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
var MAX_SESSIONS = 2e3;
var SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
function isSessionId(value) {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}
function emptyState() {
  return { usage: /* @__PURE__ */ new Map(), cooldowns: /* @__PURE__ */ new Map(), sessions: /* @__PURE__ */ new Map() };
}
function isTime(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isWindow(value) {
  return isPlainObject(value) && typeof value.utilization === "number" && Number.isFinite(value.utilization) && (value.resetsAt === null || typeof value.resetsAt === "string");
}
function isWindowOrNull(value) {
  return value === null || isWindow(value);
}
function isStringOrNull(value) {
  return value === null || typeof value === "string";
}
function isStoredUsage(value, login) {
  if (!isPlainObject(value)) return false;
  return value.accountId === login && isTime(value.fetchedAt) && (value.source === "probe" || value.source === "session") && isStringOrNull(value.subscriptionType) && typeof value.rateLimitsAvailable === "boolean" && isWindowOrNull(value.fiveHour) && isWindowOrNull(value.sevenDay) && isWindowOrNull(value.sevenDayOverage) && isWindowOrNull(value.sevenDayOpus) && isWindowOrNull(value.sevenDaySonnet) && Array.isArray(value.modelScoped) && value.modelScoped.every((window) => isWindow(window) && typeof window.displayName === "string") && (value.extraUsage === null || isPlainObject(value.extraUsage)) && (value.status === null || value.status === "allowed" || value.status === "allowed_warning" || value.status === "rejected") && (value.limited === null || isPlainObject(value.limited)) && isStringOrNull(value.error);
}
function parseState(value, now) {
  const state = emptyState();
  if (!isPlainObject(value)) return { state, dropped: 0, problem: "corrupt" };
  if (value.version !== STATE_VERSION) return { state, dropped: 0, problem: "wrong-version" };
  let dropped = 0;
  const entries = (field) => {
    if (field === void 0) return [];
    if (!isPlainObject(field)) {
      dropped++;
      return [];
    }
    return Object.entries(field);
  };
  for (const [key, usage] of entries(value.usage)) {
    if (isLoginId(key) && isStoredUsage(usage, key)) state.usage.set(key, usage);
    else dropped++;
  }
  for (const [key, until] of entries(value.cooldowns)) {
    if (!isLoginId(key) || until !== null && !isTime(until)) dropped++;
    else state.cooldowns.set(key, until === null ? Infinity : until);
  }
  for (const [key, placement] of entries(value.sessions)) {
    if (isSessionId(key) && isPlainObject(placement) && isLoginId(placement.login) && isTime(placement.lastUsed)) {
      state.sessions.set(key, { login: placement.login, lastUsed: placement.lastUsed });
    } else {
      dropped++;
    }
  }
  pruneState(state, now);
  return { state, dropped, problem: null };
}
function pruneState(state, now, maxAgeMs = SESSION_MAX_AGE_MS, maxSessions = MAX_SESSIONS) {
  for (const [login, until] of state.cooldowns) if (until <= now) state.cooldowns.delete(login);
  for (const [session, placement] of state.sessions) {
    if (now - placement.lastUsed > maxAgeMs) state.sessions.delete(session);
  }
  if (state.sessions.size > maxSessions) {
    const newestFirst = [...state.sessions].sort((a, b) => b[1].lastUsed - a[1].lastUsed);
    state.sessions = new Map(newestFirst.slice(0, maxSessions));
  }
}
function serializeState(state) {
  const usage = {};
  for (const [login, snapshot] of state.usage) usage[login] = snapshot;
  const cooldowns = {};
  for (const [login, until] of state.cooldowns) cooldowns[login] = Number.isFinite(until) ? until : null;
  const sessions = /* @__PURE__ */ Object.create(null);
  for (const [session, placement] of state.sessions) sessions[session] = placement;
  return { version: STATE_VERSION, usage, cooldowns, sessions };
}
function loadState(now = Date.now(), path = statePath()) {
  let read;
  try {
    read = readJsonFileSync(path);
  } catch {
    return { state: emptyState(), dropped: 0, problem: "corrupt" };
  }
  if (read.status === "missing") return { state: emptyState(), dropped: 0, problem: "missing" };
  if (read.status === "corrupt") return { state: emptyState(), dropped: 0, problem: "corrupt" };
  return parseState(read.value, now);
}
async function saveState(state, path = statePath()) {
  await writeJsonFile(path, serializeState(state));
}
function createCoalescedWriter(write, options) {
  let dirty = false;
  let timer = null;
  let inFlight = null;
  let lastStart = -Infinity;
  const run2 = () => {
    timer = null;
    if (!dirty || inFlight !== null) return inFlight ?? Promise.resolve();
    dirty = false;
    lastStart = Date.now();
    const started = write().catch((error) => options.onError?.(error)).finally(() => {
      inFlight = null;
      if (dirty) arm();
    });
    inFlight = started;
    return started;
  };
  const arm = () => {
    if (timer !== null || inFlight !== null) return;
    const wait = Math.max(0, lastStart + options.minIntervalMs - Date.now());
    timer = setTimeout(() => void run2(), wait);
    timer.unref?.();
  };
  return {
    schedule() {
      dirty = true;
      arm();
    },
    async flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (inFlight !== null) await inFlight;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (dirty) await run2();
    },
    pending() {
      return dirty || inFlight !== null;
    }
  };
}

// src/daemon/logins.ts
var NO_SESSION_KEY = ":no-session";
var CONFIG_CHECK_MS = 2e3;
var STATE_WRITE_MS = 2e3;
var CONFIG_LOCK_TIMEOUT_MS = 500;
var LoginTable = class {
  constructor(options) {
    this.options = options;
    this.writer = createCoalescedWriter(async () => {
      pruneState(this.state, this.options.now());
      await saveState(this.state, this.stateFile);
    }, {
      minIntervalMs: options.stateWriteMs ?? STATE_WRITE_MS,
      onError: (error) => {
        this.options.log.write("state_write_failed", { code: errorCodeOf(error) });
      }
    });
  }
  options;
  /**
   * Until a config has been read, a stand-in with the login of plain claude under a new random
   * id, because the proxy and the control API always need that login.
   * The stand-in is never saved. The first config that reads replaces it, and that drops the
   * usage and cooldowns kept under the stand-in's ids.
   */
  config = defaultConfig();
  stamp = null;
  lastCheck = -Infinity;
  state = emptyState();
  /** What the last probe of each login said about its sign-in. Absent: not probed yet. */
  signedIn = /* @__PURE__ */ new Map();
  /**
   * Sessions held to one login after a 400 on the login they had just moved to
   * (`replayDecision`'s `pin-back`). The proxy lets go of a hold when the held login cannot
   * serve (`releaseSession`). In memory only: `state.json` has no field for it, and a daemon
   * restart lets such a session be placed again. Kept within the same bounds as the session
   * placements (`pruneHolds`).
   */
  held = /* @__PURE__ */ new Map();
  /**
   * Logins whose token Anthropic refused with a 401 on a request of a CLI that was started on
   * another login, after the one renewal the proxy tries (`markRefused`), with when that was.
   * Routing treats them as signed out until a probe of the login that started later succeeds.
   * In memory only.
   */
  refused = /* @__PURE__ */ new Map();
  /**
   * The rate-limit headers of the last answer of each login (`noteObservation`). A probe that
   * started before they arrived measured an older state, so they are applied again on top of
   * its snapshot (`setProbeUsage`). In memory only; they hold no token or body.
   */
  observations = /* @__PURE__ */ new Map();
  /** When each login's current cooldown was set; absent for one read from `state.json`. In memory only. */
  cooldownSetAt = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  addedListeners = /* @__PURE__ */ new Set();
  writer;
  /** The files, fixed when the table is made, so a later change of `KURMIS_HOME` cannot move them. */
  configFile = configPath();
  stateFile = statePath();
  /** Reads `config.json` and `state.json`. A config that does not read leaves the defaults. */
  load() {
    this.reloadConfig();
    const read = loadState(this.options.now(), this.stateFile);
    this.state = read.state;
    this.options.log.write("state_loaded", {
      count: read.state.sessions.size,
      ...read.problem === "corrupt" ? { reason: "corrupt" } : read.problem === "wrong-version" ? { reason: "wrong_version" } : {},
      ...read.dropped > 0 ? { attempt: read.dropped } : {}
    });
  }
  /**
   * Reads `config.json` again. A file that does not read keeps the config the daemon has, so a
   * half-finished edit never empties the pool; the error says why, for the control API. A file
   * that could not be read because another process held its lock is read again at the next
   * check, whether or not it changed.
   */
  reloadConfig() {
    this.lastCheck = this.options.now();
    let stamp;
    try {
      stamp = configStamp(this.configFile);
    } catch (error) {
      this.options.log.write("config_invalid", { code: errorCodeOf(error) });
      return { ok: false, error: `${this.configFile} could not be read: ${messageOf2(error)}` };
    }
    if (stamp === this.stamp) return { ok: true, changed: false };
    const before = this.config;
    try {
      this.config = loadConfig(this.configFile, { timeoutMs: CONFIG_LOCK_TIMEOUT_MS });
    } catch (error) {
      const busy = isLockTimeout(error);
      if (!busy) this.stamp = stamp;
      this.options.log.write("config_invalid", { reason: busy ? "timeout" : "invalid" });
      return { ok: false, error: messageOf2(error) };
    }
    this.stamp = stamp;
    const added = this.config.logins.map((login) => login.id).filter((id) => findLogin(before, id) === void 0);
    const ids = new Set(this.config.logins.map((login) => login.id));
    for (const id of [...this.state.usage.keys()]) if (!ids.has(id)) this.state.usage.delete(id);
    for (const id of [...this.state.cooldowns.keys()]) if (!ids.has(id)) this.state.cooldowns.delete(id);
    for (const id of [...this.signedIn.keys()]) if (!ids.has(id)) this.signedIn.delete(id);
    for (const id of [...this.refused.keys()]) if (!ids.has(id)) this.refused.delete(id);
    for (const id of [...this.observations.keys()]) if (!ids.has(id)) this.observations.delete(id);
    for (const id of [...this.cooldownSetAt.keys()]) if (!ids.has(id)) this.cooldownSetAt.delete(id);
    this.options.log.write("config_loaded", { count: this.config.logins.length });
    this.changed();
    if (added.length > 0) for (const listener of [...this.addedListeners]) listener(added);
    return { ok: true, changed: true };
  }
  /** Reloads the config when its contents changed, looking at most every `configCheckMs`. */
  checkConfig() {
    if (this.options.now() - this.lastCheck < (this.options.configCheckMs ?? CONFIG_CHECK_MS)) return;
    this.reloadConfig();
  }
  /** Every login in `config.json`, the login of plain claude first. */
  logins() {
    return this.config.logins;
  }
  find(id) {
    return findLogin(this.config, id);
  }
  /** The login a plain `claude` uses: the one that CLI is signed in to. The config always has one. */
  plainClaudeLogin() {
    return plainClaudeLogin(this.config);
  }
  port() {
    return this.config.port;
  }
  /**
   * The routing rows of every login, for one request.
   *
   * `startedOn` is the login the request's CLI was started on, and `callerSigns` whether the
   * request carries an `authorization` header of its own. Null `startedOn` says the CLI's own
   * credentials are no kurmis login's (`STARTED_ON_NONE`): no login is signed with its header,
   * and plain claude's login, whose token belongs to another account than the CLI's,
   * is left out of the request's pool (`loggedIn` and `credentialsReadable` false). The proxy forwards that
   * header for the started-on login when it holds no token for it, so such a login counts as
   * signed in and signable. Every other login is signable only with a token the daemon read.
   *
   * A login whose token Anthropic refused (`markRefused`) counts as signed out, except the
   * started-on login and `pinned`, the login the request names with `x-kurmis-login`: their
   * requests go to it and get its 401 as it is.
   */
  routeRows(startedOn, callerSigns, pinned = null) {
    const now = this.options.now();
    return this.config.logins.map((login) => {
      const notTheCli = startedOn === null && login.usedByPlainClaude;
      const token = notTheCli ? null : this.options.tokens.read(login.id);
      const passThrough = token === null && callerSigns && login.id === startedOn;
      const refused = this.refused.has(login.id) && login.id !== startedOn && login.id !== pinned;
      return {
        id: login.id,
        loggedIn: !notTheCli && !refused && (token !== null || passThrough || this.signedIn.get(login.id) === true),
        credentialsReadable: token !== null || passThrough,
        tokenExpiresAt: token?.expiresAt ?? null,
        usage: this.usage(login.id),
        autoRoute: login.routing,
        fiveHourLimitPercent: login.fiveHourLimit,
        weeklyLimitPercent: login.weeklyLimit,
        useFirst: login.useFirst,
        cooldownUntil: this.cooldown(login.id, now)
      };
    });
  }
  usage(id) {
    return this.state.usage.get(id) ?? null;
  }
  setUsage(id, usage) {
    if (!isLoginId(id) || this.find(id) === void 0) return;
    this.state.usage.set(id, usage);
    this.save();
    this.changed();
  }
  /**
   * Folds the rate-limit headers of one of the login's answers into its usage, and keeps them
   * for `setProbeUsage`. Headers that say nothing about usage change nothing.
   */
  noteObservation(id, observation) {
    if (observation.status === null && observation.representativeClaim === null && Object.keys(observation.windows).length === 0) return;
    if (!isLoginId(id) || this.find(id) === void 0) return;
    this.observations.set(id, observation);
    this.setUsage(id, usageFromUnifiedHeaders(id, this.usage(id), observation));
  }
  /**
   * Stores a successful probe's snapshot. A probe that started at `startedAt` measured the login
   * at that time or a little later, so when an answer's rate-limit headers arrived after it
   * started, they count as newer and are
   * applied again on top of the probe's snapshot: the probe fills in what the headers do not
   * carry, and does not undo what they said.
   */
  setProbeUsage(id, usage, startedAt) {
    const observation = this.observations.get(id);
    this.setUsage(id, observation !== void 0 && observation.observedAt > startedAt ? usageFromUnifiedHeaders(id, usage, observation) : usage);
  }
  /** Until when routing skips the login: ms since epoch, `Infinity` for an unknown end, null for none. */
  cooldown(id, now = this.options.now()) {
    const until = this.state.cooldowns.get(id);
    return until === void 0 || until <= now ? null : until;
  }
  setCooldown(id, until) {
    if (!isLoginId(id) || this.find(id) === void 0) return;
    if (until === null) {
      this.state.cooldowns.delete(id);
      this.cooldownSetAt.delete(id);
    } else {
      this.state.cooldowns.set(id, until);
      this.cooldownSetAt.set(id, this.options.now());
    }
    this.save();
    this.changed();
  }
  /** When the login's cooldown was set by this daemon, or null (none, or one read from `state.json`). */
  cooldownSince(id) {
    return this.cooldownSetAt.get(id) ?? null;
  }
  /** Whether the last probe found the login signed in; null before its first probe. */
  probedSignedIn(id) {
    return this.signedIn.get(id) ?? null;
  }
  setSignedIn(id, value) {
    if (this.signedIn.get(id) === value || this.find(id) === void 0) return;
    this.signedIn.set(id, value);
    this.changed();
  }
  /**
   * Gives the login the automatic alias its email makes (`followEmail` in `config.ts`) when its
   * alias is automatic and does not fit the email yet, by writing `config.json` and reading it
   * again. The change is worked out again inside the lock, from the file as it is then. When the
   * lock is not free within `CONFIG_LOCK_TIMEOUT_MS`, or the write fails, the failure is logged
   * with the login's id only and the config stays as it is; the next probe tries again. The log
   * line never names the alias or the email.
   */
  noteEmail(id, email) {
    this.checkConfig();
    const login = this.find(id);
    if (login === void 0 || followEmail(this.config, id, email) === this.config) return;
    try {
      changeConfig((current) => followEmail(current, id, email), this.configFile, { timeoutMs: CONFIG_LOCK_TIMEOUT_MS });
    } catch (error) {
      this.options.log.write("alias_write_failed", { login: login.id, reason: isLockTimeout(error) ? "timeout" : "error", code: errorCodeOf(error) });
      return;
    }
    this.reloadConfig();
  }
  /** Records that Anthropic refused the login's token after the proxy tried to renew it (see `refused`). */
  markRefused(id) {
    if (this.find(id) === void 0) return;
    const known = this.refused.has(id);
    this.refused.set(id, this.options.now());
    if (!known) this.changed();
  }
  /** Whether `markRefused` holds for the login. */
  isRefused(id) {
    return this.refused.has(id);
  }
  /**
   * Ends `markRefused`: a probe of the login succeeded. A probe that started at `probeStartedAt`
   * ends only a refusal from before it or from the same millisecond; a refusal that came while
   * it ran is newer and stays.
   */
  clearRefused(id, probeStartedAt = Infinity) {
    const at = this.refused.get(id);
    if (at === void 0 || at > probeStartedAt) return;
    this.refused.delete(id);
    this.changed();
  }
  /**
   * Whether a login has credentials here: a token read, or a probe that found it
   * signed in. Null when neither has said yet.
   */
  claudeSignedIn(id) {
    if (this.options.tokens.read(id) !== null) return true;
    return this.probedSignedIn(id);
  }
  /** The login that served the session's last accepted answer, or null. */
  sessionLogin(key) {
    return this.state.sessions.get(key)?.login ?? null;
  }
  /** Records that `id` served the session's request, after the answer was accepted. */
  placeSession(key, id) {
    if (!isSessionId(key) || !isLoginId(id)) return { kind: "same" };
    const previous = this.state.sessions.get(key)?.login;
    this.state.sessions.set(key, { login: id, lastUsed: this.options.now() });
    this.save();
    if (previous === void 0) return { kind: "placed" };
    return previous === id ? { kind: "same" } : { kind: "moved", from: previous };
  }
  /** How many sessions' last request this login served. */
  sessionCount(id) {
    let count = 0;
    for (const placement of this.state.sessions.values()) if (placement.login === id) count++;
    return count;
  }
  /**
   * The login a session is held to after a pin-back, or null. A hold unused for
   * `SESSION_MAX_AGE_MS` has ended, even when no new hold has pruned it yet.
   */
  heldLogin(key) {
    const hold = this.held.get(key);
    if (hold === void 0) return null;
    const now = this.options.now();
    if (hold.lastUsed < now - SESSION_MAX_AGE_MS) {
      this.held.delete(key);
      return null;
    }
    hold.lastUsed = now;
    return hold.login;
  }
  holdSession(key, id) {
    if (!isLoginId(id)) return;
    this.held.delete(key);
    this.held.set(key, { login: id, lastUsed: this.options.now() });
    this.pruneHolds();
  }
  /** How many sessions are held after a pin-back. */
  heldCount() {
    return this.held.size;
  }
  /** Ends a session's hold, so its requests are routed on Auto again. */
  releaseSession(key) {
    this.held.delete(key);
  }
  /**
   * Calls `listener` after a reload of `config.json` that brought logins the config before it
   * did not have, with their ids. The first read replaces the stand-in config, so it names every
   * login; the usage poll is started after it and probes them all anyway.
   */
  onLoginsAdded(listener) {
    this.addedListeners.add(listener);
    return () => {
      this.addedListeners.delete(listener);
    };
  }
  /** Calls `listener` after every change of a login's usage, cooldown, sign-in or settings. */
  onChange(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  changed() {
    for (const listener of [...this.listeners]) listener();
  }
  /** Writes `state.json` now if a change is waiting, and waits for it. */
  flush() {
    return this.writer.flush();
  }
  save() {
    this.writer.schedule();
  }
  /**
   * Drops holds unused for `SESSION_MAX_AGE_MS`, and beyond the `MAX_SESSIONS` most recently
   * used, the same bounds `state.json` keeps session placements in.
   */
  pruneHolds() {
    const oldest = this.options.now() - SESSION_MAX_AGE_MS;
    for (const [key, hold] of this.held) if (hold.lastUsed < oldest) this.held.delete(key);
    if (this.held.size <= MAX_SESSIONS) return;
    const byUse = [...this.held].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key] of byUse.slice(0, this.held.size - MAX_SESSIONS)) this.held.delete(key);
  }
};
function isLockTimeout(error) {
  return error instanceof Error && error.cause instanceof LockTimeoutError;
}
function messageOf2(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/core/capacity-hold.ts
var CAPACITY_HOLD_MS = 12e4;
var CAPACITY_HOLD_BASE_MS = 5e3;
var CAPACITY_HOLD_MAX_MS = 3e4;
var CAPACITY_STREAK_MS = 10 * 6e4;
function capacityRefusal(status2, usageLimit) {
  if (status2 === 529) return "529 Overloaded";
  if (status2 === 429 && !usageLimit) return "429 Too Many Requests";
  return null;
}
function retryAfterMs(value) {
  if (value == null || value.trim().length === 0) return null;
  const seconds3 = Number(value);
  if (Number.isFinite(seconds3) && seconds3 >= 0) return seconds3 * 1e3;
  return null;
}
function capacityHoldDelayMs(attempt, asked, random, baseMs = CAPACITY_HOLD_BASE_MS, maxMs = CAPACITY_HOLD_MAX_MS) {
  const step = Math.min(Math.max(baseMs, maxMs), baseMs * 2 ** Math.max(0, attempt - 1));
  const fraction = Number.isFinite(random) ? Math.max(0, Math.min(1, random)) : 0;
  return Math.max(asked ?? 0, Math.round(step + step / 2 * fraction));
}
function capacityHoldAnswer(reason, heldMs) {
  const message = `Anthropic's API had no capacity for this request (${reason}) for ${String(Math.round(heldMs / 1e3))} s. The kurmis proxy holds it again when it is sent again.`;
  return {
    status: 529,
    headers: { "content-type": "application/json", "retry-after": "1" },
    body: JSON.stringify({ type: "error", error: { type: "overloaded_error", message } })
  };
}
var CapacityCooling = class {
  constructor(options = {}) {
    this.options = options;
  }
  options;
  streaks = /* @__PURE__ */ new Map();
  cooling = /* @__PURE__ */ new Map();
  /**
   * Records that `loginId` answered a request of the session without capacity. `reason` is
   * what `capacityRefusal` said, `retryAfter` the answer's `retry-after` header, and `random`
   * a 0-1 number for the jitter.
   */
  noteNoCapacity(sessionId, loginId, reason, retryAfter, random, now) {
    this.dropExpired(now);
    const attempt = (this.streaks.get(sessionId)?.attempt ?? 0) + 1;
    this.streaks.set(sessionId, { attempt, at: now });
    const delayMs = capacityHoldDelayMs(
      attempt,
      retryAfterMs(retryAfter),
      random,
      this.options.baseMs ?? CAPACITY_HOLD_BASE_MS,
      this.options.maxMs ?? CAPACITY_HOLD_MAX_MS
    );
    const entry = this.cooling.get(sessionId) ?? { logins: /* @__PURE__ */ new Map(), reason };
    entry.reason = reason;
    const until = Math.max(entry.logins.get(loginId) ?? 0, now + delayMs);
    entry.logins.set(loginId, until);
    this.cooling.set(sessionId, entry);
    return { attempt, delayMs, until };
  }
  /** The session got an answer that was not a want of capacity, so its count in a row starts over. */
  noteAnswered(sessionId) {
    this.streaks.delete(sessionId);
  }
  /** The session's count of answers without capacity in a row, or 1 when it has none. */
  attempt(sessionId, now) {
    this.dropExpired(now);
    return this.streaks.get(sessionId)?.attempt ?? 1;
  }
  /**
   * The session's logins that are still cooling, each with the time it may be tried again, and
   * what the last answer without capacity was. Null when none is cooling, which is when a new
   * request of the session needs no hold from the start.
   */
  coolingOf(sessionId, now) {
    this.dropExpired(now);
    return this.cooling.get(sessionId) ?? null;
  }
  /** Whether this login is cooling for the session now. */
  isCooling(sessionId, loginId, now) {
    return (this.coolingOf(sessionId, now)?.logins.get(loginId) ?? 0) > now;
  }
  /**
   * What a held request of the session waits for. `usable` is the logins the session may use
   * now (`accountsInScope`): a login that has left the session's pool is no reason to wait.
   * `cooling` is the usable logins still cooling, which the next choice of a login must pass
   * over, and `wakeAt` is when the first of them may be tried again, or null when none is
   * cooling. A held request that finds no login and nothing cooling is answered with the pool's
   * own refusal, because then it is a usage limit or a sign-in problem, not a want of capacity.
   */
  waitFor(sessionId, usable2, now) {
    const cooling = /* @__PURE__ */ new Set();
    let wakeAt = null;
    for (const [id, until] of this.coolingOf(sessionId, now)?.logins ?? []) {
      if (until <= now || !usable2.has(id)) continue;
      cooling.add(id);
      wakeAt = wakeAt === null ? until : Math.min(wakeAt, until);
    }
    return { cooling, wakeAt };
  }
  /** Forgets a session, as when the daemon drops its route. */
  forget(sessionId) {
    this.streaks.delete(sessionId);
    this.cooling.delete(sessionId);
  }
  dropExpired(now) {
    for (const [id, streak] of this.streaks) {
      if (now - streak.at > CAPACITY_STREAK_MS) this.streaks.delete(id);
    }
    for (const [id, entry] of this.cooling) {
      for (const [login, until] of entry.logins) if (until <= now) entry.logins.delete(login);
      if (entry.logins.size === 0) this.cooling.delete(id);
    }
  }
};

// src/daemon/upstream.ts
var import_node_http2 = __toESM(require("node:http"), 1);
var import_node_https = __toESM(require("node:https"), 1);
var import_node_stream = require("node:stream");
var ANTHROPIC_API_URL = "https://api.anthropic.com";
var UPSTREAM_IDLE_TIMEOUT_MS = 20 * 6e4;
var UPSTREAM_CONNECT_TIMEOUT_MS = 3e4;
var KEEPALIVE_PROBE_DELAY_MS = 3e4;
var FREE_SOCKET_TIMEOUT_MS = 3e4;
var RESEND_WINDOW_MS = 2e3;
var DISCARD_LIMIT_BYTES = 1024 * 1024;
var DISCARD_TIMEOUT_MS = 5e3;
var RESET_CODES = /* @__PURE__ */ new Set(["ECONNRESET", "EPIPE"]);
function upstreamOrigin(env) {
  const raw = env["KURMIS_UPSTREAM_URL"];
  if (raw === void 0 || raw === "") return ANTHROPIC_API_URL;
  const problem = "KURMIS_UPSTREAM_URL must be an http or https origin such as http://127.0.0.1:8080";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${problem}; the value is not a URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${problem}; the scheme is not http or https`);
  if (url.username !== "" || url.password !== "") throw new Error(`${problem}; the value has credentials in it`);
  if (raw.includes("?") || raw.includes("#")) throw new Error(`${problem}; the value has a query or fragment`);
  if (url.pathname !== "/") throw new Error(`${problem}; the value has a path`);
  return url.origin;
}
var UpstreamError = class extends Error {
  constructor(kind, code, message, options) {
    super(message, options);
    this.kind = kind;
    this.code = code;
    this.name = "UpstreamError";
  }
  kind;
  code;
};
function createUpstream(options) {
  const url = new URL(options.origin);
  const tls = url.protocol === "https:";
  if (!tls && url.protocol !== "http:") throw new Error("the upstream origin must be http or https");
  const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");
  const port = url.port === "" ? void 0 : Number(url.port);
  const idleTimeoutMs = options.idleTimeoutMs ?? UPSTREAM_IDLE_TIMEOUT_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? UPSTREAM_CONNECT_TIMEOUT_MS;
  const keepAliveProbeDelayMs = options.keepAliveProbeDelayMs ?? KEEPALIVE_PROBE_DELAY_MS;
  const resendWindowMs = options.resendWindowMs ?? RESEND_WINDOW_MS;
  const agentOptions = {
    keepAlive: true,
    keepAliveMsecs: keepAliveProbeDelayMs,
    // Applies to connections waiting for their next request; a running request sets its own.
    timeout: options.freeSocketTimeoutMs ?? FREE_SOCKET_TIMEOUT_MS,
    scheduling: "lifo"
  };
  const agent = tls ? new import_node_https.default.Agent(agentOptions) : new import_node_http2.default.Agent(agentOptions);
  const transport = tls ? import_node_https.default : import_node_http2.default;
  let closed = false;
  function attempt(request2, retried) {
    return new Promise((resolve8, reject) => {
      const { signal } = request2;
      if (signal.aborted) {
        reject(abortedError());
        return;
      }
      let response = null;
      let answered = false;
      let over = false;
      let connectTimer;
      let writtenAt = null;
      const req = transport.request({
        hostname,
        port,
        method: request2.method,
        path: request2.path,
        headers: request2.headers,
        agent
      });
      const fail4 = (error) => {
        if (over) return;
        clearTimeout(connectTimer);
        response?.destroy(error);
        req.destroy(error);
      };
      const onAbort = () => fail4(abortedError());
      const end = () => {
        over = true;
        clearTimeout(connectTimer);
        signal.removeEventListener("abort", onAbort);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      req.setTimeout(idleTimeoutMs, () => {
        fail4(new UpstreamError("timeout", "ETIMEDOUT", `the Anthropic API connection carried no data for ${String(idleTimeoutMs)} ms`));
      });
      req.on("socket", (socket) => {
        socket.setKeepAlive(true, keepAliveProbeDelayMs);
        if (!socket.connecting) return;
        connectTimer = setTimeout(() => {
          fail4(new UpstreamError("timeout", "ETIMEDOUT", `could not connect to the Anthropic API within ${String(connectTimeoutMs)} ms`));
        }, connectTimeoutMs);
        socket.once(tls ? "secureConnect" : "connect", () => clearTimeout(connectTimer));
      });
      req.once("finish", () => {
        writtenAt = Date.now();
      });
      req.on("error", (error) => {
        if (answered) return;
        answered = true;
        const reusedSocket = req.reusedSocket;
        const soonAfterWriting = writtenAt === null || Date.now() - writtenAt <= resendWindowMs;
        end();
        if (!retried && reusedSocket && soonAfterWriting && !signal.aborted && !closed && !(error instanceof UpstreamError) && RESET_CODES.has(errorCodeOf(error))) {
          resolve8(attempt(request2, true));
          return;
        }
        reject(toUpstreamError(error));
      });
      req.on("response", (res) => {
        if (answered) {
          res.destroy();
          return;
        }
        answered = true;
        response = res;
        let failure2 = null;
        res.on("error", (error) => {
          failure2 ??= toUpstreamError(error);
        });
        res.once("close", end);
        resolve8(answerOf(res, () => failure2));
      });
      req.end(request2.body);
    });
  }
  return {
    send(request2) {
      if (closed) return Promise.reject(new UpstreamError("network", "other", "the upstream client is closed"));
      return attempt(request2, false);
    },
    close() {
      closed = true;
      agent.destroy();
    }
  };
}
function abortedError() {
  return new UpstreamError("aborted", "ABORT_ERR", "the request to the Anthropic API was aborted");
}
function toUpstreamError(error) {
  if (error instanceof UpstreamError) return error;
  const code = errorCodeOf(error);
  return new UpstreamError("network", code, `the request to the Anthropic API failed (${code})`, { cause: error });
}
function answerOf(res, failure2) {
  const headers = [];
  const raw = res.rawHeaders;
  for (let index = 0; index + 1 < raw.length; index += 2) {
    headers.push([(raw[index] ?? "").toLowerCase(), raw[index + 1] ?? ""]);
  }
  return {
    status: res.statusCode ?? 0,
    headers,
    get(name) {
      const value = res.headers[name.toLowerCase()];
      if (value === void 0) return null;
      return Array.isArray(value) ? value.join(", ") : value;
    },
    body: res,
    discard() {
      if (res.readableEnded || res.destroyed) return;
      let bytes = 0;
      const timer = setTimeout(() => res.destroy(), DISCARD_TIMEOUT_MS);
      timer.unref();
      res.once("close", () => clearTimeout(timer));
      res.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > DISCARD_LIMIT_BYTES) res.destroy();
      });
      res.resume();
    },
    failure: failure2
  };
}
function forwardBody(answer2, res, signal) {
  const body = answer2.body;
  return new Promise((resolve8) => {
    let settled = false;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      body.off("data", onData);
      body.off("end", onEnd);
      res.off("drain", onDrain);
      res.off("finish", onFinish);
      res.off("close", onClose);
      signal.removeEventListener("abort", onAbort);
      stopWatching();
      resolve8(outcome);
    };
    const onData = (chunk) => {
      if (!res.write(chunk)) body.pause();
    };
    const onDrain = () => {
      body.resume();
    };
    const onEnd = () => {
      res.end();
    };
    const onFinish = () => settle("done");
    const onClose = () => {
      if (res.writableFinished) {
        settle("done");
        return;
      }
      settle("aborted");
      body.destroy();
    };
    const onAbort = () => {
      settle("aborted");
      body.destroy();
      res.destroy();
    };
    const stopWatching = (0, import_node_stream.finished)(body, (error) => {
      if (error === void 0 || error === null || settled) return;
      settle("failed");
      res.destroy();
    });
    if (signal.aborted) {
      onAbort();
      return;
    }
    if (res.destroyed) {
      onClose();
      return;
    }
    body.on("data", onData);
    body.once("end", onEnd);
    res.on("drain", onDrain);
    res.once("finish", onFinish);
    res.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
    body.resume();
  });
}

// src/daemon/proxy.ts
var MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024;
var TOO_LARGE_LINGER_MS = 5e3;
var MAX_KEPT_ANSWER_BYTES = 256 * 1024;
var KEPT_ANSWER_TIMEOUT_MS = 5e3;
var RENEWAL_WAIT_MS = 5e3;
var ClientGone = class extends Error {
};
function createProxy(options) {
  const { table, tokens, identity, poller, upstream, log, now } = options;
  const random = options.random ?? Math.random;
  const holdMs = options.hold?.holdMs ?? CAPACITY_HOLD_MS;
  const cooling = new CapacityCooling({ baseMs: options.hold?.baseMs ?? CAPACITY_HOLD_BASE_MS, maxMs: options.hold?.maxMs ?? CAPACITY_HOLD_MAX_MS });
  const maxBodyBytes = options.maxBodyBytes ?? MAX_REQUEST_BODY_BYTES;
  const renewalWaitMs = options.renewalWaitMs ?? RENEWAL_WAIT_MS;
  const lingerMs = options.tooLargeLingerMs ?? TOO_LARGE_LINGER_MS;
  const keptAnswerTimeoutMs = options.keptAnswerTimeoutMs ?? KEPT_ANSWER_TIMEOUT_MS;
  let open3 = 0;
  let drainWaiters = [];
  const finished2 = () => {
    open3--;
    if (open3 === 0) {
      const waiters = drainWaiters;
      drainWaiters = [];
      for (const resolve8 of waiters) resolve8();
    }
  };
  async function handle(req, res) {
    const info = readRouteRequest((name) => headerValue(req, name), table.plainClaudeLogin().id);
    if (!routeKeyMatches(info.key, options.key)) {
      log.write("proxy_rejected", { reason: "bad_secret", method: methodOf(req.method) });
      req.resume();
      res.writeHead(403).end();
      return;
    }
    const problem = headerProblem(info);
    if (problem !== null) {
      log.write("proxy_rejected", { reason: "invalid", method: methodOf(req.method) });
      req.resume();
      send(res, invalidRequest(problem));
      return;
    }
    open3++;
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) controller.abort(new ClientGone());
    };
    res.on("close", onClose);
    try {
      await route(req, res, info, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        if (!res.writableFinished) res.destroy();
      } else {
        log.write("internal_error", { code: errorCodeOf(error) });
        if (!res.headersSent) send(res, apiError(502, "The kurmis proxy failed to handle the request."));
        else res.destroy();
      }
    } finally {
      res.off("close", onClose);
      controller.abort();
      finished2();
    }
  }
  function headerProblem(info) {
    if (info.login === "invalid") return "The x-kurmis-login header is not a login id.";
    if (info.startedOn === "invalid") return 'The x-kurmis-started-on header is neither a login id nor "none".';
    if (info.login === null) return null;
    table.checkConfig();
    return table.find(info.login) === void 0 ? "The x-kurmis-login header does not name a login." : null;
  }
  function accountUuidOf(id) {
    const login = table.find(id);
    return login === void 0 ? null : identity.read(login)?.accountUuid ?? null;
  }
  async function route(req, res, info, signal) {
    const arrived = now();
    const read = await readBody2(req, maxBodyBytes, signal);
    if (read === "too-large") {
      log.write("proxy_rejected", { reason: "invalid", status: 413 });
      refuseTooLarge2(req, res, maxBodyBytes, lingerMs);
      return;
    }
    const body = read.length === 0 ? void 0 : read;
    if (body !== void 0 && !isJson(body)) {
      log.write("proxy_rejected", { reason: "invalid", status: 400 });
      send(res, invalidRequest("The request body is not JSON."));
      return;
    }
    table.checkConfig();
    const ownClaude = table.plainClaudeLogin().id;
    const sessionKey = info.sessionId !== null && isSessionId(info.sessionId) ? info.sessionId : NO_SESSION_KEY;
    let sentBack = info.login === null ? table.heldLogin(sessionKey) : null;
    let sentBackHere = false;
    let leftAnswer = null;
    const pinned = info.login ?? sentBack;
    const session = {
      homeAccountId: pinned ?? ownClaude,
      currentAccountId: table.sessionLogin(sessionKey),
      pinnedAccountId: pinned
    };
    const startedOn = info.startedOn;
    const callerAuthorization = headerValue(req, "authorization") ?? null;
    const rowsNow = () => table.routeRows(startedOn, callerAuthorization !== null, info.login);
    const attempted = /* @__PURE__ */ new Set();
    const excluded = /* @__PURE__ */ new Set();
    const refreshed = /* @__PURE__ */ new Set();
    const renewed = /* @__PURE__ */ new Set();
    const reread = /* @__PURE__ */ new Set();
    const refusals = [];
    let holdSince = cooling.coolingOf(sessionKey, now()) === null ? null : arrived;
    const renewable = (row) => !renewed.has(row.id) && tokens.read(row.id)?.hasRefreshToken === true;
    const endPinBack = () => {
      if (sentBack === null) return;
      table.releaseSession(sessionKey);
      sentBack = null;
      sentBackHere = false;
      session.pinnedAccountId = null;
      session.homeAccountId = ownClaude;
    };
    const pinBackEnds = (rows) => {
      if (sentBack === null) return false;
      if (excluded.has(sentBack)) return true;
      if (sentBackHere) return false;
      const row = rows.find((each) => each.id === sentBack);
      if (row === void 0) return true;
      const measured = {
        ...row,
        autoRoute: true,
        fiveHourLimitPercent: 100,
        weeklyLimitPercent: 100,
        ...renewable(row) ? { tokenExpiresAt: null } : {}
      };
      return routeBlock(measured, now()) !== null;
    };
    const pick = async () => {
      for (; ; ) {
        await abortable(tokens.prime(table.logins().map((login) => login.id)), signal);
        const rows = rowsNow();
        const stale = staleUsageLogins(session, rows, now(), /* @__PURE__ */ new Set([...refreshed, ...poller.recentStaleProbes()]));
        if (stale.length > 0) {
          for (const id of stale) refreshed.add(id);
          await abortable(poller.probeMany(stale, "stale"), signal);
          continue;
        }
        if (sentBack !== null && pinBackEnds(rows)) {
          log.write("session_hold_ended", { login: asLogin(sentBack) });
          endPinBack();
          continue;
        }
        const scope = new Set(accountsInScope(session, rows).map((row2) => row2.id));
        const blocked = /* @__PURE__ */ new Set([...excluded, ...cooling.waitFor(sessionKey, scope, now()).cooling]);
        const candidates = rows.map((row2) => renewable(row2) ? { ...row2, tokenExpiresAt: null } : row2);
        const chosen = chooseAccount(session, candidates, now(), blocked);
        if (chosen === null) return null;
        const row = rows.find((each) => each.id === chosen.id) ?? chosen;
        if (tokenIsFresh(row.tokenExpiresAt, now())) return row;
        if (!reread.has(row.id)) {
          reread.add(row.id);
          tokens.invalidate(row.id);
          await abortable(tokens.prime([row.id]), signal);
          continue;
        }
        if (!renewable(row)) {
          excluded.add(row.id);
          continue;
        }
        renewed.add(row.id);
        const elsewhere = effectivePin(session, rows) === null && chooseAccount(session, candidates, now(), /* @__PURE__ */ new Set([...blocked, row.id])) !== null;
        const renewal = poller.probe(row.id, "renewal");
        const finishedInTime = await abortable(elsewhere ? withTimeout(renewal, renewalWaitMs) : renewal.then(() => true), signal);
        if (!finishedInTime) excluded.add(row.id);
        tokens.invalidate(row.id);
      }
    };
    const place = (id) => {
      const placement = table.placeSession(sessionKey, id);
      const login = asLogin(id);
      if (placement.kind === "placed") log.write("session_placed", { login });
      else if (placement.kind === "moved") log.write("session_moved", { login, fromLogin: placement.from });
    };
    const giveHoldBack = () => {
      const heldMs = now() - (holdSince ?? arrived);
      const answer2 = capacityHoldAnswer(cooling.coolingOf(sessionKey, now())?.reason ?? "529 Overloaded", heldMs);
      log.write("request_failed", { reason: "overload", status: answer2.status, ms: heldMs });
      send(res, answer2);
    };
    for (; ; ) {
      signal.throwIfAborted();
      if (holdSince !== null && now() >= holdSince + holdMs) {
        giveHoldBack();
        return;
      }
      const row = await pick();
      if (row === null) {
        const rows = rowsNow();
        const scope = new Set(accountsInScope(session, rows).map((each) => each.id));
        const { wakeAt } = cooling.waitFor(sessionKey, scope, now());
        if (wakeAt !== null) {
          holdSince ??= arrived;
          await waitForPool(table, Math.min(wakeAt, holdSince + holdMs), now, signal);
          continue;
        }
        if (refusals.length === 0 && leftAnswer !== null) {
          log.write("request_forwarded", {
            login: asLogin(leftAnswer.login),
            method: methodOf(req.method),
            status: leftAnswer.status,
            ms: now() - arrived,
            attempt: attempted.size
          });
          res.writeHead(leftAnswer.status, downstreamResponseHeaders(leftAnswer.headers)).end(leftAnswer.body);
          return;
        }
        answerRefusal(res, session, rows, refusals, attempted, excluded, startedOn === null);
        return;
      }
      const token = tokens.read(row.id);
      const authorization = token !== null ? `Bearer ${token.accessToken}` : row.id === startedOn ? callerAuthorization : null;
      if (authorization === null) {
        excluded.add(row.id);
        continue;
      }
      const outgoing = upstreamRequest(req.headers, body, authorization, accountUuidOf(row.id));
      attempted.add(row.id);
      const holdLeft = holdSince === null ? null : holdSince + holdMs - now();
      const holdOver = new AbortController();
      const holdTimer = holdLeft === null ? null : setTimeout(() => {
        holdOver.abort();
      }, Math.max(0, holdLeft));
      const attemptSignal = holdLeft === null ? signal : AbortSignal.any([signal, holdOver.signal]);
      let answer2;
      try {
        answer2 = await upstream.send({
          method: req.method ?? "GET",
          path: req.url ?? "/",
          headers: outgoing.headers,
          ...outgoing.body === void 0 ? {} : { body: outgoing.body },
          signal: attemptSignal
        });
      } catch (error) {
        signal.throwIfAborted();
        if (holdOver.signal.aborted) {
          giveHoldBack();
          return;
        }
        const kind = error instanceof UpstreamError ? error.kind : "network";
        log.write("request_failed", { login: asLogin(row.id), reason: kind === "timeout" ? "timeout" : "network", code: errorCodeOf(error) });
        send(res, apiError(kind === "timeout" ? 504 : 502, kind === "timeout" ? "The kurmis proxy got no answer from Anthropic in time." : "The kurmis proxy could not reach Anthropic's API."));
        return;
      } finally {
        if (holdTimer !== null) clearTimeout(holdTimer);
      }
      const status2 = answer2.status;
      const get = (name) => answer2.get(name);
      noteUsage(row.id, get);
      const until = quotaCooldownUntil(status2, get);
      if (until !== null) {
        table.setCooldown(row.id, until);
        log.write("cooldown_started", { login: asLogin(row.id), ...Number.isFinite(until) ? { until } : {} });
      }
      if (status2 === 401 && token !== null) {
        tokens.invalidate(row.id);
        if (token.hasRefreshToken && !renewed.has(row.id)) {
          answer2.discard();
          renewed.add(row.id);
          log.write("retry_other_login", { login: asLogin(row.id), reason: "unauthorized", status: status2 });
          await abortable(poller.probe(row.id, "renewal"), signal);
          tokens.invalidate(row.id);
          attempted.delete(row.id);
          continue;
        }
        if (row.id !== startedOn && info.login === null) {
          answer2.discard();
          excluded.add(row.id);
          table.markRefused(row.id);
          log.write("retry_other_login", { login: asLogin(row.id), reason: "unauthorized", status: status2 });
          continue;
        }
      }
      const capacity = capacityRefusal(status2, isDefinitiveQuotaRejection(status2, get));
      if (capacity !== null) {
        answer2.discard();
        const note = cooling.noteNoCapacity(sessionKey, row.id, capacity, get("retry-after"), random(), now());
        holdSince ??= arrived;
        log.write("retry_after_backoff", { login: asLogin(row.id), reason: "overload", status: status2, attempt: note.attempt, ms: note.delayMs });
        continue;
      }
      cooling.noteAnswered(sessionKey);
      if (until !== null && sentBack !== null && row.id === sentBack) {
        log.write("session_hold_ended", { login: asLogin(sentBack), reason: "usage_limit" });
        endPinBack();
      }
      const decision = replayDecision({ status: status2, get, servedBy: row.id, session, attempted });
      if (decision.kind === "replay") {
        refusals.push({ login: row.id, until: decision.cooldownUntil, status: status2, headers: answer2.headers, body: await keepBody(answer2, signal, keptAnswerTimeoutMs) });
        excluded.add(row.id);
        log.write("retry_other_login", { login: asLogin(row.id), reason: "usage_limit", status: status2 });
        continue;
      }
      if (decision.kind === "pin-back") {
        leftAnswer = { login: row.id, until: Infinity, status: status2, headers: answer2.headers, body: await keepBody(answer2, signal, keptAnswerTimeoutMs) };
        excluded.add(row.id);
        session.pinnedAccountId = decision.to;
        session.homeAccountId = decision.to;
        sentBack = decision.to;
        sentBackHere = true;
        table.holdSession(sessionKey, decision.to);
        log.write("retry_other_login", { login: asLogin(decision.to), fromLogin: asLogin(row.id), reason: "pinned", status: status2 });
        continue;
      }
      if (status2 < 400) place(row.id);
      res.writeHead(status2, downstreamResponseHeaders(answer2.headers));
      res.flushHeaders();
      const result = await forwardBody(answer2, res, signal);
      log.write(result === "done" ? "request_forwarded" : "request_failed", {
        login: asLogin(row.id),
        method: methodOf(req.method),
        status: status2,
        ms: now() - arrived,
        ...result === "failed" ? { reason: "upstream_error" } : {},
        ...attempted.size > 1 ? { attempt: attempted.size } : {}
      });
      return;
    }
  }
  function noteUsage(id, get) {
    table.noteObservation(id, parseUnifiedHeaders(get, now()));
  }
  function answerRefusal(res, session, rows, refusals, attempted, excluded, cliOnOwnCredentials) {
    const fields = { count: attempted.size };
    if (refusals.length > 0) {
      const first = [...refusals].sort((a, b) => a.until - b.until)[0];
      const refused = new Set(refusals.map((refusal) => refusal.login));
      const pool = poolLimitAnswer(session, rows.filter((row) => !excluded.has(row.id) || refused.has(row.id)), now());
      if (pool.resetAt !== null && pool.resetAt < first.until) {
        log.write("pool_exhausted", { ...fields, reason: "usage_limit", status: pool.status, until: pool.resetAt });
        send(res, pool);
        return;
      }
      log.write("pool_exhausted", {
        ...fields,
        reason: "usage_limit",
        status: first.status,
        login: asLogin(first.login),
        ...Number.isFinite(first.until) ? { until: first.until } : {}
      });
      res.writeHead(first.status, downstreamResponseHeaders(first.headers)).end(first.body);
      return;
    }
    const answer2 = refusalAnswer(session, rows, now(), cliOnOwnCredentials);
    log.write("pool_exhausted", {
      ...fields,
      reason: answer2.kind === "no-signer" ? "no_credentials" : "usage_limit",
      status: answer2.status,
      ...answer2.resetAt === null ? {} : { until: answer2.resetAt }
    });
    send(res, answer2);
  }
  return {
    handle: (req, res) => handle(req, res).catch(() => {
      if (!res.writableFinished) res.destroy();
    }),
    openRequests: () => open3,
    drained: () => open3 === 0 ? Promise.resolve() : new Promise((resolve8) => {
      drainWaiters.push(resolve8);
    })
  };
}
function headerValue(req, name) {
  const value = req.headers[name.toLowerCase()];
  const text = Array.isArray(value) ? value[0] : value;
  return text === void 0 || text.length === 0 ? void 0 : text;
}
function isJson(bytes) {
  try {
    JSON.parse(bytes.toString("utf8"));
    return true;
  } catch {
    return false;
  }
}
function asLogin(id) {
  return isLoginId(id) ? id : void 0;
}
function send(res, answer2) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(answer2.status, answer2.headers).end(answer2.body);
}
function invalidRequest(message) {
  return {
    status: 400,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "error", error: { type: "invalid_request_error", message } })
  };
}
function apiError(status2, message) {
  return {
    status: status2,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "error", error: { type: "api_error", message } })
  };
}
function readBody2(req, max, signal) {
  return new Promise((resolve8, reject) => {
    const chunks = [];
    let size = 0;
    const settle = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("close", onClose);
      signal.removeEventListener("abort", onAbort);
    };
    const onData = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > max) {
        settle();
        chunks.length = 0;
        resolve8("too-large");
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = () => {
      settle();
      resolve8(Buffer.concat(chunks));
    };
    const onError = (error) => {
      settle();
      reject(error);
    };
    const onClose = () => {
      settle();
      reject(new Error("the request ended before its body was complete"));
    };
    const onAbort = () => {
      settle();
      reject(signal.reason);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", onError);
    req.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
function refuseTooLarge2(req, res, max, lingerMs) {
  if (res.headersSent || res.destroyed) return;
  const socket = req.socket;
  req.resume();
  res.once("finish", () => {
    socket.end();
    const timer = setTimeout(() => {
      socket.destroy();
    }, lingerMs);
    timer.unref();
    socket.once("close", () => {
      clearTimeout(timer);
    });
  });
  res.writeHead(413, { "content-type": "application/json" }).end(JSON.stringify({
    type: "error",
    error: { type: "request_too_large", message: `The request body is larger than the ${String(Math.round(max / 1024 / 1024))} MB the kurmis proxy takes.` }
  }));
}
async function keepBody(answer2, signal, timeoutMs) {
  const chunks = [];
  let size = 0;
  const body = answer2.body;
  const timer = setTimeout(() => {
    body.destroy();
  }, timeoutMs);
  const onAbort = () => {
    body.destroy();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for await (const chunk of body) {
      signal.throwIfAborted();
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (size + bytes.length > MAX_KEPT_ANSWER_BYTES) {
        answer2.discard();
        break;
      }
      chunks.push(bytes);
      size += bytes.length;
    }
  } catch {
    signal.throwIfAborted();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
  signal.throwIfAborted();
  return Buffer.concat(chunks);
}
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve8, reject) => {
    const aborted = () => {
      reject(signal.reason);
    };
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve8(value);
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      }
    );
  });
}
function withTimeout(promise, ms) {
  return new Promise((resolve8) => {
    const timer = setTimeout(() => {
      resolve8(false);
    }, ms);
    void promise.finally(() => {
      clearTimeout(timer);
      resolve8(true);
    });
  });
}
function waitForPool(table, until, now, signal) {
  return new Promise((resolve8, reject) => {
    const settle = () => {
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener("abort", aborted);
    };
    const woken = () => {
      settle();
      resolve8();
    };
    const aborted = () => {
      settle();
      reject(signal.reason);
    };
    const timer = setTimeout(woken, Math.max(0, until - now()));
    const unsubscribe = table.onChange(woken);
    if (signal.aborted) aborted();
    else signal.addEventListener("abort", aborted, { once: true });
  });
}

// src/daemon/tokens.ts
var import_node_fs15 = require("node:fs");
var import_node_os10 = require("node:os");
var import_node_path15 = require("node:path");

// src/daemon/credentials.ts
var import_node_fs14 = require("node:fs");
var import_node_path14 = require("node:path");

// src/core/credentials.ts
function parseCredentials(text) {
  try {
    const parsed = JSON.parse(text);
    const oauth = parsed?.claudeAiOauth;
    if (typeof oauth?.accessToken !== "string" || oauth.accessToken.trim().length === 0) return null;
    return {
      accessToken: oauth.accessToken,
      expiresAt: typeof oauth.expiresAt === "number" && Number.isFinite(oauth.expiresAt) ? oauth.expiresAt : null,
      hasRefreshToken: typeof oauth.refreshToken === "string" && oauth.refreshToken.trim().length > 0
    };
  } catch {
    return null;
  }
}

// src/daemon/credentials.ts
var CREDENTIALS_FILE_NAME = ".credentials.json";
var CredentialsFileReader = class {
  constructor(options) {
    this.options = options;
  }
  options;
  cache = /* @__PURE__ */ new Map();
  read(id) {
    const path = this.pathOf(id);
    try {
      const stat = (0, import_node_fs14.statSync)(path);
      const cached = this.cache.get(path);
      if (cached?.mtime === stat.mtimeMs && cached.size === stat.size) return cached.value;
      let value = null;
      try {
        value = parseCredentials((0, import_node_fs14.readFileSync)(path, "utf8"));
      } catch {
      }
      this.cache.set(path, { mtime: stat.mtimeMs, size: stat.size, value });
      return value;
    } catch {
      this.cache.delete(path);
      return null;
    }
  }
  /** Nothing to do: `read` reads the file itself. */
  prime(_ids) {
    return Promise.resolve();
  }
  invalidate(id) {
    this.cache.delete(this.pathOf(id));
  }
  clear() {
    this.cache.clear();
  }
  pathOf(id) {
    return (0, import_node_path14.join)(this.options.credentialsDir(id), CREDENTIALS_FILE_NAME);
  }
};

// src/platform/windows-credentials.ts
var import_node_os9 = require("node:os");

// src/core/keychain-service.ts
var import_node_crypto8 = require("node:crypto");
var KEYCHAIN_SERVICE_BASE = "Claude Code-credentials";
function keychainService(secureStorageDir) {
  if (secureStorageDir === null || secureStorageDir.length === 0) return KEYCHAIN_SERVICE_BASE;
  const digest = (0, import_node_crypto8.createHash)("sha256").update(secureStorageDir.normalize("NFC")).digest("hex");
  return `${KEYCHAIN_SERVICE_BASE}-${digest.slice(0, 8)}`;
}

// src/platform/windows-credentials.ts
function powerShellQuote(text) {
  return `'${text.replace(/['\u2018\u2019\u201a\u201b]/g, (quote) => quote + quote)}'`;
}
function powerShellInvocation(script, env) {
  return {
    program: systemProgram("powershell", env),
    args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")]
  };
}
var CREDENTIAL_USER_NAME = "claude-code-user";
var CHUNK_CHARS = 2400;
var MAX_CHUNKS = 256;
var CREDENTIAL_READ_TIMEOUT_MS = 2e4;
var MAX_ENCODED_COMMAND_CHARS = 3e4;
function credentialFilter(secureStorageDir) {
  return `${keychainService(secureStorageDir)}/*`;
}
function credEnumScript(filters, blobs = true) {
  return [
    "$ErrorActionPreference='Stop'",
    "$ProgressPreference='SilentlyContinue'",
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Text;",
    "using System.Runtime.InteropServices;",
    "public static class KurmisCredEnum {",
    "  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]",
    "  private struct CREDENTIAL {",
    "    public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;",
    "    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;",
    "    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;",
    "    public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;",
    "  }",
    '  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
    "  private static extern bool CredEnumerateW(string filter, int flags, out int count, out IntPtr credentials);",
    '  [DllImport("advapi32.dll")]',
    "  private static extern void CredFree(IntPtr buffer);",
    "  public static string[] List(string filter, bool blobs) {",
    "    int count; IntPtr p;",
    "    if (!CredEnumerateW(filter, 0, out count, out p)) {",
    "      int e = Marshal.GetLastWin32Error();",
    '      return new string[] { e == 1168 ? ". 0" : "! " + e };',
    "    }",
    "    try {",
    "      string[] lines = new string[count + 1];",
    "      int found = 0;",
    "      for (int i = 0; i < count; i++) {",
    "        CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(Marshal.ReadIntPtr(p, i * IntPtr.Size), typeof(CREDENTIAL));",
    "        if (c.Type != 1) continue;",
    '        string line = "+ " + Convert.ToBase64String(Encoding.UTF8.GetBytes(Marshal.PtrToStringUni(c.TargetName)));',
    "        if (!blobs) { lines[found++] = line; continue; }",
    "        byte[] b = new byte[c.CredentialBlobSize];",
    "        if (c.CredentialBlobSize > 0) Marshal.Copy(c.CredentialBlob, b, 0, c.CredentialBlobSize);",
    '        lines[found++] = line + " " + Convert.ToBase64String(b);',
    "      }",
    '      lines[found] = ". " + found;',
    "      string[] output = new string[found + 1];",
    "      Array.Copy(lines, output, found + 1);",
    "      return output;",
    "    } finally { CredFree(p); }",
    "  }",
    "}",
    "'@",
    `$filters=@(${filters.map(powerShellQuote).join(",")})`,
    `for($i=0;$i -lt $filters.Count;$i++){foreach($line in [KurmisCredEnum]::List($filters[$i],${blobs ? "$true" : "$false"})){Write-Output ("$i "+$line)}}`
  ].join("\n");
}
function parseCredEnumOutput(stdout, count) {
  const items = Array.from({ length: count }, () => /* @__PURE__ */ new Map());
  const answers = new Array(count);
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(\d+) (?:\+ ([A-Za-z0-9+/=]+)(?: ([A-Za-z0-9+/=]*))?|\. (\d+)|! (\d+))$/.exec(line.trim());
    if (match === null) continue;
    const index = Number(match[1]);
    const mine = items[index];
    if (mine === void 0 || answers[index] !== void 0) continue;
    if (match[2] !== void 0) mine.set(Buffer.from(match[2], "base64").toString("utf8"), Buffer.from(match[3] ?? "", "base64"));
    else if (match[4] !== void 0) answers[index] = Number(match[4]) === mine.size ? { kind: "items", items: mine } : void 0;
    else answers[index] = { kind: "error", code: Number(match[5]) };
  }
  const all = [];
  for (const answer2 of answers) {
    if (answer2 === void 0) return null;
    all.push(answer2);
  }
  return all.length === count ? all : null;
}
function encodedLength(filters) {
  return Math.ceil(Buffer.byteLength(credEnumScript(filters), "utf16le") / 3) * 4;
}
function credentialBatches(filters, maxChars = MAX_ENCODED_COMMAND_CHARS) {
  const batches = [];
  let batch = [];
  for (const filter of filters) {
    if (batch.length > 0 && encodedLength([...batch, filter]) > maxChars) {
      batches.push(batch);
      batch = [];
    }
    batch.push(filter);
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}
function failureOf2(result) {
  if (result.error !== null) return result.error;
  const said = result.stderr.replace(/\s+/g, " ").trim();
  return `PowerShell exited with code ${String(result.code)}${said === "" ? "" : `: ${said.slice(0, 300)}`}`;
}
function powerShellCredentialRead(env, run2 = runProgram, blobs = true) {
  return async (filters) => {
    const all = [];
    for (const batch of credentialBatches(filters)) {
      const { program, args } = powerShellInvocation(credEnumScript(batch, blobs), env);
      const result = await run2(program, args, { timeoutMs: CREDENTIAL_READ_TIMEOUT_MS, env, maxOutputBytes: 16 * 1024 * 1024 });
      if (result.code !== 0 || result.error !== null) throw new Error(failureOf2(result));
      const answers = parseCredEnumOutput(result.stdout, batch.length);
      if (answers === null) throw new Error("PowerShell did not answer for every login");
      all.push(...answers);
    }
    return all;
  };
}
function preferredAccounts(env = process.env, userName = () => (0, import_node_os9.userInfo)().username) {
  let name;
  try {
    name = env.USER || userName();
  } catch {
    name = CREDENTIAL_USER_NAME;
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) name = CREDENTIAL_USER_NAME;
  return [.../* @__PURE__ */ new Set([name, CREDENTIAL_USER_NAME])];
}
function byAccount(service, items) {
  const prefix = `${service}/`.toLowerCase();
  const accounts = /* @__PURE__ */ new Map();
  for (const [name, blob] of items) {
    if (!name.toLowerCase().startsWith(prefix)) continue;
    const match = /^(.*?)(#m|#\d+)?$/.exec(name.slice(prefix.length));
    const account = (match?.[1] ?? "").toLowerCase();
    const suffix = match?.[2] ?? "";
    let entries = accounts.get(account);
    if (entries === void 0) accounts.set(account, entries = /* @__PURE__ */ new Map());
    entries.set(suffix, blob);
  }
  return accounts;
}
function chooseAccount2(accounts, preferred) {
  const lower = accounts.map((account) => account.toLowerCase());
  for (const name of preferred) if (lower.includes(name.toLowerCase())) return name.toLowerCase();
  return lower.length === 1 ? lower[0] ?? null : null;
}
function chunkCount(blob) {
  if (blob === void 0) return null;
  let value;
  try {
    value = JSON.parse(blob.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { n, l } = value;
  if (typeof n !== "number" || typeof l !== "number" || !Number.isInteger(n) || !Number.isInteger(l)) return null;
  return n > 0 && n <= MAX_CHUNKS && l > 0 && l <= n * CHUNK_CHARS ? { n, l } : null;
}
function recordFromItems(service, items, preferred) {
  const accounts = byAccount(service, items);
  if (accounts.size === 0) return { kind: "missing" };
  const account = chooseAccount2([...accounts.keys()], preferred);
  if (account === null) return { kind: "failed", reason: "Credential Manager has records under several account names, and none is the expected one" };
  const entries = accounts.get(account) ?? /* @__PURE__ */ new Map();
  const count = chunkCount(entries.get("#m"));
  if (count === null) {
    const plain = entries.get("");
    return plain === void 0 ? { kind: "missing" } : { kind: "found", text: plain.toString("utf8") };
  }
  const slices = [];
  for (let i = 0; i < count.n; i++) {
    const slice = entries.get(`#${String(i)}`);
    if (slice === void 0) return { kind: "failed", reason: "a slice of the chunked record is missing" };
    slices.push(slice.toString("utf8"));
  }
  const joined = slices.join("");
  return joined.length === count.l ? { kind: "found", text: Buffer.from(joined, "base64").toString("utf8") } : { kind: "failed", reason: "the slices of the chunked record do not add up to its length" };
}
async function readStoredRecords(secureStorageDirs, read, preferred = preferredAccounts()) {
  const filters = [...new Set(secureStorageDirs.map(credentialFilter))];
  const answers = await read(filters);
  return secureStorageDirs.map((dir) => {
    const answer2 = answers[filters.indexOf(credentialFilter(dir))];
    if (answer2 === void 0) return { kind: "failed", reason: "PowerShell did not answer for this login" };
    if (answer2.kind === "error") return { kind: "failed", reason: `CredEnumerateW failed with Win32 error ${String(answer2.code)}` };
    return recordFromItems(keychainService(dir), answer2.items, preferred);
  });
}
async function holdsStoredRecord(secureStorageDir, env, platform = process.platform, read = powerShellCredentialRead(env)) {
  if (platform !== "win32") return false;
  try {
    const [record] = await readStoredRecords([secureStorageDir], read);
    return record?.kind === "found";
  } catch {
    return false;
  }
}
async function storedRecordsExist(secureStorageDirs, read, preferred = preferredAccounts()) {
  const filters = [...new Set(secureStorageDirs.map(credentialFilter))];
  let answers;
  try {
    answers = await read(filters);
  } catch {
    return secureStorageDirs.map(() => "unknown");
  }
  return secureStorageDirs.map((dir) => {
    const answer2 = answers[filters.indexOf(credentialFilter(dir))];
    if (answer2 === void 0 || answer2.kind === "error") return "unknown";
    const accounts = [...byAccount(keychainService(dir), answer2.items).keys()];
    if (accounts.length === 0) return false;
    return chooseAccount2(accounts, preferred) === null ? "unknown" : true;
  });
}

// src/daemon/keychain.ts
var KEYCHAIN_CACHE_MS = 6e4;
var KEYCHAIN_READ_TIMEOUT_MS = 3e3;
var MAX_OUTPUT_BYTES = 256 * 1024;
var MAX_REASON_CHARS = 500;
function keychainHoldsSecret(platform = process.platform) {
  return platform === "darwin";
}
var KeychainReadError = class extends Error {
  constructor(reason, code, timedOut = false, outputTooLarge = false) {
    super(reason);
    this.reason = reason;
    this.code = code;
    this.timedOut = timedOut;
    this.outputTooLarge = outputTooLarge;
  }
  reason;
  code;
  timedOut;
  outputTooLarge;
};
var NO_SUCH_ITEM_EXIT_CODE = 44;
var KEYCHAIN_NOT_ALLOWED_EXIT_CODE = 36;
async function readKeychainItem(securityProgram, service, timeoutMs = KEYCHAIN_READ_TIMEOUT_MS) {
  const result = await runProgram(
    securityProgram,
    ["find-generic-password", "-w", "-s", service],
    { timeoutMs, maxOutputBytes: MAX_OUTPUT_BYTES }
  );
  const failure2 = failureOf3(result, timeoutMs);
  if (failure2 !== null) throw new KeychainReadError(failure2, result.code, result.timedOut, result.outputTooLarge);
  return result.stdout.trim().length === 0 ? null : result.stdout;
}
function failureOf3(result, timeoutMs) {
  if (result.timedOut) return `it did not answer within ${seconds2(timeoutMs)} seconds`;
  if (result.outputTooLarge) return `it printed more than ${String(MAX_OUTPUT_BYTES)} bytes, which is not a credentials record`;
  if (result.error !== null) return result.error;
  if (result.code === 0) return null;
  const said = result.stderr.trim();
  return said.length > 0 ? said.slice(0, MAX_REASON_CHARS) : "it printed nothing on stderr";
}
function seconds2(ms) {
  return String(ms / 1e3);
}
var KeychainCredentialsReader = class {
  constructor(options) {
    this.options = options;
  }
  options;
  cache = /* @__PURE__ */ new Map();
  /** The read of each login going on now, with the `invalidations` count it started under. */
  reading = /* @__PURE__ */ new Map();
  /** How often each login was invalidated. */
  invalidations = /* @__PURE__ */ new Map();
  /** The logins whose failed read has been logged, until a read of one works. */
  failureLogged = /* @__PURE__ */ new Set();
  /**
   * The items whose read was killed at its deadline. A `security` that does not answer is most
   * likely showing a Keychain dialog that nobody is there to answer, and reading the item again
   * would show another one, so none of these is read again by this reader. Neither `invalidate`
   * nor `clear` empties it.
   */
  unanswered = /* @__PURE__ */ new Set();
  read(id) {
    return this.cache.get(id)?.value ?? null;
  }
  async prime(ids) {
    await Promise.all([...new Set(ids)].map((id) => this.refresh(id)));
  }
  invalidate(id) {
    this.invalidations.set(id, this.invalidatedCount(id) + 1);
    const cached = this.cache.get(id);
    if (cached !== void 0) this.cache.set(id, { ...cached, readAt: Number.NEGATIVE_INFINITY });
  }
  clear() {
    this.cache.clear();
    for (const id of this.reading.keys()) this.invalidations.set(id, this.invalidatedCount(id) + 1);
  }
  /**
   * One read per login at a time; a second caller waits for the one already running. A read
   * that started before the latest `invalidate` is waited for and then followed by a new one.
   */
  refresh(id) {
    const cached = this.cache.get(id);
    if (cached && this.now() - cached.readAt < KEYCHAIN_CACHE_MS) return Promise.resolve();
    const invalidated = this.invalidatedCount(id);
    const running = this.reading.get(id);
    if (running !== void 0) {
      return running.invalidated === invalidated ? running.promise : running.promise.then(() => this.refresh(id));
    }
    const promise = this.load(id, invalidated).finally(() => {
      this.reading.delete(id);
    });
    this.reading.set(id, { promise, invalidated });
    return promise;
  }
  invalidatedCount(id) {
    return this.invalidations.get(id) ?? 0;
  }
  async load(id, invalidated) {
    const timeoutMs = this.options.readTimeoutMs ?? KEYCHAIN_READ_TIMEOUT_MS;
    const run2 = this.options.run ?? ((service2) => readKeychainItem(this.options.securityProgram, service2, timeoutMs));
    const service = keychainService(this.options.accounts.secureStorageDir(id));
    const keep = (value2) => {
      if (this.invalidatedCount(id) !== invalidated) return false;
      this.cache.set(id, { readAt: this.now(), value: value2 });
      return true;
    };
    if (this.unanswered.has(service)) {
      keep(null);
      return;
    }
    let value = null;
    let failure2 = null;
    try {
      const secret = await run2(service);
      value = secret === null ? null : parseCredentials(secret);
      if (secret === null) failure2 = { text: "the item is empty", kind: "empty", code: null };
      else if (value === null) failure2 = { text: "the item holds no OAuth token", kind: "not_credentials", code: null };
    } catch (error) {
      if (error instanceof KeychainReadError && error.timedOut) {
        this.unanswered.add(service);
        keep(null);
        this.options.log?.(`reading login ${id} from the Keychain item "${service}" did not answer within ${seconds2(timeoutMs)} seconds, so the proxy holds no token for it, and this daemon will not read that item again until it restarts. A read that waits is usually a Keychain dialog: either a program other than the Claude CLI created the item or changed its access list, so /usr/bin/security may read it only after somebody allows it, or the login Keychain is locked. Reading again would put up another dialog.`);
        this.options.onFailure?.({ id, kind: "timeout", code: null });
        return;
      }
      if (!(error instanceof KeychainReadError && error.code === NO_SUCH_ITEM_EXIT_CODE)) {
        failure2 = error instanceof KeychainReadError ? {
          text: `${error.code === null ? "no exit code" : `exit ${String(error.code)}`}: ${error.reason}`,
          kind: failureKindOf(error),
          code: error.code
        } : { text: `it threw: ${error instanceof Error ? error.message : String(error)}`, kind: "failed", code: null };
      }
    }
    if (!keep(value)) return;
    if (failure2 === null) {
      this.failureLogged.delete(id);
    } else if (!this.failureLogged.has(id)) {
      this.failureLogged.add(id);
      this.options.log?.(`reading login ${id} from the Keychain item "${service}" failed, so the proxy holds no token for it (${failure2.text})`);
      this.options.onFailure?.({ id, kind: failure2.kind, code: failure2.code });
    }
  }
  now() {
    return this.options.now?.() ?? Date.now();
  }
};
function failureKindOf(error) {
  if (error.outputTooLarge) return "too_large";
  if (error.code === KEYCHAIN_NOT_ALLOWED_EXIT_CODE) return "not_allowed";
  if (error.code === null) return "not_run";
  return "failed";
}

// src/daemon/credential-manager.ts
var FILE_LOGIN_RECHECK_MS = 15 * 6e4;
function retryDelayMs(failures) {
  return Math.min(KEYCHAIN_CACHE_MS * 2 ** Math.max(0, failures - 1), FILE_LOGIN_RECHECK_MS);
}
var CredentialManagerReader = class {
  constructor(options) {
    this.options = options;
  }
  options;
  entries = /* @__PURE__ */ new Map();
  /** The logins whose last read that worked found their record here. */
  found = /* @__PURE__ */ new Set();
  /** The logins invalidated since their last read settled. */
  pending = /* @__PURE__ */ new Set();
  /** How often each login was invalidated; a read started before the latest one is not used. */
  invalidations = /* @__PURE__ */ new Map();
  /** How often `clear` ran; a read started before it is not used either. */
  clears = 0;
  failureLogged = /* @__PURE__ */ new Set();
  running = null;
  read(id) {
    return this.entries.get(id)?.value ?? null;
  }
  /** Whether the last read of the login that worked found its record in Credential Manager. */
  holds(id) {
    return this.found.has(id);
  }
  async prime(ids) {
    const wanted = [...new Set(ids)];
    const waitFor = wanted.filter((id) => this.found.has(id) || !this.options.fileExists(id));
    const unread = () => waitFor.some((id) => !this.entries.has(id) || this.pending.has(id));
    for (; ; ) {
      if (this.running !== null) {
        if (!unread()) return;
        await this.running;
        continue;
      }
      const due = wanted.filter((id) => this.isDue(id));
      if (due.length === 0) return;
      const run2 = this.load(due).finally(() => {
        if (this.running === run2) this.running = null;
      });
      this.running = run2;
      if (!unread()) return;
      await run2;
    }
  }
  /**
   * Has the next `prime` read the login again and wait for it where it waits for the login at
   * all. `read` goes on answering the old token until then.
   */
  invalidate(id) {
    this.invalidations.set(id, (this.invalidations.get(id) ?? 0) + 1);
    this.pending.add(id);
  }
  /**
   * Has the next `prime` read the login again in the background. A login whose last read
   * failed, or whose file exists and whose last read found no record here, keeps its longer wait.
   */
  markStale(id) {
    const entry = this.entries.get(id);
    if (entry !== void 0) entry.stale = true;
  }
  clear() {
    this.clears++;
    this.entries.clear();
    this.found.clear();
    this.pending.clear();
  }
  isDue(id) {
    const entry = this.entries.get(id);
    if (entry === void 0 || this.pending.has(id)) return true;
    const age = this.now() - entry.readAt;
    if (entry.failures > 0) return age >= retryDelayMs(entry.failures);
    if (!this.found.has(id) && this.options.fileExists(id)) return age >= FILE_LOGIN_RECHECK_MS;
    return entry.stale || age >= KEYCHAIN_CACHE_MS;
  }
  async load(ids) {
    const clears = this.clears;
    const started = new Map(ids.map((id) => [id, this.invalidations.get(id) ?? 0]));
    const settle = (id, outcome) => {
      if (this.clears === clears && (this.invalidations.get(id) ?? 0) === started.get(id)) this.settle(id, outcome);
    };
    let records;
    try {
      records = await readStoredRecords(ids.map((id) => this.options.secureStorageDir(id)), this.options.read, this.options.accounts);
    } catch {
      for (const id of ids) settle(id, { kind: "failed", failure: "not_run" });
      return;
    }
    ids.forEach((id, index) => {
      const record = records[index];
      if (record === void 0 || record.kind === "missing") settle(id, { kind: "missing" });
      else if (record.kind === "failed") settle(id, { kind: "failed", failure: "failed" });
      else {
        const value = parseCredentials(record.text);
        settle(id, value === null ? { kind: "failed", failure: "not_credentials" } : { kind: "found", value });
      }
    });
  }
  settle(id, outcome) {
    this.pending.delete(id);
    const before = this.entries.get(id);
    const readAt = this.now();
    if (outcome.kind !== "failed") {
      this.entries.set(id, { value: outcome.kind === "found" ? outcome.value : null, readAt, failures: 0, stale: false });
      if (outcome.kind === "found") this.found.add(id);
      else this.found.delete(id);
      this.failureLogged.delete(id);
      return;
    }
    this.entries.set(id, { value: before?.value ?? null, readAt, failures: (before?.failures ?? 0) + 1, stale: false });
    if (!this.failureLogged.has(id) && (this.found.has(id) || !this.options.fileExists(id))) {
      this.failureLogged.add(id);
      this.options.onFailure?.({ id, kind: outcome.failure });
    }
  }
  now() {
    return this.options.now?.() ?? Date.now();
  }
};

// src/daemon/tokens.ts
function probeEnvironment(tokens, id, env) {
  return tokens.inCredentialManager(id) ? { ...env, [FORCE_CREDENTIAL_MANAGER_VARIABLE]: "1" } : env;
}
function securityProgramOf(env, processEnv = process.env) {
  return systemProgram("security", env, processEnv);
}
function claudeSecureStorageDir(login) {
  return login.usedByPlainClaude ? null : loginFolder(login);
}
function claudeCredentialsDir(login, home) {
  return login.usedByPlainClaude ? (0, import_node_path15.join)(home, ".claude") : loginFolder(login);
}
function createTokenSource(options) {
  const home = options.home ?? import_node_os10.homedir;
  const known = /* @__PURE__ */ new Map();
  const loginOf = (id) => {
    const seen = known.get(id);
    if (seen !== void 0) return seen;
    const found = isLoginId(id) ? options.login(id) : void 0;
    if (found === void 0 || found.id !== id) return null;
    const login = { id: found.id, usedByPlainClaude: found.usedByPlainClaude };
    known.set(id, login);
    return login;
  };
  const isKnownLogin = (id) => loginOf(id) !== null;
  const checked = (id) => {
    const login = loginOf(id);
    if (login === null) throw new Error(`${id} is not the id of a login in the config.`);
    return login;
  };
  const file = new CredentialsFileReader({ credentialsDir: (id) => claudeCredentialsDir(checked(id), home()) });
  const credentialManager = (options.platform ?? process.platform) === "win32" ? new CredentialManagerReader({
    secureStorageDir: (id) => claudeSecureStorageDir(checked(id)),
    fileExists: (id) => (0, import_node_fs15.existsSync)((0, import_node_path15.join)(claudeCredentialsDir(checked(id), home()), CREDENTIALS_FILE_NAME)),
    read: options.credentialRead ?? powerShellCredentialRead(options.env),
    now: options.now,
    onFailure: (failure2) => {
      const login = loginOf(failure2.id);
      if (login !== null) options.log?.write("token_read_failed", { login: login.id, reason: credentialManagerReasonOf(failure2.kind) });
    }
  }) : null;
  const keychain = keychainHoldsSecret(options.platform ?? process.platform) ? new KeychainCredentialsReader({
    accounts: { secureStorageDir: (id) => claudeSecureStorageDir(checked(id)) },
    securityProgram: securityProgramOf(options.env),
    readTimeoutMs: options.keychainReadTimeoutMs,
    now: options.now,
    onFailure: (failure2) => {
      const login = loginOf(failure2.id);
      if (login !== null) options.log?.write("token_read_failed", { login: login.id, reason: logReasonOf(failure2.kind) });
    }
  }) : null;
  return {
    keychain: keychain !== null,
    read(id) {
      if (!isKnownLogin(id)) return null;
      return credentialManager?.read(id) ?? keychain?.read(id) ?? file.read(id);
    },
    async prime(ids) {
      const inConfig = ids.filter(isKnownLogin);
      await Promise.all([keychain?.prime(inConfig), credentialManager?.prime(inConfig)]);
    },
    invalidate(id) {
      if (!isKnownLogin(id)) return;
      keychain?.invalidate(id);
      credentialManager?.invalidate(id);
      file.invalidate(id);
    },
    markStale(id) {
      if (!isKnownLogin(id)) return;
      keychain?.invalidate(id);
      credentialManager?.markStale(id);
      file.invalidate(id);
    },
    inCredentialManager(id) {
      return isKnownLogin(id) && credentialManager !== null && credentialManager.holds(id);
    },
    clear() {
      keychain?.clear();
      credentialManager?.clear();
      file.clear();
    }
  };
}
function logReasonOf(kind) {
  switch (kind) {
    case "timeout":
      return "timeout";
    case "not_allowed":
      return "not_allowed";
    case "empty":
    case "not_credentials":
    case "too_large":
      return "invalid";
    case "not_run":
    case "failed":
      return "other";
  }
}
function credentialManagerReasonOf(kind) {
  return kind === "not_credentials" ? "invalid" : "other";
}

// src/daemon/usage-poller.ts
var POLL_INTERVAL_MS = 15 * 6e4;
var STALE_PROBE_INTERVAL_MS = 6e4;
var UsagePoller = class {
  constructor(options) {
    this.options = options;
  }
  options;
  running = /* @__PURE__ */ new Map();
  /** When each login was last asked for a probe because its reading was stale. */
  staleProbedAt = /* @__PURE__ */ new Map();
  controller = new AbortController();
  timer = null;
  closed = false;
  pollStopped = false;
  /** Probes every login once, then every signed-in login each `intervalMs`. */
  start() {
    if (this.closed || this.pollStopped || this.timer !== null) return;
    void this.probeMany(this.options.table.logins().map((login) => login.id), "start");
    this.timer = setInterval(() => {
      void this.probeMany(this.pollable(), "poll");
    }, this.options.intervalMs ?? POLL_INTERVAL_MS);
    this.timer.unref?.();
  }
  /**
   * Stops the timer of the poll, for a daemon that is stopping. Running probes and probes asked
   * for later still run.
   */
  stopPolling() {
    this.pollStopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
  /**
   * Stops the timer, kills the probes that are running and resolves once they have ended. A
   * probe ends only after its process has exited, so after this no probe's process holds the
   * data folder open: on Windows a running process's working folder or open file cannot be
   * deleted.
   */
  async close() {
    this.closed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.controller.abort();
    await Promise.all(this.running.values());
  }
  /** Whether a probe of this login is running now. */
  isRunning(id) {
    return this.running.has(id);
  }
  /**
   * The logins a poll or a probe request without a list covers: every one signed in, and every
   * one not probed yet. A login whose last probe found it signed out is left out until a token
   * appears for it or the config changes.
   */
  pollable() {
    return this.options.table.logins().filter((login) => this.signedInOrUnknown(login)).map((login) => login.id);
  }
  /**
   * The logins a probe for a stale reading was asked for within the last
   * `STALE_PROBE_INTERVAL_MS`, whether that probe succeeded or not.
   */
  recentStaleProbes() {
    const since = this.options.now() - (this.options.staleProbeIntervalMs ?? STALE_PROBE_INTERVAL_MS);
    const recent = /* @__PURE__ */ new Set();
    for (const [id, at] of this.staleProbedAt) {
      if (at > since) recent.add(id);
      else this.staleProbedAt.delete(id);
    }
    return recent;
  }
  /** Probes these logins, each once at a time, and resolves when all have finished. Never rejects. */
  async probeMany(ids, cause) {
    await Promise.all([...new Set(ids)].map((id) => this.probe(id, cause)));
  }
  /**
   * Probes one login. A probe of it that is already running is waited for rather than started
   * again. Never rejects.
   */
  probe(id, cause) {
    if (cause === "stale") this.staleProbedAt.set(id, this.options.now());
    const running = this.running.get(id);
    if (running !== void 0) return running;
    if (this.closed) return Promise.resolve();
    const login = this.options.table.find(id);
    if (login === void 0) return Promise.resolve();
    const started = this.run(login, cause).finally(() => {
      this.running.delete(id);
    });
    this.running.set(id, started);
    return started;
  }
  signedInOrUnknown(login) {
    return this.options.table.claudeSignedIn(login.id) !== false;
  }
  async run(login, cause) {
    const { table, log, now } = this.options;
    const id = login.id;
    const startedAt = now();
    log.write(cause === "renewal" ? "token_renewal_started" : "usage_probe_started", { login: id });
    const ref = { id, usedByPlainClaude: login.usedByPlainClaude };
    let answer2;
    try {
      answer2 = await this.options.probeClaude(ref, { env: this.options.env, now, signal: this.controller.signal, previous: table.usage(id) });
    } catch {
      answer2 = { ok: false, signedIn: null, reason: "other", error: "The usage probe failed unexpectedly." };
    }
    if (this.closed) return;
    if (cause === "renewal") this.options.tokens.invalidate(id);
    else this.options.tokens.markStale(id);
    const ms = now() - startedAt;
    if (answer2.ok) {
      table.setProbeUsage(id, answer2.usage, startedAt);
      table.setSignedIn(id, answer2.signedIn);
      if (answer2.signedIn) table.clearRefused(id, startedAt);
      const before = table.cooldown(id);
      const setAt = table.cooldownSince(id);
      const after = setAt !== null && setAt > startedAt ? before : cooldownAfterProbe(before, answer2.usage);
      if (after !== before) {
        table.setCooldown(id, after);
        if (after === null) log.write("cooldown_ended", { login: id });
      }
      log.write(cause === "renewal" ? "token_renewal_finished" : "usage_probe_finished", { login: id, ms, ok: true });
      this.learnEmail(ref, answer2);
    } else {
      const previous = table.usage(id);
      const base = previous ?? emptyAccountUsage(id, now());
      table.setUsage(id, { ...base, error: answer2.error });
      if (answer2.signedIn !== null) table.setSignedIn(id, answer2.signedIn);
      log.write(cause === "renewal" ? "token_renewal_finished" : "usage_probe_failed", { login: id, ms, ok: false, reason: answer2.reason });
    }
  }
  /**
   * After a successful probe that found the login signed in, gives the login the automatic alias
   * made from the email its profile names, when it names one.
   */
  learnEmail(login, answer2) {
    if (!answer2.signedIn) return;
    const email = this.options.identity.read(login)?.email ?? null;
    if (email !== null) this.options.table.noteEmail(login.id, email);
  }
};

// src/daemon/app.ts
function createDaemonApp(options) {
  const now = options.now ?? Date.now;
  const tuning = options.tuning ?? {};
  const { env, log, key } = options;
  const tokens = createTokenSource({
    login: (id) => table.find(id),
    env,
    log,
    now,
    ...tuning.platform === void 0 ? {} : { platform: tuning.platform }
  });
  const identity = new ClaudeIdentityReader();
  const table = new LoginTable({
    tokens,
    log,
    now,
    ...tuning.configCheckMs === void 0 ? {} : { configCheckMs: tuning.configCheckMs },
    ...tuning.stateWriteMs === void 0 ? {} : { stateWriteMs: tuning.stateWriteMs }
  });
  const poller = new UsagePoller({
    table,
    tokens,
    identity,
    env,
    log,
    now,
    probeClaude: tuning.probeClaude ?? ((login, probe) => probeClaudeUsage(login, { ...probe, env: probeEnvironment(tokens, login.id, probe.env) })),
    ...tuning.pollIntervalMs === void 0 ? {} : { intervalMs: tuning.pollIntervalMs }
  });
  const upstream = createUpstream({
    origin: upstreamOrigin(env),
    ...tuning.upstreamIdleTimeoutMs === void 0 ? {} : { idleTimeoutMs: tuning.upstreamIdleTimeoutMs }
  });
  const proxy = createProxy({
    key,
    table,
    tokens,
    identity,
    poller,
    upstream,
    log,
    now,
    ...tuning.random === void 0 ? {} : { random: tuning.random },
    hold: {
      ...tuning.holdMs === void 0 ? {} : { holdMs: tuning.holdMs },
      ...tuning.holdBaseMs === void 0 ? {} : { baseMs: tuning.holdBaseMs },
      ...tuning.holdMaxMs === void 0 ? {} : { maxMs: tuning.holdMaxMs }
    },
    ...tuning.renewalWaitMs === void 0 ? {} : { renewalWaitMs: tuning.renewalWaitMs },
    ...tuning.keptAnswerTimeoutMs === void 0 ? {} : { keptAnswerTimeoutMs: tuning.keptAnswerTimeoutMs }
  });
  const control = createControl({
    key,
    table,
    tokens,
    identity,
    poller,
    log,
    now,
    pid: options.pid,
    port: options.port,
    startedAt: options.startedAt,
    onStopRequested: (request2) => {
      options.onStopRequested(request2);
    }
  });
  let closed = null;
  return {
    async start() {
      table.load();
      table.onLoginsAdded((ids) => {
        void poller.probeMany(ids, "config");
      });
      await tokens.prime(table.logins().map((login) => login.id));
      if (tuning.poll !== false) poller.start();
    },
    handle(req, res) {
      const kind = requestKind(req.method, req.url);
      switch (kind.kind) {
        case "hello":
          req.resume();
          res.writeHead(200, { "content-type": "application/json" }).end(req.method === "HEAD" ? void 0 : '{"message":"hello"}');
          return;
        case "control":
          void control.handle(req, res, kind.path);
          return;
        case "route":
          void proxy.handle(req, res);
          return;
        case "unknown":
          req.resume();
          res.writeHead(404).end();
      }
    },
    openRequests: () => proxy.openRequests(),
    drained: () => proxy.drained(),
    stopPolling() {
      poller.stopPolling();
    },
    close() {
      closed ??= (async () => {
        const probesEnded = poller.close();
        upstream.close();
        tokens.clear();
        await Promise.all([table.flush(), probesEnded]);
      })();
      return closed;
    }
  };
}

// src/daemon/main.ts
var DEFAULT_DRAIN_CAP_MS = 15 * 6e4;
var BIND_DEADLINE_MS = 1e4;
var BIND_RETRY_MS = 100;
var IDLE_CLOSE_INTERVAL_MS = 1e3;
var STOP_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"];
var ERROR_EVENTS = ["uncaughtException", "unhandledRejection"];
async function runDaemon(options) {
  const version = options.version ?? kurmisVersion;
  const events = options.processEvents ?? process;
  const drainCapMs = options.drainCapMs ?? DEFAULT_DRAIN_CAP_MS;
  const bindDeadlineMs = options.bindDeadlineMs ?? BIND_DEADLINE_MS;
  const say = (text) => {
    options.stdout?.write(`${text}
`);
  };
  const complain = (text) => {
    options.stderr?.write(`kurmis daemon: ${text}
`);
  };
  const log = openDaemonLog();
  let key;
  let port;
  try {
    key = readOrCreateKey();
    port = loadConfig().port;
  } catch (error) {
    if (error instanceof ConfigError) {
      log.write("config_invalid", { reason: "invalid" });
      complain(error.message);
    } else {
      log.write("internal_error", { code: errorCodeOf(error) });
      complain(`could not read its files: ${messageOf3(error)}`);
    }
    return 1;
  }
  const stop2 = new StopControl();
  const onSignal = () => stop2.request("signal");
  const onError = (error) => {
    log.write("internal_error", { code: errorCodeOf(error) });
    stop2.request("error");
  };
  for (const signal of STOP_SIGNALS) events.on(signal, onSignal);
  for (const event of ERROR_EVENTS) events.on(event, onError);
  try {
    return await serve({ ...options, version, drainCapMs, bindDeadlineMs, key, port, log, stop: stop2, say, complain, onError });
  } finally {
    for (const signal of STOP_SIGNALS) events.off(signal, onSignal);
    for (const event of ERROR_EVENTS) events.off(event, onError);
  }
}
async function serve(options) {
  const { version, key, port, log, stop: stop2, say, complain } = options;
  const pid = process.pid;
  const startedAt = Date.now();
  let app;
  try {
    app = (options.createApp ?? createDaemonApp)({
      env: options.env,
      log,
      key,
      port,
      pid,
      startedAt,
      onStopRequested: (request2) => stop2.request("shutdown", request2.maxWaitMs)
    });
  } catch (error) {
    log.write("internal_error", { code: errorCodeOf(error) });
    complain(`could not set up its request handling: ${messageOf3(error)}`);
    return 1;
  }
  let started = null;
  let ready = false;
  const handle = (request2, response) => {
    try {
      app.handle(request2, response);
    } catch (error) {
      log.write("internal_error", { code: errorCodeOf(error) });
      if (!response.headersSent) response.statusCode = 500;
      response.end();
    }
  };
  const server = (0, import_node_http3.createServer)((request2, response) => {
    if (stop2.requested) response.setHeader("connection", "close");
    if (ready) {
      handle(request2, response);
      return;
    }
    void (started ?? Promise.resolve(false)).then((ok3) => {
      if (ok3) {
        handle(request2, response);
        return;
      }
      response.statusCode = 503;
      response.end();
    });
  });
  const bound = await bindPort(server, options);
  if (bound !== null) return bound;
  server.on("error", options.onError);
  if (!stop2.requested) {
    try {
      writeDaemonFile({ pid, port, version, startedAt });
    } catch (error) {
      log.write("internal_error", { code: errorCodeOf(error) });
      complain(`could not write daemon.json: ${messageOf3(error)}`);
      stop2.request("error");
    }
  }
  if (!stop2.requested) {
    log.write("daemon_started", { pid, port });
    say(`kurmis daemon ${version} runs on ${DAEMON_HOST}:${String(port)} (pid ${String(pid)})`);
    started = Promise.resolve().then(() => app.start()).then(
      () => {
        ready = true;
        return true;
      },
      (error) => {
        log.write("internal_error", { code: errorCodeOf(error) });
        complain(`could not start its request handling: ${messageOf3(error)}`);
        stop2.request("error");
        return false;
      }
    );
  }
  await stop2.firstRequest;
  log.write("daemon_stopping", { reason: stop2.reason ?? "other" });
  try {
    app.stopPolling();
  } catch (error) {
    log.write("internal_error", { code: errorCodeOf(error) });
  }
  server.close();
  server.closeIdleConnections();
  const idleTimer = setInterval(() => server.closeIdleConnections(), IDLE_CLOSE_INTERVAL_MS);
  try {
    if (stop2.exitCode === 0) await drain(app, options);
  } finally {
    clearInterval(idleTimer);
  }
  if (stop2.cutAtOnce || app.openRequests() > 0) server.closeAllConnections();
  if (started !== null) {
    const outcome = await waitAtMost(started, START_WAIT_MS);
    if (outcome.kind === "done" && outcome.value) {
      const closed = await waitAtMost(Promise.resolve().then(() => app.close()), CLOSE_WAIT_MS);
      if (closed.kind === "failed") log.write("internal_error", { code: errorCodeOf(closed.error) });
      if (closed.kind === "timeout") log.write("internal_error", { reason: "timeout" });
    }
  }
  server.closeAllConnections();
  try {
    removeDaemonFile(pid);
  } catch (error) {
    log.write("internal_error", { code: errorCodeOf(error) });
  }
  log.write("daemon_stopped", { pid, ok: stop2.exitCode === 0 });
  say("kurmis daemon stopped");
  return stop2.exitCode;
}
async function drain(app, options) {
  if (app.openRequests() === 0) return;
  const outcome = await waitAtMost(app.drained(), options.drainCapMs, options.stop.drainSkipped);
  if (outcome.kind === "done" || outcome.kind === "failed") {
    if (outcome.kind === "failed") options.log.write("internal_error", { code: errorCodeOf(outcome.error) });
    return;
  }
  const reason = outcome.kind === "timeout" ? "timeout" : options.stop.skipReason ?? "signal";
  options.log.write("drain_cut_short", { count: app.openRequests(), reason });
}
async function bindPort(server, options) {
  const { version, key, port, log, stop: stop2, say, complain } = options;
  let deadline = Date.now() + options.bindDeadlineMs;
  let askedToStop = null;
  let lastHolder;
  for (; ; ) {
    if (stop2.requested) return stop2.exitCode;
    const error = await listenOnce(server, port);
    if (error === null) return null;
    if (error.code !== "EADDRINUSE") {
      const refused = error.code !== void 0 && UNUSABLE_PORT_CODES.has(error.code);
      log.write(refused ? "port_in_use" : "internal_error", { code: errorCodeOf(error), port });
      complain(refused ? unusablePortText(port, error.code ?? "", configPath()) : `could not listen on ${DAEMON_HOST}:${String(port)} (${error.code ?? error.message})`);
      return 1;
    }
    const holder = await portHolder(port, key);
    lastHolder = holder;
    if (holder.kind === "other" && askedToStop === null) {
      log.write("port_in_use", { port });
      complain(`port ${String(port)} on ${DAEMON_HOST} is used by another program. To use another port, set "port" in ${configPath()} to a number from ${String(MIN_PORT)} to ${String(MAX_PORT)}.`);
      return 1;
    }
    if (holder.kind === "kurmis") {
      const other = holder.status;
      if (!shouldReplaceDaemon(other, version)) {
        say(`kurmis daemon ${other.version} already runs on port ${String(port)} (pid ${String(other.pid)})`);
        return 0;
      }
      if (askedToStop?.pid !== other.pid) {
        askedToStop = other;
        deadline = Date.now() + options.bindDeadlineMs;
        log.write("daemon_replacing_older", { pid: other.pid, port });
        say(`Replacing kurmis daemon ${other.version} (pid ${String(other.pid)}) on port ${String(port)}`);
        await controlRequest({ port, key, method: "POST", path: CONTROL_PATHS.stop });
      }
    }
    if (Date.now() >= deadline) {
      log.write("port_in_use", { port, reason: "timeout" });
      const seconds3 = String(Math.round(options.bindDeadlineMs / 1e3));
      complain(bindTimeoutText(port, seconds3, askedToStop, lastHolder ?? null));
      return 1;
    }
    await delay(BIND_RETRY_MS);
  }
}
function bindTimeoutText(port, seconds3, askedToStop, lastHolder) {
  const where = `port ${String(port)} on ${DAEMON_HOST}`;
  if (askedToStop === null) return `${where} stayed busy for ${seconds3} s with nothing answering on it`;
  const old = `the kurmis daemon ${askedToStop.version} (pid ${String(askedToStop.pid)})`;
  if (lastHolder?.kind === "kurmis" && lastHolder.status.pid === askedToStop.pid) {
    return `${old} did not give up port ${String(port)} within ${seconds3} s`;
  }
  const answer2 = lastHolder?.kind === "other" ? ` (${lastHolder.reason})` : "";
  return `${old} was asked to stop, but ${where} stayed busy for ${seconds3} s, and what holds it now does not answer as that daemon${answer2}. Another program may have taken the port. To use another port, set "port" in ${configPath()} to a number from ${String(MIN_PORT)} to ${String(MAX_PORT)}.`;
}
var UNUSABLE_PORT_CODES = /* @__PURE__ */ new Set(["EACCES", "EADDRNOTAVAIL"]);
function unusablePortText(port, code, configFile) {
  return `could not listen on ${DAEMON_HOST}:${String(port)} (${code}): the system does not let this program use the port. On Windows a port inside a range the system reserves is refused this way; "netsh int ipv4 show excludedportrange protocol=tcp" lists those ranges. To use another port, set "port" in ${configFile} to a number from ${String(MIN_PORT)} to ${String(MAX_PORT)} outside them.`;
}
function listenOnce(server, port) {
  return new Promise((resolve8) => {
    const onError = (error) => {
      server.off("listening", onListening);
      resolve8(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve8(null);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, DAEMON_HOST);
  });
}
var StopControl = class {
  requested = false;
  reason = null;
  skipReason = null;
  /** A request named a wait of 0 (`kurmis daemon stop --now`): the open requests are cut at once. */
  cutAtOnce = false;
  exitCode = 0;
  firstRequest;
  drainSkipped;
  resolveFirst;
  resolveSkip;
  constructor() {
    this.firstRequest = new Promise((resolve8) => {
      this.resolveFirst = resolve8;
    });
    this.drainSkipped = new Promise((resolve8) => {
      this.resolveSkip = resolve8;
    });
  }
  request(reason, maxWaitMs) {
    if (reason === "error") this.exitCode = 1;
    if (maxWaitMs !== void 0 && maxWaitMs <= 0) {
      this.cutAtOnce = true;
      this.skip("stop_now");
    } else if (maxWaitMs !== void 0) {
      setTimeout(() => this.skip("timeout"), maxWaitMs).unref();
    }
    if (!this.requested) {
      this.requested = true;
      this.reason = reason;
      this.resolveFirst();
      if (reason === "error") this.skip(reason);
      return;
    }
    if (reason === "signal" || reason === "error") this.skip(reason);
  }
  skip(reason) {
    this.skipReason ??= reason;
    this.resolveSkip();
  }
};
function waitAtMost(promise, ms, skip) {
  return new Promise((resolve8) => {
    const timer = setTimeout(() => resolve8({ kind: "timeout" }), ms);
    const finish = (outcome) => {
      clearTimeout(timer);
      resolve8(outcome);
    };
    promise.then((value) => finish({ kind: "done", value }), (error) => finish({ kind: "failed", error }));
    void skip?.then(() => finish({ kind: "skipped" }));
  });
}
function messageOf3(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/platform/launchd.ts
var import_node_os11 = require("node:os");
var import_node_path16 = require("node:path");
var LAUNCHCTL_PROGRAM = realSystemProgram("launchctl");
var LAUNCHCTL_VARIABLE = SYSTEM_PROGRAM_VARIABLES.launchctl;
var LAUNCHCTL_TIMEOUT_MS = 3e4;
var AUTOSTART_LABEL = "kurmis.daemon";
var DAEMON_START_ARGS = ["daemon", "start"];
function launchctlProgram(env = process.env, processEnv = process.env) {
  return systemProgram("launchctl", env, processEnv);
}
function launchctlFor(env = process.env) {
  const program = launchctlProgram(env);
  return (args) => runProgram(program, args, { timeoutMs: LAUNCHCTL_TIMEOUT_MS, env });
}
function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : 0;
}
function guiDomain(uid = currentUid()) {
  return `gui/${String(uid)}`;
}
function launchAgentsDir() {
  return (0, import_node_path16.join)((0, import_node_os11.homedir)(), "Library", "LaunchAgents");
}
function autostartPlistPath() {
  return (0, import_node_path16.join)(launchAgentsDir(), `${AUTOSTART_LABEL}.plist`);
}
function escapeXml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function plistXml(root) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>"
  ];
  const string = (value) => `<string>${escapeXml(value)}</string>`;
  const scalar = (value) => typeof value === "boolean" ? value ? "<true/>" : "<false/>" : string(value);
  for (const [key, value] of Object.entries(root)) {
    lines.push(`  <key>${escapeXml(key)}</key>`);
    if (typeof value === "string" || typeof value === "boolean") lines.push(`  ${scalar(value)}`);
    else if (Array.isArray(value)) lines.push("  <array>", ...value.map((item) => `    ${string(item)}`), "  </array>");
    else {
      lines.push("  <dict>");
      for (const [name, item] of Object.entries(value)) {
        lines.push(`    <key>${escapeXml(name)}</key>`, `    ${scalar(item)}`);
      }
      lines.push("  </dict>");
    }
  }
  lines.push("</dict>", "</plist>", "");
  return lines.join("\n");
}
var DAEMON_JOB_VARIABLES = [
  "KURMIS_HOME",
  "KURMIS_CLAUDE_BIN",
  "KURMIS_UPSTREAM_URL",
  "KURMIS_SECURITY_PROGRAM",
  "KURMIS_ENTRY",
  ...Object.values(SYSTEM_PROGRAM_VARIABLES).filter((name) => name !== "KURMIS_SECURITY_PROGRAM"),
  GUARD_VARIABLE,
  REFUSAL_LOG_VARIABLE
];
var FALLBACK_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
function daemonJobEnvironment(env = process.env, processEnv = process.env) {
  const out = {
    HOME: env.HOME !== void 0 && env.HOME !== "" ? env.HOME : (0, import_node_os11.homedir)(),
    PATH: env.PATH !== void 0 && env.PATH !== "" ? env.PATH : FALLBACK_PATH
  };
  const hooks = inheritedTestHooks(env, processEnv);
  for (const name of DAEMON_JOB_VARIABLES) {
    const value = env[name] || hooks[name];
    if (value === void 0 || value === "") continue;
    out[name] = name === "KURMIS_HOME" ? (0, import_node_path16.resolve)(value) : value;
  }
  return out;
}
function daemonJobPlist(job) {
  return plistXml({
    Label: job.label,
    ProgramArguments: job.programArguments,
    EnvironmentVariables: job.environment,
    WorkingDirectory: job.environment.HOME ?? (0, import_node_os11.homedir)(),
    RunAtLoad: true,
    AbandonProcessGroup: true,
    StandardOutPath: "/dev/null",
    StandardErrorPath: "/dev/null"
  });
}
function parseLaunchctlPrint(result) {
  if (result.code !== 0) return { loaded: false, path: null };
  const path = /^\tpath = (.*)$/m.exec(result.stdout);
  return { loaded: true, path: path === null ? null : (path[1] ?? "").trim() };
}
async function jobState(label, launchctl = launchctlFor(), uid) {
  return parseLaunchctlPrint(await launchctl(["print", `${guiDomain(uid)}/${label}`]));
}
function launchctlSaid(result) {
  if (result.error !== null) return result.error;
  const said = `${result.stderr}
${result.stdout}`.replace(/\s+/g, " ").trim();
  return said === "" ? `exit ${String(result.code)}` : `exit ${String(result.code)}: ${said}`;
}
function isNotLoaded(result) {
  if (result.code === 3 || result.code === 113) return true;
  return /no such process|could not find (specified )?service/i.test(`${result.stderr}
${result.stdout}`);
}
function isMissingGuiDomain(result) {
  if (result.code === 125 || result.code === 112) return true;
  return /domain does not support specified action|could not find domain/i.test(`${result.stderr}
${result.stdout}`);
}
function bootstrapFailure(result, domain) {
  const said = launchctlSaid(result);
  if (result.error === null && isMissingGuiDomain(result)) {
    return `launchd could not load the job into ${domain} (${said}). This usually means nobody is logged in at this Mac's screen: the GUI session, the only one that can read the login Keychain, exists only while you are logged in there or through Screen Sharing.`;
  }
  return `launchd could not load the job into ${domain} (${said}).`;
}
async function bootstrapJob(plistPath, launchctl = launchctlFor(), uid) {
  const domain = guiDomain(uid);
  const result = await launchctl(["bootstrap", domain, plistPath]);
  if (result.code !== 0 || result.error !== null) throw new Error(bootstrapFailure(result, domain));
}
async function bootoutJob(label, launchctl = launchctlFor(), uid) {
  const target = `${guiDomain(uid)}/${label}`;
  const result = await launchctl(["bootout", target]);
  if (result.code === 0 && result.error === null) return true;
  if (result.error === null && isNotLoaded(result)) return false;
  throw new Error(`launchd could not unload ${target} (${launchctlSaid(result)}).`);
}

// src/cli/commands/daemon.ts
var RUN_EXIT_FALLBACK_MS = 2e3;
function clientOptions(context) {
  return { env: context.env };
}
function failed(error, context) {
  if (!(error instanceof DaemonError)) throw error;
  writeLine(context.stderr, `kurmis daemon: ${error.message}`);
  return EXIT_FAILURE;
}
function address(port) {
  return `127.0.0.1:${String(port)}`;
}
function describeStart(result) {
  const { connection } = result;
  const where = `on ${address(connection.port)} (pid ${String(connection.pid)})`;
  if (!result.started) {
    const newer = daemonAge(connection, kurmisVersion) === "newer";
    return newer ? `A newer kurmis daemon (${versionText(connection.version, connection.apiVersion)}) already runs ${where}; this kurmis is ${versionText(kurmisVersion, CONTROL_API_VERSION)}, and can use it.` : `The kurmis daemon ${connection.version} already runs ${where}.`;
  }
  const replaced = result.replaced === null ? "" : `, replacing version ${result.replaced}, which stops once its open requests finish`;
  return `Started the kurmis daemon ${connection.version} ${where}${replaced}.`;
}
var start = async (args, context) => {
  const parsed = parseCommandArgs("daemon start", args, { env: { type: "string", multiple: true } }, context);
  if (typeof parsed === "number") return parsed;
  const assignments = daemonStartAssignments(parsed.values.env ?? []);
  if (typeof assignments === "string") return usageError("daemon start", assignments, context);
  for (const [name, value] of Object.entries(assignments)) process.env[name] = value;
  const startContext = { ...context, env: { ...context.env, ...assignments } };
  try {
    writeLine(context.stdout, describeStart(await startDaemon(clientOptions(startContext))));
    return EXIT_OK;
  } catch (error) {
    return failed(error, context);
  }
};
var restart = async (args, context) => {
  const parsed = parseCommandArgs("daemon restart", args, {}, context);
  if (typeof parsed === "number") return parsed;
  try {
    writeLine(context.stdout, describeStart(await restartDaemon(clientOptions(context))));
    return EXIT_OK;
  } catch (error) {
    return failed(error, context);
  }
};
var stop = async (args, context) => {
  const parsed = parseCommandArgs("daemon stop", args, { now: { type: "boolean" } }, context);
  if (typeof parsed === "number") return parsed;
  const now = parsed.values.now === true;
  try {
    const found = await findDaemon(clientOptions(context));
    if (found === null) {
      const problem = await keyRefusedProblem(clientOptions(context));
      if (problem !== null) throw new DaemonError(problem);
    }
    if (found === null || !await stopDaemon({ ...clientOptions(context), now })) {
      writeLine(context.stdout, "The kurmis daemon is not running.");
      const silent = found === null ? silentDaemon() : null;
      if (silent !== null) {
        writeLine(context.stdout, `Process ${String(silent.pid)}, named in daemon.json, does not answer on ${address(silent.port)}, so it was not asked to stop. It may be finishing its open requests before it stops.`);
      }
    } else {
      writeLine(context.stdout, now ? `Stopped the kurmis daemon (pid ${String(found.pid)}) without waiting for its open requests.` : `Stopped the kurmis daemon (pid ${String(found.pid)}).`);
    }
    return EXIT_OK;
  } catch (error) {
    return failed(error, context);
  }
};
var status = async (args, context) => {
  const parsed = parseCommandArgs("daemon status", args, { json: { type: "boolean" } }, context);
  if (typeof parsed === "number") return parsed;
  const json = parsed.values.json === true;
  try {
    const found = await findDaemon(clientOptions(context));
    if (found === null) {
      const silent = silentDaemon();
      const refused = silent === null ? null : await keyRefusedProblem(clientOptions(context));
      if (json) {
        writeLine(context.stdout, JSON.stringify({
          running: false,
          cliVersion: kurmisVersion,
          ...silent === null ? {} : { notAnswering: silent },
          ...refused === null ? {} : { keyRefused: refused }
        }, null, 2));
      } else {
        writeLine(context.stdout, "The kurmis daemon is not running.");
        if (refused !== null) {
          writeLine(context.stdout, refused);
        } else if (silent !== null) {
          writeLine(context.stdout, `Process ${String(silent.pid)}, named in daemon.json, does not answer on ${address(silent.port)}. It may be finishing its open requests before it stops.`);
        }
      }
      return EXIT_FAILURE;
    }
    const answer2 = await readStatus3(found);
    if (json) {
      writeLine(context.stdout, JSON.stringify({
        running: true,
        pid: answer2.pid,
        port: answer2.port,
        version: answer2.version,
        apiVersion: answer2.apiVersion,
        startedAt: answer2.startedAt,
        logins: answer2.logins.length,
        cliVersion: kurmisVersion
      }, null, 2));
      return EXIT_OK;
    }
    writeLine(context.stdout, `The kurmis daemon ${answer2.version} runs on ${address(answer2.port)}, pid ${String(answer2.pid)}, since ${new Date(answer2.startedAt).toISOString()}, with ${String(answer2.logins.length)} ${answer2.logins.length === 1 ? "login" : "logins"}.`);
    const age = daemonAge(answer2, kurmisVersion);
    const versions = `The daemon is ${versionText(answer2.version, answer2.apiVersion)}, this kurmis is ${versionText(kurmisVersion, CONTROL_API_VERSION)}.`;
    const sameApi = answer2.apiVersion === CONTROL_API_VERSION;
    if (age === "older") {
      writeLine(context.stdout, `${versions} The daemon is older, so the next "kurmis claude", "kurmis setup" or "kurmis daemon start" replaces it.`);
    } else if (age === "newer") {
      writeLine(context.stdout, sameApi ? `${versions} The daemon is newer; this kurmis can use it and does not replace it.` : `${versions} The daemon is newer, so this kurmis does not replace it, and it cannot use a daemon of another control API version. Update this kurmis, or stop the daemon with "kurmis daemon stop" and run the command again.`);
    } else if (age === "unknown" && !sameApi) {
      writeLine(context.stdout, `${versions} The versions cannot be compared, so this kurmis does not replace the daemon, and it cannot use a daemon of another control API version. Stop the daemon with "kurmis daemon stop" and run the command again.`);
    }
    return EXIT_OK;
  } catch (error) {
    return failed(error, context);
  }
};
function daemonStartAssignments(values) {
  const out = {};
  for (const value of values) {
    const at = value.indexOf("=");
    const name = at === -1 ? value : value.slice(0, at);
    if (at === -1 || !DAEMON_JOB_VARIABLES.includes(name)) {
      return `--env takes NAME=VALUE with NAME one of ${DAEMON_JOB_VARIABLES.join(", ")}, not "${name}"`;
    }
    out[name] = value.slice(at + 1);
  }
  return out;
}
var run = async (args, context) => {
  const parsed = parseCommandArgs("daemon run", args, {}, context);
  if (typeof parsed === "number") return parsed;
  const code = await runDaemon({ env: context.env, stdout: context.stdout, stderr: context.stderr });
  setTimeout(() => process.exit(code), RUN_EXIT_FALLBACK_MS).unref();
  return code;
};
var SUBCOMMANDS = { start, stop, restart, status, run };
var daemonCommand = {
  name: "daemon",
  summary: "Start, stop or show the background process",
  usage: `Usage: kurmis daemon <start|stop|restart|status|run>

The daemon is the background process that routes Claude requests. "kurmis claude" and
"kurmis setup" start it when it is not running, so "kurmis daemon start" is seldom
needed.

  start                   Start it in the background. An older daemon is replaced, a newer
                          one is kept.
  stop [--now]            Stop it after it finishes its open requests, waiting at most 30
                          seconds. With --now it stops at once, and open Claude sessions
                          retry the requests it cut.
  restart                 Start a new one now; the old one finishes its open requests first.
  status [--json]         Show whether it runs, its pid, port and version. Exits 1 when it
                          does not run.
  run                     Run it in this terminal instead of the background.

On macOS, a daemon started from an ssh login cannot read the login Keychain. Run
"kurmis setup" in a terminal at the screen: the daemon then runs in your desktop session,
starts again at each login, and ssh sessions use it.

Options:
  -h, --help              Show this help.`,
  run(args, context) {
    const [subcommand, ...rest] = args;
    if (subcommand === void 0) return usageError("daemon", "needs one of start, stop, restart, status, run", context);
    const handler = Object.hasOwn(SUBCOMMANDS, subcommand) ? SUBCOMMANDS[subcommand] : void 0;
    if (handler === void 0) return usageError("daemon", `unknown subcommand "${subcommand}"`, context);
    return handler(rest, context);
  }
};

// src/cli/commands/login.ts
var import_node_fs18 = require("node:fs");
var import_node_os12 = require("node:os");
var import_node_path19 = require("node:path");

// src/platform/remove-tree.ts
var import_node_fs16 = require("node:fs");
var import_node_path17 = require("node:path");
var nodeFs = {
  lstatSync: (path) => (0, import_node_fs16.lstatSync)(path),
  readdirSync: (path) => (0, import_node_fs16.readdirSync)(path),
  unlinkSync: (path) => (0, import_node_fs16.unlinkSync)(path),
  rmdirSync: (path) => (0, import_node_fs16.rmdirSync)(path),
  chmodSync: (path, mode) => (0, import_node_fs16.chmodSync)(path, mode),
  realpathSync: (path) => import_node_fs16.realpathSync.native(path)
};
function codeOf2(error) {
  return error?.code;
}
function removeTreeSync(path, options = {}) {
  removeEntry(path, options.fs ?? nodeFs, options.platform ?? process.platform, options.root ?? null);
}
function insideWindowsFolder(path, root) {
  const a = import_node_path17.win32.normalize(path).replace(/^\\\\\?\\/, "").toLowerCase();
  const b = import_node_path17.win32.normalize(root).replace(/^\\\\\?\\/, "").replace(/\\+$/, "").toLowerCase();
  return a === b || a.startsWith(`${b}\\`);
}
function removeEntry(path, fs, platform, root) {
  let stat;
  try {
    stat = fs.lstatSync(path);
  } catch (error) {
    if (codeOf2(error) === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    removeLink(path, fs, platform);
  } else if (stat.isDirectory()) {
    let inside = root;
    if (platform === "win32") {
      let real;
      try {
        real = fs.realpathSync(path);
      } catch {
        real = null;
      }
      if (real === null || root !== null && !insideWindowsFolder(real, root)) {
        retryWhileLockedSync(() => fs.rmdirSync(path), platform);
        return;
      }
      inside = root ?? real;
    }
    for (const name of fs.readdirSync(path)) removeEntry((0, import_node_path17.join)(path, name), fs, platform, inside);
    retryWhileLockedSync(() => fs.rmdirSync(path), platform);
  } else {
    removeFile2(path, fs, platform);
  }
}
function removeLink(path, fs, platform) {
  if (platform !== "win32") {
    fs.unlinkSync(path);
    return;
  }
  try {
    fs.unlinkSync(path);
  } catch (error) {
    const code = codeOf2(error);
    if (code !== "EPERM" && code !== "EISDIR" && code !== "EACCES" && code !== "EBUSY") throw error;
    retryWhileLockedSync(() => fs.rmdirSync(path), platform);
  }
}
function removeFile2(path, fs, platform) {
  if (platform !== "win32") {
    fs.unlinkSync(path);
    return;
  }
  try {
    fs.unlinkSync(path);
  } catch (error) {
    const code = codeOf2(error);
    if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw error;
    if (code === "EPERM") fs.chmodSync(path, 438);
    retryWhileLockedSync(() => fs.unlinkSync(path), platform);
  }
}

// src/cli/login-lock.ts
var LOGIN_LOCK_STALE_MS = 24 * 60 * 60 * 1e3;
var LOGIN_LOCK_WAIT_MS = 500;
var LoginBusyError = class extends Error {
  constructor(id, path, pid, name = id) {
    super(`another "kurmis login" or "kurmis logout" of ${name} is running now${pid === null ? "" : ` (pid ${String(pid)})`}. Wait for it to end and try again. If none is running, delete ${path}.`);
    this.id = id;
    this.path = path;
    this.name = "LoginBusyError";
  }
  id;
  path;
};
function lockLogin(id, name = id) {
  const path = loginLockPath(id);
  try {
    return acquireFileLockSync(path, { timeoutMs: LOGIN_LOCK_WAIT_MS, staleMs: LOGIN_LOCK_STALE_MS });
  } catch (error) {
    if (error instanceof LockTimeoutError) throw new LoginBusyError(id, path, error.holder?.pid ?? null, name);
    throw error;
  }
}

// src/cli/sign-out.ts
var LOGOUT_TIMEOUT_MS = 3e4;
async function signOutLogin(login, env, deps) {
  let problem;
  try {
    const program = deps.findProgram("claude", { env });
    const patch = claudeLoginEnv(login, deps.platform === "win32");
    const result = await deps.runProgram(
      program.command,
      [...program.args, "auth", "logout"],
      { timeoutMs: LOGOUT_TIMEOUT_MS, env: applyEnvPatch(env, patch) }
    );
    if (result.code === 0) return null;
    problem = result.error ?? `exit code ${String(result.code)}`;
  } catch (error) {
    if (!(error instanceof ProgramNotFoundError)) throw error;
    problem = error.message;
  }
  return `"claude auth logout" did not finish (${problem})`;
}
function leftBehindText(login, platform) {
  const service = keychainService(loginFolder(login));
  if (platform === "darwin") return ` Its Keychain item "${service}" may be left; Keychain Access can delete it.`;
  if (platform === "win32") return ` Its Windows credentials "${service}/\u2026" may be left; Credential Manager can delete them.`;
  return "";
}

// src/cli/local-credentials.ts
var import_node_fs17 = require("node:fs");
var import_node_path18 = require("node:path");
var KEYCHAIN_LOOKUP_TIMEOUT_MS = 3e3;
function credentialsFileHasToken(dir) {
  let text;
  try {
    text = (0, import_node_fs17.readFileSync)((0, import_node_path18.join)(dir, CREDENTIALS_FILE_NAME), "utf8");
  } catch (error) {
    const code = error.code;
    return code === "ENOENT" || code === "ENOTDIR" ? false : "unknown";
  }
  return parseCredentials(text) !== null;
}
async function keychainItemExists(service, env, run2) {
  const security = (args) => run2(systemProgram("security", env), args, { timeoutMs: KEYCHAIN_LOOKUP_TIMEOUT_MS, maxOutputBytes: 64 * 1024 });
  const answer2 = async (keychains2) => {
    const result = await security(["find-generic-password", "-s", service, ...keychains2]);
    if (result.error !== null) return "unknown";
    if (result.code === 0) return true;
    return result.code === NO_SUCH_ITEM_EXIT_CODE ? false : "unknown";
  };
  const searched = await answer2([]);
  if (searched !== false) return searched;
  const listed = await security(["list-keychains", "-d", "user"]);
  if (listed.error !== null || listed.code !== 0) return false;
  const keychains = listed.stdout.split("\n").map((line) => line.trim().replace(/^"|"$/g, "")).filter((line) => line.length > 0);
  return keychains.length === 0 ? false : answer2(keychains);
}
function either(a, b) {
  if (a === true || b === true) return true;
  return a === "unknown" || b === "unknown" ? "unknown" : false;
}
async function checkCredentials(logins, env, home, deps) {
  const files = logins.map((login) => credentialsFileHasToken(claudeCredentialsDir(login, home)));
  const left = logins.filter((_login, index) => files[index] !== true);
  const platform = deps.platform ?? process.platform;
  let stores = left.map(() => false);
  if (left.length > 0 && platform === "darwin") {
    stores = await Promise.all(left.map((login) => keychainItemExists(keychainService(claudeSecureStorageDir(login)), env, deps.runProgram)));
  } else if (left.length > 0 && platform === "win32") {
    const read = deps.readCredentialNames ?? powerShellCredentialRead(env, deps.runProgram, false);
    stores = await storedRecordsExist(left.map(claudeSecureStorageDir), read, preferredAccounts(env));
  }
  const answers = /* @__PURE__ */ new Map();
  logins.forEach((login, index) => {
    const file = files[index] ?? false;
    answers.set(login.id, file === true ? true : either(file, stores[left.indexOf(login)] ?? false));
  });
  return answers;
}
async function hasCredentials(login, env, home, deps) {
  return (await checkCredentials([login], env, home, deps)).get(login.id) ?? "unknown";
}

// src/cli/commands/login.ts
var LOGIN_PROBE_WAIT_MS = 15e3;
function loginTarget(argument, config) {
  if (argument === void 0) return { kind: "new" };
  const resolved = resolveLogin(config, argument);
  if ("error" in resolved) {
    return { error: `${resolved.error}. "kurmis login" without a login adds a new one, and "kurmis status" shows the logins there are` };
  }
  return { kind: "existing", login: resolved.login };
}
function freshLoginId(config) {
  for (; ; ) {
    const id = newLoginIdFor(config);
    if (!(0, import_node_fs18.existsSync)(loginFolder({ id, usedByPlainClaude: false }))) return id;
  }
}
function homeIdentity(home) {
  try {
    return parseClaudeIdentity((0, import_node_fs18.readFileSync)((0, import_node_path19.join)(home, CLAUDE_PROFILE_FILE), "utf8"));
  } catch {
    return null;
  }
}
function fail2(context, message) {
  writeLine(context.stderr, `kurmis login: ${message}`);
  return EXIT_FAILURE;
}
function sameAccount(config, login, account, home) {
  return config.logins.find((other) => other.id !== login.id && isSameClaudeAccount(readClaudeIdentity(other, home) ?? { email: null, organizationUuid: null }, account)) ?? null;
}
function otherOrganization(config, login, account, home) {
  return config.logins.find((other) => {
    if (other.id === login.id) return false;
    const identity = readClaudeIdentity(other, home);
    return identity !== null && isSameEmail(identity.email, account.email) && !isSameClaudeAccount(identity, account);
  }) ?? null;
}
var AddedMeanwhile = class extends Error {
  constructor(existing) {
    super(`${existing.id} has the same account`);
    this.existing = existing;
    this.name = "AddedMeanwhile";
  }
  existing;
};
async function tellDaemon(daemon, login, env, probeWaitMs) {
  let connection;
  try {
    connection = await daemon.findDaemon({ env });
    if (connection === null) return [];
    await daemon.requestReload(connection);
  } catch (error) {
    const said = reloadText({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
    return said === null ? [] : [said];
  }
  const lines = [reloadText({ kind: "reloaded" }) ?? ""];
  const found = connection;
  const probed = await settleWithin((signal) => daemon.requestProbe(found, [login.id], signal), probeWaitMs);
  if (probed.kind === "done") {
    const row = probed.value.logins.find((other) => other.id === login.id);
    if (row?.signedIn === false) lines.push(`The daemon still finds ${login.alias} signed out; "kurmis status" shows what it knows.`);
  } else {
    const why = probed.kind === "timeout" ? `did not finish within ${String(probeWaitMs / 1e3)} s` : `failed (${probed.error instanceof Error ? probed.error.message : String(probed.error)})`;
    lines.push(`The daemon's check of ${login.alias} ${why}; it checks the login again within 15 minutes.`);
  }
  return lines;
}
async function signIn(run2) {
  const { ref, isNew, name, lock, program, alias, context, deps } = run2;
  const folder = ref.usedByPlainClaude ? null : loginFolder(ref);
  let created = false;
  if (folder !== null && !(0, import_node_fs18.existsSync)(folder)) {
    makePrivateDirSync(folder);
    created = true;
  }
  const cleanUp = () => {
    if (created && folder !== null) removeTreeSync(folder);
  };
  const notAdded = isNew ? " No login was added." : "";
  const cliName = "claude auth login";
  const what = isNew ? `a new login (id ${ref.id})` : name;
  writeLine(context.stdout, `Signing in ${what} with "${cliName}". Follow its steps.`);
  const credentialManager = await deps.inCredentialManager(folder, context.env);
  const env = applyEnvPatch(context.env, claudeLoginEnv(ref, credentialManager));
  const end = await deps.runner.runInteractive({ command: program.command, args: [...program.args, "auth", "login", "--claudeai"], env });
  if (end.kind !== "exit") {
    cleanUp();
    lock.release();
    if (isNew) writeLine(context.stderr, `kurmis login:${notAdded}`);
    return deps.runner.finishLikeChild(end, { stderr: context.stderr, name: "claude" });
  }
  if (end.code !== 0) {
    cleanUp();
    return fail2(context, `"${cliName}" failed (exit code ${String(end.code)}).${notAdded}`);
  }
  if (ref.usedByPlainClaude) {
    (0, import_node_fs18.rmSync)((0, import_node_path19.join)(ownClaudeProbeFolder(), CLAUDE_PROFILE_FILE), { force: true });
  }
  const identity = ref.usedByPlainClaude ? homeIdentity(deps.home()) : readClaudeIdentity(ref, deps.home());
  if (identity === null && await hasCredentials(ref, context.env, deps.home(), deps) === false) {
    cleanUp();
    return fail2(context, `"${cliName}" ended, but ${name} has no credentials.${notAdded}`);
  }
  const email = identity?.email ?? null;
  const account = email === null ? null : { email, organizationUuid: identity?.organizationUuid ?? null };
  if (isNew && account !== null) {
    let config;
    try {
      config = loadConfig();
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      return fail2(context, `${name} is signed in, but config.json could not be read: ${error.message} "kurmis logout ${ref.id}" removes its credentials and folder.`);
    }
    const existing = sameAccount(config, ref, account, deps.home());
    if (existing !== null) return await dropDuplicate(run2, existing, account.email);
  }
  let saved;
  try {
    saved = changeConfig((config) => {
      const meanwhile = isNew && account !== null ? sameAccount(config, ref, account, deps.home()) : null;
      if (meanwhile !== null) throw new AddedMeanwhile(meanwhile);
      let next = isNew ? addLogin(config, ref.id, alias === void 0 ? {} : { alias }) : config;
      if (!isNew && alias !== void 0) next = updateLogin(next, ref.id, { alias });
      return followEmail(next, ref.id, email);
    });
  } catch (error) {
    if (error instanceof AddedMeanwhile && email !== null) return await dropDuplicate(run2, error.existing, email);
    if (!(error instanceof ConfigError)) throw error;
    return fail2(context, isNew ? `${name} is signed in but could not be added: ${error.message} "kurmis logout ${ref.id}" removes its credentials and folder.` : `${name} is signed in again but its settings could not be saved: ${error.message}`);
  }
  const login = findLogin(saved, ref.id);
  writeLine(context.stdout, email === null ? "Signed in." : `Signed in as ${email}.`);
  if (isNew) {
    writeLine(context.stdout, `Added ${login.alias} (id ${login.id}), a login with Auto routing on and both limits at 100%. "kurmis set ${login.alias}" changes that.`);
    const sibling = account === null ? null : otherOrganization(saved, ref, account, deps.home());
    if (sibling !== null) {
      writeLine(context.stdout, `${sibling.alias} has the same email in another organization. That is another subscription, so the two are separate logins.`);
    }
  } else if (login.alias !== name) {
    writeLine(context.stdout, `${name} is now called ${login.alias}.`);
  }
  if (!isNew && account !== null) {
    const other = sameAccount(saved, ref, account, deps.home());
    if (other !== null) {
      const which = other.usedByPlainClaude ? `${other.alias}, ${plainClaudeLoginText()},` : other.alias;
      writeLine(context.stderr, `kurmis login: warning: ${email} is also the account of ${which} (id ${other.id}). ${login.alias} and ${other.alias} are now the same account and share its limits. Neither was signed out. "kurmis login ${login.alias}" signs ${login.alias} in to another account.`);
    }
  }
  for (const line of await tellDaemon(deps.daemon, login, context.env, deps.probeWaitMs)) writeLine(context.stdout, line);
  return EXIT_OK;
}
async function dropDuplicate(run2, existing, email) {
  const { ref, context, deps } = run2;
  const problem = await signOutLogin(ref, context.env, deps);
  if (problem !== null) {
    writeLine(context.stderr, `kurmis login: ${problem}; the new sign-in is deleted anyway.${leftBehindText(ref, deps.platform)}`);
  }
  try {
    removeTreeSync(loginFolder(ref));
  } catch (error) {
    return fail2(context, `${email} is already ${existing.alias}, but the folder of the new sign-in could not be deleted (${error instanceof Error ? error.message : String(error)}). "kurmis logout ${ref.id}" deletes it.`);
  }
  const which = existing.usedByPlainClaude ? `${existing.alias}, ${plainClaudeLoginText()}` : existing.alias;
  writeLine(context.stdout, `${email} is already a kurmis login: ${which} (id ${existing.id}). No login was added, and the new sign-in was signed out again.`);
  writeLine(context.stdout, `"kurmis login ${existing.alias}" signs ${existing.alias} in again.`);
  if (run2.alias !== void 0) {
    writeLine(context.stderr, `kurmis login: --alias ${run2.alias} was not used, because no login was added. "kurmis set ${existing.alias} --alias ${run2.alias}" gives ${existing.alias} that alias.`);
  }
  return EXIT_OK;
}
function createLoginCommand(deps = {}) {
  const full = {
    daemon: deps.daemon ?? realDaemonClient,
    runner: deps.runner ?? realChildRunner,
    findProgram: deps.findProgram ?? realFindProgram,
    runProgram: deps.runProgram ?? runProgram,
    home: deps.home ?? import_node_os12.homedir,
    probeWaitMs: deps.probeWaitMs ?? LOGIN_PROBE_WAIT_MS,
    inCredentialManager: deps.inCredentialManager ?? ((folder, env) => holdsStoredRecord(folder, env)),
    platform: deps.platform ?? process.platform
  };
  return {
    name: "login",
    summary: "Sign in a new login, or sign an existing one in again",
    usage: `Usage: kurmis login [--alias <alias>]
       kurmis login <login> [--alias <alias>]

Signs a login in through the browser.

  kurmis login                Adds a new login.
  kurmis login work-example   Signs the login work-example in again, for example after it was
                              signed out.

<login> is an alias or id that "kurmis status" shows.

A new login's alias comes from its email: work@example.com gives work-example. When you sign in
to an account kurmis already has, nothing is added and kurmis names the login it already is.
"kurmis set" changes a login's alias and routing settings.

Options:
  --alias <alias>   Use this alias instead of the one from the email: 1 to 32 lowercase
                    letters, digits, "-" or "_", starting with a letter or digit.
  -h, --help        Show this help.`,
    async run(args, context) {
      const parsed = parseCommandArgs("login", args, { alias: { type: "string" } }, context, true);
      if (typeof parsed === "number") return parsed;
      if (parsed.positionals.length > 1) return usageError("login", "takes at most one login, by its alias or id", context);
      const alias = parsed.values.alias;
      let config;
      try {
        config = loadConfig();
      } catch (error) {
        if (error instanceof ConfigError) return fail2(context, error.message);
        throw error;
      }
      const target = loginTarget(parsed.positionals[0], config);
      if ("error" in target) return usageError("login", target.error, context);
      const isNew = target.kind === "new";
      const ref = isNew ? { id: freshLoginId(config), usedByPlainClaude: false } : { id: target.login.id, usedByPlainClaude: target.login.usedByPlainClaude };
      const name = isNew ? ref.id : target.login.alias;
      if (alias !== void 0) {
        const problem = aliasProblem(config, ref, alias);
        if (problem !== null) return usageError("login", problem, context);
      }
      let program;
      try {
        program = full.findProgram("claude", { env: context.env });
      } catch (error) {
        if (error instanceof ProgramNotFoundError) return fail2(context, error.message);
        throw error;
      }
      let lock;
      try {
        lock = lockLogin(ref.id, name);
      } catch (error) {
        if (error instanceof LoginBusyError) return fail2(context, error.message);
        throw error;
      }
      try {
        if (!isNew) {
          let current;
          try {
            current = loadConfig();
          } catch (error) {
            if (error instanceof ConfigError) return fail2(context, error.message);
            throw error;
          }
          if (findLogin(current, ref.id) === void 0) return fail2(context, `${name} was removed by another kurmis command just now`);
        }
        return await signIn({ ref, isNew, name, lock, program, alias, context, deps: full });
      } finally {
        lock.release();
      }
    }
  };
}
var loginCommand = createLoginCommand();

// src/cli/commands/logout.ts
var import_node_fs19 = require("node:fs");
function exists(path) {
  try {
    (0, import_node_fs19.lstatSync)(path);
    return true;
  } catch {
    return false;
  }
}
function fail3(context, message, prefix = "kurmis logout") {
  writeLine(context.stderr, `${prefix}: ${message}`);
  return EXIT_FAILURE;
}
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
function createLoginLogout(deps = {}) {
  const daemon = deps.daemon ?? realDaemonClient;
  const signOutDeps = {
    findProgram: deps.findProgram ?? realFindProgram,
    runProgram: deps.runProgram ?? runProgram,
    platform: deps.platform ?? process.platform
  };
  async function removeNow(login, context, options) {
    const { id } = login;
    const again = options.again ?? `kurmis logout ${id}`;
    const prefix = options.prefix ?? "kurmis logout";
    const keep = options.keepWhenSignOutFails === true;
    const folder = loginFolder(login);
    let name = id;
    let listed = false;
    try {
      const found = findLogin(loadConfig(), id);
      if (found?.usedByPlainClaude === true) return fail3(context, `${found.alias} is ${plainClaudeLoginText()} and cannot be removed.`, prefix);
      if (found !== void 0) {
        listed = true;
        name = found.alias;
      }
    } catch (error) {
      if (error instanceof ConfigError) return fail3(context, error.message, prefix);
      throw error;
    }
    const hasFolder = exists(folder);
    if (!listed && !hasFolder) return fail3(context, `there is no login ${id}; "kurmis status" shows the logins`, prefix);
    let reload = null;
    const unlist = async () => {
      if (!listed) return null;
      try {
        changeConfig((config) => findLogin(config, id) === void 0 ? config : removeLogin(config, id));
      } catch (error) {
        if (error instanceof ConfigError) return fail3(context, error.message, prefix);
        throw error;
      }
      reload = reloadText(await reloadIfRunning(daemon, context.env));
      return null;
    };
    if (!keep) {
      const failed2 = await unlist();
      if (failed2 !== null) return failed2;
    }
    const problem = await signOutLogin(login, context.env, signOutDeps);
    if (problem !== null) {
      const left = leftBehindText(login, signOutDeps.platform);
      if (keep) {
        const kept = listed ? `${name} stays in kurmis${hasFolder ? ` with its folder ${folder}` : ""}` : `Its folder ${folder} is kept`;
        const wayOut = `If that cannot work, for example because claude is not installed, "kurmis logout ${id}" removes ${name} and its folder without signing it out${left === "" ? "" : ", which leaves the item named above"}.`;
        return fail3(context, `${problem}.${left} ${kept}, so that "${again}" runs it again. ${wayOut}`, prefix);
      }
      writeLine(context.stderr, `${prefix}: ${problem}; ${name} is removed anyway.${left}`);
    }
    if (keep) {
      const failed2 = await unlist();
      if (failed2 !== null) return failed2;
    }
    try {
      removeTreeSync(folder);
    } catch (error) {
      const problem2 = `its folder ${folder} could not be deleted (${errorText(error)})`;
      return fail3(context, listed ? `${name} is removed from kurmis, but ${problem2}. Close what uses it and run "${again}".` : `${id} left a folder behind, but ${problem2}. Close what uses it and run "${again}" again.`, prefix);
    }
    writeLine(context.stdout, listed ? `Removed ${name} (id ${id}).` : `Deleted the folder that ${id} left behind.`);
    if (reload !== null) writeLine(context.stdout, reload);
    return EXIT_OK;
  }
  return async (login, context, options = {}) => {
    const prefix = options.prefix ?? "kurmis logout";
    if (login.usedByPlainClaude) return fail3(context, `${login.id} is ${plainClaudeLoginText()} and cannot be removed.`, prefix);
    let name;
    try {
      name = findLogin(loadConfig(), login.id)?.alias ?? login.id;
    } catch (error) {
      if (error instanceof ConfigError) return fail3(context, error.message, prefix);
      throw error;
    }
    let lock;
    try {
      lock = lockLogin(login.id, name);
    } catch (error) {
      if (error instanceof LoginBusyError) return fail3(context, error.message, prefix);
      throw error;
    }
    try {
      return await removeNow(login, context, options);
    } finally {
      lock.release();
    }
  };
}
function logoutTarget(config, text) {
  const resolved = resolveLogin(config, text);
  if ("login" in resolved) {
    const login = resolved.login;
    if (login.usedByPlainClaude) {
      return {
        kind: "error",
        usage: true,
        message: `${login.alias} is ${plainClaudeLoginText()} and cannot be removed. To sign it out, run "claude auth logout" yourself.`
      };
    }
    return { kind: "login", login: { id: login.id, usedByPlainClaude: false } };
  }
  const id = text.trim().toLowerCase();
  if (isLoginId(id) && findLogin(config, id) === void 0) {
    const login = { id, usedByPlainClaude: false };
    if (exists(loginFolder(login))) return { kind: "login", login };
  }
  return { kind: "error", usage: false, message: `${resolved.error}; "kurmis status" shows the logins` };
}
function createLogoutCommand(deps = {}) {
  const logOut = createLoginLogout(deps);
  return {
    name: "logout",
    summary: "Remove a login and its credentials",
    usage: `Usage: kurmis logout <login>

Signs a login out and removes it from kurmis. A running daemon stops using it at once.

<login> is an alias or id that "kurmis status" shows.

The login plain claude uses cannot be removed. To sign it out, run "claude auth logout".

Options:
  -h, --help   Show this help.`,
    async run(args, context) {
      const parsed = parseCommandArgs("logout", args, {}, context, true);
      if (typeof parsed === "number") return parsed;
      if (parsed.positionals.length !== 1) return usageError("logout", "takes one login, by its alias or id", context);
      let target;
      try {
        target = logoutTarget(loadConfig(), parsed.positionals[0]);
      } catch (error) {
        if (error instanceof ConfigError) return fail3(context, error.message);
        throw error;
      }
      if (target.kind === "error") return target.usage ? usageError("logout", target.message, context) : fail3(context, target.message);
      return await logOut(target.login, context);
    }
  };
}
var logoutCommand = createLogoutCommand();

// src/cli/commands/set.ts
function parseOnOff(text) {
  if (text === "on") return true;
  if (text === "off") return false;
  return null;
}
function parsePercent(text) {
  if (!/^\d{1,3}$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= 100 ? value : null;
}
function patchFromOptions(options) {
  const patch = {};
  for (const [option, field] of [["auto", "routing"], ["use-first", "useFirst"]]) {
    const text = options[option];
    if (text === void 0) continue;
    const value = parseOnOff(text);
    if (value === null) return { error: `--${option} takes on or off, not "${text}"` };
    patch[field] = value;
  }
  for (const [option, field] of [["five-hour", "fiveHourLimit"], ["weekly", "weeklyLimit"]]) {
    const text = options[option];
    if (text === void 0) continue;
    const value = parsePercent(text);
    if (value === null) return { error: `--${option} takes a whole number from 1 to 100, not "${text}"` };
    patch[field] = value;
  }
  if (options.alias !== void 0) patch.alias = options.alias;
  if (Object.keys(patch).length === 0) return { error: "give at least one of --auto, --five-hour, --weekly, --use-first or --alias" };
  return patch;
}
function aliasSource(login) {
  if (login.aliasSetByUser) return "set by you";
  if (login.alias === login.id) return "the id, while kurmis knows no email for the login";
  return "made from the email";
}
function formatLoginSettings(login) {
  const lines = [`${login.alias} (id ${login.id})`];
  if (login.usedByPlainClaude) lines.push(`  ${plainClaudeLoginText()}`);
  lines.push(
    `  alias       ${login.alias} (${aliasSource(login)})`,
    `  auto        ${login.routing ? "on" : "off"}`,
    `  five-hour   ${String(login.fiveHourLimit)}%`,
    `  weekly      ${String(login.weeklyLimit)}%`,
    `  use-first   ${login.useFirst ? "on" : "off"}`
  );
  return lines.join("\n");
}
function failWith(context, message) {
  writeLine(context.stderr, `kurmis set: ${message}`);
  return EXIT_FAILURE;
}
function createSetCommand(deps = {}) {
  const daemon = deps.daemon ?? realDaemonClient;
  return {
    name: "set",
    summary: "Change a login's routing settings or alias",
    usage: `Usage: kurmis set <login> [--auto on|off] [--five-hour <1-100>] [--weekly <1-100>]
                       [--use-first on|off] [--alias <alias>]

Changes a login's settings and prints them. A running daemon uses them at once.

<login> is an alias or id that "kurmis status" shows.

Options:
  --auto on|off         Whether Auto routing may use the login. "--login <login>" uses it
                        either way.
  --five-hour <1-100>   Auto routing stops using the login while its five-hour window is at
                        or above this percentage.
  --weekly <1-100>      The same for the weekly window.
  --use-first on|off    Take this login before every other one that has room.
  --alias <alias>       Rename the login: 1 to 32 lowercase letters, digits, "-" or "_",
                        starting with a letter or digit. An alias you set no longer follows
                        the account's email.
  -h, --help            Show this help.

Example:
  kurmis set work-example --weekly 80 --use-first on`,
    async run(args, context) {
      const parsed = parseCommandArgs("set", args, {
        auto: { type: "string" },
        "five-hour": { type: "string" },
        weekly: { type: "string" },
        "use-first": { type: "string" },
        alias: { type: "string" }
      }, context, true);
      if (typeof parsed === "number") return parsed;
      if (parsed.positionals.length !== 1) return usageError("set", "takes one login, by its alias or id", context);
      const patch = patchFromOptions(parsed.values);
      if ("error" in patch) return usageError("set", patch.error, context);
      let login;
      try {
        const config = loadConfig();
        const resolved = resolveLogin(config, parsed.positionals[0]);
        if ("error" in resolved) return usageError("set", `${resolved.error}; "kurmis status" shows the logins`, context);
        const target = resolved.login;
        if (patch.alias !== void 0) {
          const problem = aliasProblem(config, target, patch.alias);
          if (problem !== null) return usageError("set", problem, context);
        }
        const changed = changeConfig((current) => updateLogin(current, target.id, patch));
        login = findLogin(changed, target.id);
      } catch (error) {
        if (error instanceof ConfigError) return failWith(context, error.message);
        throw error;
      }
      writeLine(context.stdout, formatLoginSettings(login));
      const reload = reloadText(await reloadIfRunning(daemon, context.env));
      if (reload !== null) writeLine(context.stdout, reload);
      return EXIT_OK;
    }
  };
}
var setCommand = createSetCommand();

// src/cli/commands/setup.ts
var import_node_fs25 = require("node:fs");
var import_node_os13 = require("node:os");
var import_node_path24 = require("node:path");
var import_promises3 = require("node:readline/promises");

// src/data/remove-data-folder.ts
var import_node_fs20 = require("node:fs");
var import_node_path20 = require("node:path");
var FOLDERS = ["claude", "locks", "probe", "settings"];
var FILES = [
  "autostart.js",
  "autostart.vbs",
  "config.json",
  "daemon.json",
  "daemon.log",
  "key",
  "paused.json",
  "settings-files.json",
  "state.json"
];
var DESKTOP_FILES = [".ds_store", "thumbs.db", "desktop.ini"];
function isKurmisEntry(name) {
  if (FOLDERS.includes(name) || FILES.includes(name)) return true;
  if (name.startsWith(".key-")) return true;
  return FILES.some((file) => name.startsWith(`${file}.`));
}
function isDesktopFile(name) {
  return DESKTOP_FILES.includes(name.toLowerCase());
}
function lstatOrNull(path) {
  try {
    return (0, import_node_fs20.lstatSync)(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function removeDataFolder(platform = process.platform) {
  const path = kurmisHome();
  const stat = lstatOrNull(path);
  if (stat === null) return { path, removed: true, left: [] };
  const link = stat.isSymbolicLink();
  const folder = link ? import_node_fs20.realpathSync.native(path) : path;
  const root = import_node_fs20.realpathSync.native(folder);
  for (const name of (0, import_node_fs20.readdirSync)(folder)) {
    if (isKurmisEntry(name)) removeTreeSync((0, import_node_path20.join)(folder, name), { platform, root });
  }
  const others = (0, import_node_fs20.readdirSync)(folder);
  const left = others.filter((name) => !isDesktopFile(name));
  if (left.length > 0) return { path, removed: false, left };
  for (const name of others) removeTreeSync((0, import_node_path20.join)(folder, name), { platform, root });
  retryWhileLockedSync(() => (0, import_node_fs20.rmdirSync)(folder), platform);
  if (link) removeTreeSync(path, { platform });
  return { path, removed: true, left: [] };
}

// src/platform/autostart.ts
var import_node_fs22 = require("node:fs");

// src/platform/windows-autostart.ts
var import_node_fs21 = require("node:fs");
var import_node_path21 = require("node:path");
var RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
var RUN_VALUE_NAME = "kurmis";
var REG_VARIABLE = SYSTEM_PROGRAM_VARIABLES.reg;
var REG_TIMEOUT_MS = 3e4;
var RUN_ENTRY_DESCRIPTION = `${RUN_KEY} (value "${RUN_VALUE_NAME}")`;
function regProgram(env = process.env, processEnv = process.env) {
  return systemProgram("reg", env, processEnv);
}
function wscriptPath(env = process.env, processEnv = process.env) {
  return systemProgram("wscript", env, processEnv);
}
function regFor(env = process.env) {
  const program = regProgram(env);
  return (args) => runProgram(program, args, { timeoutMs: REG_TIMEOUT_MS, env });
}
function runValueData(wscript, scriptPath) {
  return windowsCommandLine([wscript, "//B", "//Nologo", "//E:JScript", scriptPath]);
}
var SCRIPT_HOST_SETTINGS_KEYS = [
  "HKCU\\Software\\Microsoft\\Windows Script Host\\Settings",
  "HKLM\\Software\\Microsoft\\Windows Script Host\\Settings"
];
function scriptHostDisabled(query) {
  if (query.code !== 0 || query.error !== null) return false;
  const value = parseRegQuery(query.stdout, "Enabled");
  return value !== null && /^(0x0+|0)$/i.test(value.data.trim());
}
function sameRunData(read, written) {
  const pattern = (written.match(/[\u0080-\uffff]+|[^\u0080-\uffff]+/g) ?? []).map((part) => {
    if (part.charCodeAt(0) < 128) return part.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
    return `[\\s\\S]{1,${String(part.length * 2)}}`;
  }).join("");
  return new RegExp(`^${pattern}$`).test(read);
}
function regAddArgs(data) {
  return ["add", RUN_KEY, "/v", RUN_VALUE_NAME, "/t", "REG_SZ", "/d", data, "/f"];
}
function regQueryArgs() {
  return ["query", RUN_KEY, "/v", RUN_VALUE_NAME];
}
function regListArgs() {
  return ["query", RUN_KEY];
}
function regDeleteArgs() {
  return ["delete", RUN_KEY, "/v", RUN_VALUE_NAME, "/f"];
}
function parseRegQuery(stdout, name) {
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^ {4}(.+?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/.exec(line);
    if (match !== null && (match[1] ?? "").toLowerCase() === name.toLowerCase()) {
      return { type: match[2] ?? "", data: match[3] ?? "" };
    }
  }
  return null;
}
function jscriptString(text) {
  if (/[\r\n\u2028\u2029]/.test(text)) throw new Error("a value for the logon script has a line break in it");
  return `"${text.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}
function windowsAutostartEnvironment(env = process.env, processEnv = process.env) {
  const out = {};
  const hooks = inheritedTestHooks(env, processEnv);
  for (const name of DAEMON_JOB_VARIABLES) {
    const value = env[name] || hooks[name];
    if (value !== void 0 && value !== "") out[name] = name === "KURMIS_HOME" ? import_node_path21.win32.resolve(value) : value;
  }
  return out;
}
function autostartCommandLine(script) {
  const assignments = Object.entries(script.environment).flatMap(([name, value]) => ["--env", `${name}=${value}`]);
  return windowsCommandLine([...script.programArguments, ...assignments]);
}
var PERCENT_SIGN_VARIABLE = "KURMIS_PERCENT_SIGN";
function autostartScript(script) {
  const command = autostartCommandLine(script);
  const lines = [
    "// Written by kurmis setup: starts the kurmis daemon at logon without a console window.",
    "// kurmis setup --uninstall-and-logout removes it.",
    'var shell = new ActiveXObject("WScript.Shell");',
    `shell.CurrentDirectory = ${jscriptString(script.cwd)};`
  ];
  if (command.includes("%")) {
    const escaped = command.replaceAll("%", `%${PERCENT_SIGN_VARIABLE}%`);
    lines.push(
      `// shell.Run replaces %NAME% with the variable NAME, so each percent sign is written as ${PERCENT_SIGN_VARIABLE}.`,
      `shell.Environment("Process").Item(${jscriptString(PERCENT_SIGN_VARIABLE)}) = "%";`,
      `var command = ${jscriptString(escaped)};`,
      `if (shell.ExpandEnvironmentStrings(command) == ${jscriptString(command)}) shell.Run(command, 0, false);`
    );
  } else {
    lines.push(`shell.Run(${jscriptString(command)}, 0, false);`);
  }
  return `${lines.join("\r\n")}\r
`;
}
var UTF16_BOM = Buffer.from([255, 254]);
function encodeScript(text) {
  return Buffer.concat([UTF16_BOM, Buffer.from(text, "utf16le")]);
}
function readScript(path) {
  let bytes;
  try {
    bytes = (0, import_node_fs21.readFileSync)(path);
  } catch {
    return null;
  }
  if (bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 254) return bytes.subarray(2).toString("utf16le");
  return bytes.toString("utf8");
}
function regSaid(result) {
  if (result.error !== null) return result.error;
  const said = `${result.stderr}
${result.stdout}`.replace(/\s+/g, " ").trim();
  return said === "" ? `exit ${String(result.code)}` : `exit ${String(result.code)}: ${said}`;
}
var ok2 = (result) => result.code === 0 && result.error === null;
function userProfile(env) {
  return env.USERPROFILE ?? env.HOME ?? (0, import_node_path21.dirname)(windowsAutostartScriptPath());
}
async function scriptHostProblem(wscript, reg) {
  if (!(0, import_node_fs21.existsSync)(wscript)) {
    return `${wscript} does not exist, so Windows Script Host, which starts the daemon at logon without a console window, is not installed or was removed.`;
  }
  for (const key of SCRIPT_HOST_SETTINGS_KEYS) {
    if (scriptHostDisabled(await reg(["query", key, "/v", "Enabled"]))) {
      return `Windows Script Host, which starts the daemon at logon without a console window, is turned off ("Enabled" is 0 under ${key}). Turn it on, or ask whoever manages this machine, and run kurmis setup again.`;
    }
  }
  return null;
}
function removeOldVbsScript(scriptPath) {
  const old = (0, import_node_path21.join)((0, import_node_path21.dirname)(scriptPath), "autostart.vbs");
  if (old === scriptPath || !(0, import_node_fs21.existsSync)(old)) return false;
  (0, import_node_fs21.rmSync)(old, { force: true });
  return true;
}
function percentWarning(wscript, scriptPath) {
  const named = [wscript, scriptPath].filter((path) => path.includes("%"));
  if (named.length === 0) return null;
  const advice = scriptPath.includes("%") ? `To be sure, use a kurmis data folder whose path has no "%" instead of ${import_node_path21.win32.dirname(scriptPath)}: set KURMIS_HOME to that folder for your Windows user and run kurmis setup again. The extra logins then have to be added again there with "kurmis login".` : 'The Windows folder (SystemRoot) has the "%" in its path, which kurmis cannot change.';
  return `The logon entry names ${named.join(" and ")}, and a "%" in a path there may be read as the start of a variable name (%NAME%) at login, so the daemon may not start at login. ${advice} The entry was written anyway, and the next "kurmis claude" starts the daemon when it is not running.`;
}
function withPercentWarning(result, wscript, scriptPath) {
  const warning = percentWarning(wscript, scriptPath);
  return warning === null ? result : { ...result, warning, warningOnly: true };
}
async function registerWindowsAutostart(options) {
  const reg = options.reg ?? regFor(options.env);
  const scriptPath = options.scriptPath ?? windowsAutostartScriptPath();
  if (options.programArguments === void 0) throw new Error("registerWindowsAutostart needs programArguments");
  let text;
  try {
    text = autostartScript({
      programArguments: options.programArguments,
      environment: windowsAutostartEnvironment(options.env),
      cwd: userProfile(options.env)
    });
  } catch (error) {
    return { changed: false, where: null, warning: `The logon entry was not written: ${error.message}.` };
  }
  const wscript = wscriptPath(options.env);
  const unusable = await scriptHostProblem(wscript, reg);
  if (unusable !== null) {
    return {
      changed: false,
      where: null,
      warning: `The logon entry was not written: ${unusable} The next "kurmis claude" starts the daemon anyway.`,
      noEntryPossible: true
    };
  }
  let changed = false;
  if (readScript(scriptPath) !== text) {
    makePrivateDirSync((0, import_node_path21.dirname)(scriptPath));
    (0, import_node_fs21.writeFileSync)(scriptPath, encodeScript(text));
    changed = true;
  }
  const data = runValueData(wscript, scriptPath);
  const query = await reg(regQueryArgs());
  const current = ok2(query) ? parseRegQuery(query.stdout, RUN_VALUE_NAME) : null;
  if (current !== null && current.type === "REG_SZ" && sameRunData(current.data, data)) {
    if (removeOldVbsScript(scriptPath)) changed = true;
    return withPercentWarning({ changed, where: RUN_ENTRY_DESCRIPTION }, wscript, scriptPath);
  }
  const added = await reg(regAddArgs(data));
  if (!ok2(added)) {
    return { changed, where: null, warning: `reg.exe could not write the logon entry ${RUN_ENTRY_DESCRIPTION} (${regSaid(added)}).` };
  }
  removeOldVbsScript(scriptPath);
  return withPercentWarning({ changed: true, where: RUN_ENTRY_DESCRIPTION }, wscript, scriptPath);
}
async function unregisterWindowsAutostart(options) {
  const reg = options.reg ?? regFor(options.env);
  const scriptPath = options.scriptPath ?? windowsAutostartScriptPath();
  let changed = false;
  const query = await reg(regQueryArgs());
  let present;
  if (ok2(query)) {
    present = parseRegQuery(query.stdout, RUN_VALUE_NAME) !== null;
  } else {
    const listing = await reg(regListArgs());
    if (!ok2(listing)) {
      return {
        changed,
        where: RUN_ENTRY_DESCRIPTION,
        warning: `reg.exe could not read the logon entry ${RUN_ENTRY_DESCRIPTION} (${regSaid(query)}), so it may still be there. ${scriptPath}, which that entry runs, is kept.`
      };
    }
    present = parseRegQuery(listing.stdout, RUN_VALUE_NAME) !== null;
  }
  if (present) {
    const deleted = await reg(regDeleteArgs());
    if (!ok2(deleted)) {
      return {
        changed,
        where: RUN_ENTRY_DESCRIPTION,
        warning: `reg.exe could not remove the logon entry ${RUN_ENTRY_DESCRIPTION} (${regSaid(deleted)}). ${scriptPath}, which that entry runs, is kept.`
      };
    }
    changed = true;
  }
  if (readScript(scriptPath) !== null) {
    (0, import_node_fs21.rmSync)(scriptPath, { force: true });
    changed = true;
  }
  if (removeOldVbsScript(scriptPath)) changed = true;
  return { changed, where: RUN_ENTRY_DESCRIPTION };
}

// src/platform/autostart.ts
var UNSUPPORTED = 'Starting the daemon at login is not supported on this platform; the next "kurmis claude" starts it.';
var NO_ENTRY = "kurmis is not running from its bundle, so there is no program to start at login; run kurmis setup from the installed kurmis.";
function loginProgram(options, platform) {
  const entry = options.entry === void 0 ? kurmisEntry({ env: options.env }) : options.entry;
  if (entry === null) return null;
  const node = options.nodePath ?? nodeForJobs({ env: options.env, platform });
  return [node, entry, ...DAEMON_START_ARGS];
}
function readText(path) {
  try {
    return (0, import_node_fs22.readFileSync)(path, "utf8");
  } catch {
    return null;
  }
}
async function registerAutostart(options) {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "win32") return { changed: false, where: null, warning: UNSUPPORTED };
  const programArguments = loginProgram(options, platform);
  if (programArguments === null) return { changed: false, where: null, warning: NO_ENTRY };
  const node = programArguments[0] ?? "";
  const temporary = isTemporaryPath(node, temporaryFolders(options.env, platform), platform) ? `The login item starts Node from ${node}, which is in a temporary folder and may be gone at your next login. Run kurmis setup again from a shell whose node is installed in a lasting place (for example, not one of fnm's per-shell folders).` : null;
  const result = platform === "win32" ? await registerWindowsAutostart({
    env: options.env,
    programArguments,
    ...options.windowsScriptPath === void 0 ? {} : { scriptPath: options.windowsScriptPath },
    ...options.reg === void 0 ? {} : { reg: options.reg }
  }) : await registerLaunchAgent(options, programArguments);
  if (temporary === null) return result;
  if (result.warning !== void 0) return { ...result, warning: `${result.warning} ${temporary}` };
  return { ...result, warning: temporary, warningOnly: true };
}
async function unregisterAutostart(options) {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return await unregisterWindowsAutostart({
      env: options.env,
      ...options.windowsScriptPath === void 0 ? {} : { scriptPath: options.windowsScriptPath },
      ...options.reg === void 0 ? {} : { reg: options.reg }
    });
  }
  if (platform !== "darwin") return { changed: false, where: null };
  return await unregisterLaunchAgent(options);
}
async function registerLaunchAgent(options, programArguments) {
  const launchctl = options.launchctl ?? launchctlFor(options.env);
  const path = autostartPlistPath();
  const plist = daemonJobPlist({ label: AUTOSTART_LABEL, programArguments, environment: daemonJobEnvironment(options.env) });
  const written = readText(path) !== plist;
  if (written) await writeFileAtomic(path, plist, { mode: 420 });
  const state = await jobState(AUTOSTART_LABEL, launchctl, options.uid);
  if (state.loaded && !written && (state.path === null || state.path === path)) return { changed: false, where: path };
  try {
    if (state.loaded) await bootoutJob(AUTOSTART_LABEL, launchctl, options.uid);
    await bootstrapJob(path, launchctl, options.uid);
  } catch (error) {
    return {
      changed: true,
      where: path,
      warning: `The login item is written and starts the daemon at your next login, but it could not be loaded now: ${error.message}`,
      loadsAtNextLogin: true
    };
  }
  return { changed: true, where: path };
}
async function unregisterLaunchAgent(options) {
  const launchctl = options.launchctl ?? launchctlFor(options.env);
  const path = autostartPlistPath();
  let changed = false;
  let warning;
  try {
    changed = await bootoutJob(AUTOSTART_LABEL, launchctl, options.uid);
  } catch (error) {
    warning = `${error.message} The login item's file is removed, so it does not start the daemon at the next login.`;
  }
  if (readText(path) !== null) {
    (0, import_node_fs22.rmSync)(path, { force: true });
    changed = true;
  }
  return warning === void 0 ? { changed, where: path } : { changed, where: path, warning };
}

// src/cli/global-routing.ts
var import_node_fs24 = require("node:fs");
var import_node_path23 = require("node:path");

// src/cli/global-settings.ts
var import_node_fs23 = require("node:fs");
var import_node_path22 = require("node:path");
var BASE_URL = "ANTHROPIC_BASE_URL";
var CUSTOM_HEADERS2 = "ANTHROPIC_CUSTOM_HEADERS";
var KEY_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", ...OAUTH_TOKEN_VARIABLES];
var BOM = "\uFEFF";
var LOOPBACK_URL = /^http:\/\/127\.0\.0\.1:(\d{1,5})\/?$/;
var SettingsFileError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SettingsFileError";
  }
};
function isWhitespace2(char) {
  return char === " " || char === "	" || char === "\n" || char === "\r";
}
var Scanner = class {
  constructor(text) {
    this.text = text;
  }
  text;
  skipWhitespace(pos) {
    while (isWhitespace2(this.text[pos])) pos++;
    return pos;
  }
  /** The end of the string whose opening quote is at `pos`. */
  stringEnd(pos) {
    let i = pos + 1;
    while (i < this.text.length) {
      const char = this.text[i];
      if (char === "\\") i += 2;
      else if (char === '"') return i + 1;
      else i++;
    }
    throw new SettingsFileError("the file ends inside a string");
  }
  /** The end of the value that starts at `pos`. */
  valueEnd(pos) {
    const char = this.text[pos];
    if (char === '"') return this.stringEnd(pos);
    if (char === "{" || char === "[") return this.containerEnd(pos);
    let i = pos;
    while (i < this.text.length && !isWhitespace2(this.text[i]) && !",]}".includes(this.text[i])) i++;
    return i;
  }
  containerEnd(pos) {
    let depth = 0;
    let i = pos;
    while (i < this.text.length) {
      const char = this.text[i];
      if (char === '"') {
        i = this.stringEnd(i);
        continue;
      }
      if (char === "{" || char === "[") depth++;
      else if (char === "}" || char === "]") {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    throw new SettingsFileError("the file ends inside an object or a list");
  }
  /** The members of the object whose `{` is at `open`. */
  object(open3) {
    const members = [];
    let pos = this.skipWhitespace(open3 + 1);
    if (this.text[pos] === "}") return { open: open3, close: pos, members };
    for (; ; ) {
      const keyStart = pos;
      const keyEnd = this.stringEnd(keyStart);
      const name = JSON.parse(this.text.slice(keyStart, keyEnd));
      pos = this.skipWhitespace(keyEnd) + 1;
      const valueStart = this.skipWhitespace(pos);
      const valueEnd = this.valueEnd(valueStart);
      members.push({ name, keyStart, keyEnd, valueStart, valueEnd });
      pos = this.skipWhitespace(valueEnd);
      if (this.text[pos] === "}") return { open: open3, close: pos, members };
      pos = this.skipWhitespace(pos + 1);
    }
  }
};
function isPlainObject3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseSettings2(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SettingsFileError(`it is ${notJsonText(text)}`);
  }
  if (!isPlainObject3(value)) throw new SettingsFileError("its top level is not a JSON object");
  const scanner = new Scanner(text);
  const top = scanner.object(scanner.skipWhitespace(0));
  const envMembers = top.members.filter((member) => member.name === "env");
  if (envMembers.length > 1) throw new SettingsFileError('it has more than one "env" key');
  const envMember = envMembers[0];
  if (envMember === void 0) return { text, top, env: null };
  const envValue = value.env;
  if (!isPlainObject3(envValue)) throw new SettingsFileError('its "env" is not a JSON object');
  const node = scanner.object(envMember.valueStart);
  for (const name of ROUTING_VARIABLES) {
    if (node.members.filter((member) => member.name === name).length > 1) {
      throw new SettingsFileError(`its "env" has more than one "${name}" key`);
    }
  }
  return { text, top, env: { member: envMember, node, value: envValue } };
}
function layoutOf(parsed) {
  const eol = parsed.text.includes("\r\n") ? "\r\n" : "\n";
  const first = parsed.top.members[0];
  let unit = "  ";
  if (first !== void 0) {
    const before = parsed.text.slice(parsed.top.open + 1, first.keyStart);
    const newline = before.lastIndexOf("\n");
    if (newline >= 0 && before.length > newline + 1) unit = before.slice(newline + 1);
  }
  return { eol, unit, colon: colonOf(parsed.text, parsed.top, ": ") };
}
function lineIndent(text, pos) {
  const start2 = text.lastIndexOf("\n", pos - 1) + 1;
  let end = start2;
  while (text[end] === " " || text[end] === "	") end++;
  return text.slice(start2, end);
}
function colonOf(text, node, fallback) {
  const first = node.members[0];
  return first === void 0 ? fallback : text.slice(first.keyEnd, first.valueStart);
}
function separatorOf(text, node, layout) {
  const [first, second] = node.members;
  const gap = second === void 0 ? text.slice(node.open + 1, first.keyStart) : text.slice(first.valueEnd, second.keyStart).replace(",", "");
  const newline = gap.lastIndexOf("\n");
  return newline >= 0 ? `${layout.eol}${gap.slice(newline + 1)}` : gap;
}
function addMember(text, node, name, valueJson, layout) {
  const member = `${JSON.stringify(name)}${colonOf(text, node, layout.colon)}${valueJson}`;
  const last = node.members.at(-1);
  if (last !== void 0) {
    return `${text.slice(0, last.valueEnd)},${separatorOf(text, node, layout)}${member}${text.slice(last.valueEnd)}`;
  }
  if (!text.includes("\n")) {
    return `${text.slice(0, node.open + 1)}${member}${text.slice(node.close)}`;
  }
  const outer = lineIndent(text, node.open);
  return `${text.slice(0, node.open + 1)}${layout.eol}${outer}${layout.unit}${member}${layout.eol}${outer}${text.slice(node.close)}`;
}
function removeMember(text, node, index) {
  const member = node.members[index];
  if (node.members.length === 1) {
    return `${text.slice(0, node.open + 1)}${text.slice(node.close)}`;
  }
  if (index > 0) {
    const previous = node.members[index - 1];
    return `${text.slice(0, previous.valueEnd)}${text.slice(member.valueEnd)}`;
  }
  const next = node.members[1];
  return `${text.slice(0, member.keyStart)}${text.slice(next.keyStart)}`;
}
function replaceValue(text, member, valueJson) {
  return `${text.slice(0, member.valueStart)}${valueJson}${text.slice(member.valueEnd)}`;
}
function newEnvJson(values, outerIndent, layout, oneLine) {
  const entries = Object.entries(values).map(([name, value]) => `${JSON.stringify(name)}${layout.colon}${JSON.stringify(value)}`);
  if (oneLine) return `{${entries.join(layout.colon.endsWith(" ") ? ", " : ",")}}`;
  const inner = `${outerIndent}${layout.unit}`;
  return `{${layout.eol}${entries.map((entry) => `${inner}${entry}`).join(`,${layout.eol}`)}${layout.eol}${outerIndent}}`;
}
function kurmisEnvValues(values, existingHeaders) {
  const routed = routedClaudeEnv({
    port: values.port,
    key: values.key,
    login: null,
    startedOn: null,
    secureStorageDir: null,
    inheritedCustomHeaders: null
  });
  const out = {};
  for (const name of ROUTING_VARIABLES) {
    const value = routed.set[name];
    if (value !== void 0) out[name] = value;
  }
  if (values.credentialsOfItsOwn === true) out[CUSTOM_HEADERS2] = withRouteHeaders(null, values.key, null, STARTED_ON_NONE);
  const theirs = othersHeaderLines(existingHeaders ?? "");
  if (theirs.length > 0) out[CUSTOM_HEADERS2] = [...theirs, out[CUSTOM_HEADERS2]].join("\n");
  return out;
}
function hasKurmisHeader(headers) {
  return typeof headers === "string" && parseCustomHeaders(headers).some((header) => header.name.toLowerCase() === KEY_HEADER);
}
function othersHeaderLines(headers) {
  return headers.split(/\r?\n/).filter((line) => {
    const colon = line.indexOf(":");
    const name = colon < 0 ? "" : line.slice(0, colon).trim().toLowerCase();
    return line.trim().length > 0 && !KURMIS_HEADERS.includes(name);
  });
}
function isKurmisBaseUrl(value, env, port) {
  if (typeof value !== "string") return false;
  const match = LOOPBACK_URL.exec(value);
  if (match === null) return false;
  return port !== null && Number(match[1]) === port || hasKurmisHeader(env[CUSTOM_HEADERS2]);
}
function routesThroughKurmis(text, port) {
  if (text === null) return false;
  let value;
  try {
    value = JSON.parse(withoutBom2(text));
  } catch {
    return false;
  }
  if (!isPlainObject3(value) || !isPlainObject3(value.env)) return false;
  return isKurmisBaseUrl(value.env[BASE_URL], value.env, port);
}
function displayValue(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}
function keyVariableWarnings(env) {
  if (env === void 0) return [];
  return KEY_VARIABLES.filter((name) => env[name] !== void 0 && env[name] !== "").map((name) => OAUTH_TOKEN_VARIABLES.includes(name) ? `The "env" also sets ${name}, so a plain claude signs in with that subscription token instead of the credentials of the login plain claude uses, and a request kurmis sends on that login may be billed to the token's account. Kurmis leaves it; remove it if you want your logins used. "kurmis claude" does not use it.` : `The "env" also sets ${name}, so Claude Code signs its requests with that key instead of a subscription login. Kurmis leaves it; remove it if you want your logins used.`);
}
function backupBefore(backupText) {
  if (backupText === null || backupText === void 0) return null;
  let value;
  try {
    value = JSON.parse(withoutBom2(backupText));
  } catch {
    return null;
  }
  if (!isPlainObject3(value)) return null;
  if (value.env === void 0) return { env: null };
  if (!isPlainObject3(value.env)) return null;
  const env = value.env;
  if (hasKurmisHeader(env[CUSTOM_HEADERS2])) return null;
  return { env };
}
function withoutBom2(text) {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}
function emptyEdit(text) {
  return { text, changed: false, changes: [], envCreated: false, envRemoved: false, hadKurmis: false, warnings: [] };
}
function applySetupToText(text, values) {
  if (text === null || text.trim().length === 0) {
    const env2 = kurmisEnvValues(values, null);
    const created = `${JSON.stringify({ env: env2 }, null, 2)}
`;
    const eol = text?.includes("\r\n") === true ? created.replace(/\n/g, "\r\n") : created;
    return {
      text: eol,
      changed: true,
      changes: Object.keys(env2).map((name) => ({ name, action: "added" })),
      envCreated: true,
      envRemoved: false,
      hadKurmis: false,
      warnings: []
    };
  }
  const bom = text.startsWith(BOM) ? BOM : "";
  let body = text.slice(bom.length);
  let parsed = parseSettings2(body);
  const layout = layoutOf(parsed);
  const result = emptyEdit(text);
  const env = parsed.env?.value ?? {};
  result.warnings.push(...keyVariableWarnings(parsed.env?.value));
  const baseUrl = env[BASE_URL];
  if (baseUrl !== void 0 && !isKurmisBaseUrl(baseUrl, env, values.port)) {
    throw new SettingsFileError(
      `its "env" already sets ${BASE_URL} to ${displayValue(baseUrl)}, which is not kurmis' address. Kurmis does not replace it; remove it from the file first if you want Claude Code routed through kurmis.`
    );
  }
  const headers = env[CUSTOM_HEADERS2];
  if (headers !== void 0 && typeof headers !== "string") {
    throw new SettingsFileError(`its "env" sets ${CUSTOM_HEADERS2} to something other than a string`);
  }
  const wanted = kurmisEnvValues(values, headers ?? null);
  result.hadKurmis = baseUrl !== void 0 && isKurmisBaseUrl(baseUrl, env, values.port) || hasKurmisHeader(headers);
  if (parsed.env === null) {
    const outer = parsed.top.members.length > 0 ? lineIndent(body, parsed.top.members[0].keyStart) : `${lineIndent(body, parsed.top.open)}${layout.unit}`;
    const json = newEnvJson(wanted, outer, layout, !body.includes("\n"));
    body = addMember(body, parsed.top, "env", json, layout);
    result.changes.push(...Object.keys(wanted).map((name) => ({ name, action: "added" })));
    result.envCreated = true;
  } else {
    for (const [name, value] of Object.entries(wanted)) {
      const envNode = parsed.env.node;
      const member = envNode.members.find((candidate) => candidate.name === name);
      const current = parsed.env.value[name];
      if (member === void 0) {
        body = addMember(body, envNode, name, JSON.stringify(value), layout);
        result.changes.push({ name, action: "added" });
      } else if (current === value) {
        result.changes.push({ name, action: "unchanged" });
      } else if (name === BASE_URL) {
        body = replaceValue(body, member, JSON.stringify(value));
        result.changes.push({ name, action: "updated" });
      } else if (name === CUSTOM_HEADERS2) {
        const theirs = othersHeaderLines(current).length > 0;
        body = replaceValue(body, member, JSON.stringify(value));
        result.changes.push({
          name,
          action: hasKurmisHeader(current) ? "updated" : "added",
          ...theirs ? { note: "your own header lines were kept" } : {}
        });
      } else {
        result.changes.push({ name, action: "kept", note: `it holds your own value (${displayValue(current)}), which kurmis leaves` });
      }
      parsed = parseSettings2(body);
    }
  }
  result.text = `${bom}${body}`;
  result.changed = result.text !== text;
  return result;
}
function undoSetupInText(text, values) {
  if (text.trim().length === 0) return emptyEdit(text);
  const bom = text.startsWith(BOM) ? BOM : "";
  let body = text.slice(bom.length);
  let parsed = parseSettings2(body);
  const result = emptyEdit(text);
  if (parsed.env === null) return result;
  const env = parsed.env.value;
  const backup = backupBefore(values.backupText);
  const before = backup?.env ?? null;
  const plain = kurmisEnvValues({ port: values.port ?? 1, key: "unused" }, null);
  const baseUrlIsKurmis = isKurmisBaseUrl(env[BASE_URL], env, values.port);
  for (const name of ROUTING_VARIABLES) {
    const current = parsed.env.value[name];
    if (current === void 0) continue;
    const index = parsed.env.node.members.findIndex((member2) => member2.name === name);
    const member = parsed.env.node.members[index];
    if (name === BASE_URL) {
      if (!baseUrlIsKurmis) {
        result.changes.push({ name, action: "kept", note: `it points at ${displayValue(current)}, not at kurmis` });
        continue;
      }
      body = removeMember(body, parsed.env.node, index);
      result.changes.push({ name, action: "removed" });
    } else if (name === CUSTOM_HEADERS2) {
      if (typeof current !== "string" || !parseCustomHeaders(current).some((header) => KURMIS_HEADERS.includes(header.name.toLowerCase()))) {
        continue;
      }
      const theirs = othersHeaderLines(current);
      if (theirs.length === 0) {
        body = removeMember(body, parsed.env.node, index);
        result.changes.push({ name, action: "removed" });
      } else {
        const original = before?.[name];
        const restored = typeof original === "string" && sameLines(othersHeaderLines(original), theirs) ? original : theirs.join("\n");
        body = replaceValue(body, member, JSON.stringify(restored));
        result.changes.push({ name, action: "updated", note: "kurmis' header lines were removed and yours were kept" });
      }
    } else if (current !== plain[name]) {
      result.changes.push({ name, action: "kept", note: `its value (${displayValue(current)}) is not the one kurmis sets` });
      continue;
    } else if (before !== null && before[name] === current) {
      result.changes.push({ name, action: "kept", note: "the file already had this value before kurmis changed it" });
      continue;
    } else {
      body = removeMember(body, parsed.env.node, index);
      result.changes.push({ name, action: "removed" });
    }
    parsed = parseSettings2(body);
  }
  const envWasThere = backup !== null && backup.env !== null;
  if (parsed.env !== null && parsed.env.node.members.length === 0 && !envWasThere && result.changes.some((change) => change.action === "removed")) {
    const index = parsed.top.members.findIndex((member) => member.name === "env");
    body = removeMember(body, parsed.top, index);
    result.envRemoved = true;
  }
  result.text = `${bom}${body}`;
  result.changed = result.text !== text;
  return result;
}
function sameLines(a, b) {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}
function claudeSettingsPath(env) {
  const configDir = env.CLAUDE_CONFIG_DIR;
  if (configDir === void 0 || configDir === "") return claudeUserSettingsPath(env);
  const dir = (0, import_node_path22.resolve)(configDir);
  const inside = (0, import_node_path22.relative)(kurmisHome(), dir);
  if (inside === "" || !inside.startsWith("..") && !(0, import_node_path22.isAbsolute)(inside)) {
    throw new SettingsFileError(
      `CLAUDE_CONFIG_DIR is ${dir}, which is inside kurmis' data folder. Run kurmis setup from a shell without it.`
    );
  }
  return (0, import_node_path22.join)(dir, "settings.json");
}
function backupPathFor(settingsPath) {
  return `${settingsPath}.kurmis-backup`;
}
function readText2(path) {
  try {
    return (0, import_node_fs23.readFileSync)(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function writeTarget(path) {
  try {
    return (0, import_node_fs23.realpathSync)(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let current = path;
  for (let hop = 0; hop < 40; hop++) {
    let stats;
    try {
      stats = (0, import_node_fs23.lstatSync)(current);
    } catch (error) {
      if (error.code === "ENOENT") return current;
      throw error;
    }
    if (!stats.isSymbolicLink()) return current;
    current = (0, import_node_path22.resolve)((0, import_node_path22.dirname)(current), (0, import_node_fs23.readlinkSync)(current));
  }
  throw new SettingsFileError(`${path} is a chain of more than 40 symbolic links`);
}
function linkTargetOf(path) {
  try {
    if (!(0, import_node_fs23.lstatSync)(path).isSymbolicLink()) return null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return writeTarget(path);
}
function restrictIfPresent(path) {
  try {
    return restrictToUserSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function backUp(path, replace, platform) {
  const backup = backupPathFor(path);
  if (!replace) {
    try {
      (0, import_node_fs23.copyFileSync)(path, backup, import_node_fs23.constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code === "EEXIST") return null;
      throw error;
    }
    if (platform !== "win32") (0, import_node_fs23.chmodSync)(backup, PRIVATE_FILE_MODE);
    return backup;
  }
  const temp = `${backup}.${String(process.pid)}.tmp`;
  try {
    (0, import_node_fs23.copyFileSync)(path, temp);
    if (platform !== "win32") (0, import_node_fs23.chmodSync)(temp, PRIVATE_FILE_MODE);
    replaceFileSync(temp, backup);
  } catch (error) {
    (0, import_node_fs23.rmSync)(temp, { force: true });
    throw error;
  }
  return backup;
}
function isReadOnly(mode) {
  return (mode & 128) === 0;
}
function readOnlyError(target) {
  return new SettingsFileError(`it is read-only. Clear that with attrib -R "${target}" and run the command again`);
}
function writeEdit(path, edit, existed, userOnly, platform) {
  const target = writeTarget(path);
  if (!edit.changed) return { backup: null, modeBefore: userOnly && existed ? restrictToUserSync(target, platform) : null };
  const before = existed ? (0, import_node_fs23.statSync)(target).mode & 511 : PRIVATE_FILE_MODE;
  if (platform === "win32" && existed && isReadOnly(before)) {
    throw readOnlyError(target);
  }
  const backup = existed ? backUp(path, userOnly && !edit.hadKurmis, platform) : null;
  const mode = userOnly ? userOnlyMode(before) : before;
  try {
    writeFileAtomicSync(target, edit.text, { mode });
  } catch (error) {
    const code = error.code;
    if (code === "EPERM" || code === "EACCES" || code === "EBUSY") {
      throw new SettingsFileError(`it could not be written (${code}): another program may hold it open, or the file or its folder may not be writable by you`);
    }
    throw error;
  }
  if (platform === "win32") return { backup, modeBefore: null };
  (0, import_node_fs23.chmodSync)(target, mode);
  return { backup, modeBefore: existed && mode !== before ? before : null };
}
function failWith2(path, error) {
  if (error instanceof SettingsFileError) {
    throw new SettingsFileError(`${path} was not changed: ${error.message}`);
  }
  const code = error?.code;
  if (typeof code === "string") {
    throw new SettingsFileError(`${path} was not changed: it, its backup or its folder could not be read or written (${code})`);
  }
  throw error;
}
function setupSettingsFile(path, values, platform = process.platform) {
  let text;
  let edit;
  let written;
  try {
    text = readText2(path);
    edit = applySetupToText(text, values);
    written = writeEdit(path, edit, text !== null, true, platform);
  } catch (error) {
    failWith2(path, error);
  }
  let backupModeBefore;
  try {
    backupModeBefore = written.backup === null ? restrictIfPresent(backupPathFor(path)) : null;
  } catch (error) {
    failWith2(backupPathFor(path), error);
  }
  return {
    ...edit,
    path,
    existed: text !== null,
    backupWritten: written.backup,
    linkTarget: linkTargetOf(path),
    modeBefore: written.modeBefore,
    backupModeBefore
  };
}
function checkSetupSettingsFile(path, values, platform = process.platform) {
  try {
    const text = readText2(path);
    const edit = applySetupToText(text, values);
    if (platform === "win32" && text !== null && isReadOnly((0, import_node_fs23.statSync)(writeTarget(path)).mode)) {
      throw readOnlyError(writeTarget(path));
    }
    return edit.hadKurmis;
  } catch (error) {
    failWith2(path, error);
  }
}
function undoSettingsFile(path, values, platform = process.platform) {
  let text;
  let edit;
  let written;
  try {
    text = readText2(path);
    if (text === null) {
      return { ...emptyEdit(""), path, existed: false, backupWritten: null, linkTarget: null, modeBefore: null, backupModeBefore: null };
    }
    edit = undoSetupInText(text, { ...values, backupText: readText2(backupPathFor(path)) });
    written = writeEdit(path, edit, true, false, platform);
  } catch (error) {
    failWith2(path, error);
  }
  return { ...edit, path, existed: true, backupWritten: written.backup, linkTarget: linkTargetOf(path), modeBefore: null, backupModeBefore: null };
}

// src/cli/global-routing.ts
function globalRoutingState(env) {
  const port = configuredPort2();
  for (const path of settingsFilesWith(settingsPathFor(env)).files) {
    if (routesThroughKurmis(readOrNull(path), port)) return "on";
  }
  return isPaused() ? "paused" : "off";
}
function isPaused() {
  return (0, import_node_fs24.existsSync)(pausedFilePath());
}
function markPaused(now = /* @__PURE__ */ new Date()) {
  writeJsonFileSync(pausedFilePath(), { pausedAt: now.toISOString() }, { mode: PRIVATE_FILE_MODE });
}
function clearPaused() {
  const path = pausedFilePath();
  if (!(0, import_node_fs24.existsSync)(path)) return false;
  (0, import_node_fs24.rmSync)(path, { force: true });
  return true;
}
function recordedSettingsFiles() {
  const path = setupSettingsRecordPath();
  let read;
  try {
    read = readJsonFileSync(path);
  } catch (error) {
    return { files: [], problem: `${path} could not be read (${errorCode2(error)})` };
  }
  if (read.status === "missing") return { files: [], problem: null };
  if (read.status === "corrupt") return { files: [], problem: `${path} is not valid JSON` };
  const files = read.value?.files;
  if (!Array.isArray(files) || !files.every((file) => typeof file === "string" && file !== "")) {
    return { files: [], problem: `${path} has no list of files in "files"` };
  }
  return { files, problem: null };
}
function settingsFilesWith(current, platform = process.platform) {
  const recorded = recordedSettingsFiles();
  const files = [current];
  for (const file of recorded.files) {
    if (!files.some((known) => samePath(known, file, platform))) files.push(file);
  }
  return { files, problem: recorded.problem };
}
function recordSettingsFile(path, platform = process.platform) {
  const record = setupSettingsRecordPath();
  const file = (0, import_node_path23.resolve)(path);
  return withFileLockSync(`${record}.lock`, () => {
    const current = recordedSettingsFiles();
    if (current.files.some((known) => samePath(known, file, platform))) return { damaged: null };
    writeJsonFileSync(record, { version: 1, files: [...current.files, file] }, { mode: PRIVATE_FILE_MODE });
    return { damaged: current.problem };
  });
}
function samePath(a, b, platform) {
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function settingsPathFor(env) {
  try {
    return claudeSettingsPath(env);
  } catch {
    return claudeUserSettingsPath({ ...env, CLAUDE_CONFIG_DIR: "" });
  }
}
function configuredPort2() {
  try {
    return readConfig().port;
  } catch {
    return null;
  }
}
function readOrNull(path) {
  try {
    return (0, import_node_fs24.readFileSync)(path, "utf8");
  } catch {
    return null;
  }
}
function errorCode2(error) {
  return error?.code ?? String(error);
}

// src/cli/commands/setup.ts
var NPM_UNINSTALL = "npm uninstall -g kurmis";
var USAGE2 = `Usage: kurmis setup [--pause | --uninstall-and-logout [--yes]]

Turns global routing on: every Claude Code on this machine goes through kurmis, including a
plain "claude" and the IDE extensions, not only "kurmis claude". Setup starts the daemon, makes
it start when you log in (macOS and Windows), and adds kurmis' address to the "env" block of
~/.claude/settings.json (or the one in CLAUDE_CONFIG_DIR), after saving a copy as
settings.json.kurmis-backup. Claude Code sessions that are already open need a restart.

Options:
  --pause                 Turn global routing off again: plain "claude" and the IDE
                          extensions talk to Anthropic directly. Everything else stays, and
                          "kurmis setup" turns it back on.
  --uninstall-and-logout  Remove everything kurmis set up, and sign out and remove every login
                          you added. The login plain claude uses stays signed in. It lists
                          what it removes and asks first. Then run "npm uninstall -g kurmis".
  --yes                   Do not ask (needed when there is no terminal to ask at).
  -h, --help              Show this help.`;
function changeLine(change, undo) {
  const note = change.note === void 0 ? "" : ` (${change.note})`;
  switch (change.action) {
    case "added":
      return `Added ${change.name}${note}.`;
    case "updated":
      return undo ? `Changed ${change.name}${note}.` : `Updated ${change.name} to kurmis' current value${note}.`;
    case "removed":
      return `Removed ${change.name}${note}.`;
    case "unchanged":
      return null;
    case "kept":
      return `Left ${change.name} as it is: ${change.note ?? "it is not kurmis' value"}.`;
  }
}
function reportFile(result, undo, context) {
  writeLine(context.stdout, `Claude Code settings: ${result.path}`);
  if (result.backupWritten !== null) writeLine(context.stdout, `Saved a copy of the file as it was to ${result.backupWritten}.`);
  if (!undo && !result.existed) writeLine(context.stdout, "Created the file, readable only by you.");
  if (result.modeBefore !== null) {
    writeLine(context.stdout, `Made the file readable only by you, because it holds kurmis' key (its mode was ${modeText(result.modeBefore)}).`);
  }
  if (result.backupModeBefore !== null) {
    writeLine(context.stdout, `Made ${backupPathFor(result.path)} readable only by you (its mode was ${modeText(result.backupModeBefore)}).`);
  }
  if (result.envCreated) writeLine(context.stdout, 'Added an "env" block.');
  for (const change of result.changes) {
    const line = changeLine(change, undo);
    if (line !== null) writeLine(context.stdout, line);
  }
  if (result.envRemoved) writeLine(context.stdout, 'Removed the "env" block, which had nothing else in it.');
  if (!result.changed) {
    writeLine(context.stdout, undo ? "The file has none of kurmis' settings; nothing to take out." : "The file already has kurmis' settings; nothing to change.");
  }
  for (const warning of result.warnings) writeLine(context.stderr, `Warning: ${warning}`);
  if (!undo && result.linkTarget !== null) {
    writeLine(context.stderr, `Warning: ${result.path} is a symbolic link, so kurmis' key is written to the file it points to, ${result.linkTarget}.`);
  }
}
function modeText(mode) {
  return `0${(mode & 511).toString(8).padStart(3, "0")}`;
}
function errorText2(error) {
  return error instanceof Error ? error.message : String(error);
}
function isFileError(error) {
  return error instanceof Error && typeof error.code === "string";
}
async function autostartStep(remove, deps, context) {
  let result;
  try {
    const options = { env: context.env, platform: deps.platform };
    result = remove ? await deps.unregisterAutostart(options) : await deps.registerAutostart(options);
  } catch (error) {
    result = { changed: false, where: null, warning: errorText2(error) };
  }
  const supported = deps.platform === "darwin" || deps.platform === "win32";
  const warnsOnly = result.warningOnly === true || result.loadsAtNextLogin === true || result.noEntryPossible === true || !supported;
  if (!remove && result.warning !== void 0 && warnsOnly) {
    writeLine(context.stderr, `Warning: ${result.warning}`);
    return true;
  }
  if (result.warning !== void 0) {
    writeLine(context.stderr, remove ? `Could not remove the daemon's start at login: ${result.warning}` : `Could not make the daemon start at login: ${result.warning}`);
    return false;
  }
  const where = result.where === null ? "" : ` (${result.where})`;
  if (remove) {
    if (!supported) return true;
    writeLine(context.stdout, result.changed ? `Removed the daemon's start at login${where}.` : "The daemon was not set to start at login.");
  } else {
    writeLine(context.stdout, result.changed ? `The daemon now starts at login${where}.` : `The daemon already starts at login${where}.`);
  }
  return true;
}
async function daemonStep(port, path, hadKurmis, deps, context) {
  const unchanged = hadKurmis ? `${path} was not changed. It still holds kurmis' settings from an earlier setup, so Claude Code that reads it reaches kurmis only while a daemon runs on the port they name. Run "kurmis setup" again once the daemon runs, or "kurmis setup --pause" to take them out.` : `${path} was not changed, so Claude Code does not use kurmis yet. Run "kurmis setup" again once the daemon runs.`;
  try {
    const connection = await deps.daemon.ensureDaemon({ env: context.env });
    if (connection.port !== port) {
      writeLine(
        context.stderr,
        `The daemon runs on port ${String(connection.port)}, but config.json names port ${String(port)}. Stop it with "kurmis daemon stop" and run "kurmis setup" again, so it starts on that port.`
      );
      writeLine(context.stderr, unchanged);
      return null;
    }
    writeLine(context.stdout, `The daemon is running on port ${String(connection.port)}.`);
    return connection.key;
  } catch (error) {
    if (error instanceof DaemonNotUsableError) {
      writeLine(context.stderr, error.message);
      writeLine(context.stderr, unchanged);
      return null;
    }
    writeLine(context.stderr, `The daemon could not be started: ${errorText2(error)}`);
    writeLine(context.stderr, `${unchanged} "kurmis daemon start" starts it and says what is wrong.`);
    return null;
  }
}
async function runningDaemonPid(deps, context) {
  try {
    return (await deps.daemon.findDaemon({ env: context.env }))?.pid ?? null;
  } catch {
    return null;
  }
}
function defaultFolderRefusal(env, platform) {
  const value = env["CLAUDE_CONFIG_DIR"];
  const home = (0, import_node_os13.homedir)();
  if (value === void 0 || !configDirHasOwnCredentials(env, platform)) return null;
  const folder = (0, import_node_path24.join)(home, ".claude");
  const defaultFile = (0, import_node_path24.join)(folder, "settings.json");
  if (namesDefaultClaudeFolder(value, platform, home)) {
    return `CLAUDE_CONFIG_DIR is set to ${value}, which is the default Claude Code folder ${folder}. A claude started with CLAUDE_CONFIG_DIR set keeps its credentials apart from one started without it, even when the variable names that folder, and both read ${defaultFile}, so kurmis cannot write settings there that are right for both. Unset CLAUDE_CONFIG_DIR and run "kurmis setup" again.`;
  }
  if (sharesDefaultSettingsFile(value, platform, home)) {
    return `CLAUDE_CONFIG_DIR is set to ${value}, and ${(0, import_node_path24.join)(value, "settings.json")} is a link to the default Claude Code settings file ${defaultFile}. A claude started with CLAUDE_CONFIG_DIR set signs in with the credentials in ${value}, a plain claude with those in ${folder}, and both read that one file, so kurmis cannot write settings there that are right for both. Unset CLAUDE_CONFIG_DIR and run "kurmis setup" again, or give that folder a settings.json of its own.`;
  }
  return null;
}
function settingsPathOrFail(context) {
  try {
    return claudeSettingsPath(context.env);
  } catch (error) {
    if (!(error instanceof SettingsFileError)) throw error;
    writeLine(context.stderr, `kurmis setup: ${error.message}`);
    return null;
  }
}
function portOrNull() {
  try {
    return readConfig().port;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return null;
  }
}
async function runSetup(deps, context) {
  const refusal = defaultFolderRefusal(context.env, deps.platform);
  if (refusal !== null) {
    writeLine(context.stderr, `kurmis setup: ${refusal}`);
    return EXIT_FAILURE;
  }
  const path = settingsPathOrFail(context);
  if (path === null) return EXIT_FAILURE;
  let port;
  try {
    port = loadConfig().port;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    writeLine(context.stderr, `kurmis setup: ${error.message}`);
    return EXIT_FAILURE;
  }
  let hadKurmis;
  try {
    hadKurmis = checkSetupSettingsFile(path, { port, key: readOrCreateKey() });
  } catch (error) {
    if (!(error instanceof SettingsFileError)) throw error;
    writeLine(context.stderr, `kurmis setup: ${error.message}`);
    return EXIT_FAILURE;
  }
  try {
    const recorded = recordSettingsFile(path, deps.platform);
    if (recorded.damaged !== null) {
      writeLine(context.stderr, `Warning: ${recorded.damaged}. It now names only ${path}, so "kurmis setup --pause" and "kurmis setup --uninstall-and-logout" may not find a settings file an earlier setup changed.`);
    }
  } catch (error) {
    if (!isFileError(error) && !(error instanceof LockTimeoutError)) throw error;
    writeLine(context.stderr, `kurmis setup: ${path} was not changed, because the list of the settings files setup changed, ${setupSettingsRecordPath()}, could not be written: ${errorText2(error)}`);
    return EXIT_FAILURE;
  }
  const key = await daemonStep(port, path, hadKurmis, deps, context);
  if (key === null) return EXIT_FAILURE;
  let result;
  try {
    result = setupSettingsFile(path, { port, key, credentialsOfItsOwn: configDirHasOwnCredentials(context.env, deps.platform) });
  } catch (error) {
    if (!(error instanceof SettingsFileError)) throw error;
    writeLine(context.stderr, `kurmis setup: ${error.message}`);
    return EXIT_FAILURE;
  }
  reportFile(result, false, context);
  if (clearPaused()) writeLine(context.stdout, "Global routing was paused; it is on again.");
  if (configDirHasOwnCredentials(context.env, deps.platform)) {
    writeLine(context.stdout, 'CLAUDE_CONFIG_DIR is set, so a claude that reads this file signs in with the login in that folder, not with the login plain claude uses, which is the one in ~/.claude. Kurmis sends the requests of such a claude only to the extra logins. "kurmis claude" still starts on the login plain claude uses.');
  }
  const ok3 = await autostartStep(false, deps, context);
  if (result.changed) {
    writeLine(context.stdout, "Claude Code sessions that are already open keep the settings they started with; start them again.");
  }
  if (!ok3) {
    writeLine(context.stderr, 'The settings file change above was made; run "kurmis setup" again to finish.');
    return EXIT_FAILURE;
  }
  return EXIT_OK;
}
function undoFiles(files, current, port, context) {
  let changed = false;
  let failed2 = false;
  for (const file of files) {
    try {
      const result = undoSettingsFile(file, { port });
      if (file === current || result.changed) reportFile(result, true, context);
      if (result.changed) changed = true;
    } catch (error) {
      if (!(error instanceof SettingsFileError)) throw error;
      writeLine(context.stderr, `kurmis setup: ${error.message}`);
      failed2 = true;
    }
  }
  return { changed, failed: failed2 };
}
function recordWarning(problem, context) {
  if (problem === null) return;
  writeLine(context.stderr, `Warning: ${problem}, so kurmis may not know every settings file setup changed. A settings file in a CLAUDE_CONFIG_DIR folder can be taken care of by running this command again with that CLAUDE_CONFIG_DIR set.`);
}
async function runPause(deps, context) {
  const path = settingsPathOrFail(context);
  if (path === null) return EXIT_FAILURE;
  const { files, problem } = settingsFilesWith(path, deps.platform);
  recordWarning(problem, context);
  const { changed, failed: failed2 } = undoFiles(files, path, portOrNull(), context);
  if (failed2) {
    writeLine(context.stderr, `Global routing is not paused, since a settings file above still holds kurmis' settings. Fix what is named above and run "kurmis setup --pause" again.`);
    return EXIT_FAILURE;
  }
  const wasPaused = isPaused();
  if (!changed && !wasPaused) {
    writeLine(context.stdout, 'Global routing is not on, so there is nothing to pause. "kurmis setup" turns it on.');
    return EXIT_OK;
  }
  if (!wasPaused) {
    try {
      markPaused();
    } catch (error) {
      if (!isFileError(error)) throw error;
      writeLine(context.stderr, `kurmis setup: kurmis' settings were taken out of the file, but ${pausedFilePath()} could not be written (${error.message}), so "kurmis status" shows global routing as off, not paused. "kurmis setup" turns global routing on again either way.`);
      return EXIT_FAILURE;
    }
  }
  writeLine(context.stdout, wasPaused && !changed ? "Global routing is already paused." : "Paused global routing: a plain claude and the IDE extensions send their requests to Anthropic directly.");
  writeLine(context.stdout, 'The daemon, its start at login, your logins and the settings backup stay. "kurmis setup" turns global routing on again.');
  if (changed) {
    writeLine(context.stdout, "Claude Code sessions that are already open keep the settings they started with, and so keep using kurmis until they end; start them again.");
  }
  if (await runningDaemonPid(deps, context) !== null) {
    writeLine(context.stdout, '"kurmis claude" still uses the daemon; "kurmis daemon stop" stops it.');
  }
  return EXIT_OK;
}
function loginsKurmisAdded(config) {
  const added = extraLogins(config).map((login) => ({
    login: { id: login.id, usedByPlainClaude: false },
    name: login.alias
  }));
  const others = [];
  let names;
  try {
    names = (0, import_node_fs25.readdirSync)(extraLoginsFolder());
  } catch {
    names = [];
  }
  for (const name of names) {
    if (added.some(({ login }) => login.id === name)) continue;
    if (!isLoginId(name) || findLogin(config, name)?.usedByPlainClaude === true) {
      others.push((0, import_node_path24.join)("claude", name));
      continue;
    }
    added.push({ login: { id: name, usedByPlainClaude: false }, name });
  }
  return { added, others };
}
function autostartEntry(platform) {
  if (platform === "darwin") return (0, import_node_fs25.existsSync)(autostartPlistPath()) ? autostartPlistPath() : null;
  if (platform === "win32") return `${RUN_ENTRY_DESCRIPTION}, if it is set`;
  return null;
}
function settingsHaveKurmis(path, port) {
  let text;
  let backupText;
  try {
    try {
      text = (0, import_node_fs25.readFileSync)(path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
    try {
      backupText = (0, import_node_fs25.readFileSync)(backupPathFor(path), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      backupText = null;
    }
  } catch (error) {
    if (!isFileError(error)) throw error;
    throw new SettingsFileError(`${path} cannot be read: ${error.message}`);
  }
  try {
    return undoSetupInText(text, { port, backupText }).changed;
  } catch (error) {
    if (error instanceof SettingsFileError) throw new SettingsFileError(`${path} cannot be changed: ${error.message}`);
    throw error;
  }
}
function listLine(context, text) {
  writeLine(context.stdout, `  - ${text}`);
}
function deleteBackups(files, context) {
  let failed2 = false;
  for (const file of files) {
    const backup = backupPathFor(file);
    try {
      if ((0, import_node_fs25.existsSync)(backup)) {
        (0, import_node_fs25.rmSync)(backup, { force: true });
        writeLine(context.stdout, `Deleted ${backup}.`);
      }
    } catch (error) {
      writeLine(context.stderr, `Could not delete ${backup}: ${errorText2(error)}`);
      failed2 = true;
    }
  }
  return failed2;
}
async function runUninstall(yes, deps, context) {
  const path = settingsPathOrFail(context);
  if (path === null) return EXIT_FAILURE;
  const { files, problem } = settingsFilesWith(path, deps.platform);
  let config;
  let withKurmis;
  try {
    config = readConfig();
    withKurmis = files.filter((file) => settingsHaveKurmis(file, config.port));
  } catch (error) {
    if (!(error instanceof ConfigError) && !(error instanceof SettingsFileError)) throw error;
    writeLine(context.stderr, `kurmis setup: ${error.message} Nothing was removed.`);
    return EXIT_FAILURE;
  }
  recordWarning(problem, context);
  const { added: logins, others } = loginsKurmisAdded(config);
  const backups = files.filter((file) => (0, import_node_fs25.existsSync)(backupPathFor(file)));
  const autostart = autostartEntry(deps.platform);
  const pid = await runningDaemonPid(deps, context);
  const dataFolder = kurmisHome();
  writeLine(context.stdout, "This removes what kurmis set up on this machine:");
  for (const file of withKurmis) listLine(context, `kurmis' settings in ${file}`);
  for (const file of backups) listLine(context, `${backupPathFor(file)}, the copy of ${file} that kurmis made`);
  if (autostart !== null) listLine(context, `the daemon's start at login (${autostart})`);
  if (logins.length > 0) {
    listLine(context, `the logins added to kurmis, each signed out first: ${logins.map(({ name }) => name).join(", ")}`);
  }
  if (others.length > 0) {
    listLine(context, `entries in the data folder's claude folder that are not the folder of a login kurmis added, which are deleted without a logout: ${others.join(", ")}`);
  }
  if (pid !== null) listLine(context, `the running daemon (pid ${String(pid)}), which it stops`);
  if ((0, import_node_fs25.existsSync)(dataFolder)) listLine(context, `the kurmis data folder ${dataFolder}`);
  writeLine(context.stdout, 'The login plain claude uses is not signed out, so a plain "claude" keeps working.');
  if (!yes) {
    if (!deps.stdinIsTerminal()) {
      writeLine(context.stderr, "kurmis setup: --uninstall-and-logout asks before it removes anything, and there is no terminal to ask at. Run it again with --yes to remove all of the above. Nothing was removed.");
      return EXIT_FAILURE;
    }
    const answer2 = await deps.ask("Remove all of this? [y/N] ", context);
    if (answer2 === null || !/^\s*y(es)?\s*$/i.test(answer2)) {
      writeLine(context.stdout, "Nothing was removed.");
      return EXIT_FAILURE;
    }
  }
  const undone = undoFiles(files, path, config.port, context);
  if (undone.failed) {
    writeLine(context.stderr, 'Nothing else was removed, since Claude Code that reads that file still uses the daemon. Fix what is named above and run "kurmis setup --uninstall-and-logout" again.');
    return EXIT_FAILURE;
  }
  let failed2 = deleteBackups(files, context);
  let keepData = false;
  if (!await autostartStep(true, deps, context)) {
    failed2 = true;
    keepData = true;
  }
  try {
    writeLine(context.stdout, await deps.stopDaemon({ env: context.env }) ? `Stopped the daemon${pid === null ? "" : ` (pid ${String(pid)})`}.` : "The daemon was not running.");
  } catch (error) {
    if (!(error instanceof DaemonError)) throw error;
    writeLine(context.stderr, `Could not stop the daemon: ${error.message}`);
    failed2 = true;
    keepData = true;
  }
  const notRemoved = [];
  for (const { login, name } of logins) {
    const code = await deps.logOutLogin(
      login,
      context,
      { keepWhenSignOutFails: true, again: "kurmis setup --uninstall-and-logout", prefix: "kurmis setup" }
    );
    if (code !== EXIT_OK) notRemoved.push(name);
  }
  if (notRemoved.length > 0) {
    writeLine(context.stderr, `Could not remove ${notRemoved.join(", ")}; see above.`);
    failed2 = true;
    keepData = true;
  }
  if (keepData) {
    writeLine(context.stderr, `Kept the kurmis data folder ${dataFolder}, which a second run needs to finish.`);
  } else {
    let removal = null;
    try {
      removal = removeDataFolder(deps.platform);
    } catch (error) {
      writeLine(context.stderr, `Could not delete the kurmis data folder ${dataFolder}: ${errorText2(error)}`);
      failed2 = true;
    }
    if (removal !== null && removal.removed) writeLine(context.stdout, `Deleted the kurmis data folder ${dataFolder}.`);
    if (removal !== null && !removal.removed) {
      writeLine(context.stdout, `Deleted kurmis' files in ${dataFolder}. The folder is left, because it also holds files kurmis did not write: ${removal.left.join(", ")}.`);
    }
  }
  if (undone.changed) {
    writeLine(context.stdout, "Claude Code sessions that are already open keep the settings they started with, which send their requests to the kurmis daemon; start them again.");
  }
  if (failed2) {
    writeLine(context.stderr, 'Fix what is named above and run "kurmis setup --uninstall-and-logout" again to finish.');
    return EXIT_FAILURE;
  }
  writeLine(context.stdout, `Last step: remove the kurmis program with "${NPM_UNINSTALL}".`);
  return EXIT_OK;
}
async function askAtTerminal(question) {
  const lines = (0, import_promises3.createInterface)({ input: process.stdin, output: process.stdout });
  const controller = new AbortController();
  lines.on("SIGINT", () => controller.abort());
  lines.on("close", () => controller.abort());
  try {
    return await lines.question(question, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    lines.close();
  }
}
function createSetupCommand(deps = {}) {
  const daemon = deps.daemon ?? realDaemonClient;
  const platform = deps.platform ?? process.platform;
  const full = {
    daemon,
    registerAutostart: deps.registerAutostart ?? registerAutostart,
    unregisterAutostart: deps.unregisterAutostart ?? unregisterAutostart,
    stopDaemon: deps.stopDaemon ?? stopDaemon,
    logOutLogin: deps.logOutLogin ?? createLoginLogout({ daemon, platform }),
    stdinIsTerminal: deps.stdinIsTerminal ?? (() => process.stdin.isTTY === true),
    ask: deps.ask ?? askAtTerminal,
    platform
  };
  return {
    name: "setup",
    summary: "Turn global routing on, pause it, or remove everything kurmis set up",
    usage: USAGE2,
    async run(args, context) {
      const parsed = parseCommandArgs("setup", args, {
        pause: { type: "boolean" },
        "uninstall-and-logout": { type: "boolean" },
        yes: { type: "boolean" }
      }, context);
      if (typeof parsed === "number") return parsed;
      const pause = parsed.values.pause === true;
      const uninstall = parsed.values["uninstall-and-logout"] === true;
      const yes = parsed.values.yes === true;
      if (pause && uninstall) return usageError("setup", "--pause and --uninstall-and-logout cannot be used together", context);
      if (yes && !uninstall) return usageError("setup", "--yes goes with --uninstall-and-logout", context);
      try {
        if (uninstall) return await runUninstall(yes, full, context);
        return await (pause ? runPause(full, context) : runSetup(full, context));
      } catch (error) {
        if (!isFileError(error)) throw error;
        writeLine(context.stderr, `kurmis setup: ${error.message}`);
        return EXIT_FAILURE;
      }
    }
  };
}
var setupCommand = createSetupCommand();

// src/cli/commands/status.ts
var import_node_os14 = require("node:os");

// src/cli/status-format.ts
var STATUS_JSON_FORMAT = 7;
function daemonReport(answer2, globalRouting, version) {
  return {
    daemon: daemonOf(answer2),
    source: "daemon",
    logins: answer2.logins,
    credentials: /* @__PURE__ */ new Map(),
    globalRouting,
    version
  };
}
function daemonOf(answer2) {
  const daemon = { version: answer2.version, pid: answer2.pid, port: answer2.port, startedAt: answer2.startedAt };
  if (typeof answer2.apiVersion === "number") daemon.apiVersion = answer2.apiVersion;
  return daemon;
}
function statusJson(report, now, options) {
  const daemon = report.daemon;
  const fromDaemon = report.source === "daemon";
  return {
    format: STATUS_JSON_FORMAT,
    daemon: daemon === null ? null : {
      version: daemon.version,
      pid: daemon.pid,
      port: daemon.port,
      startedAt: isoTime(daemon.startedAt),
      older: daemonAge(daemon, report.version) === "older",
      newer: daemonAge(daemon, report.version) === "newer"
    },
    source: report.source,
    globalRouting: report.globalRouting,
    logins: report.logins.map((login) => ({
      id: login.id,
      alias: login.alias,
      usedByPlainClaude: login.usedByPlainClaude,
      email: login.email ?? null,
      signedIn: fromDaemon ? login.signedIn : null,
      credentials: fromDaemon ? null : report.credentials.get(login.id) ?? "unknown",
      probing: login.probing === true,
      routing: login.routing,
      fiveHourLimit: login.fiveHourLimit,
      weeklyLimit: login.weeklyLimit,
      useFirst: login.useFirst,
      usage: login.usage === null ? null : usageJson(login, login.usage, now),
      blocked: fromDaemon ? blockJson(login, now, options) : null,
      sessions: login.sessions
    })),
    warnings: [...sameAccountWarnings(report), ...report.globalRouting === "on" && daemon === null ? [NO_DAEMON_WARNING] : []]
  };
}
var NO_DAEMON_WARNING = 'Global routing is on, but the daemon is not running, so a plain claude and the Claude Code editor extensions cannot reach Anthropic. "kurmis daemon start" starts it.';
function sameAccountWarnings(answer2) {
  const warnings = [];
  const ordered2 = [...answer2.logins.filter((login) => login.usedByPlainClaude), ...answer2.logins.filter((login) => !login.usedByPlainClaude)];
  const firsts = [];
  for (const login of ordered2) {
    if (login.email === null || login.email.trim() === "") continue;
    const kept = firsts.find((first) => isSameClaudeAccount(first, login));
    if (kept === void 0) {
      firsts.push(login);
      continue;
    }
    const keptName = kept.usedByPlainClaude ? `${kept.alias}, ${plainClaudeLoginText()},` : kept.alias;
    warnings.push(`${login.alias} and ${keptName} are the same account (${kept.email}), so they use one subscription. "kurmis logout ${login.alias}" removes ${login.alias}.`);
  }
  return warnings;
}
function formatStatus(report, now, options) {
  const json = statusJson(report, now, options);
  json.logins.forEach((login, index) => {
    const source = report.logins[index];
    const block = source?.block ?? null;
    if (login.blocked !== null && block !== null) login.blocked.text = blockText(block, now, options, true);
  });
  const lines = [...daemonLines(json, report, now), "", ...GLOBAL_ROUTING_TEXT[json.globalRouting].flatMap((line) => wrap(line, "", ""))];
  const labelWidth = Math.min(MAX_LABEL_WIDTH, Math.max(0, ...json.logins.flatMap((login) => (login.usage?.windows ?? []).map((window) => window.label.length))));
  for (const warning of json.warnings) lines.push("", ...wrap(`Warning: ${warning}`, "", "  "));
  if (report.source === "files") lines.push("", "Logins are read from config.json, and the usage is cached by the daemon:");
  for (const login of json.logins) {
    lines.push("", ...loginLines(login, now, labelWidth));
  }
  return `${lines.join("\n")}
`;
}
var DAEMON_STARTERS = ['"kurmis claude"', '"kurmis setup"', '"kurmis daemon start"'];
function daemonLines(json, report, now) {
  const daemon = report.daemon;
  if (daemon === null) {
    return [
      "The kurmis daemon is not running. It is started automatically by",
      ...DAEMON_STARTERS.flatMap((starter) => wrap(starter, "  - ", "    "))
    ];
  }
  const lines = [`kurmis daemon ${daemon.version}, pid ${String(daemon.pid)}, port ${String(daemon.port)}, running for ${spanText(now - daemon.startedAt)}`];
  if (json.daemon?.older === true) {
    lines.push(...wrap(`It runs an older kurmis than this one (${report.version}). The next ${DAEMON_STARTERS.slice(0, -1).join(", ")} or ${DAEMON_STARTERS.at(-1)} replaces it.`, "", ""));
  }
  if (json.daemon?.newer === true) {
    lines.push(...wrap(report.source === "daemon" ? `It runs a newer kurmis than this one (${report.version}), which this kurmis does not replace.` : `It runs a newer kurmis than this one (${report.version}), which this kurmis does not replace and cannot use. Update this kurmis, or stop the daemon with "kurmis daemon stop" and run the command again.`, "", ""));
  }
  if (report.source === "files") {
    lines.push("This kurmis cannot read its status.");
  }
  return lines;
}
var GLOBAL_ROUTING_TEXT = {
  on: [
    'Global routing is on: plain "claude" and the Claude Code editor extensions go through kurmis.',
    'Run "kurmis setup --pause" to pause it.'
  ],
  paused: [
    'Global routing is paused: only "kurmis claude" goes through kurmis. Plain "claude" does not.',
    'Run "kurmis setup" to turn it on again.'
  ],
  off: [
    'Global routing is off: only "kurmis claude" goes through kurmis. Plain "claude" does not.',
    'Run "kurmis setup" to turn on global routing.'
  ]
};
var WIDTH = 80;
var MAX_LABEL_WIDTH = 24;
function loginTitle(login) {
  return login.alias === login.id ? login.alias : `${login.alias} (id ${login.id})`;
}
function credentialsText(check) {
  if (check === "unknown") return "credentials on this machine: unknown";
  return check ? "credentials on this machine" : "no credentials on this machine";
}
function loginLines(login, now, labelWidth) {
  const title = loginTitle(login);
  const lines = login.email === null ? [title] : title.length + 2 + login.email.length <= WIDTH ? [`${title}  ${login.email}`] : [title, `  ${login.email}`];
  if (login.usedByPlainClaude) lines.push(`  ${plainClaudeLoginText()}`);
  const facts = [
    login.credentials !== null ? credentialsText(login.credentials) : login.signedIn === null ? "sign-in not checked yet" : login.signedIn ? "signed in" : "signed out",
    login.routing ? "routing on" : "routing off",
    `limits ${String(login.fiveHourLimit)}% 5 hour, ${String(login.weeklyLimit)}% weekly`
  ];
  if (login.useFirst) facts.push("use first");
  facts.push(login.sessions === 1 ? "1 session" : `${String(login.sessions)} sessions`);
  if (login.usage?.plan) facts.push(`plan ${login.usage.plan}`);
  if (login.probing) facts.push("reading usage now");
  lines.push(...wrapList(facts, "  "));
  if (login.usage === null) {
    lines.push("  usage not read yet");
  } else {
    for (const window of login.usage.windows) lines.push(windowLine(window, now, labelWidth));
    if (login.usage.windows.length === 0) lines.push("  no usage windows reported");
    const age = now - Date.parse(login.usage.fetchedAt);
    const when = age < 6e4 ? "just now" : `${spanText(age)} ago`;
    lines.push(`  usage read ${when}${login.usage.source === "session" ? " from a forwarded answer" : ""}`);
    if (login.usage.error !== null) lines.push(...wrap(`last probe failed: ${login.usage.error}`, "  ", "    "));
  }
  if (login.blocked !== null && login.blocked.kind !== "auto-route-off" && login.blocked.kind !== "signed-out") {
    lines.push(...wrap(`passed over: ${login.blocked.text}`, "  ", "    "));
  }
  return lines;
}
function windowLine(window, now, labelWidth) {
  const label = window.label.length > labelWidth ? `${window.label.slice(0, labelWidth - 1)}~` : window.label;
  const percent = `${String(Math.round(window.utilization))}%`.padStart(4);
  const reset = windowHasReset(window, now) ? "reset since read" : resetsInText(window.resetsAt, now) ?? "";
  const limit = window.limitPercent === null ? "" : `limit ${String(window.limitPercent)}%`;
  return `  ${label.padEnd(labelWidth)}  ${percent}  ${reset.padEnd(20)}  ${limit}`.trimEnd();
}
function usageJson(login, usage, now) {
  const current = usageAsOf(usage, now);
  const planKeys = new Set(planUsageWindows(current).map((window) => window.key));
  const limits = { fiveHourLimitPercent: login.fiveHourLimit, weeklyLimitPercent: login.weeklyLimit };
  return {
    fetchedAt: isoTime(usage.fetchedAt),
    source: usage.source,
    plan: usage.subscriptionType,
    error: usage.error,
    windows: allUsageWindows(current).map((window) => {
      const plan = planKeys.has(window.key);
      return {
        key: window.key,
        label: window.label,
        durationMinutes: window.windowDurationMins ?? null,
        utilization: window.utilization,
        resetsAt: window.resetsAt,
        plan,
        limitPercent: plan ? limitForWindow(limits, window) : null
      };
    })
  };
}
function blockJson(login, now, options) {
  const block = login.block;
  if (block === null) return null;
  let until = null;
  if (block.kind === "cooldown" && block.until !== null) until = isoTime(block.until);
  else if (block.kind === "over-limit") until = block.resetsAt;
  return { kind: block.kind, text: blockText(block, now, options, false), until };
}
function blockText(block, now, options, localTime) {
  if (block.kind === "cooldown" && block.until !== null) {
    const text2 = localTime ? `cooling down until ${localTimeText(block.until, now, options.timeZone)}` : routeBlockText(block, options.keychain);
    const left2 = resetsInText(block.until, now);
    return left2 === null ? text2 : `${text2} (${left2.replace("resets ", "")})`;
  }
  const text = routeBlockText(block, options.keychain);
  if (block.kind !== "over-limit") return text;
  const left = resetsInText(block.resetsAt, now);
  return left === null ? text : `${text}; it ${left}`;
}
function localTimeText(at, now, timeZone) {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = (time) => Object.fromEntries(format.formatToParts(time).map((part) => [part.type, part.value]));
  const then = parts(at);
  const today = parts(now);
  const clock = `${then.hour ?? ""}:${then.minute ?? ""}`;
  const date = `${then.year ?? ""}-${then.month ?? ""}-${then.day ?? ""}`;
  return date === `${today.year ?? ""}-${today.month ?? ""}-${today.day ?? ""}` ? clock : `${date} ${clock}`;
}
function isoTime(at) {
  return Number.isFinite(at) ? new Date(at).toISOString() : String(at);
}
function wrapList(items, indent) {
  const lines = [];
  let line = "";
  for (const [index, item] of items.entries()) {
    const text = index < items.length - 1 ? `${item},` : item;
    if (line !== "" && indent.length + line.length + 1 + text.length > WIDTH) {
      lines.push(indent + line);
      line = text;
    } else {
      line = line === "" ? text : `${line} ${text}`;
    }
  }
  lines.push(indent + line);
  return lines;
}
function wrap(text, first, rest) {
  const lines = [];
  let line = first;
  let empty = true;
  for (const word of text.match(/"[^"]*"\S*|\S+/g) ?? []) {
    if (!empty && line.length + 1 + word.length > WIDTH) {
      lines.push(line);
      line = rest + word;
    } else {
      line += empty ? word : ` ${word}`;
    }
    empty = false;
  }
  lines.push(line);
  return lines;
}

// src/cli/commands/status.ts
var STATUS_PROBE_WAIT_MS = 15e3;
var USAGE3 = `Usage: kurmis status [--json]

Shows every login with its settings and usage, whether the daemon runs, and whether global
routing is on. It does not start the daemon, and it exits 0 either way. For example:

  kurmis daemon 0.1.0, pid 4242, port 28411, running for 2h 5m

  Global routing is off: only "kurmis claude" goes through kurmis. Plain "claude"
  does not.
  Run "kurmis setup" to turn on global routing.

  own-example (id k3v9q2m7xa)                   <- alias and id
    the login plain claude uses
    signed in, routing on, limits 100% 5 hour, 100% weekly, 2 sessions, plan max
    5 hour       42%  resets in 2h 10m      limit 100%
    7 day        63%  resets in 3d 4h       limit 100%
    usage read 3m ago

  work-example (id p8x2n4c6ve)  work@example.com
    signed in, routing on, limits 90% 5 hour, 100% weekly, use first, 1 session
    5 hour       92%  resets in 45m         limit 90%
    7 day         0%  reset since read      limit 100%
    passed over: at its limit, the 5 hour window is at 92% of 90%; it resets in
      45m                                   <- why Auto skips this login now

A warning at the top says when two logins are the same account, so they use one subscription.

While the daemon is not running, the logins come from config.json with the last usage the
daemon read, and "credentials on this machine" takes the place of "signed in": kurmis checks
that the token is there without reading it. The README describes every line.

Options:
  --json       Print the same as JSON. "daemon" is null while the daemon is not running, and
               "source" says whether the logins come from the daemon or from the files. Each
               login has "alias", "id", "usedByPlainClaude" (whether plain claude uses
               it), "signedIn" (from the daemon) and "credentials" (from the files: true,
               false or "unknown").
               "warnings" holds the warnings.
  -h, --help   Show this help.`;
function createStatusCommand(overrides = {}) {
  const deps = {
    daemon: realDaemonClient,
    now: Date.now,
    platform: process.platform,
    probeWaitMs: STATUS_PROBE_WAIT_MS,
    home: import_node_os14.homedir,
    runProgram,
    globalRouting: globalRoutingState,
    version: kurmisVersion,
    ...overrides
  };
  return {
    name: "status",
    summary: "Show the logins, their usage, and whether the daemon runs",
    usage: USAGE3,
    run: (args, context) => runStatus(args, context, deps)
  };
}
var statusCommand = createStatusCommand();
function nothingProbedYet(status2) {
  const signedIn = status2.logins.filter((login) => login.signedIn !== false);
  return signedIn.length > 0 && signedIn.every((login) => login.usage === null);
}
async function runStatus(args, context, deps) {
  const parsed = parseCommandArgs("status", args, { json: { type: "boolean" } }, context);
  if (typeof parsed === "number") return parsed;
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    config = error;
  }
  const globalRouting = deps.globalRouting(context.env);
  let connection;
  try {
    connection = await deps.daemon.findDaemon({ env: context.env });
  } catch (error) {
    writeLine(context.stderr, `kurmis status: could not look for the kurmis daemon: ${messageOf4(error)}`);
    connection = null;
  }
  let report;
  if (connection === null) {
    const files = await reportFromFiles(config, null, globalRouting, context, deps);
    if (files === null) return EXIT_FAILURE;
    report = files;
  } else {
    let status2;
    try {
      status2 = await deps.daemon.readStatus(connection);
    } catch (error) {
      writeLine(context.stderr, `kurmis status: the kurmis daemon (pid ${String(connection.pid)}) did not answer the status request: ${messageOf4(error)}`);
      writeLine(context.stderr, `Showing the logins from config.json instead. The daemon's log is daemon.log in the kurmis data folder; "kurmis daemon restart" replaces the daemon.`);
      status2 = null;
    }
    if (status2 === null) {
      const files = await reportFromFiles(config, null, globalRouting, context, deps);
      if (files === null) return EXIT_FAILURE;
      report = files;
    } else if (status2.apiVersion !== CONTROL_API_VERSION) {
      const files = await reportFromFiles(config, status2, globalRouting, context, deps);
      if (files === null) return EXIT_FAILURE;
      report = files;
    } else {
      if (nothingProbedYet(status2)) status2 = await firstProbe(connection, status2, context, deps);
      report = daemonReport(status2, globalRouting, deps.version);
    }
  }
  const now = deps.now();
  const options = { keychain: deps.platform === "darwin" };
  if (parsed.values.json === true) {
    writeLine(context.stdout, JSON.stringify(statusJson(report, now, options), null, 2));
  } else {
    context.stdout.write(formatStatus(report, now, options));
  }
  return EXIT_OK;
}
async function firstProbe(connection, status2, context, deps) {
  const probed = await settleWithin((signal) => deps.daemon.requestProbe(connection, void 0, signal), deps.probeWaitMs);
  if (probed.kind === "done") return probed.value;
  writeLine(context.stderr, probed.kind === "timeout" ? `kurmis status: the first usage probe did not finish within ${String(deps.probeWaitMs / 1e3)} s; showing what the daemon has.` : `kurmis status: the usage probe failed (${messageOf4(probed.error)}); showing what the daemon has.`);
  return status2;
}
async function reportFromFiles(config, daemon, globalRouting, context, deps) {
  if (config instanceof ConfigError) {
    writeLine(context.stderr, `kurmis status: ${config.message}`);
    return null;
  }
  const now = deps.now();
  const state = loadState(now).state;
  const home = deps.home();
  const logins = config.logins.map((login) => {
    const cooldown = state.cooldowns.get(login.id);
    const identity = readClaudeIdentity(login, home);
    let sessions = 0;
    for (const placement of state.sessions.values()) if (placement.login === login.id) sessions++;
    return {
      id: login.id,
      alias: login.alias,
      usedByPlainClaude: login.usedByPlainClaude,
      routing: login.routing,
      fiveHourLimit: login.fiveHourLimit,
      weeklyLimit: login.weeklyLimit,
      useFirst: login.useFirst,
      signedIn: null,
      usage: state.usage.get(login.id) ?? null,
      cooldownUntil: cooldown === void 0 ? null : Number.isFinite(cooldown) ? cooldown : "unknown",
      block: null,
      sessions,
      email: identity?.email ?? null,
      organizationUuid: identity?.organizationUuid ?? null,
      probing: false
    };
  });
  const credentials = await checkCredentials(config.logins, context.env, home, deps);
  return {
    daemon: daemon === null ? null : daemonOf(daemon),
    source: "files",
    logins,
    credentials,
    globalRouting,
    version: deps.version
  };
}
function messageOf4(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/cli/commands/index.ts
var COMMANDS = [
  claudeCommand,
  statusCommand,
  setCommand,
  loginCommand,
  logoutCommand,
  setupCommand,
  daemonCommand
];
function findCommand(name) {
  return COMMANDS.find((command) => command.name === name);
}

// src/cli/dispatch.ts
function mainHelp() {
  const width = Math.max(...COMMANDS.map((command) => command.name.length));
  const lines = COMMANDS.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`);
  return `kurmis ${kurmisVersion}: use several Claude Code logins on one machine.

Usage: kurmis <command> [options]
       kurmis [--login <login>] claude [<claude arguments...>]

Commands:
${lines.join("\n")}
  ${"help".padEnd(width)}  Show the help of a command

Options:
  -h, --help     Show this help, or a command's help after its name.
  --version      Print the version.

Run "kurmis help <command>" for the options of a command.`;
}
async function runCli(argv, context) {
  const leading = parseLogin2(argv);
  if ("error" in leading) {
    writeLine(context.stderr, `kurmis: ${leading.error}`);
    return EXIT_USAGE;
  }
  const [first, ...rest] = leading.rest;
  if (leading.login !== null && first !== "claude") {
    writeLine(context.stderr, 'kurmis: --login goes right before claude, for example "kurmis --login work-example claude"');
    return EXIT_USAGE;
  }
  if (first === void 0 || isHelpFlag(first)) {
    writeLine(context.stdout, mainHelp());
    return EXIT_OK;
  }
  if (first === "--version") {
    writeLine(context.stdout, kurmisVersion);
    return EXIT_OK;
  }
  if (first === "help") return help(rest, context);
  const command = findCommand(first);
  if (command === void 0) {
    writeLine(context.stderr, first.startsWith("-") ? `kurmis: unknown option "${first}"` : `kurmis: unknown command "${first}"`);
    writeLine(context.stderr);
    writeLine(context.stderr, mainHelp());
    return EXIT_USAGE;
  }
  if (command.passesArguments !== true) {
    const beforeDashes = rest.includes("--") ? rest.slice(0, rest.indexOf("--")) : rest;
    if (beforeDashes.some(isHelpFlag)) {
      writeLine(context.stdout, command.usage);
      return EXIT_OK;
    }
  }
  return await command.run(rest, context, leading.login);
}
function parseLogin2(argv) {
  const [first, second] = argv;
  let login;
  let rest;
  if (first === "--login") {
    login = second;
    rest = argv.slice(2);
  } else if (first?.startsWith("--login=") === true) {
    login = first.slice("--login=".length);
    rest = argv.slice(1);
  } else {
    return { login: null, rest: argv };
  }
  if (login === void 0 || login === "" || login === "claude") {
    return { error: '--login needs the alias or id of a login, for example "kurmis --login work-example claude"' };
  }
  if (rest[0] === "--login" || rest[0]?.startsWith("--login=") === true) return { error: "--login was given twice" };
  return { login, rest };
}
function help(args, context) {
  const [name, ...extra] = args;
  if (name === void 0) {
    writeLine(context.stdout, mainHelp());
    return EXIT_OK;
  }
  const command = findCommand(name);
  if (command === void 0 || extra.length > 0) {
    writeLine(context.stderr, command === void 0 ? `kurmis help: unknown command "${name}"` : "kurmis help: takes one command name");
    writeLine(context.stderr);
    writeLine(context.stderr, mainHelp());
    return EXIT_USAGE;
  }
  writeLine(context.stdout, command.usage);
  return EXIT_OK;
}

// src/cli/main.ts
runCli(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr, env: process.env }).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`kurmis: ${error instanceof Error ? error.message : String(error)}
`);
    process.exitCode = 1;
  }
);
