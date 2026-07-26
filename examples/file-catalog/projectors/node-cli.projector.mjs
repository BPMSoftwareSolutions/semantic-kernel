export const projector = Object.freeze({
  projectorId: "example.file-catalog.node-cli.v1",
  project({ authority }) {
    const content = projectCli(authority);
    return {
      targetId: "node-cli.esm.v1",
      artifacts: [{ path: "file-catalog.mjs", content, executable: true }],
      metadata: { capabilityId: authority.capabilityId },
    };
  },
});

function projectCli(authority) {
  requireRecord(authority, "authority");
  requireValue(authority.semanticLayer === "projectable-cli.v1", "semanticLayer must be projectable-cli.v1");
  requireString(authority.capabilityId, "capabilityId");
  requireString(authority.command?.name, "command.name");
  requireString(authority.command?.description, "command.description");
  requireValue(authority.source?.kind === "filesystem-entries", "source.kind must be filesystem-entries");
  requireString(authority.source?.root?.fromInput, "source.root.fromInput");
  requireValue(Array.isArray(authority.inputs) && authority.inputs.length === 1, "inputs must contain exactly one positional input");
  requireValue(Array.isArray(authority.options), "options must be an array");
  requireValue(Array.isArray(authority.selection) && authority.selection.length > 0, "selection must not be empty");
  requireValue(Array.isArray(authority.presentation?.columns) && authority.presentation.columns.length > 0, "presentation.columns must not be empty");
  requireString(authority.presentation.emptyMessage, "presentation.emptyMessage");
  requireValue(
    Array.isArray(authority.source.entryKinds) && authority.source.entryKinds.length > 0,
    "source.entryKinds must not be empty",
  );
  requireUnique(authority.source.entryKinds, "source.entryKinds");
  for (const kind of authority.source.entryKinds) {
    requireValue(["file", "directory", "symbolic-link", "other"].includes(kind), `unsupported entry kind: ${kind}`);
  }

  for (const candidate of authority.inputs) requireRecord(candidate, "inputs[]");
  const input = authority.inputs?.find((candidate) => candidate.id === authority.source.root.fromInput);
  requireValue(input?.kind === "positional", `root input ${authority.source.root.fromInput} must be positional`);
  requireString(input.id, "inputs[].id");
  requireString(input.description, "inputs[].description");
  requireString(input.default, "inputs[].default");

  const fieldIds = new Set();
  const fields = authority.selection.map((field) => {
    requireRecord(field, "selection[]");
    requireString(field.id, "selection[].id");
    requireValue(!fieldIds.has(field.id), `duplicate selection field: ${field.id}`);
    fieldIds.add(field.id);
    requireValue(
      ["name", "relativePath", "sizeBytes", "modifiedAt", "entryKind"].includes(field.fromSource),
      `unsupported source property: ${field.fromSource}`,
    );
    return { id: field.id, fromSource: field.fromSource };
  });

  for (const column of authority.presentation.columns) {
    requireRecord(column, "presentation.columns[]");
    requireValue(fields.some((field) => field.id === column.field), `unknown presentation field: ${column.field}`);
    requireString(column.label, "presentation.columns[].label");
    requireValue(["text", "bytes", "iso-timestamp"].includes(column.format), `unsupported format: ${column.format}`);
    requireValue(["left", "right"].includes(column.align), `unsupported alignment: ${column.align}`);
  }
  requireUnique(authority.presentation.columns.map((column) => column.field), "presentation.columns[].field");

  const sort = authority.orderBy ?? [];
  requireValue(Array.isArray(sort), "orderBy must be an array");
  for (const term of sort) {
    requireRecord(term, "orderBy[]");
    requireValue(fields.some((field) => field.id === term.field), `unknown order field: ${term.field}`);
    requireValue(["ascending", "descending"].includes(term.direction), `unsupported direction: ${term.direction}`);
  }

  const options = authority.options ?? [];
  const optionIds = new Set();
  const optionFlags = new Set(["-h", "--help"]);
  for (const option of options) {
    requireRecord(option, "options[]");
    requireString(option.id, "options[].id");
    requireValue(!optionIds.has(option.id), `duplicate option id: ${option.id}`);
    optionIds.add(option.id);
    requireValue(option.kind === "boolean", `option ${option.id} must be boolean`);
    requireString(option.long, `option ${option.id}.long`);
    requireValue(/^--[a-z][a-z0-9-]*$/u.test(option.long), `invalid long flag: ${option.long}`);
    requireValue(!optionFlags.has(option.long), `duplicate or reserved option flag: ${option.long}`);
    optionFlags.add(option.long);
    if (option.short !== undefined) {
      requireValue(/^-[A-Za-z0-9]$/u.test(option.short), `invalid short flag: ${option.short}`);
      requireValue(!optionFlags.has(option.short), `duplicate or reserved option flag: ${option.short}`);
      optionFlags.add(option.short);
    }
    requireString(option.description, `option ${option.id}.description`);
    requireValue(typeof option.default === "boolean", `option ${option.id}.default must be Boolean`);
  }
  const recursiveOption = optionFor(options, authority.source.recursive?.fromOption);
  const hiddenOption = optionFor(options, authority.source.includeHidden?.fromOption);
  const jsonOption = optionFor(options, authority.presentation.json?.fromOption);

  const semanticConstants = {
    COMMAND: authority.command,
    POSITIONAL: input,
    OPTIONS: options,
    SOURCE: {
      entryKinds: authority.source.entryKinds,
      recursiveOption: recursiveOption?.id ?? null,
      includeHiddenOption: hiddenOption?.id ?? null,
    },
    FIELD_PROJECTIONS: fields,
    ORDER_BY: sort,
    COLUMNS: authority.presentation.columns,
    EMPTY_MESSAGE: authority.presentation.emptyMessage,
    JSON_OPTION: jsonOption?.id ?? null,
  };

  return `#!/usr/bin/env node
// Semantic authority: ${authority.capabilityId}
// Projector: example.file-catalog.node-cli.v1

import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

${Object.entries(semanticConstants)
  .map(([name, value]) => `const ${name} = ${JSON.stringify(value, null, 2)};`)
  .join("\n\n")}

const parsed = parseArguments(process.argv.slice(2));
if (parsed.help) {
  printHelp();
} else {
  try {
    const root = path.resolve(String(parsed.values[POSITIONAL.id]));
    const entries = await collectEntries(root, root, parsed.values);
    const rows = entries.map(projectRow);
    orderRows(rows);
    if (JSON_OPTION && parsed.values[JSON_OPTION]) {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      printTable(rows);
    }
  } catch (error) {
    console.error(\`\${COMMAND.name}: \${error instanceof Error ? error.message : String(error)}\`);
    process.exitCode = 1;
  }
}

function parseArguments(args) {
  const values = Object.fromEntries(OPTIONS.map((option) => [option.id, option.default ?? false]));
  values[POSITIONAL.id] = POSITIONAL.default;
  let positionalSeen = false;
  for (const token of args) {
    if (token === "--help" || token === "-h") return { help: true, values };
    const option = OPTIONS.find((candidate) => candidate.long === token || candidate.short === token);
    if (option) {
      values[option.id] = true;
    } else if (token.startsWith("-")) {
      throw new Error(\`Unknown option: \${token}\`);
    } else if (!positionalSeen) {
      values[POSITIONAL.id] = token;
      positionalSeen = true;
    } else {
      throw new Error(\`Unexpected argument: \${token}\`);
    }
  }
  return { help: false, values };
}

async function collectEntries(root, current, values) {
  const currentStat = await lstat(current);
  if (!currentStat.isDirectory()) return includeKind(kindOf(currentStat)) ? [sourceEntry(root, current, currentStat)] : [];
  const children = await readdir(current, { withFileTypes: true });
  const collected = [];
  for (const child of children) {
    if (!values[SOURCE.includeHiddenOption] && child.name.startsWith(".")) continue;
    const childPath = path.join(current, child.name);
    const childKind = child.isDirectory() ? "directory" : child.isFile() ? "file" : child.isSymbolicLink() ? "symbolic-link" : "other";
    if (includeKind(childKind)) collected.push(sourceEntry(root, childPath, await lstat(childPath)));
    if (child.isDirectory() && values[SOURCE.recursiveOption]) {
      collected.push(...await collectEntries(root, childPath, values));
    }
  }
  return collected;
}

function sourceEntry(root, entryPath, stat) {
  return {
    name: path.basename(entryPath),
    relativePath: path.relative(root, entryPath) || path.basename(entryPath),
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    entryKind: kindOf(stat),
  };
}

function kindOf(stat) {
  return stat.isDirectory() ? "directory" : stat.isFile() ? "file" : stat.isSymbolicLink() ? "symbolic-link" : "other";
}

function includeKind(kind) {
  return SOURCE.entryKinds.includes(kind);
}

function projectRow(entry) {
  return Object.fromEntries(FIELD_PROJECTIONS.map((field) => [field.id, entry[field.fromSource]]));
}

function orderRows(rows) {
  rows.sort((left, right) => {
    for (const term of ORDER_BY) {
      const comparison = String(left[term.field]).localeCompare(String(right[term.field]), undefined, { numeric: true });
      if (comparison !== 0) return term.direction === "ascending" ? comparison : -comparison;
    }
    return 0;
  });
}

function printTable(rows) {
  if (rows.length === 0) {
    console.log(EMPTY_MESSAGE);
    return;
  }
  const rendered = rows.map((row) => Object.fromEntries(COLUMNS.map((column) => [column.field, format(row[column.field], column.format)])));
  const widths = Object.fromEntries(COLUMNS.map((column) => [
    column.field,
    Math.max(column.label.length, ...rendered.map((row) => String(row[column.field]).length)),
  ]));
  console.log(COLUMNS.map((column) => column.label.padEnd(widths[column.field])).join("  "));
  console.log(COLUMNS.map((column) => "-".repeat(widths[column.field])).join("  "));
  for (const row of rendered) {
    console.log(COLUMNS.map((column) => {
      const text = String(row[column.field]);
      return column.align === "right" ? text.padStart(widths[column.field]) : text.padEnd(widths[column.field]);
    }).join("  "));
  }
}

function format(value, kind) {
  if (kind === "bytes") return formatBytes(Number(value));
  if (kind === "iso-timestamp") return new Date(String(value)).toISOString();
  return String(value);
}

function formatBytes(bytes) {
  if (bytes < 1024) return \`\${bytes} B\`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = -1;
  do { value /= 1024; unit += 1; } while (value >= 1024 && unit < units.length - 1);
  return \`\${value.toFixed(value >= 10 ? 1 : 2)} \${units[unit]}\`;
}

function printHelp() {
  console.log(\`\${COMMAND.name} — \${COMMAND.description}\\n\`);
  console.log(\`Usage: \${COMMAND.name} [\${POSITIONAL.id}] \${OPTIONS.map((option) => \`[\${option.long}]\`).join(" ")}\\n\`);
  console.log(\`  \${POSITIONAL.id.padEnd(18)} \${POSITIONAL.description} (default: \${POSITIONAL.default})\`);
  for (const option of OPTIONS) {
    console.log(\`  \${[option.short, option.long].filter(Boolean).join(", ").padEnd(18)} \${option.description}\`);
  }
  console.log(\`  \${"-h, --help".padEnd(18)} Show this help\`);
}
`;
}

function optionFor(options, id) {
  if (id === undefined) return undefined;
  const option = options.find((candidate) => candidate.id === id);
  requireValue(option, `unknown option: ${id}`);
  requireValue(option.kind === "boolean", `option ${id} must be boolean`);
  return option;
}

function requireString(value, name) {
  requireValue(typeof value === "string" && value.length > 0, `${name} must be a non-empty string`);
}

function requireRecord(value, name) {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
}

function requireUnique(values, name) {
  requireValue(new Set(values).size === values.length, `${name} values must be unique`);
}

function requireValue(condition, message) {
  if (!condition) throw new Error(`Invalid semantic authority: ${message}`);
}
