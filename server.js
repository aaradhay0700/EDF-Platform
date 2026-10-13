'use strict';
// EDF platform: node server.js  ->  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const lib = require('./lib');
const { renderEdf } = require('./pdf');

const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data');
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const DEFAULT_EXPORTER = {
  legal_name: 'ABC Global Services Pvt. Ltd.',
  address: '5th Floor, Tech Park, Andheri (E), Mumbai – 400093',
  ie_code: '0512345678',
  gstin: '27AABCA1234F1Z5',
  pan: 'AABCA1234F',
  ad_code: '0510005',
  ad_name_address: 'XYZ Bank Ltd., Trade Finance Branch, Nariman Point, Mumbai – 400021',
  type_of_export: 'Service',
  shipping_bill_text: 'Not applicable (export of services)',
  transport_mode: 'internet',
  exporter_category: 'custom_dta',
  exporter_category_other: '',
  realisation_mode: 'others',
  realisation_note: 'SWIFT remittance',
  third_party_text: 'Not applicable – payments received directly from service recipients',
  third_party_relationship: 'Not applicable',
  lc_bg_ad_text: 'Not applicable',
  leo_text: 'Not applicable',
  port_of_loading_text: 'Not applicable',
  port_of_discharge_text: 'Not applicable',
  default_services_description: 'Accounting, bookkeeping, payroll & finance support services (SAC 998221 / 998222)',
  realisation_months: 9,
  signatory_label: 'Authorised Signatory',
  form_no_prefix: 'EDF',
};

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };
const writeJson = (f, o) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(o, null, 2));
const getExporter = () => ({ ...DEFAULT_EXPORTER, ...readJson('exporter.json', {}) });

function nextFormNo(prefix, period) {
  const fy = lib.fyOf(period.y, period.m);
  const mon = lib.MON[period.m - 1].toUpperCase();
  const c = readJson('counters.json', {});
  const key = fy + '|' + mon;
  c[key] = (c[key] || 0) + 1;
  writeJson('counters.json', c);
  return { form_no: `${prefix}/${fy}/${mon}/${String(c[key]).padStart(4, '0')}`, fy };
}

const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

function body(req) {
  return new Promise((res, rej) => {
    const ch = [];
    req.on('data', (c) => ch.push(c));
    req.on('end', () => res(Buffer.concat(ch)));
    req.on('error', rej);
  });
}
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

async function generate(payload) {
  const exporter = getExporter();
  const rows = lib.rowsFromClient(payload.rows);
  const bad = rows.filter((r) => r.errors.length);
  if (bad.length) throw new Error(`${bad.length} row(s) still have errors – fix them first.`);
  const selected = Array.isArray(payload.selected) ? new Set(payload.selected) : null;
  const valid = rows.filter((r) => !selected || selected.has(r.client_name));
  const groups = lib.groupEdfs(valid, !!payload.perInvoice);
  const results = [];
  const zip = new JSZip();
  for (const g of groups) {
    const { form_no, fy } = nextFormNo(exporter.form_no_prefix, g.period);
    const total = g.invoices.reduce((a, r) => a.plus(r.inr_value), new lib.Decimal(0));
    const decl = payload.declarationDate && /^\d{4}-\d\d-\d\d$/.test(payload.declarationDate)
      ? lib.fromIso(payload.declarationDate) : lib.lastDayOfMonth(g.period.y, g.period.m);
    const snapshot = {
      form_no, fy,
      exporter: { ...exporter, default_services_description: payload.description || exporter.default_services_description },
      client: { name: g.client_name, name_and_address: g.name_and_address, country: g.country },
      declaration_date: lib.fmtDate(decl),
      total_inr: total.toFixed(2),
      total_words: lib.rupeesInWords(total),
      invoices: g.invoices.map((r) => ({
        invoice_no: r.invoice_no, invoice_date: lib.fmtDate(r.invoice_date), currency: r.currency,
        invoice_amount: lib.fmtMoney(r.invoice_amount), net_realisable_value: lib.fmtMoney(r.net_realisable_value),
        contract_ref: r.contract_ref, service_description: r.service_description, sac_code: r.sac_code, remarks: r.remarks,
        name_and_address: r.name_and_address, country: r.country,
        exchange_rate: r.exchange_rate.toString(), inr_value: r.inr_value.toFixed(2),
      })),
    };
    const pdf = await renderEdf(snapshot);
    const file = `${form_no.replace(/\//g, '_')}__${slug(g.client_name)}.pdf`;
    fs.writeFileSync(path.join(OUT, file), pdf);
    zip.file(file, pdf);
    results.push({ file, form_no, client: g.client_name, country: g.country, invoices: g.invoices.length, total_inr: lib.fmtMoney(total), total_words: snapshot.total_words, pdf: pdf.toString('base64') });
  }
  const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
  return { results, zip: zipBuf.toString('base64') };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    }
    if (req.method === 'GET' && url.startsWith('/output/')) {
      const f = path.join(OUT, path.basename(decodeURIComponent(url)));
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': 'application/pdf' });
      return res.end(fs.readFileSync(f));
    }
    if (req.method === 'GET' && url === '/api/exporter') return send(res, 200, { exporter: getExporter(), defaults: DEFAULT_EXPORTER });
    if (req.method === 'PUT' && url === '/api/exporter') {
      const o = JSON.parse((await body(req)).toString('utf8'));
      writeJson('exporter.json', { ...getExporter(), ...o });
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url === '/api/reset-numbering') { writeJson('counters.json', {}); return send(res, 200, { ok: true }); }
    if (req.method === 'POST' && url === '/api/parse') {
      const buf = await body(req);
      const r = await lib.parseWorkbook(buf, decodeURIComponent(req.headers['x-filename'] || 'upload.xlsx'));
      return send(res, 200, { ...r, rows: r.rows.map(lib.toJSONRow) });
    }
    if (req.method === 'POST' && url === '/api/validate') {
      const o = JSON.parse((await body(req)).toString('utf8'));
      return send(res, 200, { rows: lib.rowsFromClient(o.rows).map(lib.toJSONRow) });
    }
    if (req.method === 'POST' && url === '/api/generate') {
      const o = JSON.parse((await body(req)).toString('utf8'));
      return send(res, 200, await generate(o));
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    console.error(e);
    send(res, 400, { error: e.message });
  }
});
server.listen(PORT, () => console.log(`EDF platform running at http://localhost:${PORT}`));
