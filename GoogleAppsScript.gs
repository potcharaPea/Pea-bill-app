/**
 * ============================================================
 *  Google Apps Script - PEA Bill App Backend
 *  คิดค่าใบบริการแก้ไฟ
 *
 *  วิธี Deploy:
 *  1) เปิด https://script.google.com/ → New Project
 *  2) วางโค้ดทั้งหมดนี้ลงในไฟล์ Code.gs (ลบโค้ดตัวอย่างก่อน)
 *  3) แก้ค่า CONFIG ด้านล่าง (API_KEY, ใส่ SHEET_ID ถ้ามี Sheet เดิม)
 *  4) เมนู Deploy → New deployment → ประเภท "Web app"
 *     - Execute as: Me
 *     - Who has access: Anyone (เพื่อให้ PWA เรียกได้)
 *  5) Copy URL ที่ได้ (จบด้วย /exec) → ใส่ในแอปที่หน้า "ตั้งค่า"
 *  6) ในแอปกดปุ่ม "ทดสอบ" — ถ้าขึ้น "เชื่อมต่อสำเร็จ" คือใช้งานได้
 *
 *  สิ่งที่สคริปต์นี้ทำ:
 *  - GET  ?action=ping            ตรวจการเชื่อมต่อ
 *  - GET  ?action=getItems        ดึงรายการอุปกรณ์ + ราคาจาก Sheet
 *  - GET  ?action=getHistory      ดึงประวัติใบบริการ
 *  - POST {action:"saveBill"}     บันทึกใบบริการลง Sheet
 *  - POST {action:"updatePrice"}  อัปเดตราคาอุปกรณ์ (admin)
 * ============================================================ */

// -------- CONFIG --------
const CONFIG = {
  API_KEY: 'CHANGE_ME_TO_A_RANDOM_STRING',   // ตั้งค่าให้เหมือนกับในแอป (ที่หน้า "ตั้งค่า")
  SHEET_ID: '',                              // เว้นว่างไว้ = สร้าง Spreadsheet ใหม่อัตโนมัติครั้งแรกที่รัน
  SHEET_NAME_ITEMS: 'Items',
  SHEET_NAME_BILLS: 'Bills',
  SHEET_NAME_BILL_ITEMS: 'BillItems',
  TIMEZONE: 'Asia/Bangkok'
};

// =============== Entry points ===============

function doGet(e) {
  return handle(e, 'GET');
}

function doPost(e) {
  return handle(e, 'POST');
}

function handle(e, method) {
  try {
    const params = (method === 'GET') ? (e.parameter || {}) : parseBody(e);
    const action = params.action || '';

    // API key check (allow ping without key for first-time test)
    if (action !== 'ping') {
      if (!CONFIG.API_KEY || CONFIG.API_KEY === 'CHANGE_ME_TO_A_RANDOM_STRING') {
        return reply({ ok: false, error: 'Server not configured: please set CONFIG.API_KEY in Apps Script.' });
      }
      if (params.apiKey !== CONFIG.API_KEY) {
        return reply({ ok: false, error: 'Invalid API key' });
      }
    }

    switch (action) {
      case 'ping':        return reply({ ok: true, message: 'PEA Bill API alive', timestamp: new Date().toISOString() });
      case 'getItems':    return reply({ ok: true, items: getItems() });
      case 'getHistory':  return reply({ ok: true, bills: getHistory(params.limit ? parseInt(params.limit, 10) : 100) });
      case 'saveBill':    return reply({ ok: true, id: saveBill(params.bill) });
      case 'updatePrice': return reply({ ok: true, updated: updatePrice(params.code, params.fields) });
      default:            return reply({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function parseBody(e) {
  if (!e || !e.postData) return {};
  try { return JSON.parse(e.postData.contents || '{}'); }
  catch (err) { return {}; }
}

function reply(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============== Spreadsheet helpers ===============

function getSpreadsheet() {
  if (CONFIG.SHEET_ID) {
    return SpreadsheetApp.openById(CONFIG.SHEET_ID);
  }
  // No SHEET_ID provided — create one in My Drive and remember it via PropertiesService
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* recreate below */ }
  }
  const ss = SpreadsheetApp.create('ใบบริการแก้ไฟ - Database');
  props.setProperty('SHEET_ID', ss.getId());
  initSheets(ss);
  return ss;
}

function initSheets(ss) {
  // Items
  let s = ss.getSheetByName(CONFIG.SHEET_NAME_ITEMS) || ss.insertSheet(CONFIG.SHEET_NAME_ITEMS);
  if (s.getLastRow() === 0) {
    s.appendRow(['code', 'name', 'unit', 'category', 'std_price', 'user_price', 'pre_tax', 'frequent']);
    s.setFrozenRows(1);
    s.getRange('A1:H1').setFontWeight('bold').setBackground('#1f8a4c').setFontColor('#ffffff');
  }

  // Bills (header)
  s = ss.getSheetByName(CONFIG.SHEET_NAME_BILLS) || ss.insertSheet(CONFIG.SHEET_NAME_BILLS);
  if (s.getLastRow() === 0) {
    s.appendRow(['id', 'created_at', 'customer', 'location', 'note', 'total', 'item_count', 'created_by']);
    s.setFrozenRows(1);
    s.getRange('A1:H1').setFontWeight('bold').setBackground('#1f8a4c').setFontColor('#ffffff');
  }

  // Bill items (line items)
  s = ss.getSheetByName(CONFIG.SHEET_NAME_BILL_ITEMS) || ss.insertSheet(CONFIG.SHEET_NAME_BILL_ITEMS);
  if (s.getLastRow() === 0) {
    s.appendRow(['bill_id', 'code', 'name', 'unit', 'qty', 'user_price', 'line_total', 'pre_tax_each', 'category']);
    s.setFrozenRows(1);
    s.getRange('A1:I1').setFontWeight('bold').setBackground('#1f8a4c').setFontColor('#ffffff');
  }
}

function sheet(name) {
  const ss = getSpreadsheet();
  initSheets(ss);
  return ss.getSheetByName(name);
}

// =============== Items ===============

function getItems() {
  const s = sheet(CONFIG.SHEET_NAME_ITEMS);
  const data = s.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function updatePrice(code, fields) {
  if (!code) throw new Error('code required');
  const s = sheet(CONFIG.SHEET_NAME_ITEMS);
  const data = s.getDataRange().getValues();
  const headers = data[0];
  const codeIdx = headers.indexOf('code');
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][codeIdx]) === String(code)) {
      Object.keys(fields || {}).forEach(k => {
        const ci = headers.indexOf(k);
        if (ci >= 0) s.getRange(r + 1, ci + 1).setValue(fields[k]);
      });
      return true;
    }
  }
  // Not found → append new row
  const newRow = headers.map(h => fields && fields[h] !== undefined ? fields[h] : (h === 'code' ? code : ''));
  s.appendRow(newRow);
  return true;
}

// =============== Bills ===============

function saveBill(bill) {
  if (!bill || !bill.id) throw new Error('bill or bill.id required');
  const ss = getSpreadsheet();
  const sBills = ss.getSheetByName(CONFIG.SHEET_NAME_BILLS);
  const sLines = ss.getSheetByName(CONFIG.SHEET_NAME_BILL_ITEMS);

  // Avoid duplicates: if id already exists, skip header insert (still re-insert lines? — be conservative: skip entirely)
  const ids = sBills.getRange(2, 1, Math.max(0, sBills.getLastRow() - 1), 1).getValues().flat();
  if (ids.includes(bill.id)) return bill.id;

  const createdAt = bill.created_at || new Date().toISOString();
  sBills.appendRow([
    bill.id,
    createdAt,
    bill.customer || '',
    bill.location || '',
    bill.note || '',
    bill.total || 0,
    (bill.items || []).length,
    Session.getActiveUser().getEmail() || ''
  ]);

  const rows = (bill.items || []).map(it => [
    bill.id,
    it.code || '',
    it.name || '',
    it.unit || '',
    it.qty || 0,
    it.user_price || 0,
    (it.user_price || 0) * (it.qty || 0),
    it.pre_tax || 0,
    it.category || ''
  ]);
  if (rows.length > 0) {
    sLines.getRange(sLines.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }

  return bill.id;
}

function getHistory(limit) {
  limit = limit || 100;
  const ss = getSpreadsheet();
  const sBills = ss.getSheetByName(CONFIG.SHEET_NAME_BILLS);
  const sLines = ss.getSheetByName(CONFIG.SHEET_NAME_BILL_ITEMS);
  const billsData = sBills.getDataRange().getValues();
  const linesData = sLines.getDataRange().getValues();

  if (billsData.length < 2) return [];

  const billHeaders = billsData[0];
  const lineHeaders = linesData[0];

  // Group lines by bill_id
  const linesByBill = {};
  for (let r = 1; r < linesData.length; r++) {
    const obj = {};
    lineHeaders.forEach((h, i) => obj[h] = linesData[r][i]);
    const bid = obj.bill_id;
    if (!linesByBill[bid]) linesByBill[bid] = [];
    linesByBill[bid].push(obj);
  }

  // Build bill objects (newest first)
  const bills = billsData.slice(1).map(row => {
    const obj = {};
    billHeaders.forEach((h, i) => obj[h] = row[i]);
    obj.items = linesByBill[obj.id] || [];
    return obj;
  }).reverse().slice(0, limit);

  return bills;
}

// =============== Manual helper functions (run from editor) ===============

/**
 * รันฟังก์ชันนี้ครั้งแรกเพื่อสร้าง Spreadsheet + Sheets
 * แล้วเปิด Drive → ดูชื่อ "ใบบริการแก้ไฟ - Database"
 */
function setup() {
  const ss = getSpreadsheet();
  Logger.log('Spreadsheet ID: ' + ss.getId());
  Logger.log('URL: ' + ss.getUrl());
}

/**
 * Import รายการอุปกรณ์จาก JSON (วาง JSON ลงในตัวแปร data ก่อนรัน)
 * วิธีใช้: ดับเบิลคลิกฟังก์ชันนี้ใน editor → Run
 */
function importItemsFromJson() {
  const jsonText = '[]'; // ← วาง JSON จากไฟล์ items.json ลงตรงนี้ (ครอบด้วย ' )
  const items = JSON.parse(jsonText);
  const s = sheet(CONFIG.SHEET_NAME_ITEMS);
  s.getRange(2, 1, Math.max(0, s.getLastRow() - 1), 8).clearContent();
  const rows = items.map(it => [
    it.code, it.name, it.unit, it.category,
    it.std_price, it.user_price, it.pre_tax, it.frequent ? 'Y' : ''
  ]);
  if (rows.length > 0) {
    s.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
  Logger.log('Imported ' + rows.length + ' items');
}
