# Projected file-catalog CLI

This example keeps the capability's meaning in
`semantic-authority/file-catalog.cli.v1.json`. The semantic layer declares the
command contract, filesystem population, selected facts, ordering, and
presentation. It contains no JavaScript.

Project it into a standalone Node CLI:

```bash
node tools/project-cli.mjs examples/file-catalog/semantic-authority/file-catalog.cli.v1.json examples/file-catalog/generated/file-catalog.mjs
```

Execute the projected code:

```bash
node examples/file-catalog/generated/file-catalog.mjs src --recursive
node examples/file-catalog/generated/file-catalog.mjs src --recursive --json
```

Verify that the checked-in projection still matches its authority:

```bash
node tools/project-cli.mjs examples/file-catalog/semantic-authority/file-catalog.cli.v1.json examples/file-catalog/generated/file-catalog.mjs --check
```

The projector owns only generic Node mechanics: argument parsing, filesystem
access, sorting, and rendering. The authority owns which mechanics are composed
and what they mean for this capability.
