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

## Use

```ts
import { SemanticKernel } from "@deterministic-solutions/semantic-kernel";

const kernel = new SemanticKernel();
kernel.catalog.registerDecision(decisionDeclaration);
kernel.catalog.registerProjection(projectionDeclaration);
kernel.ports.register("copies-file", copiesFileAdapter);

const receipt = await kernel.execute("copy-one-file", immutableContext);
```

## Commands

```bash
npm run build
npm test
```

## Deliberate v0.1 exclusions

Schema validation, parallel execution, state-transition declarations, retries, plugin loading, persisted evidence, and cryptographic authority hashes are not silently simulated. They belong in subsequent bounded increments.
