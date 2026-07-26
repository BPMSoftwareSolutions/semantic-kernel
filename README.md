# Semantic Kernel

A small, domain-neutral runtime that interprets declared semantic authority. Domain decisions, mappings, iteration meaning, and operation order are data. The kernel supplies only universal mechanics.

## v0.1 primitives

- Predicate evaluation: equality, existence, Boolean composition, containment, numeric comparison, and pattern matching.
- First-match decision resolution.
- JSON-path-like reads and immutable writes.
- Declarative object, array, conditional, coalesce, and merge projections.
- Declared collection iteration.
- Registered mechanical ports.
- Ordered execution models.
- Shipped deterministic code-body compiler with an optional backend extension API.
- Step testimony, observations, final results, and failure receipts.

## Architectural boundary

```text
Semantic authority = domain meaning
Kernel             = generic interpretation
Port adapters       = external mechanics
Capability body     = thin linear invocation
Receipt             = observed testimony
```

The kernel must never learn that a particular provider finish reason means “completed,” that a target conflict means “replace,” or that a repository heading deserves emphasis. Those remain semantic declarations supplied by capabilities.

It must likewise never own SQL grammar, relational query plans, joins,
grouping, aggregation, or query-result behavior. Those belong to a query
capability and its replaceable mechanical adapters.

## Use

```ts
import { SemanticKernel } from "@deterministic-solutions/semantic-kernel";

const kernel = new SemanticKernel();
kernel.catalog.registerDecision(decisionDeclaration);
kernel.catalog.registerProjection(projectionDeclaration);
kernel.ports.register("copies-file", copiesFileAdapter);

const receipt = await kernel.execute("copy-one-file", immutableContext);
```

## Declarative code-body projection

Application consumers do not implement projector modules. The kernel ships
versioned compiler backends, including a general structured TypeScript ESM
backend:

```ts
const kernel = createSemanticKernel();
const projection = await kernel.projectCode(
  "semantic-kernel/declarative-typescript.v1",
  sejCodeBodyAuthority,
);
```

`declarative-typescript-projection.v1` is a structured code-body IR. It models
imports, interfaces, types, functions, classes, variables, expressions,
branching, iteration, switches, and exception boundaries. It intentionally has
no raw-source or arbitrary-template escape hatch.

The packaged CLI selects the backend by its stable identity:

```bash
semantic-project ./body.sej.json ./generated
semantic-project ./body.sej.json ./generated --check
```

The kernel validates the IR, emits deterministic artifacts, and records
authority, options, and artifact SHA-256 identities. Custom `CodeProjector`
registration remains an extension point for platform authors adding a new
language backend; it is not required of application consumers.

## Commands

```bash
npm run build
npm test
```

## Deliberate v0.1 exclusions

Schema validation, parallel execution, state-transition declarations, retries, plugin loading, persisted evidence, and cryptographic authority hashes are not silently simulated. They belong in subsequent bounded increments.
