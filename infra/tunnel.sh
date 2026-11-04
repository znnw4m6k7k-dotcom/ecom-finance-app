#!/usr/bin/env bash
# 临时公网 HTTPS（仅测试）：用 Cloudflare 免费快速隧道把本机 3000 端口暴露出去，无需注册。
# 每次重启地址都会变，需要同步改钉钉应用的首页地址。正式上线请用云服务器 + 备案域名。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
if ! command -v cloudflared >/dev/null 2>&1; then
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
  brew install cloudflared
fi
[ -f logs/tunnel.pid ] && kill "$(cat logs/tunnel.pid)" 2>/dev/null || true
nohup cloudflared tunnel --no-autoupdate --url http://localhost:${PORT:-3000} > logs/tunnel.log 2>&1 &
echo $! > logs/tunnel.pid
URL=""
for i in $(seq 1 30); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' logs/tunnel.log | head -1 || true)
  [ -n "$URL" ] && break; sleep 1
done
[ -n "$URL" ] || { echo "没拿到隧道地址，看 logs/tunnel.log"; exit 1; }
tmp=$(mktemp); grep -v '^PUBLIC_BASE_URL=' .env > "$tmp"; echo "PUBLIC_BASE_URL=$URL" >> "$tmp"; mv "$tmp" .env; chmod 600 .env
sh infra/restart.sh >/dev/null
echo
echo "公网地址：$URL"
echo "钉钉应用首页地址填：$URL/?tenant=luye-demo"
