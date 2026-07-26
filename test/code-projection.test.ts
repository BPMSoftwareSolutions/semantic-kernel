import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createSemanticKernel,
  declarativeTypeScriptProjector,
  SemanticKernelError,
  type CodeProjector,
  type DeclarativeTypeScriptProjection,
} from "../src/index.js";

test("shipped TypeScript compiler projects materially different bodies from SEJ and emits compilable source", async () => {
  const authority = diverseTypeScriptAuthority();
  const kernel = createSemanticKernel();
  const first = await kernel.projectCode(declarativeTypeScriptProjector.projectorId, authority);
  const second = await kernel.projectCode(declarativeTypeScriptProjector.projectorId, structuredClone(authority));

  assert.deepEqual(first, second);
  assert.equal(first.artifacts.length, 2);
  const workflow = first.artifacts.find((artifact) => artifact.path === "src/workflow.ts")?.content ?? "";
  const classifier = first.artifacts.find((artifact) => artifact.path === "src/classifier.ts")?.content ?? "";
  assert.match(workflow, /for \(const item of items\)/u);
  assert.match(workflow, /if \(item\.enabled\)/u);
  assert.match(workflow, /try \{/u);
  assert.match(workflow, /catch \(error\)/u);
  assert.match(classifier, /switch \(value\)/u);
  assert.doesNotMatch(workflow, /projector\.mjs|CodeProjector/u);

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "declarative-typescript-"));
  try {
    for (const artifact of first.artifacts) {
      const destination = path.join(temporary, ...artifact.path.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, artifact.content, "utf8");
    }
    const compiled = spawnSync(process.execPath, [
      path.resolve("node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--target", "ES2022",
      "--module", "NodeNext",
      "--moduleResolution", "NodeNext",
      ...first.artifacts.map((artifact) => path.join(temporary, ...artifact.path.split("/"))),
    ], { encoding: "utf8" });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("CLI infers the shipped TypeScript compiler from SEJ without a projector argument", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "declarative-typescript-cli-"));
  try {
    const authorityPath = path.join(temporary, "body.sej.json");
    const outputPath = path.join(temporary, "generated");
    fs.writeFileSync(authorityPath, JSON.stringify(diverseTypeScriptAuthority()), "utf8");
    const projected = runCli([
      authorityPath,
      outputPath,
    ]);
    assert.equal(projected.status, 0, projected.stderr);
    assert.equal(fs.existsSync(path.join(outputPath, "src", "workflow.ts")), true);
    assert.equal(runCli([
      authorityPath,
      outputPath,
      "--check",
    ]).status, 0);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("declarative TypeScript compiler rejects source injection and malformed identifiers", async () => {
  const kernel = createSemanticKernel();
  const unsafe = diverseTypeScriptAuthority() as unknown as {
    artifacts: Array<{ declarations: Array<{ name?: string; returnType?: string }> }>;
  };
  unsafe.artifacts[0]!.declarations[1]!.name = "run; process.exit()";
  await assert.rejects(kernel.projectCode(declarativeTypeScriptProjector.projectorId, unsafe), /Invalid TypeScript identifier/u);

  const unsafeType = structuredClone(diverseTypeScriptAuthority()) as unknown as {
    artifacts: Array<{ declarations: Array<{ name?: string; returnType?: string }> }>;
  };
  unsafeType.artifacts[0]!.declarations[1]!.returnType = "string; process.exit()";
  await assert.rejects(kernel.projectCode(declarativeTypeScriptProjector.projectorId, unsafeType), /Unsafe TypeScript type text/u);

  const rawEscape = structuredClone(diverseTypeScriptAuthority()) as unknown as {
    artifacts: Array<{ declarations: Array<Record<string, unknown>> }>;
  };
  rawEscape.artifacts[0]!.declarations[1]!.rawSource = "process.exit()";
  await assert.rejects(
    kernel.projectCode(declarativeTypeScriptProjector.projectorId, rawEscape),
    /unsupported fields: rawSource/u,
  );
});

test("optional platform backends can add distinct target languages and artifact layouts", async () => {
  const first: CodeProjector = {
    projectorId: "platform.javascript-backend.v1",
    project: ({ authority }) => ({
      targetId: "javascript.esm.v1",
      artifacts: [{ path: "commands/first.mjs", content: `export default ${JSON.stringify(authority)};\n` }],
    }),
  };
  const second: CodeProjector = {
    projectorId: "platform.python-backend.v1",
    project: () => ({
      targetId: "python.v1",
      artifacts: [
        { path: "app.py", content: "print('platform-backend')\n", executable: true },
        { path: "requirements.txt", content: "" },
      ],
    }),
  };
  const kernel = createSemanticKernel({ codeProjectors: [first, second] });

  const firstReceipt = await kernel.edges.projectsCode("platform.javascript-backend.v1", { meaning: "one" });
  const secondReceipt = await kernel.projectCode("platform.python-backend.v1", { meaning: "two" });

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

test("code projection rejects cyclic and non-finite authority before invoking a backend", async () => {
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

test("CLI supports optional third-party language backends and detects stale artifacts", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-project-cli-"));
  try {
    const projectorPath = path.join(temporary, "projector.mjs");
    const authorityPath = path.join(temporary, "authority.json");
    const optionsPath = path.join(temporary, "options.json");
    const outputPath = path.join(temporary, "generated");
    fs.writeFileSync(projectorPath, `
export const projector = {
  projectorId: "platform.cli-test-backend.v1",
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

test("packed downstream consumer projects SEJ through the shipped backend without authoring a projector", async () => {
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

    fs.writeFileSync(path.join(consumer, "authority.json"), JSON.stringify(diverseTypeScriptAuthority()), "utf8");
    fs.writeFileSync(path.join(consumer, "verify.mjs"), `
import { createSemanticKernel } from "@deterministic-solutions/semantic-kernel";
import { readFile } from "node:fs/promises";
const authority = JSON.parse(await readFile(new URL("./authority.json", import.meta.url), "utf8"));
const receipt = await createSemanticKernel().projectCode("semantic-kernel/declarative-typescript.v1", authority);
if (!receipt.artifacts.some((artifact) => artifact.path === "src/workflow.ts")) process.exitCode = 1;
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
      "authority.json",
      "generated",
    ], { cwd: consumer, encoding: "utf8" });
    assert.equal(projected.status, 0, projected.stderr);
    assert.equal(
      fs.readFileSync(path.join(consumer, "generated", "src", "classifier.ts"), "utf8"),
      (await createSemanticKernel()
        .projectCode("semantic-kernel/declarative-typescript.v1", diverseTypeScriptAuthority()))
        .artifacts.find((artifact) => artifact.path === "src/classifier.ts")?.content,
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

function diverseTypeScriptAuthority(): DeclarativeTypeScriptProjection {
  return {
    projectionType: "declarative-typescript-projection.v1",
    projectionId: "project-diverse-app-bodies",
    version: "1.0.0",
    targetId: "typescript-esm",
    artifacts: [
      {
        path: "src/workflow.ts",
        declarations: [
          {
            kind: "interface",
            name: "WorkItem",
            export: true,
            members: [
              { kind: "property", name: "id", type: "string", readonly: true },
              { kind: "property", name: "enabled", type: "boolean", readonly: true },
            ],
          },
          {
            kind: "function",
            name: "runsWorkflow",
            export: true,
            async: true,
            parameters: [
              { name: "items", type: "readonly WorkItem[]" },
              { name: "handler", type: "(id: string) => Promise<string>" },
            ],
            returnType: "Promise<readonly string[]>",
            body: [
              {
                kind: "variable",
                declarationKind: "const",
                name: "results",
                type: "string[]",
                value: { kind: "array", items: [] },
              },
              {
                kind: "for-of",
                declarationKind: "const",
                name: "item",
                iterable: { kind: "identifier", name: "items" },
                body: [{
                  kind: "if",
                  condition: {
                    kind: "member",
                    object: { kind: "identifier", name: "item" },
                    property: "enabled",
                  },
                  then: [{
                    kind: "try",
                    body: [{
                      kind: "expression",
                      expression: {
                        kind: "call",
                        callee: {
                          kind: "member",
                          object: { kind: "identifier", name: "results" },
                          property: "push",
                        },
                        arguments: [{
                          kind: "await",
                          expression: {
                            kind: "call",
                            callee: { kind: "identifier", name: "handler" },
                            arguments: [{
                              kind: "member",
                              object: { kind: "identifier", name: "item" },
                              property: "id",
                            }],
                          },
                        }],
                      },
                    }],
                    catch: {
                      binding: "error",
                      body: [{
                        kind: "throw",
                        expression: {
                          kind: "new",
                          callee: { kind: "identifier", name: "Error" },
                          arguments: [{
                            kind: "template",
                            parts: ["Handler failed: ", {
                              kind: "call",
                              callee: { kind: "identifier", name: "String" },
                              arguments: [{ kind: "identifier", name: "error" }],
                            }],
                          }],
                        },
                      }],
                    },
                  }],
                }],
              },
              { kind: "return", expression: { kind: "identifier", name: "results" } },
            ],
          },
        ],
      },
      {
        path: "src/classifier.ts",
        declarations: [{
          kind: "function",
          name: "classifiesValue",
          export: true,
          parameters: [{ name: "value", type: "string" }],
          returnType: "string",
          body: [{
            kind: "switch",
            expression: { kind: "identifier", name: "value" },
            cases: [
              {
                test: { kind: "literal", value: "a" },
                body: [{ kind: "return", expression: { kind: "literal", value: "alpha" } }],
              },
              {
                test: { kind: "literal", value: "b" },
                body: [{ kind: "return", expression: { kind: "literal", value: "beta" } }],
              },
              {
                body: [{ kind: "return", expression: { kind: "literal", value: "other" } }],
              },
            ],
          }],
        }],
      },
    ],
  };
}

function runNpm(
  arguments_: string[],
  options: Readonly<{ cwd: string }>,
): Readonly<{ status: number | null; stdout: string; stderr: string }> {
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, "npm_execpath must be available while running npm test");
  return spawnSync(process.execPath, [npmCli, ...arguments_], { ...options, encoding: "utf8" });
}
