#!/usr/bin/env node
// Semantic authority: catalog-files
// Projector: example.file-catalog.node-cli.v1

import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

const COMMAND = {
  "name": "file-catalog",
  "description": "Display files with their sizes and modification timestamps."
};

const POSITIONAL = {
  "id": "path",
  "kind": "positional",
  "description": "File or directory to inspect",
  "default": "."
};

const OPTIONS = [
  {
    "id": "recursive",
    "kind": "boolean",
    "short": "-r",
    "long": "--recursive",
    "description": "Include files in descendant directories",
    "default": false
  },
  {
    "id": "includeHidden",
    "kind": "boolean",
    "short": "-a",
    "long": "--all",
    "description": "Include entries whose names begin with a dot",
    "default": false
  },
  {
    "id": "json",
    "kind": "boolean",
    "long": "--json",
    "description": "Render the selected semantic fields as JSON",
    "default": false
  }
];

const SOURCE = {
  "entryKinds": [
    "file"
  ],
  "recursiveOption": "recursive",
  "includeHiddenOption": "includeHidden"
};

const FIELD_PROJECTIONS = [
  {
    "id": "file",
    "fromSource": "relativePath"
  },
  {
    "id": "bytes",
    "fromSource": "sizeBytes"
  },
  {
    "id": "modified",
    "fromSource": "modifiedAt"
  }
];

const ORDER_BY = [
  {
    "field": "file",
    "direction": "ascending"
  }
];

const COLUMNS = [
  {
    "field": "file",
    "label": "FILE",
    "format": "text",
    "align": "left"
  },
  {
    "field": "bytes",
    "label": "SIZE",
    "format": "bytes",
    "align": "right"
  },
  {
    "field": "modified",
    "label": "MODIFIED",
    "format": "iso-timestamp",
    "align": "left"
  }
];

const EMPTY_MESSAGE = "No matching files.";

const JSON_OPTION = "json";

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
    console.error(`${COMMAND.name}: ${error instanceof Error ? error.message : String(error)}`);
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
      throw new Error(`Unknown option: ${token}`);
    } else if (!positionalSeen) {
      values[POSITIONAL.id] = token;
      positionalSeen = true;
    } else {
      throw new Error(`Unexpected argument: ${token}`);
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
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = -1;
  do { value /= 1024; unit += 1; } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}

function printHelp() {
  console.log(`${COMMAND.name} — ${COMMAND.description}\n`);
  console.log(`Usage: ${COMMAND.name} [${POSITIONAL.id}] ${OPTIONS.map((option) => `[${option.long}]`).join(" ")}\n`);
  console.log(`  ${POSITIONAL.id.padEnd(18)} ${POSITIONAL.description} (default: ${POSITIONAL.default})`);
  for (const option of OPTIONS) {
    console.log(`  ${[option.short, option.long].filter(Boolean).join(", ").padEnd(18)} ${option.description}`);
  }
  console.log(`  ${"-h, --help".padEnd(18)} Show this help`);
}
