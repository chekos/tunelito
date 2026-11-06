import { UsageError, closestMatch } from "./cli-output.js";

export const GLOBAL_OPTIONS = [
  { name: "--help", aliases: ["-h"], arity: 0, description: "Show help before validation or side effects" },
  { name: "--version", aliases: ["-v"], arity: 0, description: "Show package version" },
  { name: "--json", arity: 0, description: "Select machine JSON output (serve uses JSONL)" },
  { name: "--no-color", arity: 0, description: "Disable color, including FORCE_COLOR" },
  { name: "--plain", arity: 0, description: "Accessible plain output: no color or redraws" },
  { name: "--format", arity: 1, description: "Select text, json, or plain output (inbox also supports prompt/ids)" },
];

const REPEATABLE = new Set(["--link-preview", "--link-preview-fields", "--link-preview-header", "--link-preview-env", "--file", "--completed", "--remaining"]);

// The declaration rows supply the same metadata to human help, machine help,
// suggestions, and the shared lexer. Prose references are not declarations.
export function optionMetadata(help) {
  const options = new Map();
  let active = [];
  for (const line of help.split("\n")) {
    const declaration = line.match(/^\s+(?:(?:-[a-z],\s+)?--[a-z][a-z-]*)(.*)$/);
    if (!declaration) {
      if (/^\s{4,}\S/.test(line)) {
        for (const option of active) option.description = `${option.description} ${line.trim()}`.trim();
      } else active = [];
      continue;
    }
    const syntax = line.trim().match(/^(?:-[a-z],\s+)?--[a-z][a-z-]*(?:,\s*--[a-z][a-z-]*)*(?:\s+(?:<[^>]+>|'[^']*'|"[^"]*"))*/)[0];
    const names = syntax.match(/--[a-z][a-z-]*/g) || [];
    const arity = (syntax.match(/'[^']*'|"[^"]*"|<[^>]+>/g) || []).length;
    active = names.map((name) => ({
      name, syntax, arity, repeatable: REPEATABLE.has(name),
      description: line.trim().slice(syntax.length).trim(),
    }));
    for (const option of active) options.set(option.name, option);
  }
  for (const option of GLOBAL_OPTIONS) options.set(option.name, { ...option, ...options.get(option.name), ...(option.aliases ? { aliases: option.aliases } : {}) });
  return [...options.values()];
}

function scan(argv, options) {
  const byName = new Map(options.flatMap((option) => [option.name, ...(option.aliases || [])].map((name) => [name, option])));
  const tokens = [];
  for (let i = 0; i < argv.length; i += 1) {
    const index = i;
    const raw = argv[i];
    if (raw === "--") {
      tokens.push({ literal: true, values: argv.slice(i + 1) });
      break;
    }
    const equals = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const name = equals < 0 ? raw : raw.slice(0, equals);
    const option = byName.get(name);
    if (!option) { tokens.push({ raw, index }); continue; }
    const values = equals < 0 ? [] : [raw.slice(equals + 1)];
    for (let n = values.length; n < option.arity && i + 1 < argv.length; n += 1) {
      if (argv[i + 1] === "--" || argv[i + 1].startsWith("--") || ["-h", "-v"].includes(argv[i + 1])) break;
      values.push(argv[++i]);
    }
    tokens.push({ option, name: option.name, values, equals: equals >= 0, index });
  }
  return tokens;
}

export function inspectGlobals(argv, options = GLOBAL_OPTIONS) {
  const tokens = scan(argv, options);
  return {
    help: tokens.some((token) => token.name === "--help"),
    version: tokens.some((token) => token.name === "--version"),
    json: tokens.some((token) => token.name === "--json" || (token.name === "--format" && token.values[0] === "json")),
    noColor: tokens.some((token) => token.name === "--no-color" || token.name === "--plain" || (token.name === "--format" && token.values[0] === "plain")),
    plain: tokens.some((token) => token.name === "--plain" || (token.name === "--format" && token.values[0] === "plain")),
  };
}

export function normalizeArguments(argv, options, commands = []) {
  const tokens = scan(argv, options);
  const globals = inspectGlobals(argv, options);
  const positionals = tokens.flatMap((token) => token.literal ? token.values
    : token.raw !== undefined && !token.raw.startsWith("--") && !/^-[a-z]$/i.test(token.raw) ? [token.raw] : []);
  // Help and version are discovery operations even when ordinary values are
  // missing, conflicting, or unknown. Anything following -- is literal.
  if (globals.help || globals.version) return { args: [], globals, positions: {}, positionals };
  const seen = new Set();
  const args = [];
  const positions = {};
  const first = tokens.find((token) => token.raw !== undefined || token.literal);
  const ordered = first && commands.includes(first.raw) ? [first, ...tokens.filter((token) => token !== first)] : tokens;
  for (const token of ordered) {
    if (token.literal) { args.push("--", ...token.values); break; }
    if (!token.option) {
      if (token.raw.startsWith("--") || /^-[a-z]$/i.test(token.raw)) {
        const name = token.raw.split("=")[0];
        const replacement = { "--out": "--comments", "--live": "--ephemeral", "--owner-name": "--owner" }[name];
        if (replacement) throw new UsageError(`${name} was removed in Tunelito 1.0`, { hint: `Use ${replacement} instead.` });
        const suggestion = closestMatch(name, options.map((option) => option.name));
        throw new UsageError(`Unknown option ${name}`, { hint: suggestion ? `Did you mean ${suggestion}?` : undefined });
      }
      args.push(token.raw);
      continue;
    }
    const { name, values, option } = token;
    if (token.equals && option.arity === 0) throw new UsageError(`${name} does not take a value`);
    // Domain parsers own missing-value diagnostics (path, provider, number,
    // etc.). Keep the option so they can give the actionable specific error.
    if (seen.has(name) && !option.repeatable) throw new UsageError(`${name} was given more than once`);
    seen.add(name);
    if (["--no-color", "--plain"].includes(name)) continue;
    positions[name] = args.length;
    args.push(name, ...values, ...Array(Math.max(0, option.arity - values.length)).fill(undefined));
  }
  if (seen.has("--code-wrap") && seen.has("--no-code-wrap")) throw new UsageError("Use either --code-wrap or --no-code-wrap, not both");
  if (seen.has("--json") && seen.has("--format")) throw new UsageError("Use either --json or --format, not both");
  return { args, globals, positions, positionals };
}

export function routeCommand(argv, options, commandNames) {
  const tokens = scan(argv, options);
  const first = tokens.find((token) => token.raw !== undefined || token.literal);
  const command = first && commandNames.includes(first.raw) ? first.raw : null;
  if (!command) return { command: "serve", args: argv, positional: first?.raw };
  const index = first.index;
  return { command, args: [...argv.slice(0, index), ...argv.slice(index + 1)], positional: command };
}
