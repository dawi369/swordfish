#!/usr/bin/env bash

set -euo pipefail

FRONTEND_SERVICE_NAME="${FRONTEND_SERVICE_NAME:-mk3-frontend}"
BACKEND_SERVICE_NAME="${BACKEND_SERVICE_NAME:-mk3-backend}"

if ! command -v railway >/dev/null 2>&1; then
  echo "Railway CLI is required."
  echo "Install: https://docs.railway.com/guides/cli"
  exit 1
fi

cat <<'EOF'
This script bootstraps Railway services for this repo.

Prerequisites:
1. Run `railway login`
2. Create or link a Railway project for this repo:
   - `railway init`
   - or `railway project link`

The script will create:
- an empty frontend service
- an empty backend service
- a Redis service
- a Postgres service for durable analytics storage
EOF

read -r -p "Continue? [y/N] " confirm
if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

echo "Creating frontend service: ${FRONTEND_SERVICE_NAME}"
railway add --service "${FRONTEND_SERVICE_NAME}"

echo "Creating backend service: ${BACKEND_SERVICE_NAME}"
railway add --service "${BACKEND_SERVICE_NAME}"

echo "Creating Redis service"
railway add --database redis

echo "Creating Postgres service"
railway add --database postgres

cat <<EOF

Bootstrap complete.

Next steps in Railway:

1. Set the frontend service root directory to \`/frontend\`
2. Set the backend service root directory to \`/backend\`
3. Enable public networking for:
   - ${FRONTEND_SERVICE_NAME}
   - ${BACKEND_SERVICE_NAME}
4. Leave Redis private
5. Attach Postgres/DATABASE_URL to ${BACKEND_SERVICE_NAME}
6. Paste variables from:
   - frontend/.env.example
   - backend/.env.example
7. On frontend set:
   - NEXT_PUBLIC_SITE_URL to the frontend public domain
   - NEXT_PUBLIC_HUB_URL to the backend public domain
8. On backend prefer Railway's injected REDIS_URL if available

Reference:
- docs/runbooks/railway-deploy.md
- docs/decisions/ADR-0003-railway-monorepo-services.md
EOF
