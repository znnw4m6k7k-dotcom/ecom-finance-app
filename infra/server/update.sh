#!/usr/bin/env bash
# 发布新版本：备份 → 记录当前版本 → 拉代码 → 构建 → 启动（容器启动时执行已审核迁移）→ 健康检查
# 失败回滚：bash infra/server/update.sh --rollback   （只回代码和镜像；有破坏性迁移时需用备份恢复，见 infra/发布与回滚.md）
set -euo pipefail
cd "$(dirname "$0")/../.."
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
C="$DOCKER compose -f infra/server/docker-compose.prod.yml --env-file .env"
DOMAIN=$(grep '^APP_DOMAIN=' .env | cut -d= -f2)
mkdir -p logs
if [ "${1:-}" = "--rollback" ]; then
  prev=$(cat logs/previous-version 2>/dev/null || true)
  [ -n "$prev" ] || { echo "没有记录上一版本"; exit 1; }
  git checkout -q "$prev"
  APP_VERSION="$prev" $C up -d --build
  echo "已回滚到 $prev"; exit 0
fi
bash infra/server/backup.sh
git rev-parse HEAD > logs/previous-version
git checkout -q main && git pull --ff-only
APP_VERSION=$(git rev-parse --short HEAD) $C up -d --build
sleep 8
curl -fsS "https://$DOMAIN/api/v1/health" && echo "发布成功：$(git rev-parse --short HEAD)" || { echo "健康检查失败，可执行：bash infra/server/update.sh --rollback"; exit 1; }
