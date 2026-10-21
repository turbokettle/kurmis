#!/usr/bin/env node
"use strict";

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
function notImplemented(command, context) {
  writeLine(context.stderr, `kurmis ${command}: not implemented yet`);
  return EXIT_FAILURE;
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

// src/data/login-id.ts
var LOGIN_PROVIDERS = ["claude", "codex"];
var LOGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
var WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;
var DEFAULT_LOGIN_NAME = "default";
function isValidLoginName(name) {
  return LOGIN_NAME_PATTERN.test(name) && !WINDOWS_RESERVED_NAMES.test(name);
}
function isLoginProvider(value) {
  return value === "claude" || value === "codex";
}
function parseLoginId(text) {
  if (typeof text !== "string") return null;
  const colon = text.indexOf(":");
  if (colon < 0) return null;
  const provider = text.slice(0, colon);
  const name = text.slice(colon + 1);
  if (!isLoginProvider(provider) || !isValidLoginName(name)) return null;
  return { id: text, provider, name };
}
function toLoginId(text) {
  const parsed = parseLoginId(text);
  if (parsed === null) {
    throw new Error(
      `"${text}" is not a login id. A login id is claude:<name> or codex:<name>, where the name is 1 to 32 lowercase letters, digits, "-" or "_".`
    );
  }
  return parsed.id;
}
function loginId(provider, name) {
  return toLoginId(`${provider}:${name}`);
}
function defaultLoginId(provider) {
  return `${provider}:${DEFAULT_LOGIN_NAME}`;
}
var DEFAULT_LOGIN_IDS = LOGIN_PROVIDERS.map(defaultLoginId);
function isDefaultLoginId(id) {
  return DEFAULT_LOGIN_IDS.includes(id);
}
function providerOfLoginId(id) {
  return id.startsWith("codex:") ? "codex" : "claude";
}
function nameOfLoginId(id) {
  return id.slice(id.indexOf(":") + 1);
}

// src/cli/wrapper-args.ts
function parseWrapperArgs(provider, args) {
  const result = { help: false, login: null, passThrough: [] };
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === "--") {
      index++;
      break;
    }
    if (isHelpFlag(arg)) {
      result.help = true;
      index++;
      continue;
    }
    let value;
    if (arg === "--login") {
      value = args[index + 1];
      if (value === void 0) return { error: "--login needs a login id, for example --login work" };
      index += 2;
    } else if (arg.startsWith("--login=")) {
      value = arg.slice("--login=".length);
      index++;
    } else {
      break;
    }
    if (result.login !== null) return { error: "--login was given twice" };
    const login = resolveLogin(provider, value);
    if (typeof login === "object") return login;
    result.login = login;
  }
  result.passThrough = args.slice(index);
  return result;
}
function resolveLogin(provider, value) {
  const parsed = parseLoginId(value);
  if (parsed !== null) {
    if (parsed.provider !== provider) return { error: `${value} is a ${parsed.provider} login, not a ${provider} one` };
    return parsed.id;
  }
  if (value.includes(":")) return { error: `"${value}" is not a login id` };
  try {
    return loginId(provider, value);
  } catch {
    return { error: `"${value}" is not a login name` };
  }
}

// src/cli/commands/claude.ts
var claudeCommand = {
  name: "claude",
  summary: "Start Claude Code routed through the kurmis daemon",
  usage: `Usage: kurmis claude [--login <id>] [--] [claude arguments...]

Starts Claude Code with the terminal attached. Its requests go through the kurmis daemon,
which signs each one with a login that has room, and the command exits with claude's exit code.
The daemon is started first when it is not running.

Options (only before the first argument kurmis does not know):
  --login <id>   Keep the session on one login, whatever its limits say. <id> is claude:<name>
                 or just <name>. Without it the session is on Auto.
  -h, --help     Show this help.
  --             Pass everything after it to claude, even arguments kurmis knows.

Everything from the first argument kurmis does not know is passed to claude unchanged.
"kurmis claude -- --help" shows claude's own help.`,
  passesArguments: true,
  run(args, context) {
    const parsed = parseWrapperArgs("claude", args);
    if ("error" in parsed) return usageError("claude", parsed.error, context);
    if (parsed.help) {
      writeLine(context.stdout, claudeCommand.usage);
      return EXIT_OK;
    }
    return notImplemented("claude", context);
  }
};

// src/cli/commands/codex.ts
var codexCommand = {
  name: "codex",
  summary: "Start Codex on a login that has room",
  usage: `Usage: kurmis codex [--login <id>] [--] [codex arguments...]

Starts Codex with the terminal attached, on the login that ranks first (the same order Claude's
Auto uses) or on the one named, and exits with codex's exit code.

Options (only before the first argument kurmis does not know):
  --login <id>   Start on this login. <id> is codex:<name> or just <name>.
  -h, --help     Show this help.
  --             Pass everything after it to codex, even arguments kurmis knows.

Everything from the first argument kurmis does not know is passed to codex unchanged.
"kurmis codex -- --help" shows codex's own help.`,
  passesArguments: true,
  run(args, context) {
    const parsed = parseWrapperArgs("codex", args);
    if ("error" in parsed) return usageError("codex", parsed.error, context);
    if (parsed.help) {
      writeLine(context.stdout, codexCommand.usage);
      return EXIT_OK;
    }
    return notImplemented("codex", context);
  }
};

// src/cli/commands/daemon.ts
var SUBCOMMANDS = {
  start: (args, context) => noOptions("daemon start", args, context),
  stop: (args, context) => noOptions("daemon stop", args, context),
  status: (args, context) => {
    const parsed = parseCommandArgs("daemon status", args, { json: { type: "boolean" } }, context);
    return typeof parsed === "number" ? parsed : notImplemented("daemon status", context);
  },
  run: (args, context) => noOptions("daemon run", args, context)
};
function noOptions(name, args, context) {
  const parsed = parseCommandArgs(name, args, {}, context);
  return typeof parsed === "number" ? parsed : notImplemented(name, context);
}
var daemonCommand = {
  name: "daemon",
  summary: "Start, stop or show the background process",
  usage: `Usage: kurmis daemon <start|stop|status|run>

The daemon is the background process that routes Claude requests. "kurmis claude" starts it
when it is not running, so it seldom needs starting by hand.

  start            Start it in the background, replacing one of an older version.
  stop             Stop it after it finishes the requests it has open.
  status [--json]  Show whether it runs, its pid, port and version.
  run              Run it in this terminal instead of the background (what "start" launches).

Options:
  -h, --help       Show this help.`,
  run(args, context) {
    const [subcommand, ...rest] = args;
    if (subcommand === void 0) return usageError("daemon", "needs one of start, stop, status, run", context);
    const handler = Object.hasOwn(SUBCOMMANDS, subcommand) ? SUBCOMMANDS[subcommand] : void 0;
    if (handler === void 0) return usageError("daemon", `unknown subcommand "${subcommand}"`, context);
    return handler(rest, context);
  }
};

// src/data/json-file.ts
var import_node_fs = require("node:fs");
var TEMP_FLAGS = import_node_fs.constants.O_WRONLY | import_node_fs.constants.O_CREAT | import_node_fs.constants.O_EXCL;
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
    text = (0, import_node_fs.readFileSync)(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return { status: "missing" };
    throw error;
  }
  return parseJsonText(text);
}

// src/data/paths.ts
var import_node_os = require("node:os");
var import_node_path = require("node:path");
function kurmisHome() {
  const override = process.env.KURMIS_HOME;
  if (override !== void 0 && override !== "") return (0, import_node_path.resolve)(override);
  return (0, import_node_path.join)((0, import_node_os.homedir)(), ".kurmis");
}
function configPath() {
  return (0, import_node_path.join)(kurmisHome(), "config.json");
}

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

// src/data/config.ts
var CONFIG_VERSION = 1;
var DEFAULT_PORT = 28411;
var MIN_PORT = 1024;
var MAX_PORT = 65535;
var DEFAULT_FIVE_HOUR_LIMIT = 100;
var DEFAULT_WEEKLY_LIMIT = 100;
var DEFAULT_ROUTING = true;
var ConfigError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
};
function newLoginSettings(id, patch = {}) {
  const login = {
    id,
    provider: providerOfLoginId(id),
    label: nameOfLoginId(id),
    routing: DEFAULT_ROUTING,
    fiveHourLimit: DEFAULT_FIVE_HOUR_LIMIT,
    weeklyLimit: DEFAULT_WEEKLY_LIMIT,
    useFirst: false
  };
  return withConfigErrors(() => applyPatch(login, patch, topOf(`settings of ${id}`)));
}
function withConfigErrors(check) {
  try {
    return check();
  } catch (error) {
    if (error instanceof DataFileError) throw new ConfigError(error.message);
    throw error;
  }
}
function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    port: DEFAULT_PORT,
    logins: DEFAULT_LOGIN_IDS.map((id) => newLoginSettings(id))
  };
}
function checkLimit(value, where) {
  return expectInteger(value, where, 1, 100);
}
function checkLabel(value, where) {
  const label = expectString(value, where).trim();
  if (label === "" || label.length > 64) fail(where, "must be 1 to 64 characters");
  return label;
}
function applyPatch(login, patch, where) {
  const next = { ...login };
  if (patch.label !== void 0) next.label = checkLabel(patch.label, child(where, "label"));
  if (patch.routing !== void 0) next.routing = expectBoolean(patch.routing, child(where, "routing"));
  if (patch.fiveHourLimit !== void 0) next.fiveHourLimit = checkLimit(patch.fiveHourLimit, child(where, "fiveHourLimit"));
  if (patch.weeklyLimit !== void 0) next.weeklyLimit = checkLimit(patch.weeklyLimit, child(where, "weeklyLimit"));
  if (patch.useFirst !== void 0) next.useFirst = expectBoolean(patch.useFirst, child(where, "useFirst"));
  return next;
}
function parseLogin(value, where) {
  const raw = expectObject(value, where);
  const idText = expectString(raw.id, child(where, "id"));
  const parsed = parseLoginId(idText);
  if (parsed === null) {
    fail(child(where, "id"), 'must be claude:<name> or codex:<name>, with a name of 1 to 32 lowercase letters, digits, "-" or "_"');
  }
  if (raw.provider !== void 0 && raw.provider !== parsed.provider) {
    fail(child(where, "provider"), `must be "${parsed.provider}", the provider in the id`);
  }
  const patch = {};
  for (const key of ["label", "routing", "fiveHourLimit", "weeklyLimit", "useFirst"]) {
    if (raw[key] !== void 0) patch[key] = raw[key];
  }
  return applyPatch(newLoginSettings(parsed.id), patch, where);
}
function migrate(raw, file) {
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
  return raw;
}
function parseConfig(value, file) {
  const raw = migrate(expectObject(value, topOf(file)), file);
  const where = topOf(file);
  const port = raw.port === void 0 ? DEFAULT_PORT : expectInteger(raw.port, child(where, "port"), MIN_PORT, MAX_PORT);
  const listed = raw.logins === void 0 ? [] : expectArray(raw.logins, child(where, "logins"));
  const byId = /* @__PURE__ */ new Map();
  listed.forEach((entry, index) => {
    const login = parseLogin(entry, child(child(where, "logins"), index));
    if (byId.has(login.id)) fail(child(child(child(where, "logins"), index), "id"), `repeats "${login.id}"`);
    byId.set(login.id, login);
  });
  const defaults = DEFAULT_LOGIN_IDS.map((id) => byId.get(id) ?? newLoginSettings(id));
  const extras = [...byId.values()].filter((login) => !isDefaultLoginId(login.id));
  return { version: CONFIG_VERSION, port, logins: [...defaults, ...extras] };
}
function loadConfig(path = configPath()) {
  const read = readJsonFileSync(path);
  if (read.status === "missing") return defaultConfig();
  if (read.status === "corrupt") throw new ConfigError(`${path} is not valid JSON: ${read.reason}`);
  return withConfigErrors(() => parseConfig(read.value, path));
}

// src/cli/commands/list.ts
function formatLoginTable(logins) {
  const rows = [
    ["ID", "LABEL", "ROUTING", "5H LIMIT", "WEEKLY LIMIT", "USE FIRST"],
    ...logins.map((login) => [
      login.id,
      login.label,
      login.routing ? "on" : "off",
      `${String(login.fiveHourLimit)}%`,
      `${String(login.weeklyLimit)}%`,
      login.useFirst ? "yes" : "no"
    ])
  ];
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd()).join("\n");
}
var listCommand = {
  name: "list",
  summary: "List the logins and their routing settings",
  usage: `Usage: kurmis list [--json]

Lists every login kurmis knows, the machine's own claude:default and codex:default first, with
whether routing may use it, its five-hour and weekly limits, and whether it is used first.

Options:
  --json       Print the logins as JSON.
  -h, --help   Show this help.`,
  run(args, context) {
    const parsed = parseCommandArgs("list", args, { json: { type: "boolean" } }, context);
    if (typeof parsed === "number") return parsed;
    let logins;
    try {
      logins = loadConfig().logins;
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      writeLine(context.stderr, `kurmis list: ${error.message}`);
      return EXIT_FAILURE;
    }
    writeLine(context.stdout, parsed.values.json === true ? JSON.stringify(logins, null, 2) : formatLoginTable(logins));
    return EXIT_OK;
  }
};

// src/cli/commands/login.ts
var loginCommand = {
  name: "login",
  summary: "Sign in a new login, or sign an existing one in again",
  usage: `Usage: kurmis login <id>

Signs in the login <id>, which is claude:<name> or codex:<name>. A new login is added with
routing on and both limits at 100%. The name is 1 to 32 lowercase letters, digits, "-" or "_".

Options:
  -h, --help   Show this help.`,
  run(args, context) {
    const parsed = parseCommandArgs("login", args, {}, context, true);
    if (typeof parsed === "number") return parsed;
    return notImplemented("login", context);
  }
};

// src/cli/commands/logout.ts
var logoutCommand = {
  name: "logout",
  summary: "Remove a login and its credentials",
  usage: `Usage: kurmis logout <id>

Removes the login <id> and its credentials from kurmis. The machine's own logins,
claude:default and codex:default, cannot be removed.

Options:
  -h, --help   Show this help.`,
  run(args, context) {
    const parsed = parseCommandArgs("logout", args, {}, context, true);
    if (typeof parsed === "number") return parsed;
    return notImplemented("logout", context);
  }
};

// src/cli/commands/setup.ts
var setupCommand = {
  name: "setup",
  summary: "Route every Claude Code on this machine through kurmis",
  usage: `Usage: kurmis setup [--undo]

Puts kurmis' routing settings in the env block of ~/.claude/settings.json, so a plain "claude"
and the IDE extensions are routed too, and makes the daemon start when you log in.

Options:
  --undo       Remove both again.
  -h, --help   Show this help.`,
  run(args, context) {
    const parsed = parseCommandArgs("setup", args, { undo: { type: "boolean" } }, context);
    if (typeof parsed === "number") return parsed;
    return notImplemented("setup", context);
  }
};

// src/cli/commands/status.ts
var statusCommand = {
  name: "status",
  summary: "Show each login's usage",
  usage: `Usage: kurmis status [--json]

Shows each login's five-hour and weekly usage, its limits, and whether routing can use it now.

Options:
  --json       Print the same as JSON.
  -h, --help   Show this help.`,
  run(args, context) {
    const parsed = parseCommandArgs("status", args, { json: { type: "boolean" } }, context);
    if (typeof parsed === "number") return parsed;
    return notImplemented("status", context);
  }
};

// src/cli/commands/index.ts
var COMMANDS = [
  claudeCommand,
  codexCommand,
  statusCommand,
  listCommand,
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
  return `kurmis ${kurmisVersion}: use several Claude Code and Codex logins on one machine.

Usage: kurmis <command> [options]

Commands:
${lines.join("\n")}
  ${"help".padEnd(width)}  Show the help of a command

Options:
  -h, --help     Show this help, or a command's help after its name.
  --version      Print the version.

Run "kurmis help <command>" for the options of a command.`;
}
async function runCli(argv, context) {
  const [first, ...rest] = argv;
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
  return await command.run(rest, context);
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
