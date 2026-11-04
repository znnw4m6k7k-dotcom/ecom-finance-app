#!/usr/bin/env bash
# 数据库备份：pg_dump -Fc，保留最近 7 天。恢复见 infra/发布与回滚.md
set -euo pipefail
cd "$(dirname "$0")/../.."
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
mkdir -p backups
f="backups/ecomfin-$(date +%Y%m%d-%H%M%S).dump"
$DOCKER compose -f infra/server/docker-compose.prod.yml --env-file .env exec -T db pg_dump -U app -Fc ecomfin > "$f"
[ -s "$f" ] || { echo "备份为空：$f"; exit 1; }
chmod 600 "$f"
find backups -name 'ecomfin-*.dump' -mtime +7 -delete
echo "备份完成：$f"
