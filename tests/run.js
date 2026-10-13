// Checks the sample file against the fixtures in EDF_PLATFORM_SPEC.md section 12, and renders PDFs. Run: npm test
const fs = require('fs'), path = require('path'), assert = require('assert');
const L = require('../public/js/lib.js');
const { renderEdf } = require('../public/js/pdf.js');

(async () => {
  assert.strictEqual(L.indianWords(123456789), 'Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine');
  assert.strictEqual(L.indianWords(100000), 'One Lakh');
  assert.strictEqual(L.indianWords(10000000), 'One Crore');
  assert.strictEqual(L.fyOf(2026, 10), '2026-27'); assert.strictEqual(L.fyOf(2027, 3), '2026-27'); assert.strictEqual(L.fyOf(2027, 4), '2027-28');
  assert.strictEqual(new L.Decimal('12500').mul('83.85').toString(), '1048125');

  const r = await L.parseWorkbook(fs.readFileSync(path.join(__dirname, '..', 'samples', 'Dummy_Sales_Data.xlsx')), 'sample.xlsx');
  assert.strictEqual(r.header_row, 20); assert.strictEqual(r.rows.length, 5);
  assert(r.rows.every((x) => !x.errors.length), 'no errors');
  assert.strictEqual(r.rows[2].warnings.length, 1, 'Rhein warning');
  assert.strictEqual(r.rows[0].sac_code, '998222');
  const want = ['1048125.00', '750720.00', '874800.00', '826500.00', '335400.00'];
  r.rows.forEach((x, i) => assert.strictEqual(x.inr_value.toFixed(2), want[i]));
  const total = r.rows.reduce((a, x) => a.plus(x.inr_value), new L.Decimal(0));
  assert.strictEqual(L.rupeesInWords(total), 'Rupees Thirty Eight Lakh Thirty Five Thousand Five Hundred Forty Five only (INR 38,35,545)');
  assert.strictEqual(L.groupEdfs(r.rows, false).length, 5);
  assert.strictEqual(L.fmtDate(r.rows[0].invoice_date), '05-Oct-2026');

  for (const g of L.groupEdfs(r.rows, false)) {
    const t = g.invoices.reduce((a, x) => a.plus(x.inr_value), new L.Decimal(0));
    const snap = { form_no: 'EDF/TEST/0001', exporter: { legal_name: 'T', address: 'A', ie_code: '1', gstin: '', pan: '', ad_code: '1', ad_name_address: 'B', type_of_export: 'Service', shipping_bill_text: 'NA', transport_mode: 'internet', exporter_category: 'custom_dta', realisation_mode: 'others', realisation_note: 'x', third_party_text: 'NA', third_party_relationship: 'NA', lc_bg_ad_text: 'NA', leo_text: 'NA', port_of_loading_text: 'NA', port_of_discharge_text: 'NA', default_services_description: 'd', realisation_months: 9, signatory_label: 'S' },
      client: { name: g.client_name, name_and_address: g.name_and_address, country: g.country }, declaration_date: '31-Oct-2026', total_words: L.rupeesInWords(t),
      invoices: g.invoices.map((x) => ({ invoice_no: x.invoice_no, invoice_date: L.fmtDate(x.invoice_date), currency: x.currency, invoice_amount: L.fmtMoney(x.invoice_amount), net_realisable_value: L.fmtMoney(x.net_realisable_value), contract_ref: x.contract_ref, service_description: x.service_description, sac_code: x.sac_code, remarks: x.remarks, name_and_address: x.name_and_address, country: x.country })) };
    const pdf = await renderEdf(snap);
    assert(pdf.slice(0, 4).toString() === '%PDF', 'pdf header');
  }
  console.log('All checks passed: parsing, INR values, amounts in words, grouping, 5 PDFs rendered.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
