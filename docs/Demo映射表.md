# Demo 映射表：页面 → API → 表 → 权限 → 规则

来源 Demo：`input/demo/电商财务集成管理系统.html`（DSH 交付 v2，2026-11-02 验收 14/14），源码 `input/demo/src/`，数据契约 `input/demo/docs/data-schema.md`。

**改造原则**：Demo 的核算引擎（`engine.js`）、导入器（`importer.js`）原样复用，前后端是同一份代码（`packages/domain/legacy/src` 与 `apps/web/src` 由测试保证逐字节一致），不重写口径。Demo 里“看得到”的功能，下表逐项标出现在是**真实后端**、**沿用前端计算**还是**未实现**。

图例：✅ 已接后端并有测试　🟡 前端沿用 Demo 计算（数据来自后端）　⛔ 未实现 / 不在本期

## 1. 页面

| 页面（Demo） | 现状 | API | 读写的表 | 权限 | 业务规则 / 说明 |
|---|---|---|---|---|---|
| 登录（新增） | ✅ | `POST /auth/login`、`GET /auth/me`、`POST /auth/dingtalk` | `User`、`Tenant`、`ExternalIdentity`、`AuditEvent` | 公开 | 企业代码+账号+密码；5 次失败锁 5 分钟；钉钉免登只认管理员绑定过的账号（不自动建号）。Demo 原为“无登录单角色”，见待确认 Q3 |
| 经营总览 | 🟡 | `GET /dataset`（明细）、`GET /dataset/summary`（服务端 KPI/勾稽） | 全部明细表（只读） | `report:read` | 5 组 KPI、利润桥、8 项勾稽，口径 = data-schema §2–3 |
| **经营简报（新增）** | ✅ | `GET/POST /briefings`、`PATCH /briefings/:id`、`POST /:id/regenerate｜submit｜approve｜reject｜notify` | `Briefing`、`BriefingVersion`、`AiCall`、`NotificationDelivery`、`AuditEvent` | 读 `briefing:read`；生成/改/提交 `FINANCE+OWNER`；审核 `OWNER` | 本期唯一的 AI 闭环，见 §3 |
| 店铺利润 | 🟡 | `GET /dataset` | Store、Order、OrderItem、Shipment、PlatformBill、Expense、Employee | `report:read` | 公共费用、无店铺员工薪酬按营业收入占比分摊 |
| 商品利润 | 🟡 | 同上 | Sku、OrderItem、OpeningInventory、PurchaseItem | `report:read` | 移动加权平均成本 |
| 平台结算与对账 | 🟡 | 同上；服务端摘要 `/dataset/summary` | PlatformBill、Payout、Order | `report:read` | 账单 vs 订单重算 vs 打款；差异原因三类 |
| 物流成本 | 🟡 | 同上 | Shipment | `report:read` | 首重+续重+区域加价+退回运费 |
| 采购与库存 | 🟡 | 同上 | PurchaseOrder、PurchaseItem、OpeningInventory | `report:read` | 周转天数、滞销（默认 60 天） |
| 工资与提成 | 🟡 | 同上 | Employee | `report:read` | 底薪+补贴+阶梯提成；只算应发，不做个税 |
| 费用与发票 | 🟡 | 同上 | Expense、Invoice | `report:read` | 匹配 / 金额不符 / 找不到单据 / 缺票（>500 元） |
| 数据导入 | ✅ | `POST /imports/:tableId/validate`、`POST /imports/:tableId/commit`、`GET /imports` | 11 类模板对应的表、`ImportBatch`、`AuditEvent` | `data:import`（FINANCE+OWNER） | 前端预览只供参考；**服务端重新解析+校验**，有错误整份拒绝；一次导入一个事务；追加=同号覆盖，替换=整表替换 |
| 设置 | ✅ | `PUT /dataset/settings` | `Tenant.settings`、`Store` 费率 | `settings:write`（FINANCE+OWNER） | 原 Demo 存浏览器 localStorage，现存数据库并记审计；改完全员生效 |
| 口径与说明 | 🟡 | 无（静态 + 引擎公式） | — | `report:read` | — |
| 导出 CSV / 打印 PDF | 🟡 | 无（浏览器端） | — | `report:read` | 导出不记审计（待确认 Q9） |
| 导出数据快照 / 恢复演示数据 | ⛔（服务端模式下禁用恢复） | — | — | — | 数据以数据库为准；备份走数据库备份 |
| 离线单文件模式 | 保留 | — | — | — | `file://` 双击打开仍是原 Demo，便于售前演示 |

## 2. 表（Prisma，`apps/api/prisma/schema.prisma`）

| 表 | 来源 | 主键 | 说明 |
|---|---|---|---|
| Tenant | 新增 | id / slug | `meta`、`settings` JSON 沿用 Demo 结构 |
| User / ExternalIdentity | 新增 | id | 角色 OWNER/FINANCE/VIEWER；平台账号只存 userid |
| Store、Supplier、Sku、Employee、OpeningInventory | Demo 主数据 | (tenantId, 业务ID) | 字段名与 Demo 一致 |
| Order、OrderItem、Shipment、PurchaseOrder、PurchaseItem、PlatformBill、Payout、Expense、Invoice | Demo 明细 | (tenantId, 业务ID)；明细行自增 | 金额 `Decimal(14,2)`，日期 `@db.Date` |
| ImportBatch | 新增 | id | 每次导入的结果与错误 |
| Briefing / BriefingVersion | 新增 | id | facts（系统核算，不可改）+ draft（AI/人工），每次改动一个版本 |
| AiCall | 新增 | id | 每次模型调用（含失败）：tokens、耗时、估算费用 |
| NotificationDelivery | 新增 | idempotencyKey 唯一 | 幂等投递与重试 |
| AuditEvent | 新增 | id | 只追加 |

所有业务表都以 `(tenantId, 业务ID)` 作主键：两家公司都有 `TB01` 店铺也不会冲突（有测试）。

## 3. 业务闭环（本期）

```
导入平台账单/订单等 → 服务端校验写库 → 核算引擎重算
  → 财务点「生成 AI 草稿」：系统生成事实表（数字），模型只写文字解读（结构化 JSON，校验不过自动重试 1 次，仍失败 = FAILED）
  → 文字里出现的数字逐个与事实表比对，对不上的标黄给审核人
  → 财务可修改（每次一个版本）→ 提交
  → 老板审核：必须审当前版本号；通过 / 退回（退回必填原因）
  → 通过后推送到办公平台（本期钉钉；幂等键 = 简报+版本；失败可重试，不影响审核结果）
  → 全程审计
```

## 4. 权限矩阵（`packages/domain/src/roles.ts`，假设，待确认 Q3）

| 权限 | 老板 OWNER | 财务 FINANCE | 只读 VIEWER |
|---|---|---|---|
| 看报表 / 简报 | ✅ | ✅ | ✅ |
| 导入数据、改设置 | ✅ | ✅ | — |
| 生成 / 修改 / 提交简报 | ✅ | ✅ | — |
| 审核简报（触发通知） | ✅ | — | — |
| 审计日志、连接器账号绑定 | ✅ | — | — |

## 5. Demo 中有、但本期没有变成真实能力的

- 平台数据仍靠**文件导入**；没有直连淘宝/天猫、小红书、快递、ERP 开放接口（Demo 合同也写明不含）。
- 报表在浏览器里计算（同一引擎）；服务端只为简报和摘要做计算。数据量变大后需要改成服务端分页/聚合（待确认 Q7）。
- 发票只做台账与匹配，不做税额计算和抵扣；工资不做个税；不报税。
