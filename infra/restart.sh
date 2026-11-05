#!/usr/bin/env sh
# 本机重启 API（读取 .env），日志写到 logs/api.log
set -e
cd "$(dirname "$0")/.."
mkdir -p logs
# 已设开机自启（named-tunnel.sh）时交给 launchd 重启，避免起两份
if [ -f "$HOME/Library/LaunchAgents/com.ecomfin.api.plist" ]; then
  launchctl kickstart -k "gui/$(id -u)/com.ecomfin.api" && sleep 3 && tail -n 2 logs/api.log; exit 0
fi
[ -f logs/api.pid ] && kill "$(cat logs/api.pid)" 2>/dev/null || true
set -a; . ./.env; set +a
nohup node apps/api/dist/main.js > logs/api.log 2>&1 &
echo $! > logs/api.pid
sleep 3
tail -n 2 logs/api.log
