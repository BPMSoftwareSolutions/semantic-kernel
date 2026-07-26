import assert from "node:assert/strict";
import test from "node:test";
import { createSemanticKernel, SemanticKernel, SemanticKernelError } from "../src/index.js";

const kernel = new SemanticKernel();
kernel.catalog.registerDecision({
  declarationType: "decision.v1", decisionId: "resolve-target-disposition", noMatchDisposition: "reject",
  rules: [
    { ruleId: "missing", when: { operator: "equals", left: { kind: "path", path: "$.target.exists" }, right: { kind: "value", value: false } }, then: "authorize-copy" },
    { ruleId: "same", when: { operator: "equals", left: { kind: "path", path: "$.source.hash" }, right: { kind: "path", path: "$.target.hash" } }, then: "declare-noop" },
    { ruleId: "reject", when: { operator: "always" }, then: "reject-conflict" }
  ]
});
kernel.catalog.registerProjection({ declarationType: "projection.v1", projectionId: "project-copy-request", expression: { kind: "object", fields: {
  operationId: { kind: "read", path: "$.placement.id" }, sourcePath: { kind: "read", path: "$.placement.source" }, targetPath: { kind: "read", path: "$.placement.target" }, overwrite: { kind: "constant", value: false }
}}});
kernel.catalog.registerProjection({ declarationType: "projection.v1", projectionId: "project-item", expression: { kind: "object", fields: {
  value: { kind: "read", path: "$.item" }, index: { kind: "read", path: "$.iteration.index" }
}}});
kernel.catalog.registerIteration({ declarationType: "iteration.v1", iterationId: "project-items", collectionPath: "$.items", itemContextPath: "$.item", projectionId: "project-item", order: "source" });

test("resolves a semantic decision without domain logic in the kernel", () => {
  assert.equal(kernel.resolve("resolve-target-disposition", { source: { hash: "a" }, target: { exists: false } }), "authorize-copy");
  assert.equal(kernel.resolve("resolve-target-disposition", { source: { hash: "a" }, target: { exists: true, hash: "a" } }), "declare-noop");
});

test("applies a declared DTO projection", () => {
  assert.deepEqual(kernel.project("project-copy-request", { placement: { id: "p1", source: "/a", target: "/b" } }), { operationId: "p1", sourcePath: "/a", targetPath: "/b", overwrite: false });
});

test("fails closed when a required projection path is absent", () => {
  const requiredPathKernel = new SemanticKernel();
  requiredPathKernel.catalog.registerProjection({
    declarationType: "projection.v1",
    projectionId: "project-required-path",
    expression: { kind: "read", path: "$.required", required: true },
  });
  assert.throws(
    () => requiredPathKernel.project("project-required-path", {}),
    (error: unknown) => error instanceof SemanticKernelError && error.code === "PROJECTION_REQUIRED_PATH_MISSING",
  );
});
test("filters, maps, and counts collections through declared projection expressions", () => {
  const collectionKernel = new SemanticKernel();
  const filtered = {
    kind: "filter" as const,
    collection: { kind: "read" as const, path: "$.rows", required: true },
    itemPath: "$.item",
    when: {
      operator: "equals" as const,
      left: { kind: "path" as const, path: "$.item.kind" },
      right: { kind: "value" as const, value: "accepted" },
    },
  };
  collectionKernel.catalog.registerProjection({
    declarationType: "projection.v1",
    projectionId: "project-collection-summary",
    expression: {
      kind: "object",
      fields: {
        count: { kind: "count", expression: filtered },
        items: {
          kind: "map",
          collection: filtered,
          itemPath: "$.item",
          expression: {
            kind: "object",
            fields: { id: { kind: "read", path: "$.item.id", required: true } },
          },
        },
      },
    },
  });
  assert.deepEqual(
    collectionKernel.project("project-collection-summary", { rows: [{ id: "a", kind: "accepted" }, { id: "b", kind: "other" }] }),
    { count: 1, items: [{ id: "a" }] },
  );
});

test("executes declared iteration in source order", () => {
  assert.deepEqual(kernel.iterate("project-items", { items: ["a", "b"] }), [{ value: "a", index: 0 }, { value: "b", index: 1 }]);
});

test("executes a semantic model through a registered mechanical port and emits proof", async () => {
  kernel.catalog.registerProjection({ declarationType: "projection.v1", projectionId: "project-port-input", expression: { kind: "read", path: "$" } });
  kernel.catalog.registerExecution({ declarationType: "execution-model.v1", executionModelId: "copy-one-file", resultPath: "$.execution", steps: [
    { stepId: "resolve", operation: "resolve-decision", decisionId: "resolve-target-disposition", inputPath: "$.facts", outputPath: "$.disposition" },
    { stepId: "project", operation: "apply-projection", projectionId: "project-copy-request", inputPath: "$", outputPath: "$.request" },
    { stepId: "copy", operation: "invoke-port", portId: "copies-file", inputPath: "$.request", outputPath: "$.execution" },
    { stepId: "observe", operation: "record-observation", observationType: "file-copy-result", valuePath: "$.execution", outputPath: "$.observation" }
  ]});
  kernel.ports.register("copies-file", async (input) => ({ disposition: "copied", request: input }));
  const receipt = await kernel.execute("copy-one-file", { facts: { source: { hash: "abc" }, target: { exists: false } }, placement: { id: "p1", source: "/a", target: "/b" } });
  assert.equal(receipt.disposition, "EXECUTION_COMPLETED");
  assert.equal(receipt.steps.length, 4);
  assert.equal(receipt.observations.length, 1);
});

test("registers capability packs and exposes collapsed semantic edges", async () => {
  const packedKernel = createSemanticKernel();
  packedKernel.registerCapabilityPacks([{
    decisions: [{
      declarationType: "decision.v1",
      decisionId: "resolve-example",
      noMatchDisposition: "reject",
      rules: [{ ruleId: "always", when: { operator: "always" }, then: "resolved" }],
    }],
    projections: [{
      declarationType: "projection.v1",
      projectionId: "project-example",
      expression: { kind: "object", fields: { value: { kind: "read", path: "$.value" } } },
    }],
    invocations: {
      "execute-example": async (context: unknown) => ({ executed: context }),
    },
  }]);

  assert.equal(await packedKernel.edges.invokes("resolve-example", {}), "resolved");
  assert.deepEqual(packedKernel.edges.projects("project-example", { value: "projected" }), { value: "projected" });
  assert.deepEqual(await packedKernel.edges.invokes("execute-example", { value: "input" }), { executed: { value: "input" } });
});

test("seats validated port adapters and rejects invalid packs", async () => {
  const packedKernel = createSemanticKernel();
  packedKernel.seatPortAdapters({ echoes: async (input: unknown) => input });
  assert.deepEqual(await packedKernel.ports.invoke("echoes", { value: "echoed" }), { value: "echoed" });
  assert.throws(
    () => packedKernel.registerCapabilityPacks([{ decisions: "not-an-array" }]),
    (error: unknown) => error instanceof SemanticKernelError && error.code === "INVALID_CAPABILITY_PACK",
  );
});
