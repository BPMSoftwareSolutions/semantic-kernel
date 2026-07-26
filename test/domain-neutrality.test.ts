import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("the semantic kernel does not publish relational query authority or mechanics", () => {
  assert.equal(fs.existsSync("src/contracts/relational.contract.ts"), false);
  assert.equal(fs.existsSync("src/kernel/relational-query-engine.ts"), false);
  for (const root of ["src", "dist"]) {
    assert.equal(fs.existsSync(root), true, `${root} must exist for the domain-neutrality scan`);
    for (const file of walksFiles(root)) {
      assert.doesNotMatch(
        fs.readFileSync(file, "utf8"),
        /\b(?:relational|sql)\b/i,
        `query-domain vocabulary leaked into ${file}`,
      );
    }
  }
});

function walksFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? walksFiles(candidate) : [candidate];
  });
}
