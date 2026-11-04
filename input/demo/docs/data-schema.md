# 数据模型与核算口径（v1 契约）

本文档是 `engine.js` / `data.js` / `importer.js` / 界面视图的共同契约。所有金额单位：元（CNY），保留 2 位小数；数量为整数；日期为 `YYYY-MM-DD`，账期为 `YYYY-MM`。

## 0. 顶层数据结构

```js
{
  meta: { company_name, brand, currency: "CNY", start_month, end_month, current_month },
  settings: { commission_ladder, default_basis, slow_moving_days, turnover_days, allocation_method, tax_rate_default },
  stores: [...], suppliers: [...], skus: [...], employees: [...],
  opening_inventory: [...],
  orders: [...], order_items: [...], shipments: [...],
  purchase_orders: [...], purchase_items: [...],
  platform_bills: [...], payouts: [...],
  expenses: [...], invoices: [...]
}
```

## 1. 数据表

### stores 店铺
| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 主键，如 `TB01` |
| platform | `taobao` \| `xhs` | 平台 |
| name | string | 店铺名 |
| commission_rate | number | 佣金率（淘宝 0.05，小红书 0.05） |
| tech_fee_rate | number | 软件服务费/技术服务费率 |
| payment_fee_rate | number | 支付手续费率（0.006） |
| insurance_rate | number | 运费险率（按净销售额，0.008，可 0） |
| settlement_days | int | 账期天数（T+N） |

### suppliers 供应商
`id, name, tax_rate, terms`

### skus 商品
`id, name, category, spec, list_price, supplier_id, launch_month, status(active|off)`
> 成本不写在 SKU 上，成本一律由库存移动加权平均算出。

### employees 员工
`id, name, role(运营|主播|客服|仓管|财务|设计), base_salary, allowance, deduction, basis(revenue|gross_profit), store_ids[], commission_share, joined_at, active`

### opening_inventory 期初库存（start_month 上月最后一天）
`sku_id, qty, unit_cost`

### orders 订单头
`id, store_id, order_date, status(paid|refunded|partial), paid_amount, refund_amount, refund_date, ship_date, carrier, province, returned(bool)`
> `paid_amount` 为买家实付（含运费），`refund_amount` 为退款金额（含退运费）。订单明细金额之和 = paid_amount。

### order_items 订单明细
`order_id, sku_id, qty, amount, refund_amount, refund_qty`

### shipments 物流面单
`id, order_id, carrier, province, weight_kg, base_fee, overweight_fee, surcharge, return_fee, shipped_at, returned`
> 运费 = 首重费(base_fee) + 续重费(overweight_fee) + 区域加价(surcharge) + 退回运费(return_fee)。

### purchase_orders / purchase_items 采购
订单头：`id, supplier_id, date, status(received|pending), invoice_no`
明细：`po_id, sku_id, qty, unit_price, amount`（amount = qty × unit_price）

### platform_bills 平台账单（月 × 店）
`id, store_id, period, gmv, refund_amount, commission, tech_service_fee, payment_fee, promotion_fee, freight_insurance, subsidy, other_deduction, settled_amount, status(settled|pending), payout_date`
> `settled_amount` 以平台账单为准；系统另按订单重算一版，差异进入对账。

### payouts 平台打款
`id, store_id, bill_id, date, amount, bank_ref`

### expenses 费用
`id, date, category(推广费|仓储费|包装耗材|办公费|快递费|其他), store_id(nil 为公共), vendor, amount, invoice_no`

### invoices 发票台账
`id, direction(input|output), number, date, seller, buyer, amount, tax_amount, related_type(purchase|expense|platform_fee|sales), related_id, note`
> 匹配状态由引擎计算：`matched`（能找到关联单据且金额一致）、`amount_mismatch`、`unmatched`。

## 2. 核算口径

### 2.1 收入
- GMV = 当月订单 `paid_amount` 合计（下单口径）
- 退款 = 按退款发生月份归集的 `refund_amount` 合计（无退款日期时按订单月份；跨月退款冲减次月收入与成本）
- 净销售额 = GMV − 退款
- 平台补贴（bill.subsidy）计入收入：**营业收入 = 净销售额 + 补贴**
- 佣金 = 净销售额 × commission_rate（账单实际值优先展示，差异进入对账）
- 软件服务费 = 净销售额 × tech_fee_rate
- 支付手续费 = GMV × payment_fee_rate
- 运费险 = 净销售额 × insurance_rate
- 推广费 = 账单代扣推广费（bill.promotion_fee）+ 费用表推广费（store_id 匹配）

### 2.2 商品成本（移动加权平均）
按日期顺序处理库存移动，期初为 `opening_inventory`：
- 采购入库：`新均价 = (结存数量×原均价 + 入库金额) ÷ (结存数量 + 入库数量)`
- 销售出库：按发货日**当时均价**结转成本
- 退货入库：按退货发生日当时均价入库，同时冲减当月收入与成本
- 结存金额 = 结存数量 × 均价
- 周转天数 = 期间平均库存金额 ÷ 期间出库成本 × 期间天数
- 滞销：结存数量 > 0 且最近 `slow_moving_days` 天无出库

### 2.3 利润
单店单月：
```
营业收入   = 净销售额 + 补贴
商品成本   = 出库成本 − 退货入库成本（净额）
物流成本   = 面单运费合计（含退回运费）
平台费用   = 佣金 + 软件服务费 + 支付手续费 + 运费险
推广费     = 账单推广 + 费用表推广（按店）
人工成本   = 提成（直接归属）+ 底薪与补贴按店铺收入占比分摊 + 代扣不计入成本
其他费用   = 店铺直接费用 + 公共费用按店铺收入占比分摊
经营毛利   = 营业收入 − 商品成本
贡献毛利   = 经营毛利 − 物流成本
净利润     = 贡献毛利 − 平台费用 − 推广费 − 人工成本 − 其他费用
```
公司合计 = 各店逐项相加；`公共费用` / `无店铺员工薪酬` 按各店营业收入占比分摊，分摊后各店净利之和 = 公司净利（勾稽项）。

### 2.4 工资
```
应发 = 底薪 + 补贴 + 提成
实发 = 应发 − 代扣
提成基数 = basis=revenue ? 店铺净销售额 : 店铺贡献毛利
提成 = 阶梯(基数)：min ≤ 基数 < max 的部分 × rate（默认 0–5万 2%、5–10万 3%、10万以上 4%）
```
- 员工有多个店铺：提成按店铺分别计算后相加；底薪按这些店铺收入占比分摊
- 员工无店铺（财务/仓管）：薪酬进公共费用池，按全公司收入占比分摊
- 退货扣回：提成基数用当月**净**额（已扣退款），跨月退款在下月冲减
- 工资只算应发口径，社保/个税作为 `deduction` 固定代扣，不进公司费用

### 2.5 现金流与对账
- 已回款 = `payouts.amount` 合计（按打款日期）
- 待结算 = `platform_bills.status = pending` 的 `settled_amount` 合计
- 账期占款 = 已发货但对应账单未结算的订单 `paid_amount − refund_amount` 合计
- 账单重算值 = 净销售额 + 补贴 − 佣金 − 软件服务费 − 支付手续费 − 账单推广 − 运费险 − 其他扣款
- 对账差异 = 账单 `settled_amount` − 重算值，差异原因分三类：`order_missing`（账单多/少订单）、`fee_diff`（费用率差异）、`rounding`
- 打款对账：同一账单 `payouts` 合计 vs `settled_amount`

### 2.6 发票
- 采购入库应有进项票（`purchase_orders.invoice_no` 非空）
- 费用超过 500 元应有发票（`expenses.invoice_no`）
- 发票匹配：`related_type + related_id` 找到单据；金额一致 → matched；不一致 → amount_mismatch；找不到 → unmatched
- 销项票按平台/自开登记，不做税额计算，只做台账与金额汇总

## 3. 勾稽校验（首页告警）

| id | 校验 | 公式 |
|---|---|---|
| `pnl-identity` | 利润恒等式 | 营业收入 − 商品成本 − 物流 − 平台费 − 推广 − 人工 − 其他 = 净利润（差 ≤ 0.01） |
| `store-sum` | 店铺合计 | Σ店铺净利润 = 公司净利润 |
| `inventory-roll` | 库存滚动 | 期初数量 + 入库 − 出库 = 期末数量（逐 SKU，差 = 0） |
| `cost-consistency` | 成本勾稽 | 商品成本合计 = 销售出库成本 − 退货入库成本 |
| `bill-vs-orders` | 账单与订单 | 账单 GMV 合计 vs 订单 GMV 合计，差异需全部有对账原因 |
| `payout-vs-bill` | 打款与账单 | 已回款合计 = 已结算账单合计 |
| `payroll-total` | 工资合计 | Σ员工应发 = 计入利润的人工成本 |
| `negative-stock` | 负库存 | 任一 SKU 任一时点结存 < 0 |

## 4. 引擎输出（`computeModel(data)`）

```js
{
  months: ["2026-08","2026-09","2026-10"],
  stores, skus, employees,
  storeMonth: { [storeId]: { [month]: { 收入...净利润, orders, units, aov, refundRate, freightPerOrder } } },
  companyMonth: { [month]: {...} },
  total: {...},
  skuMonth: [{ sku_id, store_id, month, qty, revenue, cogs, grossProfit, refundQty }],
  inventory: { bySku: [...], total: {qty, value, turnoverDays, slowMovingValue} },
  payroll: { byMonth: [...], total },
  reconciliation: { bills: [...], payoutDiffs: [...], summary },
  cash: { byStore: {...}, total: {received, pending, occupied} },
  invoices: { input: {...}, output: {...}, issues: [...] },
  expenses: { byCategory: [...], byMonth: [...] },
  logistics: { byCarrier: [...], byProvince: [...], byStore: [...], total },
  purchases: { bySupplier: [...], total },
  checks: [{ id, label, ok, expected, actual, diff }],
  alerts: [...],
  kpis: { [month]: {...} }
}
```

## 5. 设置项（可在界面修改并持久化）

- `commission_ladder`: `[{min, max, rate}]`，区间左闭右开，最后一段 max = null
- `default_basis`: `revenue` | `gross_profit`
- `slow_moving_days`: 默认 60
- `turnover_days`: 默认 30（周转天数按当月 30 天）
- `allocation_method`: `revenue_share`（固定，本期只做这一种）
- 店铺费率：`commission_rate / tech_fee_rate / payment_fee_rate / insurance_rate`

## 6. 导入规范化

CSV/.xlsx 首行为表头，中英文表头均识别（别名表见 `templates.js`）。每张表有必填字段；导入时逐行校验：
- 日期格式、数字格式、必填缺失、外键不存在（store_id/sku_id/order_id）、金额不平（明细合计 ≠ 头）、重复主键
- 校验失败的行不写入，导出错误清单（行号 + 字段 + 原因）
- 支持"追加"与"替换整表"两种模式
