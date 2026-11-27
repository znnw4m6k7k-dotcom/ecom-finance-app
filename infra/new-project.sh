#!/usr/bin/env bash
# 从本样板开一个新的企业应用项目：复制已提交的代码 → 改项目标识 → 重置项目文档 → 清空 Demo 输入 → git init。
# 样板业务（电商财务核算 + 月度经营简报）先保留，保证新项目第一天就能 build/test；
# 按 template/样板说明.md 逐步替换成新 Demo 的业务。
#
# 用法：bash infra/new-project.sh <目标目录> --slug <英文项目名> [--tenant <演示企业代码>] [--scope <npm 前缀>] [--db <库名>] [--title <中文名>]
# 例：  bash infra/new-project.sh ~/work/gym-crm --slug gym-crm --tenant gym-demo --scope @gym --title "健身房会员系统"
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:?用法：bash infra/new-project.sh <目标目录> --slug <英文项目名> ...}"; shift
SLUG=""; TENANT=""; SCOPE=""; DB=""; TITLE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --slug) SLUG="$2";; --tenant) TENANT="$2";; --scope) SCOPE="$2";;
    --db) DB="$2";; --title) TITLE="$2";;
    *) echo "未知参数：$1"; exit 2;;
  esac; shift 2
done
[ -n "$SLUG" ] || { echo "必须提供 --slug"; exit 2; }
echo "$SLUG" | grep -qE '^[a-z][a-z0-9-]{1,40}$' || { echo "--slug 只能用小写字母、数字、-，字母开头"; exit 2; }
TENANT="${TENANT:-$SLUG-demo}"; SCOPE="${SCOPE:-@$SLUG}"; DB="${DB:-$(echo "$SLUG" | tr -d -)}"; TITLE="${TITLE:-$SLUG}"
echo "$TENANT" | grep -qE '^[a-z0-9-]+$' || { echo "--tenant 只能用小写字母、数字、-"; exit 2; }
echo "$SCOPE" | grep -qE '^@[a-z0-9-]+$' || { echo "--scope 形如 @abc"; exit 2; }
echo "$DB" | grep -qE '^[a-z][a-z0-9_]*$' || { echo "--db 只能用小写字母、数字、_"; exit 2; }
if [ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ]; then echo "目标目录已存在且不为空：$DEST"; exit 1; fi

echo "==> 复制样板（只取已提交的文件，不带 .env、node_modules、日志）"
mkdir -p "$DEST"
git -C "$SRC" archive --format=tar HEAD | tar -x -C "$DEST"
cd "$DEST"

echo "==> 改项目标识"
# 只替换标识符，不动业务代码里的中文
# 交付技能、样板说明和本脚本本身要继续指向样板仓库，不替换
grep -rlE 'ecom-finance-app|ecomfin|luye-demo|@efa/' . --exclude-dir=input --exclude-dir=.git --exclude-dir=.claude \
  --exclude-dir=template --exclude-dir=tests --exclude=new-project.sh | while IFS= read -r f; do
  sed -i.bak -e "s#ecom-finance-app#$SLUG#g" -e "s#ecomfin#$DB#g" -e "s#luye-demo#$TENANT#g" -e "s#@efa/#$SCOPE/#g" "$f" && rm -f "$f.bak"
done
# 根 package.json 的描述
sed -i.bak "s#\"description\": \".*\"#\"description\": \"$TITLE（由 DSH Demo 演进的企业应用）\"#" package.json && rm -f package.json.bak

echo "==> 重置项目文档（通用文档保留，样板项目的报告移到 docs/样板参考/）"
mkdir -p docs/样板参考
for f in docs/里程碑报告-*.md docs/Demo映射表.md docs/待确认事项.md docs/客户需求.md docs/验收清单.md; do [ -f "$f" ] && mv "$f" docs/样板参考/; done
rm -rf docs/screenshots
cp template/docs/*.md docs/
cp .claude/skills/client-onboarding/references/资料清单模板.md docs/客户资料清单.md
for f in docs/Demo映射表.md docs/待确认事项.md docs/客户需求.md docs/验收清单.md docs/客户资料清单.md; do
  sed -i.bak -e "s#〈项目名〉#$TITLE#g" -e "s#〈tenant〉#$TENANT#g" "$f" && rm -f "$f.bak"
done

echo "==> 清空 Demo 输入（原件请放入 input/demo/，不要修改）"
rm -rf input/demo && mkdir -p input/demo
printf '# Demo 原件\n\n把 DSH 交付的 HTML Demo 原件（含 .delivery/ 验收记录）放在这里，不要修改。\n\n来源：\n版本/日期：\nDSH 验收结论：\n' > input/demo/README.md

echo "==> CLAUDE.md：保留通用规范，替换“本项目补充规则”"
awk '/^## 本项目/{exit} {print}' CLAUDE.md > CLAUDE.md.new
cat template/CLAUDE-项目补充规则.md | sed "s#〈项目名〉#$TITLE#g" >> CLAUDE.md.new
mv CLAUDE.md.new CLAUDE.md

echo "==> README"
{
  echo "# $TITLE"
  echo
  echo "由 DSH Demo 演进的企业应用。样板来源：ecom-finance-app（$(git -C "$SRC" rev-parse --short HEAD)）。"
  echo
  echo "- 总流程：在 Claude Code 里说“按 demo-to-enterprise 技能把 input/demo 做成企业版”"
  echo "- 哪些是通用骨架、哪些要替换：template/样板说明.md"
  echo "- 本地运行：docs/本地运行.md · 上线检查：bash infra/preflight.sh"
} > README.md

git init -q && git add -A && git -c user.name="new-project" -c user.email="new-project@localhost" commit -qm "从 ecom-finance-app 样板创建 $SLUG"
echo
echo "完成：$DEST"
echo "  slug=$SLUG  tenant=$TENANT  scope=$SCOPE  db=$DB"
echo "下一步：把 Demo 放进 input/demo/，然后 npm ci && npm run build && npm run test:unit"
