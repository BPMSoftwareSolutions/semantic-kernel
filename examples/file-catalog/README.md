# Projected file-catalog CLI

This example keeps the capability's meaning in
`semantic-authority/file-catalog.cli.v1.json`. The semantic layer declares the
command contract, filesystem population, selected facts, ordering, and
presentation. It contains no JavaScript.

Project it into a standalone Node CLI:

```bash
npm run build
node dist/cli/project-code.js examples/file-catalog/projectors/node-cli.projector.mjs examples/file-catalog/semantic-authority/file-catalog.cli.v1.json examples/file-catalog/generated
```

Execute the projected code:

```bash
node examples/file-catalog/generated/file-catalog.mjs src --recursive
node examples/file-catalog/generated/file-catalog.mjs src --recursive --json
```

Verify that the checked-in projection still matches its authority:

```bash
node dist/cli/project-code.js examples/file-catalog/projectors/node-cli.projector.mjs examples/file-catalog/semantic-authority/file-catalog.cli.v1.json examples/file-catalog/generated --check
```

This example owns its projector. It deliberately contains the Node CLI body,
including argument parsing, filesystem access, sorting, and rendering. The
semantic kernel owns none of those mechanics; another application supplies a
different projector and can produce an entirely different body or artifact
layout.
