import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createSemanticKernel,
  SemanticKernelError,
  type CodeProjector,
} from "../src/index.js";

test("consumer projectors own distinct code bodies and artifact layouts", async () => {
  const first: CodeProjector = {
    projectorId: "consumer.first.v1",
    project: ({ authority }) => ({
      targetId: "javascript.esm.v1",
      artifacts: [{ path: "commands/first.mjs", content: `export default ${JSON.stringify(authority)};\n` }],
    }),
  };
  const second: CodeProjector = {
    projectorId: "consumer.second.v1",
    project: () => ({
      targetId: "python.v1",
      artifacts: [
        { path: "app.py", content: "print('consumer-owned')\n", executable: true },
        { path: "requirements.txt", content: "" },
      ],
    }),
  };
  const kernel = createSemanticKernel({ codeProjectors: [first, second] });

  const firstReceipt = await kernel.edges.projectsCode("consumer.first.v1", { meaning: "one" });
  const secondReceipt = await kernel.projectCode("consumer.second.v1", { meaning: "two" });

  assert.equal(firstReceipt.artifacts[0]?.path, "commands/first.mjs");
  assert.match(firstReceipt.artifacts[0]?.content ?? "", /"meaning":"one"/u);
  assert.deepEqual(secondReceipt.artifacts.map((artifact) => artifact.path), ["app.py", "requirements.txt"]);
  assert.equal(secondReceipt.targetId, "python.v1");
});

test("code projection snapshots inputs and produces stable content identities", async () => {
  let observedFrozen = false;
  const projector: CodeProjector = {
    projectorId: "consumer.deterministic.v1",
    project: ({ authority, options }) => {
      observedFrozen = Object.isFrozen(authority)
        && Object.isFrozen((authority as { nested: object }).nested)
        && Object.isFrozen(options);
      return {
        targetId: "text.v1",
        artifacts: [{ path: "body.txt", content: "stable\n" }],
        metadata: { flavor: options.flavor ?? null },
      };
    },
  };
  const kernel = createSemanticKernel({ codeProjectors: [projector] });
  const first = await kernel.projectCode("consumer.deterministic.v1", { z: 1, nested: { value: true }, a: 2 }, { flavor: "plain" });
  const second = await kernel.projectCode("consumer.deterministic.v1", { a: 2, nested: { value: true }, z: 1 }, { flavor: "plain" });

  assert.equal(observedFrozen, true);
  assert.equal(first.authoritySha256, second.authoritySha256);
  assert.equal(first.optionsSha256, second.optionsSha256);
  assert.equal(first.artifacts[0]?.sha256, second.artifacts[0]?.sha256);
  assert.deepEqual(first.metadata, { flavor: "plain" });

  const differentOptions = await kernel.projectCode(
    "consumer.deterministic.v1",
    { a: 2, nested: { value: true }, z: 1 },
    { flavor: "different" },
  );
  assert.notEqual(first.optionsSha256, differentOptions.optionsSha256);
});

test("code projection fails closed for missing projectors and unsafe or duplicate artifacts", async () => {
  const kernel = createSemanticKernel();
  await assert.rejects(
    kernel.projectCode("missing.v1", {}),
    (error: unknown) => error instanceof SemanticKernelError && error.code === "CODE_PROJECTOR_NOT_FOUND",
  );

  kernel.codeProjectors.register({
    projectorId: "consumer.invalid.v1",
    project: () => ({
      targetId: "text.v1",
      artifacts: [
        { path: "../escape.txt", content: "escape" },
        { path: "../escape.txt", content: "duplicate" },
      ],
    }),
  });
  await assert.rejects(
    kernel.projectCode("consumer.invalid.v1", {}),
    (error: unknown) => error instanceof SemanticKernelError && error.code === "INVALID_CODE_PROJECTION_OUTPUT",
  );
});

test("code projection rejects cyclic and non-finite authority before invoking a consumer", async () => {
  let invoked = false;
  const kernel = createSemanticKernel({
    codeProjectors: [{
      projectorId: "consumer.never-invoked.v1",
      project: () => {
        invoked = true;
        return { targetId: "text.v1", artifacts: [{ path: "body.txt", content: "" }] };
      },
    }],
  });
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  await assert.rejects(
    kernel.edges.projectsCode("consumer.never-invoked.v1", cyclic),
    (error: unknown) => error instanceof SemanticKernelError && error.code === "NON_JSON_VALUE",
  );
  await assert.rejects(
    kernel.edges.projectsCode("consumer.never-invoked.v1", { invalid: Number.POSITIVE_INFINITY }),
    (error: unknown) => error instanceof SemanticKernelError && error.code === "NON_JSON_VALUE",
  );
  assert.equal(invoked, false);
});

test("packaged CLI loads a consumer projector, writes artifacts, and detects staleness", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-project-cli-"));
  try {
    const projectorPath = path.join(temporary, "projector.mjs");
    const authorityPath = path.join(temporary, "authority.json");
    const optionsPath = path.join(temporary, "options.json");
    const outputPath = path.join(temporary, "generated");
    fs.writeFileSync(projectorPath, `
export const projector = {
  projectorId: "consumer.cli-test.v1",
  project: ({ authority, options }) => ({
    targetId: "javascript.esm.v1",
    artifacts: [
      { path: "nested/app.mjs", content: "export default " + JSON.stringify({ authority, flavor: options.flavor }) + ";\\n" },
      ...(authority.includeLegacy ? [{ path: "legacy.mjs", content: "export const legacy = true;\\n" }] : [])
    ]
  })
};
`, "utf8");
    fs.writeFileSync(authorityPath, JSON.stringify({ application: "different-body", includeLegacy: true }), "utf8");
    fs.writeFileSync(optionsPath, JSON.stringify({ flavor: "consumer-option" }), "utf8");
    const cliArguments = [projectorPath, authorityPath, outputPath, "--options", optionsPath];

    const project = runCli(cliArguments);
    assert.equal(project.status, 0, project.stderr);
    assert.equal(
      fs.readFileSync(path.join(outputPath, "nested", "app.mjs"), "utf8"),
      'export default {"authority":{"application":"different-body","includeLegacy":true},"flavor":"consumer-option"};\n',
    );
    assert.equal(fs.existsSync(path.join(outputPath, "legacy.mjs")), true);
    assert.equal(runCli([...cliArguments, "--check"]).status, 0);

    fs.appendFileSync(path.join(outputPath, "nested", "app.mjs"), "// stale\n", "utf8");
    const stale = runCli([...cliArguments, "--check"]);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /nested\/app\.mjs/u);

    fs.writeFileSync(authorityPath, JSON.stringify({ application: "different-body", includeLegacy: false }), "utf8");
    assert.equal(runCli(cliArguments).status, 0);
    assert.equal(fs.existsSync(path.join(outputPath, "legacy.mjs")), false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("file-catalog consumer projector rejects incomplete semantic authority", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-project-invalid-"));
  try {
    const authorityPath = path.join(temporary, "authority.json");
    fs.writeFileSync(authorityPath, JSON.stringify({
      semanticLayer: "projectable-cli.v1",
      capabilityId: "incomplete",
      command: { name: "broken", description: "Broken" },
      source: { kind: "filesystem-entries", root: { fromInput: "path" } },
      inputs: [{ id: "path", kind: "positional", description: "Path", default: "." }],
      options: [],
      selection: [{ id: "file", fromSource: "relativePath" }],
      presentation: { columns: [{ field: "file", label: "FILE", format: "text", align: "left" }], emptyMessage: "Empty" },
    }), "utf8");
    const result = runCli([
      path.resolve("examples/file-catalog/projectors/node-cli.projector.mjs"),
      authorityPath,
      path.join(temporary, "generated"),
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /source\.entryKinds must not be empty/u);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("checked-in file-catalog projection is current and executable", () => {
  const current = runCli([
    path.resolve("examples/file-catalog/projectors/node-cli.projector.mjs"),
    path.resolve("examples/file-catalog/semantic-authority/file-catalog.cli.v1.json"),
    path.resolve("examples/file-catalog/generated"),
    "--check",
  ]);
  assert.equal(current.status, 0, current.stderr);

  const executed = spawnSync(process.execPath, [
    path.resolve("examples/file-catalog/generated/file-catalog.mjs"),
    "--help",
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /Usage: file-catalog/u);
});

test("packed downstream consumer can import the API and run its own projector through the shipped CLI", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-project-packed-"));
  try {
    const packed = runNpm(["pack", "--json", "--pack-destination", temporary], {
      cwd: process.cwd(),
    });
    assert.equal(packed.status, 0, packed.stderr);
    const packResult = JSON.parse(packed.stdout) as readonly [{ filename: string }];
    const tarball = path.join(temporary, packResult[0].filename);
    const consumer = path.join(temporary, "consumer");
    fs.mkdirSync(consumer);
    fs.writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ type: "module", private: true }), "utf8");
    const installed = runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
      cwd: consumer,
    });
    assert.equal(installed.status, 0, installed.stderr);

    fs.writeFileSync(path.join(consumer, "projector.mjs"), `
export const projector = {
  projectorId: "downstream.custom.v1",
  project: ({ authority }) => ({
    targetId: "downstream.module.v1",
    artifacts: [{ path: "custom.mjs", content: "export const consumer = " + JSON.stringify(authority.name) + ";\\n" }]
  })
};
`, "utf8");
    fs.writeFileSync(path.join(consumer, "authority.json"), JSON.stringify({ name: "packed-client" }), "utf8");
    fs.writeFileSync(path.join(consumer, "verify.mjs"), `
import { createSemanticKernel } from "@deterministic-solutions/semantic-kernel";
import { projector } from "./projector.mjs";
const receipt = await createSemanticKernel({ codeProjectors: [projector] }).projectCode(projector.projectorId, { name: "packed-client" });
if (receipt.artifacts[0].path !== "custom.mjs") process.exitCode = 1;
`, "utf8");

    const imported = spawnSync(process.execPath, ["verify.mjs"], { cwd: consumer, encoding: "utf8" });
    assert.equal(imported.status, 0, imported.stderr);
    const cliPath = path.join(
      consumer,
      "node_modules",
      "@deterministic-solutions",
      "semantic-kernel",
      "dist",
      "cli",
      "project-code.js",
    );
    const projected = spawnSync(process.execPath, [
      cliPath,
      "projector.mjs",
      "authority.json",
      "generated",
    ], { cwd: consumer, encoding: "utf8" });
    assert.equal(projected.status, 0, projected.stderr);
    assert.equal(
      fs.readFileSync(path.join(consumer, "generated", "custom.mjs"), "utf8"),
      'export const consumer = "packed-client";\n',
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

function runCli(arguments_: string[]): Readonly<{ status: number | null; stdout: string; stderr: string }> {
  return spawnSync(process.execPath, [path.resolve("dist/cli/project-code.js"), ...arguments_], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function runNpm(
  arguments_: string[],
  options: Readonly<{ cwd: string }>,
): Readonly<{ status: number | null; stdout: string; stderr: string }> {
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, "npm_execpath must be available while running npm test");
  return spawnSync(process.execPath, [npmCli, ...arguments_], { ...options, encoding: "utf8" });
}
