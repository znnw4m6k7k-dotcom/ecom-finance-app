#!/usr/bin/env sh
# 在本机终端运行：把钉钉群机器人的 access_token 和加签密钥写入 .env（输入不回显，不经过聊天）
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "找不到 .env，请先完成安装"; exit 1; }
printf "粘贴 Webhook 里 access_token= 后面的那串，回车："; stty -echo; read TOKEN; stty echo; echo
printf "粘贴以 SEC 开头的加签密钥，回车："; stty -echo; read SECRET; stty echo; echo
[ -n "$TOKEN" ] && [ -n "$SECRET" ] || { echo "两个值都不能为空"; exit 1; }
tmp=$(mktemp)
grep -vE '^(CONNECTOR_PROVIDER|DINGTALK_NOTIFY_CHANNEL|DINGTALK_ROBOT_ACCESS_TOKEN|DINGTALK_ROBOT_SECRET)=' .env > "$tmp"
{
  echo "CONNECTOR_PROVIDER=dingtalk"
  echo "DINGTALK_NOTIFY_CHANNEL=robot"
  echo "DINGTALK_ROBOT_ACCESS_TOKEN=$TOKEN"
  echo "DINGTALK_ROBOT_SECRET=$SECRET"
} >> "$tmp"
mv "$tmp" .env && chmod 600 .env
echo "已写入 .env。请重启服务：sh infra/restart.sh"
