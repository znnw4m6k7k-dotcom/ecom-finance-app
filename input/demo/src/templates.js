/* 导入模板定义：表结构、中文标签、别名、示例行
 * 用于：生成 CSV 模板、把表头映射到字段、导入校验
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FinTemplates = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function f(key, label, type, required, aliases, extra) {
    return Object.assign({ key: key, label: label, type: type, required: !!required, aliases: aliases || [] }, extra || {});
  }

  var TABLES = [
    {
      id: 'orders', label: '订单明细', icon: '🛒',
      desc: '淘宝 / 小红书后台导出的订单明细，一行一个商品；同一订单号可多行。导入后自动生成订单头与明细。',
      tables: ['orders', 'order_items'],
      fields: [
        f('order_id', '订单号', 'text', true, ['订单编号', '主订单号', 'order_id', '订单ID']),
        f('store_id', '店铺', 'text', true, ['店铺编码', '店铺名称', 'store_id'], { fk: 'stores' }),
        f('order_date', '下单日期', 'date', true, ['下单时间', '订单日期', 'order_date', '创建时间']),
        f('paid_amount', '支付金额', 'money', false, ['买家实付', '实付金额', '订单金额', 'paid_amount']),
        f('refund_amount', '退款金额', 'money', false, ['退款金额', '售后退款', 'refund_amount']),
        f('refund_date', '退款日期', 'date', false, ['退款时间', '售后时间', 'refund_date']),
        f('ship_date', '发货日期', 'date', false, ['发货时间', 'ship_date']),
        f('carrier', '快递公司', 'text', false, ['物流公司', '承运商', 'carrier']),
        f('province', '收货省份', 'text', false, ['省份', '收货地址', 'province']),
        f('status', '订单状态', 'enum', false, ['状态', 'status'], { values: ['paid', 'refunded', 'partial'] }),
        f('sku_id', '商品编码', 'text', true, ['商品ID', '商家编码', 'SKU', 'sku_id'], { fk: 'skus' }),
        f('qty', '数量', 'int', true, ['购买数量', '件数', 'qty']),
        f('amount', '商品金额', 'money', true, ['明细金额', '商品实付', 'amount']),
        f('item_refund_qty', '退款数量', 'int', false, ['退货数量', '退款件数']),
        f('item_refund_amount', '明细退款金额', 'money', false, ['明细退款', '退款金额(明细)'])
      ],
      sample: [
        { order_id: 'TB2608010001', store_id: 'TB01', order_date: '2026-08-01', paid_amount: '139', refund_amount: '0', refund_date: '', ship_date: '2026-08-02', carrier: '中通', province: '浙江', status: 'paid', sku_id: 'SKU001', qty: '1', amount: '139', item_refund_qty: '0', item_refund_amount: '0' },
        { order_id: 'TB2608010002', store_id: 'TB01', order_date: '2026-08-01', paid_amount: '278', refund_amount: '0', refund_date: '', ship_date: '2026-08-02', carrier: '圆通', province: '广东', status: 'paid', sku_id: 'SKU010', qty: '2', amount: '140', item_refund_qty: '0', item_refund_amount: '0' }
      ]
    },
    {
      id: 'shipments', label: '物流面单', icon: '📦',
      desc: '快递 / 电子面单 / 仓配系统导出的运费明细，用于按订单归集物流成本。',
      tables: ['shipments'],
      fields: [
        f('shipment_id', '面单号', 'text', false, ['运单号', '物流单号', 'shipment_id']),
        f('order_id', '订单号', 'text', true, ['订单编号', 'order_id'], { fk: 'orders' }),
        f('carrier', '快递公司', 'text', true, ['物流公司', '承运商', 'carrier']),
        f('province', '收货省份', 'text', false, ['省份', 'province']),
        f('weight_kg', '重量(kg)', 'money', false, ['重量', '计费重量', 'weight_kg']),
        f('base_fee', '首重费用', 'money', true, ['运费', '基础运费', 'base_fee']),
        f('overweight_fee', '续重费用', 'money', false, ['续重', '超重费', 'overweight_fee']),
        f('surcharge', '区域加价', 'money', false, ['偏远加价', 'surcharge']),
        f('return_fee', '退回运费', 'money', false, ['逆向运费', 'return_fee']),
        f('shipped_at', '发货日期', 'date', true, ['发货时间', 'shipped_at']),
        f('returned', '是否退回', 'enum', false, ['退回', 'returned'], { values: ['0', '1', 'true', 'false', '是', '否'] })
      ],
      sample: [
        { shipment_id: 'SH2608010001', order_id: 'TB2608010001', carrier: '中通', province: '浙江', weight_kg: '0.35', base_fee: '3.2', overweight_fee: '0', surcharge: '0', return_fee: '0', shipped_at: '2026-08-02', returned: '0' }
      ]
    },
    {
      id: 'platform_bills', label: '平台账单', icon: '🧾',
      desc: '淘宝 / 小红书月度结算账单。系统会按订单重算一遍，差异进入对账清单。',
      tables: ['platform_bills'],
      fields: [
        f('bill_id', '账单号', 'text', true, ['账单编号', '结算单号', 'bill_id']),
        f('store_id', '店铺', 'text', true, ['店铺编码', '店铺名称'], { fk: 'stores' }),
        f('period', '账期', 'month', true, ['结算月份', '账期月份', 'period']),
        f('gmv', '账单GMV', 'money', true, ['成交金额', 'gmv']),
        f('refund_amount', '退款金额', 'money', false, ['退款', 'refund_amount']),
        f('commission', '佣金', 'money', false, ['平台佣金', 'commission']),
        f('tech_service_fee', '软件服务费', 'money', false, ['技术服务费', 'tech_service_fee']),
        f('payment_fee', '支付手续费', 'money', false, ['支付服务费', 'payment_fee']),
        f('promotion_fee', '推广费(代扣)', 'money', false, ['推广费', '直通车', 'promotion_fee']),
        f('freight_insurance', '运费险', 'money', false, ['运费险', 'freight_insurance']),
        f('subsidy', '平台补贴', 'money', false, ['补贴', 'subsidy']),
        f('other_deduction', '其他扣款', 'money', false, ['其他费用', 'other_deduction']),
        f('settled_amount', '结算金额', 'money', true, ['实际结算', '打款金额', 'settled_amount']),
        f('status', '结算状态', 'enum', false, ['状态', 'status'], { values: ['settled', 'pending'] }),
        f('payout_date', '打款日期', 'date', false, ['到账日期', 'payout_date']),
        f('note', '差异说明', 'text', false, ['备注', '说明', 'note'])
      ],
      sample: [
        { bill_id: 'BILL-TB01-202608', store_id: 'TB01', period: '2026-08', gmv: '855000', refund_amount: '52000', commission: '40150', tech_service_fee: '16060', payment_fee: '5130', promotion_fee: '64125', freight_insurance: '6424', subsidy: '0', other_deduction: '0', settled_amount: '671111', status: 'settled', payout_date: '2026-09-15', note: '' }
      ]
    },
    {
      id: 'payouts', label: '平台打款流水', icon: '🏦',
      desc: '平台结算到银行账户的回款流水，用于核对“已回款 / 待结算”。',
      tables: ['payouts'],
      fields: [
        f('payout_id', '流水号', 'text', true, ['打款流水号', 'payout_id']),
        f('store_id', '店铺', 'text', true, ['店铺编码', '店铺名称'], { fk: 'stores' }),
        f('bill_id', '账单号', 'text', false, ['对应账单', 'bill_id'], { fk: 'platform_bills' }),
        f('date', '到账日期', 'date', true, ['打款日期', 'date']),
        f('amount', '到账金额', 'money', true, ['金额', 'amount']),
        f('bank_ref', '银行流水号', 'text', false, ['银行摘要', 'bank_ref'])
      ],
      sample: [
        { payout_id: 'PAY-001', store_id: 'TB01', bill_id: 'BILL-TB01-202608', date: '2026-09-15', amount: '671111', bank_ref: 'BANK20260915001' }
      ]
    },
    {
      id: 'purchase', label: '采购单', icon: '📥',
      desc: 'ERP / 采购系统导出的采购入库单，一行一个商品；同一采购单号可多行，用于移动加权平均成本。',
      tables: ['purchase_orders', 'purchase_items'],
      fields: [
        f('po_id', '采购单号', 'text', true, ['采购订单号', '入库单号', 'po_id']),
        f('supplier_id', '供应商', 'text', true, ['供应商名称', 'supplier_id'], { fk: 'suppliers' }),
        f('date', '采购日期', 'date', true, ['入库日期', '采购时间', 'date']),
        f('status', '状态', 'enum', false, ['入库状态', 'status'], { values: ['received', 'pending'] }),
        f('invoice_no', '发票号', 'text', false, ['采购发票', 'invoice_no']),
        f('sku_id', '商品编码', 'text', true, ['商品ID', '商家编码', 'sku_id'], { fk: 'skus' }),
        f('qty', '采购数量', 'int', true, ['数量', '入库数量', 'qty']),
        f('unit_price', '采购单价', 'money', true, ['单价', '含税单价', 'unit_price']),
        f('amount', '采购金额', 'money', false, ['金额', '含税金额', 'amount'])
      ],
      sample: [
        { po_id: 'PO2608-SUP01', supplier_id: 'SUP01', date: '2026-08-02', status: 'received', invoice_no: 'FPPO2608-SUP01', sku_id: 'SKU001', qty: '2000', unit_price: '60.5', amount: '121000' },
        { po_id: 'PO2608-SUP01', supplier_id: 'SUP01', date: '2026-08-02', status: 'received', invoice_no: 'FPPO2608-SUP01', sku_id: 'SKU005', qty: '1500', unit_price: '69.2', amount: '103800' }
      ]
    },
    {
      id: 'employees', label: '员工与工资规则', icon: '👥',
      desc: '工资模块的员工底薪、提成基数与分摊店铺；提成阶梯在「设置」里统一维护。',
      tables: ['employees'],
      fields: [
        f('employee_id', '员工编号', 'text', true, ['工号', 'employee_id']),
        f('name', '姓名', 'text', true, ['员工姓名', 'name']),
        f('role', '岗位', 'text', true, ['职位', 'role']),
        f('base_salary', '底薪', 'money', true, ['基本工资', 'base_salary']),
        f('allowance', '补贴', 'money', false, ['津贴', 'allowance']),
        f('deduction', '代扣', 'money', false, ['社保个税', 'deduction']),
        f('basis', '提成基数', 'enum', false, ['提成方式', 'basis'], { values: ['gross_profit', 'revenue'] }),
        f('store_ids', '负责店铺', 'ids', false, ['所属店铺', 'store_ids']),
        f('commission_share', '提成比例', 'money', false, ['提成份额', 'commission_share']),
        f('joined_at', '入职日期', 'date', false, ['入职时间', 'joined_at'])
      ],
      sample: [
        { employee_id: 'EMP02', name: '陈默', role: '运营', base_salary: '13000', allowance: '1000', deduction: '2100', basis: 'gross_profit', store_ids: 'TB01', commission_share: '0.75', joined_at: '2025-05-12' }
      ]
    },
    {
      id: 'expenses', label: '费用支出', icon: '💳',
      desc: '仓储、推广、包装、办公等费用；店铺为空表示公共费用，按收入占比分摊。',
      tables: ['expenses'],
      fields: [
        f('expense_id', '费用单号', 'text', true, ['单据号', 'expense_id']),
        f('date', '发生日期', 'date', true, ['日期', 'date']),
        f('category', '费用类别', 'text', true, ['类别', 'category']),
        f('store_id', '店铺', 'text', false, ['所属店铺', 'store_id'], { fk: 'stores' }),
        f('vendor', '供应商/收款方', 'text', false, ['收款方', 'vendor']),
        f('amount', '金额', 'money', true, ['费用金额', 'amount']),
        f('invoice_no', '发票号', 'text', false, ['发票号码', 'invoice_no'])
      ],
      sample: [
        { expense_id: 'EXP0001', date: '2026-08-05', category: '仓储费', store_id: 'TB01', vendor: '华东云仓（虚构）', amount: '6841.33', invoice_no: 'FP-WH-202608TB01' }
      ]
    },
    {
      id: 'invoices', label: '发票台账', icon: '🧮',
      desc: '进项 / 销项发票登记；关联单据号用于自动匹配采购、费用与平台服务费。',
      tables: ['invoices'],
      fields: [
        f('invoice_id', '发票记录号', 'text', true, ['记录号', 'invoice_id']),
        f('direction', '进项/销项', 'enum', true, ['方向', 'direction'], { values: ['input', 'output', '进项', '销项'] }),
        f('number', '发票号码', 'text', false, ['发票号', 'number']),
        f('date', '开票日期', 'date', true, ['日期', 'date']),
        f('seller', '销方', 'text', false, ['开票方', 'seller']),
        f('buyer', '购方', 'text', false, ['受票方', 'buyer']),
        f('amount', '价税合计', 'money', true, ['金额', 'amount']),
        f('tax_amount', '税额', 'money', false, ['税金', 'tax_amount']),
        f('related_type', '关联单据类型', 'enum', false, ['关联类型', 'related_type'], { values: ['purchase', 'expense', 'platform_fee', 'sales'] }),
        f('related_id', '关联单据号', 'text', false, ['关联单据', 'related_id'])
      ],
      sample: [
        { invoice_id: 'INV-IN-001', direction: 'input', number: 'FP2608-SUP01', date: '2026-08-05', seller: '广州植萃生物科技（虚构）', buyer: '麓野（杭州）品牌管理有限公司（虚构）', amount: '121000', tax_amount: '13920.35', related_type: 'purchase', related_id: 'PO2608-SUP01' }
      ]
    },
    {
      id: 'skus', label: '商品主数据', icon: '🏷️',
      desc: 'ERP / 商品中心导出的 SKU 主数据；成本不在主数据里填写，由采购与库存计算。',
      tables: ['skus'],
      fields: [
        f('sku_id', '商品编码', 'text', true, ['SKU', '商家编码', 'sku_id']),
        f('name', '商品名称', 'text', true, ['品名', 'name']),
        f('category', '类目', 'text', false, ['分类', 'category']),
        f('spec', '规格', 'text', false, ['规格型号', 'spec']),
        f('list_price', '零售价', 'money', false, ['标价', '吊牌价', 'list_price']),
        f('supplier_id', '供应商', 'text', false, ['供应商名称', 'supplier_id'], { fk: 'suppliers' }),
        f('launch_month', '上市月份', 'month', false, ['上市时间', 'launch_month'])
      ],
      sample: [
        { sku_id: 'SKU001', name: '玻尿酸水光精华', category: '精华', spec: '30ml', list_price: '139', supplier_id: 'SUP01', launch_month: '2026-07' }
      ]
    },
    {
      id: 'stores', label: '店铺主数据', icon: '🏬',
      desc: '店铺与平台费率；改费率会立即影响佣金、软件服务费等核算。',
      tables: ['stores'],
      fields: [
        f('store_id', '店铺编码', 'text', true, ['店铺ID', 'store_id']),
        f('platform', '平台', 'enum', true, ['所属平台', 'platform'], { values: ['taobao', 'xhs'] }),
        f('name', '店铺名称', 'text', true, ['店铺名', 'name']),
        f('commission_rate', '佣金率', 'money', false, ['平台佣金率', 'commission_rate']),
        f('tech_fee_rate', '软件服务费率', 'money', false, ['技术服务费率', 'tech_fee_rate']),
        f('payment_fee_rate', '支付手续费率', 'money', false, ['支付费率', 'payment_fee_rate']),
        f('insurance_rate', '运费险率', 'money', false, ['运费险费率', 'insurance_rate']),
        f('settlement_days', '账期天数', 'int', false, ['结算周期', 'settlement_days'])
      ],
      sample: [
        { store_id: 'TB01', platform: 'taobao', name: '麓野旗舰店（天猫）', commission_rate: '0.05', tech_fee_rate: '0.02', payment_fee_rate: '0.006', insurance_rate: '0.008', settlement_days: '15' }
      ]
    },
    {
      id: 'opening_inventory', label: '期初库存', icon: '📊',
      desc: '账期开始前一天的库存快照；没有期初库存会导致销售出库成本从 0 开始。',
      tables: ['opening_inventory'],
      fields: [
        f('sku_id', '商品编码', 'text', true, ['SKU', '商家编码'], { fk: 'skus' }),
        f('qty', '期初数量', 'int', true, ['数量', '库存数量']),
        f('unit_cost', '期初单价', 'money', true, ['成本价', 'unit_cost'])
      ],
      sample: [
        { sku_id: 'SKU001', qty: '1350', unit_cost: '59.9' }
      ]
    }
  ];

  function getTable(id) {
    for (var i = 0; i < TABLES.length; i++) if (TABLES[i].id === id) return TABLES[i];
    return null;
  }

  function templateCsv(id) {
    var t = getTable(id);
    if (!t) return '';
    var headers = t.fields.map(function (x) { return x.label; });
    var lines = [headers.join(',')];
    (t.sample || []).forEach(function (row) {
      lines.push(t.fields.map(function (x) {
        var v = row[x.key] === undefined ? '' : String(row[x.key]);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(','));
    });
    return '\ufeff' + lines.join('\r\n');
  }

  return { TABLES: TABLES, getTable: getTable, templateCsv: templateCsv };
});
