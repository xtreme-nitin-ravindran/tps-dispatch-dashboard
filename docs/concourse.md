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
scripts/fly-exec-task.sh test-update-and-publish

# Choose a fly target and forward extra fly execute arguments after `--`.
scripts/fly-exec-task.sh test-update-and-publish --target main -- \
  --input repo=. --output incident-repo=./out
```

The helper extracts the task's config from the pipeline, writes it to a scratch file under the git-ignored
`.cache/` directory, and runs `fly execute -c <scratch>` from the repository root.
A task defined with `file:` is passed to `fly execute` directly, since its config
already lives in a real file. The scratch file is removed on success, failure, and
signals. The helper never reads or prints credentials: supply them through the
environment or `fly` vars. It does not configure the worker/registry setup below.

In the October 7, 2026 verification, the worker ran in minikube with containerd and
could not use an image available only in the host Docker daemon. The image built
from `Dockerfile.test` was pushed to the in-cluster registry
(`registry.kube-system.svc.cluster.local`), and the worker temporarily received
`CONCOURSE_INSECURE_REGISTRIES` for that plain-HTTP registry. This is an
installation-specific setup, not a default requirement: confirm the current worker
and registry configuration before using it, then remove temporary worker settings
and test images after verification. `scripts/fly-exec-task.sh` provides the reusable
inline-task extraction/execution helper described above.

