#!/usr/bin/env bash
# 上线前检查（踩坑清单 .claude/skills/go-live/references/踩坑清单.md 中标 [自动] 的条目）。
# 只报告“已填/缺失/格式可疑”，从不打印任何配置值。
# 用法：bash infra/preflight.sh [--prod] [--env 路径] [--offline]
#   --prod     按正式环境要求检查（禁止模拟模型/连接器、临时隧道地址、开发密码）
#   --offline  跳过数据库连通和健康检查（只做静态检查）
set -uo pipefail
cd "$(dirname "$0")/.."
PROD=0; OFFLINE=0; ENV_FILE=.env
while [ $# -gt 0 ]; do
  case "$1" in
    --prod) PROD=1;; --offline) OFFLINE=1;;
    --env) ENV_FILE="$2"; shift;;
    *) echo "未知参数：$1"; exit 2;;
  esac; shift
done
FAIL=0; WARN=0
ok()   { echo "✅ $*"; }
warn() { echo "⚠️  $*"; WARN=$((WARN+1)); }
bad()  { echo "❌ $*"; FAIL=$((FAIL+1)); }

# 读取 .env 中某个变量（不 source，不执行其中内容；取最后一次出现）
val() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }

echo "== 运行环境"
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')
if [ -z "$NODE_MAJOR" ]; then bad "没有 Node.js（需要 20+）"
elif [ "$NODE_MAJOR" -lt 20 ]; then bad "Node 版本过低：v$NODE_MAJOR（需要 20+）"
else
  ok "Node v$NODE_MAJOR"
  WANT=$(sed 's/[^0-9].*//' .nvmrc 2>/dev/null || true)
  [ -n "$WANT" ] && [ "$WANT" != "$NODE_MAJOR" ] && warn "Node v$NODE_MAJOR 与 .nvmrc（$WANT）不一致，CI 未覆盖该版本"
fi

echo "== 配置文件"
if [ ! -f "$ENV_FILE" ]; then
  bad "找不到 $ENV_FILE（从 .env.example 复制，或运行安装脚本）"
else
  ok "$ENV_FILE 存在"
  PERM=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE" 2>/dev/null)
  [ "$PERM" = "600" ] && ok "$ENV_FILE 权限 600" || warn "$ENV_FILE 权限是 $PERM，建议 chmod 600"
fi
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git ls-files --error-unmatch .env >/dev/null 2>&1; then bad ".env 被 git 跟踪了：git rm --cached .env，并重置其中所有密钥"
  else ok ".env 未提交到 git"; fi
fi

JWT=$(val JWT_SECRET)
[ ${#JWT} -ge 16 ] && ok "JWT_SECRET 已设置（≥16 位）" || bad "JWT_SECRET 为空或短于 16 位"
[ -n "$(val DATABASE_URL)" ] && ok "DATABASE_URL 已设置" || bad "DATABASE_URL 未设置"

BASE=$(val PUBLIC_BASE_URL)
case "$BASE" in
  "") bad "PUBLIC_BASE_URL 未设置";;
  *trycloudflare.com*)
    [ $PROD = 1 ] && bad "PUBLIC_BASE_URL 是临时隧道地址，重启就会变；正式环境用固定域名" \
                  || ok "PUBLIC_BASE_URL 是临时隧道地址（仅测试）";;
  https://*) ok "PUBLIC_BASE_URL 是 HTTPS";;
  *) [ $PROD = 1 ] && bad "PUBLIC_BASE_URL 不是 HTTPS" || ok "PUBLIC_BASE_URL 已设置（非 HTTPS，仅本机）";;
esac

if [ $PROD = 1 ]; then
  [ "$(val NODE_ENV)" = "production" ] || warn "NODE_ENV 不是 production"
  for r in OWNER FINANCE VIEWER; do
    p=$(val SEED_${r}_PASSWORD)
    case "$p" in *-dev-123) bad "SEED_${r}_PASSWORD 仍是开发默认密码";; esac
  done
  [ -f .seeded ] && warn "这台机器跑过演示种子数据；正式客户应使用 SKIP_SEED=1 并删除演示账号"
fi

echo "== 模型"
MP=$(val MODEL_PROVIDER); MP=${MP:-mock}
if [ "$MP" = "mock" ]; then
  [ $PROD = 1 ] && bad "MODEL_PROVIDER=mock：正式环境还在用模拟模型" || warn "MODEL_PROVIDER=mock（模拟模型，界面会显示“模拟”）"
else
  [ -n "$(val MODEL_API_KEY)" ] && ok "MODEL_API_KEY 已填（$MP）" || bad "MODEL_PROVIDER=$MP 但 MODEL_API_KEY 为空"
  [ -n "$(val MODEL_NAME)" ] || warn "MODEL_NAME 为空，将用预设默认模型"
  [ -n "$(val MODEL_PRICE_INPUT_PER_1K)" ] && [ -n "$(val MODEL_PRICE_OUTPUT_PER_1K)" ] || warn "模型单价未填，成本计量为 0"
fi

echo "== 办公平台"
CP=$(val CONNECTOR_PROVIDER); CP=${CP:-mock}
case "$CP" in
  mock) [ $PROD = 1 ] && bad "CONNECTOR_PROVIDER=mock：正式环境不会真的发通知" || warn "CONNECTOR_PROVIDER=mock（不对外发送）";;
  dingtalk)
    CH=$(val DINGTALK_NOTIFY_CHANNEL); CH=${CH:-robot}
    if [ "$CH" = "robot" ]; then
      [ -n "$(val DINGTALK_ROBOT_ACCESS_TOKEN)" ] && [ -n "$(val DINGTALK_ROBOT_SECRET)" ] \
        && ok "钉钉群机器人 token 和加签密钥已填" || bad "钉钉群机器人缺 access_token 或加签密钥（sh infra/set-dingtalk-robot.sh）"
      S=$(val DINGTALK_ROBOT_SECRET); [ -n "$S" ] && case "$S" in SEC*) ;; *) warn "群机器人加签密钥通常以 SEC 开头，请核对";; esac
    fi
    KEY=$(val DINGTALK_APP_KEY); SEC=$(val DINGTALK_APP_SECRET); AG=$(val DINGTALK_AGENT_ID); CORP=$(val DINGTALK_CORP_ID)
    if [ "$CH" = "work_notice" ] || [ -n "$KEY" ]; then
      [ -n "$KEY" ] && [ -n "$SEC" ] && [ -n "$AG" ] && ok "钉钉应用 Client ID / Secret / AgentId 已填" \
        || bad "钉钉应用缺 Client ID、Secret 或 AgentId（sh infra/set-dingtalk-app.sh）"
      case "$KEY" in *_*|*-*) bad "Client ID 含 _ 或 -，像是把 Client Secret 填进去了";; esac
      [ ${#KEY} -gt 40 ] && bad "Client ID 超过 40 位，像是填成了 Client Secret"
      [ -n "$CORP" ] && [ "$CORP" = "$KEY" ] && bad "CorpId 与 Client ID 相同，填错位了（CorpId 可留空，首页地址用 \$CORPID\$）"
      [ -n "$SEC" ] && [ "$SEC" = "$KEY" ] && bad "Client Secret 与 Client ID 相同"
      [ -n "$AG" ] && case "$AG" in *[!0-9]*) bad "AgentId 应为纯数字";; esac
      case "$BASE" in https://*) ;; *) bad "钉钉工作台/工作通知需要公网 HTTPS 的 PUBLIC_BASE_URL";; esac
    fi;;
  feishu|wecom) bad "CONNECTOR_PROVIDER=$CP：该平台连接器本期未实现，调用会报“暂不支持”";;
  *) bad "未知的 CONNECTOR_PROVIDER：$CP";;
esac

echo "== 脚本与仓库"
if [ -f infra/tunnel.sh ]; then
  grep -q -- '--protocol http2' infra/tunnel.sh && ok "隧道使用 http2（国内常拦 QUIC）" || bad "infra/tunnel.sh 没有 --protocol http2"
fi
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # 常见密钥格式：OpenAI 兼容 sk-、钉钉加签 SEC+64 位十六进制、PEM 私钥、带口令的连接串（排除开发占位口令）
  HITS=$(git grep -nIE '(sk-[A-Za-z0-9]{32,}|SEC[0-9a-f]{64}|-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(ql)?://[^:/ ]+:[^@ $]{6,}@)' \
         -- ':!package-lock.json' ':!infra/preflight.sh' ':!infra/tests/*' 2>/dev/null \
         | grep -v 'app_dev_only' | cut -d: -f1-2 || true)
  [ -z "$HITS" ] && ok "仓库未发现疑似密钥" || { bad "仓库里有疑似密钥（只列位置）："; echo "$HITS" | sed 's/^/     /'; }
fi

if [ $OFFLINE = 0 ]; then
  echo "== 连通性"
  if command -v pg_isready >/dev/null 2>&1; then
    DBURL=$(val DATABASE_URL)
    if [ -n "$DBURL" ]; then pg_isready -q -d "${DBURL%%\?*}" && ok "数据库可连接" || bad "数据库连不上（PostgreSQL 是否启动？）"; fi
  else warn "没有 pg_isready，跳过数据库检查（Docker 部署可忽略）"; fi
  PORT=$(val PORT); PORT=${PORT:-3000}
  if curl -fsS -m 5 "http://localhost:$PORT/api/v1/health" >/dev/null 2>&1; then ok "服务健康检查通过（localhost:$PORT）"
  else warn "localhost:$PORT 健康检查无响应（服务未启动，或在容器内运行）"; fi
  case "$BASE" in https://*)
    curl -fsS -m 10 "$BASE/api/v1/health" >/dev/null 2>&1 && ok "公网地址可访问" || warn "公网地址健康检查失败（域名解析/证书/隧道/备案）";;
  esac
fi

echo
echo "结果：$FAIL 项错误，$WARN 项提醒"
[ $FAIL = 0 ]
