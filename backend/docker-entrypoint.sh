#!/bin/sh
# Entrypoint for the API container.
#
# Compose holds this container back until MySQL reports healthy, so there is no
# wait-for-it loop here. Render has no such dependency ordering, hence the retry
# around migrate: a managed database may still be waking when the container starts.
set -eu

# Checked before anything else, because a missing variable is a configuration
# mistake rather than a transient fault. Without this the retry loop below spends
# thirty seconds re-attempting a failure that will never succeed, and buries the
# real cause under ten identical stack traces.
if [ -z "${DATABASE_URL:-}" ]; then
  echo "!!! DATABASE_URL is not set." >&2
  echo "    The API cannot start without it. On Render, set it under" >&2
  echo "    Environment for this service; render.yaml marks it sync: false so the" >&2
  echo "    value is supplied there rather than committed to the repository." >&2
  exit 1
fi

for required in JWT_ACCESS_SECRET JWT_REFRESH_SECRET; do
  eval "value=\${$required:-}"
  if [ -z "$value" ]; then
    echo "!!! $required is not set. Generate one with: openssl rand -hex 32" >&2
    exit 1
  fi
done

echo "==> Applying migrations"

# `migrate deploy` applies pending migrations and never generates or resets — the
# correct command for a container. `migrate dev` would try to create a shadow
# database and could prompt, neither of which belongs in a non-interactive start.
attempt=1
max_attempts=10
until npx prisma migrate deploy; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "!!! Migrations failed after ${max_attempts} attempts" >&2
    exit 1
  fi
  echo "    database not ready (attempt ${attempt}/${max_attempts}), retrying in 3s"
  attempt=$((attempt + 1))
  sleep 3
done

# Seeding is opt-in. It is safe to repeat — every write is an upsert keyed on a
# natural unique column — but a production database should not be reseeded on
# every deploy, so the default is off and compose turns it on.
if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "==> Seeding demo data (Jashim, Bullet, Nusrat, Rafiq, Shirin)"
  node dist/prisma/seed.js
fi

echo "==> Starting API"
# exec so the Node process becomes PID 1 and receives SIGTERM directly. Without it
# the shell would swallow the signal and the graceful shutdown would never run.
exec "$@"
