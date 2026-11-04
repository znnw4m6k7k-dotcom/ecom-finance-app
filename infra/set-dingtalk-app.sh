#!/usr/bin/env sh
# 录入钉钉企业内部应用凭证（工作台免登 + 工作通知）。AppSecret 输入不回显，不经过聊天。
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "找不到 .env，请先完成安装"; exit 1; }
printf "CorpId（开发者后台首页右上角或「企业信息」里，ding 开头；不是应用的 Client ID）："; read CORP
printf "AppKey（应用「凭证与基础信息」页的 Client ID，较短）："; read KEY
printf "AppSecret（Client Secret，输入不显示）："; stty -echo; read SECRET; stty echo; echo
printf "AgentId（应用基础信息页）："; read AGENT
printf "通知方式：1=工作通知发给个人  2=继续用群机器人 [1]："; read CH
[ "$CH" = "2" ] && CHANNEL=robot || CHANNEL=work_notice
[ -n "$CORP" ] && [ -n "$KEY" ] && [ -n "$SECRET" ] && [ -n "$AGENT" ] || { echo "四个值都不能为空"; exit 1; }
# 防填错位：Client ID 一般是 ding 开头约 20 位；Secret 很长、常含 _ 或 -；CorpId 与 Client ID 不应相同
[ "$CORP" = "$KEY" ] && { echo "CorpId 和 AppKey 填成一样了，请重新运行"; exit 1; }
case "$KEY" in *_*|*-*) echo "AppKey 里有 _ 或 -，看起来像是把 Client Secret 填进了 AppKey，请重新运行"; exit 1;; esac
[ ${#KEY} -gt 40 ] && { echo "AppKey 太长，可能填成了 Client Secret，请重新运行"; exit 1; }
case "$AGENT" in *[!0-9]*) echo "AgentId 应该是纯数字"; exit 1;; esac
tmp=$(mktemp)
grep -vE '^(CONNECTOR_PROVIDER|DINGTALK_NOTIFY_CHANNEL|DINGTALK_CORP_ID|DINGTALK_APP_KEY|DINGTALK_APP_SECRET|DINGTALK_AGENT_ID)=' .env > "$tmp"
{
  echo "CONNECTOR_PROVIDER=dingtalk"
  echo "DINGTALK_NOTIFY_CHANNEL=$CHANNEL"
  echo "DINGTALK_CORP_ID=$CORP"
  echo "DINGTALK_APP_KEY=$KEY"
  echo "DINGTALK_APP_SECRET=$SECRET"
  echo "DINGTALK_AGENT_ID=$AGENT"
} >> "$tmp"
mv "$tmp" .env && chmod 600 .env
sh infra/restart.sh
echo "已启用钉钉应用。绑定员工：node apps/api/dist/bind-identity.js luye-demo owner <钉钉userid>"
