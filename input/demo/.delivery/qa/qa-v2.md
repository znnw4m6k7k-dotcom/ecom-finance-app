# 独立验收报告 v2（聚焦复验）· 电商财务集成管理系统

- 验收对象：冻结版本 **v2**（`.delivery/freeze.json`，frozen_at 2026-11-02T07:24:07.282Z，24 个文件）
- 验收人：独立 QA 子 Agent（只读复核，未修改任何源码/交付物、未重新构建）
- 验收时间：2026-11-02T15:27:35+08:00
- **release_status：`ready`**
- 一句话结论：v1 的 4 项返工全部落地并通过复验，14 条验收条目 **14/14 通过**；无 must-fix，仅 1 条非阻断建议（打印字号 8px 偏小）。

---

## 0. 冻结与测试

```
freeze_version: v2   frozen_at: 2026-11-02T07:24:07.282Z
files listed: 24   match: 24   mismatch_or_missing: 0
test_commands: ["node --test"]

node --test → tests 62 / pass 62 / fail 0 / cancelled 0 / skipped 0 / todo 0
              duration_ms 618.19，exit code 0
```

**v1 → v2 文件差异**（逐文件 sha256 对比）：

| 变化 | 文件 |
|---|---|
| CHANGED（5） | `src/style.css`、`src/app.js`、`docs/data-schema.md`、`使用说明.md`、`电商财务集成管理系统.html` |
| 与 v1 逐字节一致（15） | `src/data.js`、`src/engine.js`、`src/importer.js`、`src/views.js`、`src/ui.js`、`src/templates.js`、`src/charts.js`、`src/xlsx.js`、`src/index.html`、`build/build.mjs`、5 个测试文件 |

数据/引擎/导入/视图层未动，符合本次「只修打印 + 现金流口径 + 文档」的返工范围。

## 1. F1 打印宽表裁切 —— 已修复 ✅

**量测（print media + A4 可打印宽度 717px）**

| 页面 | 列数 | 表宽 / 容器宽 | th 越界 | 单元格溢出 | .table-wrap overflow-x | table-layout |
|---|---|---|---|---|---|---|
| 店铺利润 | 12 | 715 / 715 | 0 | 0 | visible | fixed |
| 平台结算（账单明细） | 13 | 715 / 715 | 0 | 0 | visible | fixed |
| 采购与库存（SKU） | 10 | 715 / 715 | 0 | 0 | visible | fixed |
| 商品利润 / 工资 / 物流 / 发票 | 8/8/5–6/5 | 均 715 或 691 / 相同 | 0 | 0 | visible | fixed |

**实际 `Page.printToPDF`（A4 8.27×11.69in、四边 0.4in，与 v1 完全同一参数）**

| 页面 | v2 页数 | v1 页数 | 列完整性 |
|---|---|---|---|
| 店铺利润 | 1 | 1 | **12 列全含**：… 净利润▼ / **净利率 15.99%** / **利润占比 66.25%**，合计行 12.4% / 100% |
| 平台结算 | 2 | 2 | **13 列全含**：… 结算金额 / **重算** / **差异 ¥-0.50** / **状态「待结算」** |
| 采购与库存 | 3 | — | 表格完整 |
| 经营总览 | **3** | 4 | KPI 3 列 |

截图：`/tmp/qa-v1/v2-print-stores-a4.png`、`v2-print-settlement-a4.png`、`v2-print-overview-a4.png`、`v2-print-inventory-a4.png`；PDF 同目录 `v2-print-*.pdf`。交付 HTML 内已包含 `.table-wrap { overflow: visible` 与 `table-layout: fixed` 规则。

> 列名核对以 PDF 截图为准（未依赖文本提取，避开 CJK 兼容字问题）。

## 2. F2 现金流时点口径 —— 已修复 ✅

| 筛选 | 净利润（会变，说明筛选有效） | 现金流卡（时点） | 标签 |
|---|---|---|---|
| 全部账期 / 全部店铺 | 31.9 万 | 138.6 万 / 77.2 万 / 91.9 万 | 现金流 **截至 2026-10-31**，副标「累计已回款」 |
| **8 月** / 全部店铺 | 10.9 万 | 138.6 / 77.2 / 91.9（不变） | 同上 |
| **8 月 + TB01** | 7.1 万 | **70.9 / 39.6 / 47.2** | 同上 |
| **9 月 + TB01** | 6.5 万 | 70.9 / 39.6 / 47.2（不变） | 同上 |
| 9 月 + XHS01 | 2 万 | 41.4 / 22.5 / 27.6 | 同上 |

与引擎独立值一致：TB01 = 709,006.80 / 396,043.99 / 472,494.69，XHS01 = 414,222.87 / 225,368.81 / 276,199.70。卡面 title 写明「时点口径（截至数据截止日）：已回款 = 平台打款流水累计…」。v1 的「已回款按月、待结算/占款按全期」混用已消除。

## 3. F3 打印 KPI 多列 —— 已修复 ✅

- print media 下 `.kpi-grid` 计算结果为 **3 列**，`.kpi-spark` 全部 `display:none`。
- 经营总览打印页数 **4 → 3 页**（同 A4/0.4in 参数）；第 1 页可见 3 列 KPI（净利润 / 店铺排名 / 现金流）+ 第二行（成本结构 / 库存），打印标题「麓野 · 财务中枢 | 经营总览 · 全部账期 | 数据截止 2026-10-31」正常。

## 4. F4 文档口径 —— 已修复 ✅

- `docs/data-schema.md` §2.1：「退款 = 按退款发生月份归集的 `refund_amount` 合计（无退款日期时按订单月份；跨月退款冲减次月收入与成本）」——与 `src/engine.js` 的 `rm = monthOf(it.refund_date || o.refund_date || o.order_date)` 一致。
- `使用说明.md` §4：「现金流：时点口径，始终显示截至数据截止日（2026-10-31）的累计已回款、未结算账单金额与账期占款，不随账期切换；选店铺时显示该店口径」——与 `src/app.js` 一致；平台费率参考也已更新。
- 全文复查：无「当月订单 refund_amount 合计」「已回款按月」等矛盾表述。

## 5. 回归抽查

| 项 | 结果 |
|---|---|
| 5 组 KPI 首屏可见 | ✅ 1440×900 下 5 张卡全在首屏（maxBottom 475） |
| 下钻 | ✅ 店铺（月度 3 行 + 最近订单 10 笔）、商品（10 笔最近订单）、账单（10 项构成）、员工（3 个月）、发票（KV 明细） |
| 设置改 10% | ✅ 净利 31.9 万→22.3 万、应发 32.9 万→42.5 万（独立重算 425,257.56 / 222,540.41 一致） |
| 设置持久化 / 恢复 | ✅ 刷新后仍 10.00×3；恢复默认后 2.00/3.00/4.00、净利回到 31.9 万 |
| CSV 导出 | ✅ 「经营总览-全部账期.csv」468 字节、BOM `ef bb bf`、表头「指标,数值,口径」、营业收入 2,568,362.18 |
| 导入校验 | ✅ valid-orders.csv：校验通过（1/1、错误 0）→ 确认导入 → 订单 15,190→15,191、营业收入 2,568,561 |
| 11 个页面 | ✅ 全部渲染，0 页出现 undefined/NaN，勾稽 8/8 通过 |
| 控制台 / 外部依赖 | ✅ 0 console.error / 0 console.warn / 0 unhandledrejection / 0 fetch·XHR / 0 外部资源；HTML 静态扫描仅 2 处 SVG 命名空间 |

## 6. 遗留建议（非阻断）

- **F5**：打印态 `table.data{font-size:8px}`（约 6pt）偏小，PDF 上可读但正式汇报偏紧；可回调 9px，或对 12/13 列的「店铺利润」「平台结算」用 `@page` 横向。不影响验收。

## 7. 证据文件

| 文件 | 内容 |
|---|---|
| `/tmp/qa-v1/node-test-v2.log` | v2 `node --test` 原始输出（62/62，exit 0） |
| `/tmp/qa-v1/verify-freeze.mjs` | 24 文件 sha256 核对（v2 24/24） |
| `/tmp/qa-v1/diff-v1-v2.cjs` | v1↔v2 逐文件哈希差异 |
| `/tmp/qa-v1/v2-print-stores-a4.pdf/.png` | 店铺利润打印（1 页，12 列全含） |
| `/tmp/qa-v1/v2-print-settlement-a4.pdf/.png` | 平台结算打印（2 页，13 列全含） |
| `/tmp/qa-v1/v2-print-overview-a4.pdf/.png` | 总览打印（3 页，KPI 3 列；v1 为 4 页） |
| `/tmp/qa-v1/v2-print-inventory-a4.pdf/.png` | 采购与库存打印（3 页） |
| `/tmp/qa-v1/v2-print-stores-dom.png`、`v2-print-overview-media.png` | 打印态布局截图 |
| `/tmp/qa-v1/v2-export-overview.csv` | 导出 CSV 原件（含 BOM） |

---

**最终结论：`ready`。** 14 条验收条目全部通过，v1 的 F1–F4 均已修复并复验；仅保留 1 条非阻断的打印字号建议，可在后续版本顺手优化，不影响发布。
