#!/usr/bin/env bash
# Cloudflare 命名隧道：固定域名访问本机服务，并设置开机自启（macOS）。
# 前提：你有一个域名，且已托管到 Cloudflare（免费套餐即可）。
# 用法：bash infra/named-tunnel.sh fin.你的域名.com   [隧道名，默认 ecomfin]
set -euo pipefail
cd "$(dirname "$0")/.."
APP="$(pwd)"
HOST="${1:?用法：bash infra/named-tunnel.sh <子域名，如 fin.example.com> [隧道名]}"
NAME="${2:-ecomfin}"
PORT="${PORT:-3000}"
CFDIR="$HOME/.cloudflared"
LA="$HOME/Library/LaunchAgents"
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$b" ]; then eval "$("$b" shellenv)"; fi; done
command -v cloudflared >/dev/null || brew install cloudflared
CF="$(command -v cloudflared)"; NODE="$(command -v node)"
step() { printf '\n==> %s\n' "$*"; }

step "1/6 授权 Cloudflare 账号（浏览器会打开，选中你的域名后点 Authorize）"
[ -f "$CFDIR/cert.pem" ] && echo "已授权过，跳过" || "$CF" tunnel login

step "2/6 创建隧道 $NAME（已存在则复用）"
"$CF" tunnel info "$NAME" >/dev/null 2>&1 || "$CF" tunnel create "$NAME"
UUID=$("$CF" tunnel list --name "$NAME" --output json | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).filter(t=>!t.deleted_at);process.stdout.write(a.length?a[0].id:"")})')
[ -n "$UUID" ] || { echo "没找到隧道 $NAME"; exit 1; }
[ -f "$CFDIR/$UUID.json" ] || { echo "缺少隧道凭证 $CFDIR/$UUID.json（隧道可能是在别的电脑上建的）"; exit 1; }
echo "隧道 ID：$UUID"

step "3/6 把 $HOST 指向这个隧道（自动写 Cloudflare DNS）"
"$CF" tunnel route dns --overwrite-dns "$NAME" "$HOST"

step "4/6 写配置 $CFDIR/$NAME.yml"
cat > "$CFDIR/$NAME.yml" <<YML
tunnel: $UUID
credentials-file: $CFDIR/$UUID.json
protocol: http2
ingress:
  - hostname: $HOST
    service: http://localhost:$PORT
  - service: http_status:404
YML

step "5/6 设置开机自启：隧道 + 系统服务（launchd）"
mkdir -p "$LA" logs
[ -f logs/tunnel.pid ] && kill "$(cat logs/tunnel.pid)" 2>/dev/null && rm -f logs/tunnel.pid || true   # 停掉临时隧道
[ -f logs/api.pid ] && kill "$(cat logs/api.pid)" 2>/dev/null && rm -f logs/api.pid || true           # 改由 launchd 管理
tmp=$(mktemp); grep -v '^PUBLIC_BASE_URL=' .env > "$tmp"; echo "PUBLIC_BASE_URL=https://$HOST" >> "$tmp"; mv "$tmp" .env; chmod 600 .env
cat > "$LA/com.ecomfin.tunnel.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.ecomfin.tunnel</string>
  <key>ProgramArguments</key><array><string>$CF</string><string>tunnel</string><string>--no-autoupdate</string><string>--config</string><string>$CFDIR/$NAME.yml</string><string>run</string><string>$NAME</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$APP/logs/tunnel.log</string><key>StandardErrorPath</key><string>$APP/logs/tunnel.log</string>
</dict></plist>
PL
cat > "$LA/com.ecomfin.api.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.ecomfin.api</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>cd "$APP" &amp;&amp; set -a &amp;&amp; . ./.env &amp;&amp; set +a &amp;&amp; exec "$NODE" apps/api/dist/main.js</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$APP/logs/api.log</string><key>StandardErrorPath</key><string>$APP/logs/api.log</string>
</dict></plist>
PL
: > logs/tunnel.log
for s in api tunnel; do
  launchctl bootout "gui/$(id -u)/com.ecomfin.$s" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$LA/com.ecomfin.$s.plist"
done

step "6/6 检查"
for i in $(seq 1 30); do grep -q "Registered tunnel connection" logs/tunnel.log 2>/dev/null && break; sleep 1; done
curl -fsS "http://localhost:$PORT/api/v1/health" >/dev/null && echo "本机服务：正常" || echo "本机服务：未就绪，看 logs/api.log"
grep -q "Registered tunnel connection" logs/tunnel.log && echo "隧道：已连上 Cloudflare" || { echo "隧道：未连上，看 logs/tunnel.log"; tail -5 logs/tunnel.log; }
echo
echo "固定地址：https://$HOST"
echo "钉钉应用首页地址（只需改这一次）：https://$HOST/?tenant=luye-demo&corpId=\$CORPID\$"
echo "以后重启服务：sh infra/restart.sh   停用自启：launchctl bootout gui/\$(id -u)/com.ecomfin.api ；同理 com.ecomfin.tunnel"
