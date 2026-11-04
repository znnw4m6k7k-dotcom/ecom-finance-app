## 本项目（〈项目名〉）补充规则
- 需求来源：`input/demo/`（DSH 交付的 Demo，原件不改）；映射见 `docs/Demo映射表.md`；未确认的业务规则写进 `docs/待确认事项.md`。
- 总流程按 `.claude/skills/demo-to-enterprise`；客户资料按 `client-onboarding`；部署按 `go-live`，部署前后跑 `bash infra/preflight.sh`。
- 样板业务（电商财务核算、月度经营简报）是从 ecom-finance-app 带来的示例，替换计划见 `template/样板说明.md`；替换完成前不得把样板功能写成本项目已实现。
- 本期闭环：〈待确认事项 Q1 确认后填写〉。AI 只写草稿，数字来自系统计算。
- 模型：通过 `ModelProvider`，客户自选国内模型；不得在业务代码里直接调用某家 SDK。
- 连接器：本期只实现〈平台〉；其他平台保持“接口 + 能力矩阵”。`isMock=true` 的模型/连接器必须在界面和审计里显示为“模拟”。
- 常用命令：`npm run build`、`npm run test:unit`、`npm run test:api`（需要 PostgreSQL，见 `docs/本地运行.md`）。
