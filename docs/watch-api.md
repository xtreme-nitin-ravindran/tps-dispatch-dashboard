# Web Notifications

[Documentation home](../README.md)

Web notifications alert users to new or meaningfully updated calls in an area they choose.

## Behavior and device support

- Enable notifications through **Watch this area**; permission is requested only after an explicit user action.
- Matching runs every five minutes. Routine refreshes and stale or unavailable feeds do not trigger notifications.
- Notifications identify the service and incident, with an approximate distance when available. They do not imply severity or ongoing status.
- Clicking a notification opens the selected incident, even if local filters hide it. Expired incidents show an explanation.
- Desktop and Android support depends on available browser APIs and HTTPS. On iOS/iPadOS, Web Push requires an installed Home Screen app.
- Verify delivery and notification arrival on actual target devices; desktop emulation is insufficient.

## Privacy and retention

- Store only the subscription and settings needed to match and deliver notifications. Never store saved-location labels, addresses, location history, or unrelated UI state.
- Round watch coordinates to four decimal places; do not expose subscriptions, keys, or authorization tokens in public responses or logs.
- Keep notification contents free of watch coordinates, saved-location labels, and subscription credentials.
- Delete watches immediately on user deletion. Inactive or dead subscriptions expire after 30 days; active watches remain until disabled or unsubscribed. Notification tracking expires after 30 days.
- Duplicate processing must not produce duplicate notifications. Retry temporary failures at most three times; dead endpoints deactivate the matching subscription without disabling a replacement. Process at most 100 notifications per run.
- Log aggregate operational counts only, without personal locations, credentials, or incident IDs.

## Configure delivery

The current notification service uses Cloudflare Workers and a private D1 database. Dashboard hosting is separate.

- Copy `wrangler.toml.example` to the ignored `wrangler.toml` and set your database ID and a unique positive rate-limit `namespace_id`.
- Apply all four migrations in order (`0001_create_watches.sql` through `0004_add_watch_retention.sql`) before deployment.
- Configure the settings below. Exact allowed origins are required; wildcard origins are rejected. Missing required configuration prevents delivery.
- Keep private keys out of Git, HTML, and logs. Set the Worker URL in `sirento-watch-api-base-url` and the public key in `sirento-vapid-public-key` in `index.html`. An empty API URL disables registration.

| Setting | Purpose |
| --- | --- |
| `WATCH_DB` | Private D1 database containing watches and notification state. |
| `WATCH_ALLOWED_ORIGINS` | Comma-separated exact dashboard origins; never `*`. |
| `WATCH_SNAPSHOT_URL` | HTTPS URL of normalized `data/current.json`. |
| `WATCH_INCIDENT_BASE_URL` | HTTPS dashboard root used for notification links. |
| `WATCH_CREATE_RATE_LIMITER` | Cloudflare Rate Limiting binding; 30 creation attempts per client key per 60 seconds. |
| `VAPID_PUBLIC_KEY` | Base64url P-256 public key; also set in `sirento-vapid-public-key` in `index.html`. |
| `VAPID_PRIVATE_KEY` | Matching private key, stored only with `wrangler secret put`; never in TOML, HTML, logs, or Git. |
| `VAPID_SUBJECT` | Operator contact as a `mailto:` or HTTPS URI. |
| `VAPID_KEY_VERSION` | Opaque version recorded with new or updated watches for rotation tracking. |
| cron trigger | Runs matching, cleanup, and delivery every five minutes. |


```bash
npx wrangler d1 create sirento-watch
npx wrangler d1 migrations apply sirento-watch --remote
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler deploy
```

- For local development, keep the private key in ignored `.dev.vars`, apply migrations with `--local`, and run `npx wrangler dev`.
- Rotate the private key, public key, HTML public key, and `VAPID_KEY_VERSION` together. Users must explicitly re-enable watches after rotation; existing subscriptions are not silently reused.
- Creation is limited to 30 attempts per client key per minute; missing rate-limit configuration rejects creation. Exceeded limits return 429 with a 60-second retry delay.

## Test notifications

The deterministic commands below use fixtures without live databases, push services, or production secrets.

```bash
scripts/docker-test.sh npm run test:watch-backend
scripts/docker-test.sh npm run test:watch-production
scripts/docker-test.sh npm run test:watch-matching
scripts/docker-test.sh npm run test:watch-delivery
scripts/docker-test.sh npm run test:notification-ux
scripts/docker-test.sh npm run fixture:watch-matching
scripts/docker-test.sh npm run fixture:watch-delivery
scripts/docker-test.sh npm run fixture:notification-ux
```

- Cover permission, matching, duplicates, failures, retention, subscription renewal, and notification arrival.
- Fixtures activate only on loopback hosts and never send real push messages. See [local browser fixtures](browser-tests.md#local-watch-and-push-fixtures).
- For manual checks, serve on port 4173 and use these cases:

- New TFS incident with distance: `http://127.0.0.1:4173/?push=new-tfs&arrival=present&click=existing-client`
- New TPS incident: `http://127.0.0.1:4173/?push=new-tps&arrival=present`
- Meaningful update: `http://127.0.0.1:4173/?push=update&arrival=present`
- No reliable distance: `http://127.0.0.1:4173/?push=no-distance&arrival=present`
- Missing/expired incident: `http://127.0.0.1:4173/?push=new-tfs&arrival=missing`
- Direct present arrival: `http://127.0.0.1:4173/?view=1&incident=fixture-incident-1`
- Direct missing arrival: `http://127.0.0.1:4173/?view=1&incident=fixture-expired-incident`


- Test clicks with the dashboard open and closed, plus mobile and desktop layouts. Manual notification checks require browser permission; automated fixtures do not.
