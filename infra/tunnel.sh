#!/usr/bin/env bash
# 临时公网 HTTPS（仅测试）：用 Cloudflare 免费快速隧道把本机 3000 端口暴露出去，无需注册。
# 每次重启地址都会变，需要同步改钉钉应用的首页地址。正式上线请用云服务器 + 备案域名。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
CF=$(command -v cloudflared || true)
[ -z "$CF" ] && [ -x tools/cloudflared ] && CF=tools/cloudflared
if [ -z "$CF" ]; then
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$b" ]; then eval "$("$b" shellenv)"; fi; done
  if command -v brew >/dev/null 2>&1; then brew install cloudflared && CF=$(command -v cloudflared); fi
fi
if [ -z "$CF" ]; then
  # 没有 Homebrew 也能用：直接从 cloudflared 官方 GitHub Release 下载单文件
  case "$(uname -m)" in arm64) ARCH=arm64;; *) ARCH=amd64;; esac
  mkdir -p tools
  curl -fL --connect-timeout 15 --max-time 300 "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$ARCH.tgz" -o tools/cf.tgz
  tar -xzf tools/cf.tgz -C tools && rm tools/cf.tgz && chmod +x tools/cloudflared
  CF=tools/cloudflared
fi
[ -f logs/tunnel.pid ] && kill "$(cat logs/tunnel.pid)" 2>/dev/null || true
nohup "$CF" tunnel --no-autoupdate --url http://localhost:${PORT:-3000} > logs/tunnel.log 2>&1 &
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
