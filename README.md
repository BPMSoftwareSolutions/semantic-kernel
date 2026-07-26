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
- Consumer-supplied, deterministic code projectors.
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

## Consumer-owned code projection

The kernel does not contain application templates. A consumer registers a
projector that owns its target language, framework, imports, mechanics, and
artifact layout:

```ts
const kernel = createSemanticKernel({ codeProjectors: [myProjector] });
const projection = await kernel.projectCode("my-app.node-cli.v1", semanticAuthority);
```

A projector receives immutable snapshots of `authority` and `options` and
returns one or more relative-path text artifacts. The kernel validates the
artifacts and adds deterministic SHA-256 identities. The packaged
`semantic-project` command can load the same consumer projector:

```bash
semantic-project ./projectors/my-projector.mjs ./authority.json ./generated
semantic-project ./projectors/my-projector.mjs ./authority.json ./generated --options ./projection-options.json
semantic-project ./projectors/my-projector.mjs ./authority.json ./generated --check
```

The CLI only loads, writes, and verifies artifacts; it owns no generated
application body.

## Commands

```bash
npm run build
npm test
```

## Deliberate v0.1 exclusions

Schema validation, parallel execution, state-transition declarations, retries, plugin loading, persisted evidence, and cryptographic authority hashes are not silently simulated. They belong in subsequent bounded increments.
