---
name: go-live
description: 把已在本地跑通的企业应用部署到测试环境（本机+隧道）或客户云服务器，并按踩坑清单做上线前后检查。用户说“部署”“上线”“装到客户服务器”“放进钉钉/飞书/企业微信工作台”时使用。
---

# 上线部署与踩坑检查

**边界**：Claude 准备脚本、检查和回滚方案；买服务器/域名、录凭证、正式发布、生产数据库迁移由用户或客户执行或明确批准。密钥不进聊天。

## 每次都先做
1. 读 `references/踩坑清单.md`，对照本次环境逐条确认。
2. 在目标机器上运行 `bash infra/preflight.sh`（正式环境加 `--prod`），把输出原样记进报告。❌ 项未解决不继续。

## 路线一：测试环境（我方电脑 + 临时隧道，几分钟）
1. macOS：`bash infra/mac-install.sh`（装 Node/PostgreSQL、建库、生成 .env、构建、迁移、种子、启动）。
   - 没有 Homebrew 时脚本会给 Postgres.app 指引；国内网络自动用 npmmirror。
   - 安装包放在「下载」以外的目录，或先给终端“文件与文件夹”权限。
2. `bash infra/tunnel.sh` 拿临时 HTTPS 地址（必须 `--protocol http2`）。地址每次重启都会变，平台首页地址要跟着改。
3. 运行平台录入脚本（如 `sh infra/set-dingtalk-app.sh`），客户管理员在后台填首页地址。
4. 员工在工作台打开应用 → 记下页面显示的 userid → `node apps/api/dist/bind-identity.js <tenant> <账号> <userid>` 绑定。
5. 真机走一遍闭环，确认通知不带“模拟”。

## 路线二：客户云服务器（固定地址，正式）
前提：`client-onboarding` 清单 B 段全部 ✅（服务器、安全组、域名解析、ICP 备案）。
1. 客户运维在服务器上：`bash infra/server/server-install.sh <域名>`（Docker Compose：db + api + caddy 自动证书）。正式客户加 `SKIP_SEED=1`。
2. 录入平台和模型凭证（录入脚本），`bash infra/server/update.sh` 生效。
3. 平台后台首页地址改为正式域名；如后台要求出口 IP 白名单，填服务器公网 IP。
4. `bash infra/preflight.sh --prod`，再做真机验收。
5. 每日备份已由安装脚本加入 crontab；上线前至少做一次恢复演练（`infra/发布与回滚.md`）。

## 发布与回滚
- 更新：`bash infra/server/update.sh`（先备份 → 拉代码 → 构建 → 迁移 → 启动）。
- 破坏性迁移、删除数据：先写回滚方案给用户审，批准后才执行。

## 结束
- 报告：环境、地址、preflight 结果、真机验收人和设备、剩余风险。
- 新坑写进 `references/踩坑清单.md`；能脚本检查的加进 `infra/preflight.sh` 并补测试。
