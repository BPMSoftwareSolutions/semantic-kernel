# Declarative TypeScript projection

This example contains semantic code-body authority, not an executable
projector. Project it with the compiler shipped by the kernel:

```bash
npm run build
node dist/cli/project-code.js examples/declarative-typescript/authority.json examples/declarative-typescript/generated
```

The consumer owns the authority and the generated application body. The
kernel owns the reusable compiler.
