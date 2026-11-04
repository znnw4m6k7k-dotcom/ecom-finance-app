# 电商财务集成系统（企业应用版）

由 DSH 交付的 HTML Demo「电商财务集成管理系统」（`input/demo/`）演进而来的企业应用。
**第一阶段目标：本地跑通一条真实业务闭环**，不是生产系统。

```
数据导入（订单/账单/物流/采购/工资/费用/发票）→ 服务端校验写库 → 核算
→ AI 起草月度经营简报（数字由系统核算，AI 只写解读）→ 财务修改提交 → 老板审核 → 钉钉通知
全程：登录、租户隔离、角色权限、审计、模型调用计量
```

## 当前状态（2026-11-04）

| 部分 | 状态 |
|---|---|
| 登录 / 租户隔离 / 角色权限 / 审计 | 已实现，集成测试覆盖 |
| 数据导入（11 类 CSV/xlsx）、核算、报表页面 | 已实现；报表复用 Demo 核算引擎 |
| AI 月度经营简报 + 审核 | 已实现；**默认用模拟模型**，真实模型需客户选定厂商并提供密钥 |
| 钉钉通知 / 免登 | 代码已实现并有单元测试，**未用真实钉钉应用联调** |
| 飞书、企业微信 | 只有接口和能力矩阵，未实现 |
| 生产部署 | 未做 |

## 目录

```
apps/api                    NestJS + Prisma + PostgreSQL 后端（/api/v1）
apps/web                    由 Demo 演进的页面（原视觉保留；新增登录、经营简报页、API 适配层）
packages/domain             业务核心：Demo 核算引擎/导入器（原样复用）+ 简报事实表/状态机/权限
packages/model-adapters     ModelProvider：OpenAI 兼容适配（DeepSeek/通义/Kimi/智谱/豆包预设）+ 重试 + 计量 + Mock
packages/workspace-connectors 办公平台连接器：钉钉（实现）、飞书/企业微信（接口）、Mock
infra/                      Docker Compose、Dockerfile、发布与回滚
docs/                       映射表、待确认事项、能力矩阵、验收清单、里程碑报告
input/demo/                 原始 Demo（不修改）
.claude/skills/             交付技能：demo-to-enterprise（总流程）、client-onboarding（客户资料清单）、go-live（部署+踩坑）、demo-import、connector-dev、release-review
template/                   作为样板开新项目：样板说明、空白文档模板（infra/new-project.sh 使用）
```

## 快速开始

见 [docs/本地运行.md](docs/本地运行.md)。最短路径（已有 PostgreSQL）：

```bash
npm ci && npm run build
cp .env.example .env   # 填 JWT_SECRET、DATABASE_URL
set -a && . ./.env && set +a
npm run db:migrate && npm run db:seed
npm run dev            # http://localhost:3000  企业代码 luye-demo，账号 owner / finance / viewer
```

## 必读

- [docs/Demo映射表.md](docs/Demo映射表.md)：页面 → API → 表 → 权限 → 规则
- [docs/待确认事项.md](docs/待确认事项.md)：需要客户/负责人拍板的业务问题
- [docs/连接器能力矩阵.md](docs/连接器能力矩阵.md)：钉钉/飞书/企业微信能力差异与联调步骤
- [docs/里程碑报告-M1.md](docs/里程碑报告-M1.md)：本期改了什么、怎么跑、测试结果、风险
- [CLAUDE.md](CLAUDE.md)：工程规则
