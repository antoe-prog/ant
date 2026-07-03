#!/usr/bin/env bash
set -euo pipefail

image="${POSTGRES_IMAGE:-postgres:16-alpine}"
container="final-judo-postgres-smoke-$(date +%s)"
database="${POSTGRES_DB:-final_judo}"
user="${POSTGRES_USER:-postgres}"
password="${POSTGRES_PASSWORD:-postgres}"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop and retry." >&2
  exit 1
fi

trap cleanup EXIT

docker run \
  --name "$container" \
  -e POSTGRES_PASSWORD="$password" \
  -e POSTGRES_DB="$database" \
  -d "$image" >/dev/null

for attempt in $(seq 1 40); do
  if docker exec "$container" psql -U "$user" -d "$database" -Atc "select 1" >/dev/null 2>&1; then
    break
  fi

  sleep 1

  if [ "$attempt" = "40" ]; then
    docker logs "$container" >&2
    exit 1
  fi
done

for migration in db/migrations/*.sql; do
  docker exec -i "$container" psql -U "$user" -d "$database" -v ON_ERROR_STOP=1 -f - < "$migration" >/dev/null
done
docker exec -i "$container" psql -U "$user" -d "$database" -v ON_ERROR_STOP=1 -f - < db/seeds/seed_mvp.sql >/dev/null

counts="$(
  docker exec "$container" psql -U "$user" -d "$database" -Atc "
    select 'branches=' || count(*) from branches
    union all select 'users=' || count(*) from users
    union all select 'members=' || count(*) from members
    union all select 'classes=' || count(*) from classes
    union all select 'attendance=' || count(*) from attendance
    union all select 'counseling_notes=' || count(*) from counseling_notes
    union all select 'payments=' || count(*) from payments
    union all select 'notices=' || count(*) from notices
    union all select 'audit_logs=' || count(*) from audit_logs
    union all select 'app_runtime_state=' || count(*) from app_runtime_state
    order by 1;
  "
)"

echo "$counts"

for expected in "app_runtime_state=0" "branches=2" "users=6" "members=6" "classes=5" "attendance=3" "counseling_notes=3" "payments=3" "notices=3"; do
  if ! grep -q "^${expected}$" <<< "$counts"; then
    echo "Expected ${expected} in seeded PostgreSQL smoke output." >&2
    exit 1
  fi
done

echo "PostgreSQL migration and seed smoke passed."
