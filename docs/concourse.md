# Concourse worker validation

[Testing and Validation](../README.md#testing-and-validation)

For changes affecting a Concourse task, run the affected task with `fly execute`
against the working tree on the real worker as well as local Docker verification.
Extract the named inline task config from `concourse/pipeline.yml`; when reproducing
a deployed failure, inspect the live pipeline config too. Keep the extracted config
in scratch storage rather than adding a duplicate `concourse/*.yml` task definition.
Use the actual task inputs, params, and pinned image so history-file and
credential-dependent behavior are exercised. A publication task can write to R2;
choose its publication destination deliberately and keep credentials out of Git and logs.

`scripts/fly-exec-task.sh` automates the extraction and execution so the task is
never hand-copied:

```bash
# Extract the named task from concourse/pipeline.yml and run it with fly execute.
scripts/fly-exec-task.sh update-and-publish

# Choose a fly target and forward extra fly execute arguments after `--`.
scripts/fly-exec-task.sh update-and-publish --target main -- \
  --input repo=. --output incident-repo=./out
```

The helper extracts the task's config from the pipeline, writes it to a scratch file under the git-ignored
`.cache/` directory, and runs `fly execute -c <scratch>` from the repository root.
A task defined with `file:` is passed to `fly execute` directly, since its config
already lives in a real file. The scratch file is removed on success, failure, and
signals. The helper never reads or prints credentials: supply them through the
environment or `fly` vars. The task config supplies its worker image.

The scheduled pipeline consumes `main`, which has passed the protected promotion
checks. Its `update-and-publish` task uses `node:24-bookworm-slim`, installs only
runtime dependencies with `npm ci --omit=dev`, and runs the incident update and R2
publication. It does not build the test image or rerun tests, lint, syntax, or
coverage checks. Those remain required in local verification and the promotion gate.

Concourse inputs and outputs are rooted in the task's initial working directory.
Capture the declared `incident-repo` output path before changing into `repo` so
the vehicle task receives the snapshot. Use the extracted task's registry image
for worker validation; no locally built test image or temporary worker registry
configuration is needed. Redact credentials before displaying live pipeline
configuration, since `fly get-pipeline` can return resolved secrets.
