(function () {
'use strict';
// Parsing, validation, money/date/words helpers for the EDF platform .
const isNode = typeof window === 'undefined';
const ExcelJS = isNode ? require('exceljs') : window.ExcelJS;
const Decimal = isNode ? require('decimal.js') : window.Decimal;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

const ALIASES = {
  name_and_address: ['servicerecipientnameaddress', 'clientnameaddress', 'clientrecipient', 'servicerecipient'],
  client_name: ['clientname'],
  client_address: ['clientaddress'],
  country: ['country'],
  invoice_no: ['invoiceno', 'invoicenumber', 'invno'],
  invoice_date: ['invoicedate', 'invdate'],
  currency: ['currency', 'invoicecurrency'],
  invoice_amount: ['invoiceamount'],
  net_realisable_value: ['netrealisablevalue', 'netrealizablevalue', 'nrv'],
  exchange_rate: ['exchrateinr', 'exchangerate', 'fxrate', 'exchrate'],
  contract_ref: ['contractnoifanyanddate', 'contractno', 'contractref'],
  service_description: ['descriptionofservices', 'description'],
  sac_code: ['saccode', 'sac', 'hsnsac'],
  remarks: ['remarks'],
};
const REQUIRED = ['country', 'invoice_no', 'invoice_date', 'currency', 'invoice_amount', 'exchange_rate', 'service_description', 'sac_code'];

// ---------- cell helpers ----------
function cellVal(c) {
  let v = c && c.value !== undefined ? c.value : c;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) v = v.result;
    else if (v.richText) v = v.richText.map((t) => t.text).join('');
    else if (v.text !== undefined) v = v.text;
  }
  return v == null ? '' : v;
}

function parseDecimal(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return new Decimal(v.toPrecision(15)); // kills 1048124.9999999999 style artefacts
  const s = String(v).replace(/[,\s₹$€£]/g, '').replace(/^[A-Za-z]{3}(?=[\d.])/, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  return new Decimal(s);
}

function parseDate(v) {
  if (v === '' || v == null) return null;
  if (v instanceof Date) return isNaN(v) ? undefined : { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, d: v.getUTCDate() };
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; }
  const s = clean(v);
  let m = s.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[a-z]*[-\/ ,]*(\d{2,4})$/);
  if (m) { const mi = MON.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()); if (mi < 0) return undefined; return mk(+m[3], mi + 1, +m[1]); }
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/); // day-first
  if (m) return mk(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return mk(+m[1], +m[2], +m[3]);
  return undefined;
}
function mk(y, m, d) {
  if (y < 100) y += 2000;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return undefined;
  return { y, m, d };
}
const fmtDate = (d) => `${String(d.d).padStart(2, '0')}-${MON[d.m - 1]}-${d.y}`;
const isoDate = (d) => `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
const lastDayOfMonth = (y, m) => ({ y, m, d: new Date(Date.UTC(y, m, 0)).getUTCDate() });

// ---------- number formatting ----------
function fmtMoney(x) { // #,##0.00 (western grouping, as on the form)
  const [i, f] = new Decimal(x).toFixed(2).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + f;
}
function fmtIndian(n) { // 38,35,545
  const s = String(n);
  if (s.length <= 3) return s;
  return s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
}
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below100(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''); }
function below1000(n) { return (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + below100(n % 100); }
function indianWords(n) {
  n = Math.round(Number(n));
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(indianWords(crore) + ' Crore');
  if (lakh) parts.push(below100(lakh) + ' Lakh');
  if (th) parts.push(below100(th) + ' Thousand');
  if (n) parts.push(below1000(n));
  return parts.join(' ');
}
function rupeesInWords(dec) {
  const n = new Decimal(dec).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return `Rupees ${indianWords(n)} only (INR ${fmtIndian(n)})`;
}
function fyOf(y, m) { const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; }

// ---------- workbook parsing ----------
async function parseWorkbook(buffer, filename) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  let best = null;
  for (const ws of wb.worksheets) {
    const max = Math.min(ws.rowCount, 50);
    for (let r = 1; r <= max; r++) {
      const row = ws.getRow(r);
      const map = {};
      let hits = 0;
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        const k = norm(cellVal(cell));
        if (!k) return;
        for (const [field, al] of Object.entries(ALIASES)) {
          if (!(field in map) && al.includes(k)) { map[field] = col; hits++; break; }
        }
      });
      if (!best || hits > best.hits) best = { ws, row: r, map, hits };
    }
  }
  if (!best || best.hits < 6) throw new Error('Could not find the invoice table header row (need at least 6 known column names such as Invoice No., Invoice Date, Currency, Invoice Amount).');
  const { ws, map } = best;
  if (!map.name_and_address && !(map.client_name)) map.name_and_address = undefined;
  const missing = REQUIRED.filter((f) => !map[f]);
  if (!map.name_and_address && !map.client_name) missing.push('name_and_address');
  if (missing.length) throw new Error('Missing required columns: ' + missing.join(', '));

  const rows = [];
  let blanks = 0;
  const firstCol = Math.min(...Object.values(map).filter(Boolean));
  for (let r = best.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const g = (f) => (map[f] ? cellVal(row.getCell(map[f])) : '');
    const first = clean(cellVal(row.getCell(1)));
    const firstData = clean(cellVal(row.getCell(firstCol)));
    if (/^total/i.test(first) || /^total/i.test(firstData)) break;
    const hasData = Object.values(map).some((c) => c && clean(cellVal(row.getCell(c))) !== '');
    if (!hasData) { if (++blanks >= 3) break; continue; }
    blanks = 0;
    let nameAddr = clean(g('name_and_address'));
    if (!nameAddr) nameAddr = [clean(g('client_name')), clean(g('client_address'))].filter(Boolean).join(', ');
    rows.push({
      src_row: r,
      name_and_address: nameAddr,
      country: clean(g('country')),
      invoice_no: clean(g('invoice_no')),
      invoice_date: g('invoice_date'),
      currency: clean(g('currency')).toUpperCase(),
      invoice_amount: g('invoice_amount'),
      net_realisable_value: g('net_realisable_value'),
      exchange_rate: g('exchange_rate'),
      contract_ref: clean(g('contract_ref')),
      service_description: clean(g('service_description')),
      sac_code: clean(g('sac_code')),
      remarks: clean(g('remarks')),
    });
  }
  if (!rows.length) throw new Error('No invoice rows found under the header row.');
  return { filename, sheet: ws.name, header_row: best.row, rows: validateRows(rows) };
}

// Normalise + validate. Input rows may come from the editable review table (strings).
function validateRows(rows) {
  const seen = new Map();
  const lastRate = {};
  const out = rows.map((r, i) => {
    const errors = [], warnings = [];
    const o = { ...r, idx: i };
    o.name_and_address = clean(r.name_and_address);
    o.country = clean(r.country);
    o.invoice_no = clean(r.invoice_no);
    o.currency = clean(r.currency).toUpperCase();
    o.service_description = clean(r.service_description);
    o.sac_code = clean(r.sac_code);
    o.contract_ref = clean(r.contract_ref);
    o.remarks = clean(r.remarks);
    if (!o.name_and_address) errors.push('Missing client name & address');
    if (!o.country) errors.push('Missing country');
    if (!o.invoice_no) errors.push('Missing invoice no.');
    else if (seen.has(o.invoice_no)) errors.push(`Duplicate invoice no. (also row ${seen.get(o.invoice_no) + 1})`);
    else seen.set(o.invoice_no, i);
    if (!/^[A-Z]{3}$/.test(o.currency)) errors.push('Currency must be 3 letters');
    if (!o.service_description) errors.push('Missing description of services');
    if (!/^\d{6}$/.test(o.sac_code)) errors.push('SAC must be 6 digits');

    let d = typeof r.invoice_date === 'object' && r.invoice_date && 'y' in r.invoice_date ? r.invoice_date : parseDate(r.invoice_date);
    if (d === null) errors.push('Missing invoice date'); else if (d === undefined) errors.push('Invalid invoice date');
    o.invoice_date = d || null;
    const amt = parseDecimal(r.invoice_amount);
    if (amt == null) errors.push('Missing invoice amount'); else if (amt === undefined || amt.lte(0)) errors.push('Invoice amount must be a number > 0');
    let nrv = parseDecimal(r.net_realisable_value);
    if (nrv == null) nrv = amt && amt !== undefined ? amt : null;
    else if (nrv === undefined || nrv.lt(0)) errors.push('Net realisable value must be a number ≥ 0');
    const fx = parseDecimal(r.exchange_rate);
    if (fx == null) errors.push('Missing exchange rate'); else if (fx === undefined || fx.lte(0)) errors.push('Exchange rate must be a number > 0');
    o.invoice_amount = amt || null; o.net_realisable_value = nrv || null; o.exchange_rate = fx || null;
    if (amt && nrv && amt.gt && nrv.gt && nrv.gt(amt)) errors.push('Net realisable value exceeds invoice amount');
    if (amt && nrv && amt.gt && nrv.lt && nrv.lt(amt)) warnings.push(`Net realisable is ${amt.minus(nrv).toFixed(2)} less than invoice amount – check remarks`);
    if (fx && fx.gt && lastRate[o.currency] && fx.minus(lastRate[o.currency]).abs().div(lastRate[o.currency]).gt(0.1)) warnings.push('Exchange rate differs by >10% from previous ' + o.currency + ' invoice');
    if (fx && fx.gt) lastRate[o.currency] = fx;
    if (d && d.y) { const age = (Date.now() - Date.UTC(d.y, d.m - 1, d.d)) / 86400000; if (age > 366) warnings.push('Invoice date is more than 12 months old'); }
    o.inr_value = nrv && fx && nrv.mul && fx.gt ? nrv.mul(fx) : null;
    o.client_name = o.name_and_address.split(',')[0].trim();
    o.errors = errors; o.warnings = warnings;
    return o;
  });
  return out;
}

const toJSONRow = (o) => ({
  ...o,
  invoice_date: o.invoice_date ? isoDate(o.invoice_date) : null,
  invoice_amount: o.invoice_amount ? o.invoice_amount.toFixed(2) : '',
  net_realisable_value: o.net_realisable_value ? o.net_realisable_value.toFixed(2) : '',
  exchange_rate: o.exchange_rate ? o.exchange_rate.toString() : '',
  inr_value: o.inr_value ? o.inr_value.toFixed(2) : '',
});

// Rebuild rows posted back from the browser.
function rowsFromClient(rows) {
  return validateRows(rows.map((r) => ({ ...r, invoice_date: r.invoice_date && /^\d{4}-/.test(r.invoice_date) ? fromIso(r.invoice_date) : r.invoice_date })));
}

// ---------- grouping into EDFs ----------
function groupEdfs(valid, perInvoice) {
  const groups = new Map();
  for (const r of valid) {
    const key = (perInvoice ? r.invoice_no : '') + '|' + r.client_name.toLowerCase() + '|' + r.country.toLowerCase() + '|' + r.invoice_date.y + '-' + r.invoice_date.m;
    if (!groups.has(key)) groups.set(key, { client_name: r.client_name, name_and_address: r.name_and_address, country: r.country, period: { y: r.invoice_date.y, m: r.invoice_date.m }, invoices: [] });
    groups.get(key).invoices.push(r);
  }
  const list = [...groups.values()];
  for (const g of list) g.invoices.sort((a, b) => isoDate(a.invoice_date).localeCompare(isoDate(b.invoice_date)) || a.invoice_no.localeCompare(b.invoice_no));
  list.sort((a, b) => (a.period.y * 12 + a.period.m) - (b.period.y * 12 + b.period.m) || a.client_name.localeCompare(b.client_name));
  return list;
}

const api = { parseWorkbook, validateRows, rowsFromClient, toJSONRow, groupEdfs, fmtMoney, fmtDate, isoDate, fromIso, lastDayOfMonth, rupeesInWords, indianWords, fmtIndian, fyOf, MON, clean, Decimal };
if (isNode) module.exports = api; else window.EdfLib = api;
})();
