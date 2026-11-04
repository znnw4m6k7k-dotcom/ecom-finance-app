#!/usr/bin/env sh
# 本地一键启动（需要 Docker）：数据库 → 迁移 → 种子数据 → API
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { cp .env.example .env; echo "已生成 .env，请先填写 JWT_SECRET 后重跑"; exit 1; }
docker compose -f infra/docker-compose.yml --env-file .env up -d db
npm ci
npm run build
set -a; . ./.env; set +a
npm run db:migrate
npm run db:seed
npm run dev
