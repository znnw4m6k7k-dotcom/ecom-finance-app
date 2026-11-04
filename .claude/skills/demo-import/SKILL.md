---
name: demo-import
description: 把 DC-HONEY / DSH 生成的 HTML Demo 导入本仓库并输出“页面→API→表→权限→规则”映射表。新 Demo 到来或 Demo 改版时使用。
---

1. 原件放 `input/demo/`，不修改；记录来源、版本、验收结论（若有 `.delivery/`）。
2. 盘点：页面清单、表单/按钮、写死的数据、浏览器存储（localStorage 等）、离线计算逻辑、外部依赖。
3. 能复用的计算/校验代码（纯函数、无 DOM）放进 `packages/domain`，前后端共用一份，并保留原有测试。
4. 输出/更新 `docs/Demo映射表.md`：每个页面标 ✅ 已接后端 / 🟡 前端沿用 / ⛔ 未实现，列出 API、表、权限、规则。
5. HTML 上看到但没有真实后端的功能，一律不写“已实现”；规则不清楚的写进 `docs/待确认事项.md`，不要编造。
6. 前端只加薄适配层（`apps/web/src/api.js`），保留原视觉；`file://` 离线演示模式要继续可用。
