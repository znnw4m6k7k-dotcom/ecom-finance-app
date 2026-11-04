'use strict';

/**
 * 零依赖 .xlsx 读取器（浏览器 + Node 通用，ES2020）。
 *
 * 只做「把第一个工作表读成二维字符串数组」这一件事，金额清洗/字段映射交给调用方。
 * 实现要点：
 *  1. .xlsx 本质是 zip 包：先读 EOCD → 中央目录 → 本地文件头，取出各个 XML；
 *  2. 压缩只依赖平台自带的 DecompressionStream('deflate-raw')，不引入 pako；
 *  3. XML 用一个容错的小型解析器（不做 XSD 校验），够解析 SpreadsheetML 即可；
 *  4. sharedStrings.xml 保存全工作簿复用的字符串，单元格 t="s" 的 <v> 是它的下标；
 *  5. 日期在 xlsx 里是「1900 日期系统的序列号 + 数字格式」，需结合 styles.xml 判断。
 *
 * 接口：
 *   parseXlsx(arrayBufferOrUint8Array, { sheetIndex = 0, maxRows = 50000 })
 *     => Promise<{ sheetNames: string[], rows: string[][], truncated: boolean }>
 */
(function () {
  'use strict';

  var DEFAULT_MAX_ROWS = 50000;
  var DATE_BUILTIN_IDS = [
    14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47,
  ];

  /* ------------------------------------------------------------------ *
   * 对外入口
   * ------------------------------------------------------------------ */

  async function parseXlsx(input, options) {
    try {
      return await parseWorkbook(input, options);
    } catch (err) {
      if (err instanceof Error && err.message.indexOf('xlsx: ') === 0) throw err;
      var detail = err && err.message ? err.message : String(err);
      throw new Error('xlsx: 解析失败（' + detail + '）');
    }
  }

  async function parseWorkbook(input, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var maxRows = normalizeMaxRows(opts.maxRows);
    var bytes = toUint8Array(input);
    var zip = parseZip(bytes);

    var workbookDoc = await readXmlEntry(zip, 'xl/workbook.xml');
    if (!workbookDoc) {
      throw new Error('xlsx: 找不到 xl/workbook.xml，不是有效的 Excel 工作簿');
    }
    var workbook = firstElement(workbookDoc);
    var sheetsNode = child(workbook, 'sheets');
    var sheetDefs = [];
    if (sheetsNode) {
      for (var i = 0; i < sheetsNode.children.length; i++) {
        var node = sheetsNode.children[i];
        if (node.local !== 'sheet') continue;
        sheetDefs.push({
          name: node.attrs.name || '',
          relId: node.attrs['r:id'] || node.attrs.id || '',
        });
      }
    }
    if (sheetDefs.length === 0) {
      throw new Error('xlsx: workbook.xml 中没有工作表（<sheet>）定义');
    }

    var sheetIndex = resolveSheetIndex(opts.sheetIndex, sheetDefs.length);
    var sheetName = sheetDefs[sheetIndex].name;
    var rels = await readWorkbookRels(zip);
    var target = rels.get(sheetDefs[sheetIndex].relId) ||
      'xl/worksheets/sheet' + (sheetIndex + 1) + '.xml';
    var sheetDoc = await readXmlEntry(zip, target);
    if (!sheetDoc) {
      throw new Error('xlsx: 找不到工作表「' + sheetName + '」（缺少 ' + target + '）');
    }

    var sharedStrings = await readSharedStrings(zip);
    var dateStyles = await readDateStyles(zip);
    var result = extractSheet(sheetDoc, {
      sharedStrings: sharedStrings,
      dateStyles: dateStyles,
      maxRows: maxRows,
    });

    return {
      sheetNames: sheetDefs.map(function (sheet) { return sheet.name; }),
      rows: result.rows,
      truncated: result.truncated,
    };
  }

  function normalizeMaxRows(value) {
    if (value === undefined || value === null) return DEFAULT_MAX_ROWS;
    var n = Number(value);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_MAX_ROWS;
    return Math.floor(n);
  }

  function resolveSheetIndex(value, count) {
    if (value === undefined || value === null) return 0;
    var index = Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw new Error('xlsx: sheetIndex 超出范围（共 ' + count + ' 个工作表）');
    }
    return index;
  }

  function toUint8Array(input) {
    if (input && typeof input === 'object') {
      if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) {
        return new Uint8Array(input);
      }
      if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(input)) {
        return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      }
      // 兼容别的 realm（iframe / worker）里创建的 ArrayBuffer
      if (Object.prototype.toString.call(input) === '[object ArrayBuffer]') {
        return new Uint8Array(input);
      }
    }
    throw new Error('xlsx: 输入必须是 ArrayBuffer 或 Uint8Array');
  }

  /* ------------------------------------------------------------------ *
   * zip 解析：EOCD → 中央目录 → 本地文件头
   * ------------------------------------------------------------------ */

  function viewOf(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  function signature(view, offset) {
    if (offset < 0 || offset + 4 > view.byteLength) return -1;
    return view.getUint32(offset, true);
  }

  function findEocd(bytes, view) {
    if (bytes.length < 22) {
      throw new Error('xlsx: 不是有效的 zip 文件（文件太小）');
    }
    var min = Math.max(0, bytes.length - 22 - 65535);
    for (var i = bytes.length - 22; i >= min; i--) {
      if (signature(view, i) === 0x06054b50) return i;
    }
    throw new Error('xlsx: 不是有效的 zip 文件（找不到 EOCD 目录结尾）');
  }

  function parseZip(bytes) {
    var view = viewOf(bytes);
    var eocd = findEocd(bytes, view);
    var totalEntries = view.getUint16(eocd + 10, true);
    var cdOffset = view.getUint32(eocd + 16, true);
    if (totalEntries === 0xffff || cdOffset === 0xffffffff) {
      throw new Error('xlsx: 暂不支持 ZIP64 格式的 xlsx');
    }
    if (signature(view, cdOffset) !== 0x02014b50) {
      throw new Error('xlsx: zip 中央目录损坏');
    }

    var entries = new Map();
    var pos = cdOffset;
    for (var i = 0; i < totalEntries; i++) {
      if (signature(view, pos) !== 0x02014b50) {
        throw new Error('xlsx: zip 中央目录条目损坏（第 ' + (i + 1) + ' 项）');
      }
      var flags = view.getUint16(pos + 8, true);
      var method = view.getUint16(pos + 10, true);
      var compressedSize = view.getUint32(pos + 20, true);
      var uncompressedSize = view.getUint32(pos + 24, true);
      var nameLength = view.getUint16(pos + 28, true);
      var extraLength = view.getUint16(pos + 30, true);
      var commentLength = view.getUint16(pos + 32, true);
      var localOffset = view.getUint32(pos + 42, true);
      if (pos + 46 + nameLength > bytes.length) {
        throw new Error('xlsx: zip 中央目录条目越界');
      }
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
        throw new Error('xlsx: 暂不支持 ZIP64 格式的 xlsx');
      }
      var rawName = decodeText(bytes.subarray(pos + 46, pos + 46 + nameLength));
      var name = rawName.replace(/\\/g, '/');
      entries.set(name, {
        name: name,
        flags: flags,
        method: method,
        compressedSize: compressedSize,
        uncompressedSize: uncompressedSize,
        localOffset: localOffset,
      });
      pos += 46 + nameLength + extraLength + commentLength;
    }
    return { bytes: bytes, view: view, entries: entries };
  }

  function findEntry(zip, name) {
    if (zip.entries.has(name)) return zip.entries.get(name);
    var lower = name.toLowerCase();
    var found = null;
    zip.entries.forEach(function (entry, key) {
      if (!found && key.toLowerCase() === lower) found = entry;
    });
    return found;
  }

  async function readEntry(zip, name) {
    var entry = findEntry(zip, name);
    if (!entry) return null;
    if (entry.flags & 0x1) {
      throw new Error('xlsx: 不支持加密的 zip 条目（' + name + '）');
    }
    var bytes = zip.bytes;
    var lo = entry.localOffset;
    if (lo + 30 > bytes.length || signature(zip.view, lo) !== 0x04034b50) {
      throw new Error('xlsx: zip 条目「' + name + '」的本地文件头损坏');
    }
    var nameLength = zip.view.getUint16(lo + 26, true);
    var extraLength = zip.view.getUint16(lo + 28, true);
    var start = lo + 30 + nameLength + extraLength;
    var end = start + entry.compressedSize;
    if (start > bytes.length || end > bytes.length) {
      throw new Error('xlsx: zip 条目「' + name + '」数据超出文件范围');
    }
    var data = bytes.subarray(start, end);
    if (entry.method === 0) return data;
    if (entry.method === 8) return inflateRaw(data);
    throw new Error(
      'xlsx: 不支持的压缩方式 ' + entry.method +
      '（仅支持 stored=0 / deflate=8）：' + name
    );
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('xlsx: 当前环境不支持 DecompressionStream("deflate-raw")');
    }
    var stream;
    try {
      stream = new DecompressionStream('deflate-raw');
    } catch (err) {
      throw new Error('xlsx: 当前环境不支持 deflate-raw 解压');
    }
    var collected = collectStream(stream.readable);
    var writer = stream.writable.getWriter();
    try {
      await writer.write(bytes);
      await writer.close();
      return await collected;
    } catch (err) {
      collected.catch(function () { /* 避免解压失败时产生未处理的 Promise 拒绝 */ });
      throw new Error('xlsx: zip 数据解压失败（deflate 数据损坏）');
    }
  }

  async function collectStream(readable) {
    var reader = readable.getReader();
    var chunks = [];
    var total = 0;
    for (;;) {
      var step = await reader.read();
      if (step.done) break;
      if (step.value) {
        chunks.push(step.value);
        total += step.value.length;
      }
    }
    var out = new Uint8Array(total);
    var offset = 0;
    for (var i = 0; i < chunks.length; i++) {
      out.set(chunks[i], offset);
      offset += chunks[i].length;
    }
    return out;
  }

  function decodeText(bytes) {
    if (typeof TextDecoder === 'undefined') {
      throw new Error('xlsx: 当前环境缺少 TextDecoder，无法读取 XML');
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  async function readXmlEntry(zip, name) {
    var data = await readEntry(zip, name);
    if (!data) return null;
    return parseXml(decodeText(data));
  }

  /* ------------------------------------------------------------------ *
   * 极简 XML 解析器
   * ------------------------------------------------------------------ */

  function parseXml(text) {
    var root = { name: '', local: '', attrs: {}, children: [], text: '' };
    var stack = [root];
    var len = text.length;
    var pos = 0;
    while (pos < len) {
      var lt = text.indexOf('<', pos);
      if (lt === -1) {
        appendText(stack[stack.length - 1], text.slice(pos));
        break;
      }
      if (lt > pos) appendText(stack[stack.length - 1], text.slice(pos, lt));
      if (text.startsWith('<!--', lt)) {
        pos = skipUntil(text, '-->', lt + 4);
        continue;
      }
      if (text.startsWith('<![CDATA[', lt)) {
        var cdataEnd = text.indexOf(']]>', lt + 9);
        var stop = cdataEnd === -1 ? len : cdataEnd;
        stack[stack.length - 1].text += text.slice(lt + 9, stop);
        pos = cdataEnd === -1 ? len : cdataEnd + 3;
        continue;
      }
      if (text.startsWith('<?', lt)) {
        pos = skipUntil(text, '?>', lt + 2);
        continue;
      }
      if (text.startsWith('<!', lt)) {
        // DOCTYPE 等声明，跳过（不支持内部子集）
        pos = skipUntil(text, '>', lt + 2);
        continue;
      }
      var gt = findTagEnd(text, lt + 1);
      if (gt === -1) throw new Error('XML 标签未闭合');
      var body = text.slice(lt + 1, gt);
      pos = gt + 1;
      if (body.charAt(0) === '/') {
        closeElement(stack, body.slice(1).trim());
        continue;
      }
      var trimmed = body.replace(/\s+$/, '');
      if (trimmed.endsWith('/')) {
        var selfNode = parseStartTag(trimmed.slice(0, -1));
        stack[stack.length - 1].children.push(selfNode);
      } else {
        var node = parseStartTag(trimmed);
        stack[stack.length - 1].children.push(node);
        stack.push(node);
      }
    }
    return root;
  }

  function closeElement(stack, rawName) {
    var name = stripPrefix(rawName);
    for (var i = stack.length - 1; i > 0; i--) {
      if (stack[i].local === name) {
        stack.length = i;
        return;
      }
    }
  }

  function parseStartTag(content) {
    var nameEnd = 0;
    while (nameEnd < content.length && !/\s/.test(content.charAt(nameEnd))) {
      nameEnd++;
    }
    var rawName = content.slice(0, nameEnd);
    var node = {
      name: rawName,
      local: stripPrefix(rawName),
      attrs: {},
      children: [],
      text: '',
    };
    var i = nameEnd;
    while (i < content.length) {
      while (i < content.length && /\s/.test(content.charAt(i))) i++;
      if (i >= content.length) break;
      var eq = content.indexOf('=', i);
      if (eq === -1) break;
      var key = content.slice(i, eq).trim();
      var j = eq + 1;
      while (j < content.length && /\s/.test(content.charAt(j))) j++;
      var quote = content.charAt(j);
      if (quote === '"' || quote === "'") {
        var close = content.indexOf(quote, j + 1);
        if (close === -1) throw new Error('XML 属性引号未闭合');
        node.attrs[key] = decodeEntities(content.slice(j + 1, close));
        i = close + 1;
      } else {
        var valueEnd = j;
        while (valueEnd < content.length && !/\s/.test(content.charAt(valueEnd))) {
          valueEnd++;
        }
        node.attrs[key] = decodeEntities(content.slice(j, valueEnd));
        i = valueEnd;
      }
    }
    return node;
  }

  function findTagEnd(text, start) {
    var quote = '';
    for (var i = start; i < text.length; i++) {
      var ch = text.charAt(i);
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        return i;
      }
    }
    return -1;
  }

  function skipUntil(text, token, start) {
    var index = text.indexOf(token, start);
    return index === -1 ? text.length : index + token.length;
  }

  function stripPrefix(name) {
    var colon = name.indexOf(':');
    return colon === -1 ? name : name.slice(colon + 1);
  }

  function appendText(node, raw) {
    if (!raw) return;
    node.text += decodeEntities(raw);
  }

  function decodeEntities(text) {
    if (text.indexOf('&') === -1) return text;
    return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (match, body) {
      if (body.charAt(0) === '#') {
        var hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
        var code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
        try {
          return String.fromCodePoint(code);
        } catch (err) {
          return match;
        }
      }
      switch (body) {
        case 'amp': return '&';
        case 'lt': return '<';
        case 'gt': return '>';
        case 'quot': return '"';
        case 'apos': return "'";
        default: return match;
      }
    });
  }

  function firstElement(doc) {
    for (var i = 0; i < doc.children.length; i++) {
      if (doc.children[i].name) return doc.children[i];
    }
    throw new Error('XML 中没有任何元素');
  }

  function child(node, local) {
    for (var i = 0; i < node.children.length; i++) {
      if (node.children[i].local === local) return node.children[i];
    }
    return null;
  }

  function childrenOf(node, local) {
    return node.children.filter(function (item) { return item.local === local; });
  }

  /* ------------------------------------------------------------------ *
   * workbook 关系、共享字符串、样式
   * ------------------------------------------------------------------ */

  async function readWorkbookRels(zip) {
    var doc = await readXmlEntry(zip, 'xl/_rels/workbook.xml.rels');
    var map = new Map();
    if (!doc) return map;
    var root = firstElement(doc);
    for (var i = 0; i < root.children.length; i++) {
      var rel = root.children[i];
      if (rel.local !== 'Relationship') continue;
      if (rel.attrs.Id) map.set(rel.attrs.Id, resolveTarget(rel.attrs.Target));
    }
    return map;
  }

  function resolveTarget(target) {
    var path = String(target || '').replace(/\\/g, '/');
    if (!path) return '';
    if (path.charAt(0) === '/') {
      path = path.slice(1);
    } else if (!/^xl\//i.test(path)) {
      path = 'xl/' + path;
    }
    var parts = [];
    path.split('/').forEach(function (segment) {
      if (!segment || segment === '.') return;
      if (segment === '..') parts.pop();
      else parts.push(segment);
    });
    return parts.join('/');
  }

  async function readSharedStrings(zip) {
    var doc = await readXmlEntry(zip, 'xl/sharedStrings.xml');
    var list = [];
    if (!doc) return list;
    var root = firstElement(doc);
    for (var i = 0; i < root.children.length; i++) {
      var si = root.children[i];
      if (si.local === 'si') list.push(collectRichText(si));
    }
    return list;
  }

  // <si> 下可能是单个 <t>，也可能是若干 <r><t>富文本片段；<rPh> 是注音，丢弃。
  function collectRichText(node) {
    var text = '';
    for (var i = 0; i < node.children.length; i++) {
      var childNode = node.children[i];
      if (childNode.local === 't') {
        text += childNode.text;
      } else if (childNode.local === 'r') {
        var runs = childrenOf(childNode, 't');
        for (var j = 0; j < runs.length; j++) text += runs[j].text;
      }
    }
    return text;
  }

  async function readDateStyles(zip) {
    var doc = await readXmlEntry(zip, 'xl/styles.xml');
    if (!doc) return [];
    var root = firstElement(doc);
    var customFormats = new Map();
    var numFmts = child(root, 'numFmts');
    if (numFmts) {
      for (var i = 0; i < numFmts.children.length; i++) {
        var fmt = numFmts.children[i];
        if (fmt.local !== 'numFmt') continue;
        customFormats.set(Number(fmt.attrs.numFmtId), fmt.attrs.formatCode || '');
      }
    }
    var styles = [];
    var cellXfs = child(root, 'cellXfs');
    if (cellXfs) {
      for (var j = 0; j < cellXfs.children.length; j++) {
        var xf = cellXfs.children[j];
        if (xf.local !== 'xf') continue;
        styles.push(isDateFormat(Number(xf.attrs.numFmtId || 0), customFormats));
      }
    }
    return styles;
  }

  function isDateFormat(numFmtId, customFormats) {
    if (DATE_BUILTIN_IDS.indexOf(numFmtId) !== -1) return true;
    var code = customFormats.get(numFmtId);
    if (!code) return false;
    // 去掉引号字面量、转义字符、[颜色]/[条件] 等修饰，再找 y/m/d
    var cleaned = String(code)
      .replace(/"[^"]*"/g, '')
      .replace(/\\./g, '')
      .replace(/\[[^\]]*\]/g, '');
    return /[ymd]/i.test(cleaned);
  }

  /* ------------------------------------------------------------------ *
   * 工作表 → 字符串矩阵
   * ------------------------------------------------------------------ */

  function extractSheet(doc, context) {
    var root = firstElement(doc);
    var sheetData = child(root, 'sheetData');
    var rows = [];
    var truncated = false;
    if (!sheetData) return { rows: rows, truncated: truncated };

    for (var i = 0; i < sheetData.children.length; i++) {
      var rowNode = sheetData.children[i];
      if (rowNode.local !== 'row') continue;
      var cells = [];
      var highestCol = -1;
      var colCursor = -1;
      for (var j = 0; j < rowNode.children.length; j++) {
        var cell = rowNode.children[j];
        if (cell.local !== 'c') continue;
        var col = cell.attrs.r ? columnIndex(cell.attrs.r) : colCursor + 1;
        if (!Number.isInteger(col) || col < 0) col = colCursor + 1;
        colCursor = col;
        var value = cellText(cell, context);
        if (value !== '') {
          cells[col] = value;
          if (col > highestCol) highestCol = col;
        }
      }
      if (highestCol < 0) continue; // 整行空白：忽略
      if (rows.length >= context.maxRows) {
        truncated = true;
        break;
      }
      var line = new Array(highestCol + 1).fill('');
      for (var k = 0; k <= highestCol; k++) {
        if (typeof cells[k] === 'string') line[k] = cells[k];
      }
      rows.push(line);
    }
    return { rows: rows, truncated: truncated };
  }

  // "AB12" → 27（A=0），只取字母部分
  function columnIndex(ref) {
    var col = 0;
    var seen = false;
    for (var i = 0; i < ref.length; i++) {
      var code = ref.charCodeAt(i);
      var upper = code >= 97 && code <= 122 ? code - 32 : code;
      if (upper < 65 || upper > 90) break;
      col = col * 26 + (upper - 65 + 1);
      seen = true;
    }
    return seen ? col - 1 : -1;
  }

  function cellText(cell, context) {
    var type = cell.attrs.t || '';
    if (type === 'inlineStr') {
      var inline = child(cell, 'is');
      return inline ? collectRichText(inline) : '';
    }
    var valueNode = child(cell, 'v');
    var raw = valueNode ? valueNode.text : '';
    if (type === 's') {
      if (raw === '') return '';
      var index = parseInt(raw, 10);
      return context.sharedStrings[index] != null ? context.sharedStrings[index] : '';
    }
    if (type === 'str') return raw; // 公式的字符串缓存值
    if (type === 'e') return raw; // 错误码原文，如 #DIV/0!
    if (type === 'b') {
      if (raw === '') return '';
      return raw === '1' || /^true$/i.test(raw) ? 'TRUE' : 'FALSE';
    }
    if (type === 'd') return raw ? raw.slice(0, 10) : ''; // ISO 8601 日期
    if (raw.trim() === '') return '';

    var styleIndex = cell.attrs.s === undefined ? -1 : Number(cell.attrs.s);
    if (styleIndex >= 0 && context.dateStyles[styleIndex]) {
      var serial = Number(raw);
      if (Number.isFinite(serial)) return serialToDate(serial);
    }
    return numberToText(raw);
  }

  function numberToText(raw) {
    var text = raw.trim();
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return text;
    var value = Number(text);
    if (!Number.isFinite(value)) return text;
    if (Number.isInteger(value)) return String(value);
    var plain = String(value);
    return /e/i.test(plain) ? expandExponential(plain) : plain;
  }

  // 把 JS 的 1e-7 / 1e+21 这类字符串展开成普通十进制，避免导出后变科学计数法
  function expandExponential(text) {
    var negative = text.charAt(0) === '-';
    var body = negative ? text.slice(1) : text;
    var parts = body.split(/e/i);
    var mantissa = parts[0];
    var exponent = parseInt(parts[1], 10);
    var dot = mantissa.indexOf('.');
    var intPart = dot === -1 ? mantissa : mantissa.slice(0, dot);
    var fracPart = dot === -1 ? '' : mantissa.slice(dot + 1);
    var digits = intPart + fracPart;
    var point = intPart.length + exponent;
    var out;
    if (point <= 0) {
      out = '0.' + repeatZero(-point) + digits;
    } else if (point >= digits.length) {
      out = digits + repeatZero(point - digits.length);
    } else {
      out = digits.slice(0, point) + '.' + digits.slice(point);
    }
    out = out.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return negative ? '-' + out : out;
  }

  function repeatZero(count) {
    var out = '';
    for (var i = 0; i < count; i++) out += '0';
    return out;
  }

  // Excel 1900 日期系统：序列号 1 = 1900-01-01；
  // 它把 1900-02-29 当成存在（序列号 60），所以 61 之后要按 1899-12-30 起算。
  function serialToDate(serial) {
    var days = Math.floor(serial);
    if (days === 60) return '1900-02-29';
    var base = days >= 61
      ? Date.UTC(1899, 11, 30)
      : Date.UTC(1899, 11, 31);
    var date = new Date(base + days * 86400000);
    return formatDate(date);
  }

  function formatDate(date) {
    var year = String(date.getUTCFullYear());
    while (year.length < 4) year = '0' + year;
    var month = String(date.getUTCMonth() + 1);
    var day = String(date.getUTCDate());
    return year + '-' + (month.length < 2 ? '0' + month : month) +
      '-' + (day.length < 2 ? '0' + day : day);
  }

  /* ------------------------------------------------------------------ *
   * 导出
   * ------------------------------------------------------------------ */

  var api = { parseXlsx: parseXlsx };

  if (typeof window !== 'undefined') {
    window.XLSXReader = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
