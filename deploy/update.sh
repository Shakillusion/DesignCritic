#!/usr/bin/env bash
# Pull the latest code from GitHub and rebuild. Your data and .env are kept.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
sudo docker compose up -d --build
sudo docker image prune -f >/dev/null
echo "Updated. Logs: sudo docker compose logs -f app"
