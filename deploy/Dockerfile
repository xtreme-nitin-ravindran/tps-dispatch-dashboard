# Story 64 — production runtime image for the TTC collector/processor.
#
# This image is a minimal Node runtime for the two long-running services. It is
# intentionally separate from docker/Dockerfile.test, which is the self-contained
# validation image; this one installs only production dependencies and runs the
# service entrypoint. The Node tag is pinned to the same Debian "bookworm" series
# as the test image via concourse/node-image.yml (slim variant, matching the
# runtime ETL tasks).
FROM node:26-bookworm-slim

# The service needs no write access outside /app except the mounted spool/store
# volumes, which the Compose stack binds under /app.
WORKDIR /app

# Install only runtime dependencies (no dev tooling). The manifests change rarely,
# so this layer is cached independently of source changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the application and script sources the services import at runtime. These
# are copied explicitly (stable-to-volatile) rather than with a broad `COPY . .`;
# the published snapshot (data/) is fetched from R2, never baked into the image.
COPY src ./src
COPY scripts ./scripts

# The service entrypoint is explicit; the image does not run anything by default
# so the Compose `command` selects collector or processor.
ENTRYPOINT ["node", "scripts/ttc-service.js"]
