#!/usr/bin/env bash
# macOS 本机一键安装：代码 → Node → PostgreSQL → 建库 → .env → 构建 → 迁移 → 种子 → 启动
# 用法：bash infra/mac-install.sh [代码包路径]   （安装到 ~/ecom-finance-app）
set -euo pipefail
APP="$HOME/ecom-finance-app"
BUNDLE="${1:-$HOME/Documents/deepseek/电商财务集成系统/ecom-finance-app.bundle}"
REPO="https://github.com/znnw4m6k7k-dotcom/ecom-finance-app"
step() { printf '\n==> %s\n' "$*"; }

step "1/8 获取代码"
if [ -d "$APP/.git" ]; then
  git -C "$APP" pull --ff-only "$REPO" main 2>/dev/null || git -C "$APP" pull --ff-only "$BUNDLE" main
elif git clone -q "$REPO" "$APP" 2>/dev/null; then echo "从 GitHub 克隆"
else git clone -q "$BUNDLE" "$APP" && git -C "$APP" remote set-url origin "$REPO" && echo "从本地代码包克隆"; fi
cd "$APP"

step "2/8 检查 Homebrew / Node"
if ! command -v brew >/dev/null 2>&1; then
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
fi
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || echo 0)
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  command -v brew >/dev/null || { echo "需要 Node 20+，且没有 Homebrew。请先安装 https://brew.sh 后重跑"; exit 1; }
  brew install node@22 && brew link --overwrite --force node@22
fi
node -v

step "3/8 PostgreSQL"
if ! command -v psql >/dev/null 2>&1; then
  for d in /opt/homebrew/opt/postgresql@16/bin /usr/local/opt/postgresql@16/bin /Applications/Postgres.app/Contents/Versions/latest/bin; do [ -d "$d" ] && export PATH="$d:$PATH"; done
fi
if ! command -v psql >/dev/null 2>&1; then
  command -v brew >/dev/null || { echo "需要 PostgreSQL：请到 https://postgresapp.com 下载 Postgres.app，拖进“应用程序”，打开后点 Initialize，然后重跑本脚本"; exit 1; }
  brew install postgresql@16
  export PATH="$(brew --prefix postgresql@16)/bin:$PATH"
fi
if ! pg_isready -q -h localhost 2>/dev/null; then
  command -v brew >/dev/null && brew services start postgresql@16 || true
  for i in $(seq 1 20); do pg_isready -q -h localhost && break; sleep 1; done
fi
pg_isready -h localhost

step "4/8 建用户和库（app / ecomfin）"
psql -h localhost -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='app'" | grep -q 1 || psql -h localhost -d postgres -c "CREATE USER app WITH PASSWORD 'app_dev_only' CREATEDB;"
psql -h localhost -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='ecomfin'" | grep -q 1 || psql -h localhost -d postgres -c "CREATE DATABASE ecomfin OWNER app;"

step "5/8 生成 .env（已存在则保留）"
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i '' "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://app:app_dev_only@localhost:5432/ecomfin?schema=public#" .env
  sed -i '' "s#^JWT_SECRET=.*#JWT_SECRET=$(openssl rand -hex 24)#" .env
  chmod 600 .env
fi

step "6/8 安装依赖并构建"
# 国内网络：npm 官方源或 Prisma 引擎下载不通时，自动改用 npmmirror 镜像（只影响本次安装）
if ! curl -fsS -m 8 -o /dev/null https://registry.npmjs.org/ 2>/dev/null || ! curl -sS -m 8 -o /dev/null https://binaries.prisma.sh/ 2>/dev/null; then
  echo "检测到境外源较慢或不通，改用国内镜像"
  export npm_config_registry=https://registry.npmmirror.com
  export PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
fi
npm ci --no-audit --no-fund
npm run build

step "7/8 数据库迁移与演示数据"
set -a; . ./.env; set +a
npm run db:migrate
npm run db:seed

step "8/8 启动服务"
sh infra/restart.sh
sleep 2
curl -s localhost:${PORT:-3000}/api/v1/health && echo
echo
echo "完成：浏览器打开 http://localhost:${PORT:-3000}  企业代码 luye-demo  账号 owner / finance / viewer"
echo "接钉钉群机器人：cd ~/ecom-finance-app && sh infra/set-dingtalk-robot.sh && sh infra/restart.sh"
echo "放进钉钉工作台（测试）：cd ~/ecom-finance-app && bash infra/tunnel.sh   然后 sh infra/set-dingtalk-app.sh"
