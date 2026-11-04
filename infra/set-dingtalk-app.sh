#!/usr/bin/env sh
# 录入钉钉企业内部应用凭证（工作台免登 + 工作通知）。AppSecret 输入不回显，不经过聊天。
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "找不到 .env，请先完成安装"; exit 1; }
printf "CorpId（开发者后台首页可见，ding 开头）："; read CORP
printf "AppKey（应用凭证页，也叫 Client ID）："; read KEY
printf "AppSecret（Client Secret，输入不显示）："; stty -echo; read SECRET; stty echo; echo
printf "AgentId（应用基础信息页）："; read AGENT
printf "通知方式：1=工作通知发给个人  2=继续用群机器人 [1]："; read CH
[ "$CH" = "2" ] && CHANNEL=robot || CHANNEL=work_notice
[ -n "$CORP" ] && [ -n "$KEY" ] && [ -n "$SECRET" ] && [ -n "$AGENT" ] || { echo "四个值都不能为空"; exit 1; }
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
