#!/usr/bin/env bash
# 新服务器一键安装（Ubuntu 22.04/24.04）。在服务器上以有 sudo 权限的用户运行：
#   curl 或 scp 本脚本到服务器后：bash server-install.sh fin.example.com
# 前提：域名已解析到本机公网 IP；安全组放行 80/443；大陆服务器需已完成 ICP 备案。
set -euo pipefail
DOMAIN="${1:?用法：bash server-install.sh <域名>}"
APP="${APP_DIR:-$HOME/ecom-finance-app}"
REPO="${REPO:-https://github.com/znnw4m6k7k-dotcom/ecom-finance-app}"
step() { printf '\n==> %s\n' "$*"; }

step "1/6 安装 Docker"
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update -y && sudo apt-get install -y ca-certificates curl git openssl
  # 国内网络拉不到官方源时，按云厂商文档换用其 Docker 镜像源
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"

step "2/6 获取代码"
# 私有仓库：先在服务器上配置只读 Deploy Key 或用 gh 登录，凭证不进聊天
if [ -d "$APP/.git" ]; then git -C "$APP" pull --ff-only; else git clone "$REPO" "$APP"; fi
cd "$APP"

step "3/6 生成 .env（已存在则只更新域名）"
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s#^JWT_SECRET=.*#JWT_SECRET=$(openssl rand -hex 32)#" .env
  echo "DB_PASSWORD=$(openssl rand -hex 16)" >> .env
fi
grep -vE '^(APP_DOMAIN|PUBLIC_BASE_URL)=' .env > .env.tmp
{ echo "APP_DOMAIN=$DOMAIN"; echo "PUBLIC_BASE_URL=https://$DOMAIN"; } >> .env.tmp
mv .env.tmp .env && chmod 600 .env

step "4/6 构建并启动"
$DOCKER compose -f infra/server/docker-compose.prod.yml --env-file .env up -d --build

step "5/6 演示数据（仅首次；正式客户请跳过：SKIP_SEED=1）"
if [ "${SKIP_SEED:-0}" != "1" ] && [ ! -f .seeded ]; then
  $DOCKER compose -f infra/server/docker-compose.prod.yml --env-file .env exec -T api node dist/seed.js && touch .seeded
fi

step "6/6 每日备份（02:30，保留 7 天）"
( crontab -l 2>/dev/null | grep -v 'infra/server/backup.sh'; echo "30 2 * * * cd $APP && bash infra/server/backup.sh >> logs/backup.log 2>&1" ) | crontab -
mkdir -p logs backups

sleep 5
curl -fsS "https://$DOMAIN/api/v1/health" && echo || echo "HTTPS 暂未就绪：检查域名解析、80/443 是否放行、备案状态，然后看 $DOCKER compose logs caddy"
echo
echo "完成：https://$DOMAIN/?tenant=luye-demo"
echo "录入钉钉凭证：sh infra/set-dingtalk-app.sh 后运行 bash infra/server/update.sh 使其生效"
