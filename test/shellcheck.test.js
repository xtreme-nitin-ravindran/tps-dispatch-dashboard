import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Structural regression coverage for the shellcheck lint wiring.
//
// ShellCheck is installed in the Docker test image (see docker/Dockerfile.test)
// and invoked by `npm run lint` via the `lint:shell` script. This test pins the
// invocation contract rather than executing shellcheck in-process, so it runs
// against the mounted working tree regardless of whether shellcheck is present
// on the host:
//
//   - `lint:shell` must target the repository shell scripts under scripts/.
//   - it must gate on `--severity=error`, catching real shell bugs while leaving
//     the intentional `CDPATH= cd` idiom (SC1007) and trap-invoked functions
//     (SC2329) as non-fatal warnings, so no script carries an unverified
//     suppression.
//   - shellcheck must be wired into the top-level `lint` script so full and fast
//     verification run it.

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

test("[INFRA-LINT] shellcheck is wired into the lint pipeline", () => {
  assert.equal(typeof pkg.scripts["lint:shell"], "string", "package.json must define `lint:shell`");
  assert.match(
    pkg.scripts["lint"],
    /lint:shell/,
    "`lint` must run shellcheck (via `lint:shell`)"
  );
});

test("[INFRA-LINT] shellcheck targets the repository shell scripts at error severity", () => {
  const script = pkg.scripts["lint:shell"];
  assert.match(script, /shellcheck/);
  assert.match(script, /--severity=error/);
  assert.match(script, /scripts\/\*\.sh/);
});
