#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 tests/xlsx.test.js 用的最小 .xlsx 样本（仅用 Python 标准库）。

用法：
    python3 tests/fixtures/make-xlsx-fixture.py

产物（二进制直接提交进仓库，测试运行时不依赖 Python）：
    sample.xlsx          deflate 压缩的真实结构 xlsx
    sample-stored.xlsx   stored（不压缩）xlsx

样本内容故意覆盖：sharedStrings、inlineStr、数字（139 / 37.2 / 1000000）、
内置日期格式、自定义日期格式、公式缓存值、布尔、错误值、空单元格列跳跃、
整行空白、中文表头、两个工作表。
"""

from pathlib import Path
import zipfile

HERE = Path(__file__).resolve().parent
FIXED_ZIP_TIME = (2024, 1, 1, 0, 0, 0)  # 固定时间戳，保证重复生成的文件字节一致

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>
"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>
"""

WORKBOOK = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="订单明细" sheetId="1" r:id="rId1"/>
    <sheet name="说明" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>
"""

WORKBOOK_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>
"""

SHARED_STRINGS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="14" uniqueCount="14">
  <si><t>订单号</t></si>
  <si><t>商品名称</t></si>
  <si><t>数量</t></si>
  <si><t>金额</t></si>
  <si><t>下单日期</t></si>
  <si><t>公式金额</t></si>
  <si><t>是否加急</t></si>
  <si><t>错误码</t></si>
  <si><t>ORD-001</t></si>
  <si><t>ORD-002</t></si>
  <si><t>ORD-003</t></si>
  <si><t>ORD-004</t></si>
  <si><t>sheet2 数据</t></si>
  <si><t>A &amp; B &lt;测试&gt; &quot;引号&quot;</t></si>
</sst>
"""

STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>
    <numFmt numFmtId="165" formatCode="#,##0.00"/>
  </numFmts>
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>
"""

SHEET1 = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:H6"/>
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
      <c r="C1" t="s"><v>2</v></c>
      <c r="D1" t="s"><v>3</v></c>
      <c r="E1" t="s"><v>4</v></c>
      <c r="F1" t="s"><v>5</v></c>
      <c r="G1" t="s"><v>6</v></c>
      <c r="H1" t="s"><v>7</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>8</v></c>
      <c r="B2" t="inlineStr"><is><t>中文商品 · 测试</t></is></c>
      <c r="C2"><v>139</v></c>
      <c r="D2"><v>37.2</v></c>
      <c r="E2" s="1"><v>45366</v></c>
      <c r="F2"><f>SUM(C2:D2)</f><v>176.2</v></c>
      <c r="G2" t="b"><v>1</v></c>
      <c r="H2" t="e"><v>#DIV/0!</v></c>
    </row>
    <row r="3">
      <c r="A3" t="s"><v>9</v></c>
      <c r="B3" t="inlineStr"><is><t>第二行</t></is></c>
      <c r="C3"><v>1000000</v></c>
      <c r="D3" s="3"><v>0.5</v></c>
      <c r="E3" s="2"><v>43831</v></c>
      <c r="F3"><f>C3*D3</f><v>500000</v></c>
      <c r="G3" t="b"><v>0</v></c>
      <c r="H3" t="e"><v>#N/A</v></c>
    </row>
    <row r="4">
      <c r="A4" t="s"><v>10</v></c>
      <c r="C4"><v>2</v></c>
    </row>
    <row r="5"><c r="A5" s="0"/></row>
    <row r="6">
      <c r="A6" t="s"><v>11</v></c>
      <c r="C6"><v>7</v></c>
    </row>
  </sheetData>
</worksheet>
"""

SHEET2 = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>这是第二个工作表</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>12</v></c>
      <c r="B2"><v>42</v></c>
      <c r="C2" t="str"><f>"OK"</f><v>公式文本</v></c>
    </row>
    <row r="3">
      <c r="A3" s="1"><v>1</v></c>
      <c r="B3" s="1"><v>59</v></c>
      <c r="C3" s="1"><v>60</v></c>
      <c r="D3" s="1"><v>61</v></c>
    </row>
    <row r="4">
      <c r="A4" t="s"><v>13</v></c>
    </row>
  </sheetData>
</worksheet>
"""


def package_parts():
    return {
        "[Content_Types].xml": CONTENT_TYPES,
        "_rels/.rels": ROOT_RELS,
        "xl/workbook.xml": WORKBOOK,
        "xl/_rels/workbook.xml.rels": WORKBOOK_RELS,
        "xl/sharedStrings.xml": SHARED_STRINGS,
        "xl/styles.xml": STYLES,
        "xl/worksheets/sheet1.xml": SHEET1,
        "xl/worksheets/sheet2.xml": SHEET2,
    }


def write_xlsx(path, compression):
    with zipfile.ZipFile(path, "w", compression=compression, allowZip64=False) as archive:
        for name, content in package_parts().items():
            info = zipfile.ZipInfo(name, date_time=FIXED_ZIP_TIME)
            info.compress_type = compression
            info.external_attr = 0o600 << 16
            archive.writestr(info, content.encode("utf-8"))


def main():
    write_xlsx(HERE / "sample.xlsx", zipfile.ZIP_DEFLATED)
    write_xlsx(HERE / "sample-stored.xlsx", zipfile.ZIP_STORED)
    for name in ("sample.xlsx", "sample-stored.xlsx"):
        path = HERE / name
        print("generated:", path, path.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
