import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [authorityArgument, outputArgument, mode] = process.argv.slice(2);

if (!authorityArgument || !outputArgument) {
  console.error("Usage: node tools/project-cli.mjs <authority.json> <output.mjs> [--check]");
  process.exitCode = 2;
} else {
  const authorityPath = resolve(authorityArgument);
  const outputPath = resolve(outputArgument);
  const authority = JSON.parse(await readFile(authorityPath, "utf8"));
  const projectedCode = projectCli(authority, authorityArgument);

  if (mode === "--check") {
    const currentCode = await readFile(outputPath, "utf8").catch(() => "");
    if (currentCode !== projectedCode) {
      console.error(`Projection is stale: ${outputArgument}`);
      process.exitCode = 1;
    } else {
      console.log(`Projection is current: ${outputArgument}`);
    }
  } else {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, projectedCode, "utf8");
    console.log(`Projected ${authority.capabilityId} -> ${outputArgument}`);
  }
}

function projectCli(authority, authorityArgument) {
  requireValue(authority.semanticLayer === "projectable-cli.v1", "semanticLayer must be projectable-cli.v1");
  requireString(authority.capabilityId, "capabilityId");
  requireString(authority.command?.name, "command.name");
  requireString(authority.command?.description, "command.description");
  requireValue(authority.source?.kind === "filesystem-entries", "source.kind must be filesystem-entries");
  requireValue(authority.source?.root?.fromInput, "source.root.fromInput is required");
  requireValue(Array.isArray(authority.selection) && authority.selection.length > 0, "selection must not be empty");
  requireValue(Array.isArray(authority.presentation?.columns), "presentation.columns is required");

  const input = authority.inputs?.find((candidate) => candidate.id === authority.source.root.fromInput);
  requireValue(input?.kind === "positional", `root input ${authority.source.root.fromInput} must be positional`);

  const fields = authority.selection.map((field) => {
    requireString(field.id, "selection[].id");
    requireValue(
      ["name", "relativePath", "sizeBytes", "modifiedAt", "entryKind"].includes(field.fromSource),
      `unsupported source property: ${field.fromSource}`,
    );
    return { id: field.id, fromSource: field.fromSource };
  });

  for (const column of authority.presentation.columns) {
    requireValue(fields.some((field) => field.id === column.field), `unknown presentation field: ${column.field}`);
    requireValue(["text", "bytes", "iso-timestamp"].includes(column.format), `unsupported format: ${column.format}`);
  }

  const sort = authority.orderBy ?? [];
  for (const term of sort) {
    requireValue(fields.some((field) => field.id === term.field), `unknown order field: ${term.field}`);
    requireValue(["ascending", "descending"].includes(term.direction), `unsupported direction: ${term.direction}`);
  }

  const options = authority.options ?? [];
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
// Generated from ${authorityArgument.replaceAll("\\", "/")}.
// Semantic authority: ${authority.capabilityId}
// Re-project with: node tools/project-cli.mjs ${authorityArgument.replaceAll("\\", "/")} ${process.argv[3]?.replaceAll("\\", "/") ?? "<output.mjs>"}

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

function requireValue(condition, message) {
  if (!condition) throw new Error(`Invalid semantic authority: ${message}`);
}
