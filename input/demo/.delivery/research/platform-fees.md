# 电商财务集成管理系统：平台费用与结算业务口径资料

> 检索截止 2026-11-02。平台费率会调整，演示系统应做成可配置；凡写“未找到公开权威口径”的，不要硬编码成平台规则。

## 1. 淘宝/天猫商家账单

费用有：类目佣金（天猫软件服务费，常见 2%–5%，服饰/家居 5%，3C/家电 2%，黄金 0.5%）；2024-09-01 起淘宝 C 店与天猫均收 0.6% 基础软件服务费，2024-09-18 至 2025-11-30 子订单封顶 60 元、超出平台承担；天猫原 3 万/6 万年费自 2024-09-01 取消。支付手续费仅花呗/信用卡等贷记渠道 0.6%，借记卡/余额宝免费。淘宝客佣金由卖家设 0.5%–50%，平台向推广者扣约 10% 技术服务费，确认收货后按月结算。直通车按点击 CPC 竞价；万相台按展示、点击、成交等行为计费，均预付消耗。运费险/退货宝按单动态定价，2024 年退货宝 1.5 元/单降至 1.05 元/单。账单按自然月/结算批次列订单号、结算金额、佣金、服务费、退款、补贴和打款批次；货款确认收货后结算，账期保障或保证金不足时冻结 15 天。

来源：[网经社 2024 费率与年费](https://www.100ec.cn/detail--6641350.html)、[60 元封顶](https://www.163.com/dy/article/K8HUD80L05568W0A.html)、[支付 0.6%](https://mpaypass.com.cn/news/202107/28172029.html)、[直通车 CPC](https://zhitongche.taobao.com/taobao_yingxiao.html)、[万相台计费](https://terms.alicdn.com/legal-agreement/terms/b_end_product_protocol/20230217170621149/20230217170621149.html)、[账期冻结](https://cschannel.alipay.com/mobile/helpDetail.htm?help_id=201656243171)、[退货宝](https://www.yilantop.com/news/41425)。

## 2. 小红书商家与推广结算

小红书基础技术服务费按类目 2%–5%（服饰/家居 5%，美妆 4%，3C/家电 2%，黄金阶梯 0.6%–5%），跨境另收 0.7%。2025-09-01 至 2026-08-31，同一主体前 100 万支付交易额免佣，仅留 0.6% 支付通道成本，超额恢复原费率；该计划已到期，2026-09 起恢复原费率。结算：境内订单自动确认收货 7 天（异常最长 17 天）；店铺分≥4.7 的商家确认收货后 4 天结算。蒲公英报备笔记服务费由品牌承担，实操资料多称约 10%（纯内容）/20%（含流量助推），未找到统一官方费率页，以订单页为准；平台向品牌开服务费票，达人侧由平台代扣/开票。薯条/千帆预付充值、按曝光/点击消耗，先记预付账款，消耗转销售费用。带货分佣：货款计商家收入，平台/达人佣金计销售费用；商家开商品票，平台/达人开服务费票。

来源：[技术服务费规则](https://school.xiaohongshu.com/rule/detail/27/854)、[类目费率表](https://school.xiaohongshu.com/rule/detail/27/2585)、[百万免佣](https://www.stcn.com/article/detail/3257637.html)、[结算账期](https://www.yilantop.com/news/60248)、[蒲公英介绍](https://school.xiaohongshu.com/helper/detail/1356)、[蒲公英服务费实操](https://zhuanlan.zhihu.com/p/1914594040038556612)。

## 3. 快递物流成本结构

快递成本=电子面单+首重+续重+附加费。面单纸张+API 约 0.03–0.06 元/单。电商件首重 1kg 常见 2.5–3.6 元、续重 1–2 元/kg；新疆/西藏首重 15 元、续重 12 元（申通 2025.7 有赞价）；邮政电商标快首重 3.5–5.5 元、续重 1–1.6 元/kg，新疆/西藏 8–15 元。区域、单量、协议决定实际价，无统一公开价。抛货计费重量取实重与体积重较大值：顺丰部分流向÷6000、标快 30kg 以下部分÷12000；德邦快递÷6000、零担÷4800。云仓分入库、出库操作、仓储（件天/托天/㎡）、增值（换标、退货质检、再上架）和保底/耗材，按件/单/托计。退货逆向=退件运费+质检+再上架/折损；退货宝按单收费，2024 年案例 1.5→1.05 元/单。

来源：[申通 2025.7 价](https://help.youzan.com/displaylist/detail_4_4-2-85399)、[邮政电商标快价](https://help.youzan.com/displaylist/detail_5_5-2-286173)、[顺丰计费规则](https://www.sf-express.com/mobile/cn/sc/dynamic_functions/price-rule)、[德邦计费规则](https://www.deppon.com/depponmobile/billingRules_20250715)、[电子面单成本](https://www.kdniao.com/message/detail/127889)、[云仓费用构成](https://www.hupun.com/articles/cloud-warehouse-operation-fees-breakdown.html)。

## 4. 电商 ERP 导出字段与成本核算

聚水潭订单接口常见字段：o_id（内部单号）、so_id（平台单号）、shop_id/shop_name、order_date/pay_date/send_date、status/shop_status、pay_amount/paid_amount/freight、free_amount、discount_rate、receiver_*、logistics_company/l_id、items[].sku_id/i_id/qty/price/amount/refund_status、pays[].payment/amount。采购入库：io_id、po_id、supplier_id、io_date、wh_id、items[].cost_price/cost_amount。库存：qty、order_lock、pick_lock、allocate_qty、purchase_qty、return_qty、defective_qty、in_qty、sale_refund_qty；覆盖可售、锁定、在途、次品。调拨：go_co_id/warehouse→link_co_id/link_warehouse、io_date、items[].qty。成本核算：管家婆等支持移动加权平均、先进先出、个别计价；移动加权每次入库重算均价，FIFO 按批次，选定后不宜频繁切换。聚水潭/旺店通字段名不同，接入层要做映射，不能把平台字段直接当财务字段。

来源：[聚水潭订单查询](https://open.jushuitan.com/document/2125.html)、[采购入库](https://open.jushuitan.com/document/2019.html)、[库存](https://open.jushuitan.com/document/1020.html)、[调拨](https://open.jushuitan.com/document/2166.html)、[管家婆成本算法](https://erp.wsgjp.com.cn/article-2737.html)。

## 5. 电商财务核算口径

建议口径：GMV→销售额（支付）→净收入（销售额−退款−商家优惠−平台佣金/基础服务费，佣金也可单列销售费用）→毛利（净收入−商品成本−物流−包装−仓储履约）→净利（毛利−推广−人工−仓储固定费−平台固定费用−税费）。佣金冲收入还是计费用，按总额法/净额法一贯选择；主要责任人总额法，代理人净额法。退货跨期按 CAS14 第 32 条：期末重估退货，收入按预期不会退回部分确认，退回部分确认负债和应收退货成本；可原单追溯或当期冲减，口径固定。账单与订单差异来自结算价（运费、补贴、优惠分摊）、跨期、佣金/退款、账期与打款批次；保留订单期、结算期、财务期。

来源：[CAS14 收入准则](https://www.casc.org.cn/2018/0815/202799.shtml)、[利润口径与漏项](https://www.hupun.com/articles/ecommerce-profit-calculation-errors.html)、[账单对账与差异](https://www.hupun.com/articles/multi-platform-bill-reconciliation.html)。

## 6. 工资提成常见做法

常见结构为底薪+提成。运营按 GMV 或毛利，底薪:提成约 6:4 至 1:1；实操案例月销 10 万以下 1.5%、10–30 万 2%、30 万以上 2.5%，并考核退款率/新品动销。客服为固定+询单转化/响应绩效，提成通常低于运营。员工主播底薪+GMV 1%–5%；外部达人 5%–30%，坑位费另计，按退货后有效成交结算。退货扣回须在合同/制度约定，不能突破最低工资；因劳动者原因造成损失的月扣款不超过工资 20%。社保个人部分、个税由单位代扣代缴；提成可 70% 当月、30% 季度/年终，离职结清按制度与当地规定。以上为行业区间，不是法定标准。

来源：[运营提成与毛利口径](https://www.jiushuyun.com/blog/hywz/ds/16427.html)、[阶梯与退款率案例](https://m.kaixinyin.com/article/dian-shang-19)、[主播提成区间](https://www.eshutong.com/archives/7356.html)、[工资支付暂行规定](https://www.gov.cn/zhengce/2022-08/31/content_5711284.htm)。

## 7. 发票台账

进项：采购货物 13%（专票可抵）、物流运输 9%、推广/平台技术服务/仓储 6%；小规模按票面征收率。销项：商品 13%，服务 6%。平台通常只就佣金、基础软件服务费、广告/推广费向商家开票，商品票由商家自开；个别平台特定场景代开，以规则为准。台账要素：invoice_id、invoice_code、invoice_no、invoice_type（进/销）、issue_date、seller_tax_no、buyer_tax_no、amount_ex_tax、tax_rate、tax_amount、total_amount、platform、shop_id、bill_period、fee_type、related_bill_id、related_order_id、status、remark。匹配：账单费项→发票→付款三单匹配，按平台+账期+费项+金额+税额比对；差异挂“待认证/待查”，跨期先暂估、次月红冲或补票。发票管理办法要求收款方对外经营收款应开票，电子发票与纸质同等效力。

来源：[发票管理办法](https://liaoning.chinatax.gov.cn/art/2023/7/20/art_5869_7634.html)、[增值税 13%/9%](http://zc.gjzwfw.gov.cn/art/2022/4/28/art_14_50631.html)、[6% 应税交易](http://beijing.chinatax.gov.cn/bjswj/c104557/202606/a37695e53c4740cdb0bbea85fa1a9b25.shtml)。

## 8. 对本系统的字段与演示数据建议

建议字段：platform、shop_id、bill_id、bill_period、settle_batch_no、order_id、sub_order_id、sku_id、gmv_amount、paid_amount、refund_amount、merchant_discount、platform_subsidy、commission_rate、commission_amount、base_service_fee、payment_fee、affiliate_commission、ad_spend、freight_insurance、return_service_fee、logistics_fee、warehouse_fee、packaging_fee、cogs、gross_profit、net_profit、invoice_id、tax_rate、cost_method、return_period、recognition_date、settle_date、payout_date。

建议默认值（演示期 2026-08~10，按到期后口径）：天猫类目佣金 5%（可配）、基础软件服务费 0.6% **不封顶**（60 元封顶政策已于 2025-11-30 到期）、支付手续费 0.6%（仅贷记）、淘宝客佣金 10%（卖家付）、小红书佣金 5%（免佣计划已于 2026-08-31 到期，2026-09 起恢复类目费率）、小红书支付 0.6%、退货宝 1.05 元/单、电子面单 0.05 元/单、快递首重 3.5 元+续重 1.5 元/kg、云仓操作费 1.5 元/单+仓储 0.8 元/㎡/天、推广费按 GMV 8%–15%、包装 0.8 元/单、人工按 GMV 8%–12%。

三个最容易算错：①把 GMV 当收入，或在账单已扣佣金后又重复计费用；②退货跨期只冲收入、不冲成本/佣金/运费，或把退款全部记当期费用；③用订单金额直接对银行到账，忽略结算价、补贴分摊、账期和打款批次，以及含税/不含税口径混用。
