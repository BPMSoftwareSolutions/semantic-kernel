#!/usr/bin/env node
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import type { CodeProjectionReceipt, CodeProjector } from "../contracts/code-projection.contract.js";
import { createSemanticKernel } from "../kernel/semantic-kernel.js";
import { declarativeTypeScriptProjector } from "../projectors/declarative-typescript-projector.js";

const MANIFEST_NAME = ".semantic-projection.json";

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function main(arguments_: string[]): Promise<void> {
  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    printHelp();
    return;
  }
  const { check, optionsPath, positionals } = parseArguments(arguments_);
  if (positionals.length !== 2 && positionals.length !== 3) {
    printHelp();
    process.exitCode = 2;
    return;
  }

  const [projectorArgument, authorityArgument, outputArgument] = positionals.length === 3
    ? positionals as [string, string, string]
    : [undefined, ...positionals] as [undefined, string, string];
  const authorityPath = path.resolve(authorityArgument);
  const outputDirectory = path.resolve(outputArgument);
  const authority = JSON.parse(await readFile(authorityPath, "utf8")) as unknown;
  const selectedProjector = projectorArgument ?? inferBuiltInProjector(authority);
  const builtIn = selectedProjector === declarativeTypeScriptProjector.projectorId;
  const projector = builtIn
    ? declarativeTypeScriptProjector
    : selectProjector(await import(projectorSpecifier(selectedProjector)) as Readonly<Record<string, unknown>>);
  const options = optionsPath === undefined
    ? {}
    : JSON.parse(await readFile(path.resolve(optionsPath), "utf8")) as unknown;
  const kernel = builtIn ? createSemanticKernel() : createSemanticKernel({ codeProjectors: [projector] });
  const receipt = await kernel.edges.projectsCode(projector.projectorId, authority, options);

  if (check) {
    await checkProjection(outputDirectory, receipt);
    console.log(`Projection is current: ${outputArgument}`);
  } else {
    await writeProjection(outputDirectory, receipt);
    console.log(`Projected with ${projector.projectorId} -> ${outputArgument}`);
  }
}

function inferBuiltInProjector(authority: unknown): string {
  if (
    authority !== null
    && typeof authority === "object"
    && !Array.isArray(authority)
    && (authority as Readonly<Record<string, unknown>>).projectionType === "declarative-typescript-projection.v1"
  ) {
    return declarativeTypeScriptProjector.projectorId;
  }
  throw new Error("No shipped compiler recognizes this authority projectionType; specify a platform backend explicitly.");
}

function selectProjector(module: Readonly<Record<string, unknown>>): CodeProjector {
  const candidates = [module.default, module.projector].filter((candidate) => candidate !== undefined);
  if (candidates.length !== 1) {
    throw new Error("Projector module must export exactly one projector as default or as `projector`.");
  }
  return candidates[0] as CodeProjector;
}

async function writeProjection(outputDirectory: string, receipt: CodeProjectionReceipt): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  const previousArtifactPaths = await readManagedArtifactPaths(outputDirectory);
  const nextArtifactPaths = new Set(receipt.artifacts.map((artifact) => artifact.path));
  for (const artifact of receipt.artifacts) {
    const destination = artifactDestination(outputDirectory, artifact.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, artifact.content, "utf8");
    if (artifact.executable === true && process.platform !== "win32") await chmod(destination, 0o755);
  }
  for (const previousPath of previousArtifactPaths) {
    if (!nextArtifactPaths.has(previousPath)) {
      await unlink(artifactDestination(outputDirectory, previousPath)).catch((error: unknown) => {
        if (!isMissingFileError(error)) throw error;
      });
    }
  }
  await writeFile(path.join(outputDirectory, MANIFEST_NAME), manifest(receipt), "utf8");
}

async function checkProjection(outputDirectory: string, receipt: CodeProjectionReceipt): Promise<void> {
  const mismatches: string[] = [];
  for (const artifact of receipt.artifacts) {
    const current = await readFile(artifactDestination(outputDirectory, artifact.path), "utf8").catch(() => undefined);
    if (current !== artifact.content) mismatches.push(artifact.path);
  }
  const currentManifest = await readFile(path.join(outputDirectory, MANIFEST_NAME), "utf8").catch(() => undefined);
  if (currentManifest !== manifest(receipt)) mismatches.push(MANIFEST_NAME);
  if (mismatches.length > 0) {
    throw new Error(`Projection is stale or incomplete: ${mismatches.join(", ")}`);
  }
}

function artifactDestination(outputDirectory: string, artifactPath: string): string {
  if (!isSafeManifestArtifactPath(artifactPath)) {
    throw new Error(`Invalid managed artifact path: ${artifactPath}`);
  }
  const destination = path.resolve(outputDirectory, ...artifactPath.split("/"));
  const relative = path.relative(outputDirectory, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Projected artifact escapes output directory: ${artifactPath}`);
  }
  return destination;
}

async function readManagedArtifactPaths(outputDirectory: string): Promise<readonly string[]> {
  const content = await readFile(path.join(outputDirectory, MANIFEST_NAME), "utf8").catch(() => undefined);
  if (content === undefined) return [];
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed === null || typeof parsed !== "object" || !("artifacts" in parsed) || !Array.isArray(parsed.artifacts)) return [];
    return parsed.artifacts.flatMap((artifact: unknown) => {
      if (
        artifact !== null
        && typeof artifact === "object"
        && "path" in artifact
        && typeof artifact.path === "string"
        && isSafeManifestArtifactPath(artifact.path)
      ) {
        return [artifact.path];
      }
      return [];
    });
  } catch {
    return [];
  }
}

function isSafeManifestArtifactPath(value: string): boolean {
  if (value.length === 0 || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:\//u.test(value)) return false;
  return value.split("/").every((segment) => (
    segment.length > 0
    && segment !== "."
    && segment !== ".."
    && !/[\u0000-\u001f<>:"|?*]/u.test(segment)
    && !/[. ]$/u.test(segment)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(segment)
  ));
}

function isMissingFileError(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function projectorSpecifier(argument: string): string {
  if (
    argument.startsWith(".")
    || argument.startsWith("/")
    || /^[A-Za-z]:[\\/]/u.test(argument)
    || existsSync(path.resolve(argument))
  ) {
    return pathToFileURL(path.resolve(argument)).href;
  }
  return argument;
}

function parseArguments(arguments_: string[]): Readonly<{
  check: boolean;
  optionsPath?: string;
  positionals: string[];
}> {
  let check = false;
  let optionsPath: string | undefined;
  const positionals: string[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--check") {
      check = true;
    } else if (argument === "--options") {
      optionsPath = arguments_[index + 1];
      if (optionsPath === undefined) throw new Error("--options requires a JSON file path.");
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      positionals.push(argument);
    }
  }
  return {
    check,
    positionals,
    ...(optionsPath === undefined ? {} : { optionsPath }),
  };
}

function manifest(receipt: CodeProjectionReceipt): string {
  return `${JSON.stringify({
    receiptType: receipt.receiptType,
    projectorId: receipt.projectorId,
    targetId: receipt.targetId,
    authoritySha256: receipt.authoritySha256,
    optionsSha256: receipt.optionsSha256,
    artifacts: receipt.artifacts.map(({ path: artifactPath, sha256, executable }) => ({
      path: artifactPath,
      sha256,
      ...(executable === undefined ? {} : { executable }),
    })),
    metadata: receipt.metadata,
  }, null, 2)}\n`;
}

function printHelp(): void {
  console.log("Usage: semantic-project <authority.json> <output-directory> [--options <options.json>] [--check]");
  console.log("   or: semantic-project <built-in-projector-id|projector-module> <authority.json> <output-directory> [--options <options.json>] [--check]");
  console.log("");
  console.log("Infers a shipped compiler from authority, or uses an explicitly selected platform backend.");
}
