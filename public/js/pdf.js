(function () {
'use strict';
const isNode = typeof window === 'undefined';
// Renders one EDF (from a snapshot object) to a PDF buffer. All fixed wording lives in T below.
const PDFDocument = isNode ? require('pdfkit') : window.PDFDocument;
const fs = isNode ? require('fs') : null;
const path = isNode ? require('path') : null;

const T = {
  annex: 'Annex',
  title: 'Export Declaration Form',
  s1: '1. General Information:',
  s2b: '2B. Details of Export Value^ of Services',
  s2bSub: 'Details of services provided to multiple recipients',
  s3: '3. Applicable for Export under FPO/Couriers',
  s4: '4. Declaration by the Exporters (All types of exports)',
  s5: '5. Space for use of Specified Authority (Custom/SEZ/AD/STPI):',
  declaration: (m) => `I/We hereby declare that I/We am/are the provider of services in respect of which this declaration is made and that the particulars given above are true and that the value to be received from the buyer/third party represents the export value contracted and declared above. I/We undertake that I/We will deliver to the authorised dealer named above the foreign exchange representing the full value of the services exported as above within ${m} months from the respective invoice dates (i.e. within the period of realisation stipulated by RBI from time to time) in the manner specified in the Regulations made under the Foreign Exchange Management Act, 1999. I/We also undertake to submit the documents pertaining to exports declared in this form, to the Authorised Dealer named above, as may be required under the Act.`,
  certified: 'Certified, on the basis of above declaration at 4, that the services described above and the export value^ declared by the exporter in this form is as per the corresponding invoice/gist of invoices submitted and declared by the exporter.',
  authSig: '(Signature of Designated/Authorised officials of Custom/SEZ/Authorised Dealer/STPI)',
  foot2: '^ Export value is the net realisable value of the services, in the currency of invoice, as declared by the exporter.',
  foot3: 'Note: Section 2A (goods) is not applicable for export of services.',
  transport: [['air', 'Air'], ['land', 'Land'], ['sea', 'Sea'], ['post_courier', 'Post/Couriers'], ['internet', 'Internet'], ['others', 'others']],
  category: [['custom_dta', 'Custom (DTA units)'], ['sez', 'SEZ'], ['eou_100', '100% EOU'], ['warehouse', 'Warehouse export'], ['others', 'others (Specify)']],
  realisation: [['lc', 'L/C'], ['bg', 'BG'], ['others', 'Others (advance payment, etc. including transfer/remittance to bank a/c maintained overseas)']],
};

function fontPaths() {
  if (!isNode) return ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique'];
  const cands = [
    [path.join(__dirname, 'fonts', 'LiberationSans-Regular.ttf'), path.join(__dirname, 'fonts', 'LiberationSans-Bold.ttf'), path.join(__dirname, 'fonts', 'LiberationSans-Italic.ttf')],
    ['C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/ariali.ttf'],
    ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf'],
  ];
  return cands.find((c) => c.every(fs.existsSync)) || ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique'];
}

const checks = (list, sel, extra) =>
  list.map(([k, l]) => `[${k === sel ? 'X' : ' '}] ${l}${k === sel && extra ? ' – ' + extra : ''}`).join('   ');

function renderEdf(s) {
  return new Promise((resolve, reject) => {
    const [R, B, I] = fontPaths();
    const doc = new PDFDocument({
      size: 'A4', margins: { top: 36, bottom: 50, left: 36, right: 36 }, bufferPages: true,
      info: { Title: `EDF ${s.form_no} – ${s.client.name}`, Author: s.exporter.legal_name },
    });
    const bufs = [];
    doc.on('data', (b) => bufs.push(b));
    doc.on('end', () => resolve(isNode ? Buffer.concat(bufs) : new Blob(bufs, { type: 'application/pdf' })));
    doc.on('error', reject);
    doc.registerFont('R', R); doc.registerFont('B', B); doc.registerFont('I', I);

    const L = 36, W = 523.28, BOTTOM = 841.89 - 50, PAD = 4, FS = 8.5;
    const ex = s.exporter;
    let y = 36;
    doc.lineWidth(0.75).strokeColor('#000');

    const need = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = 36; return true; } return false; };

    // runs: array of paragraphs; paragraph = array of [text, bold]
    const measure = (paras, w, fs) => {
      doc.font('B').fontSize(fs);
      return paras.reduce((h, p) => h + doc.heightOfString(p.map((r) => r[0]).join(''), { width: w - 2 * PAD }) + 2, 0);
    };
    const paint = (paras, x, top, w, fs, align) => {
      let ty = top + PAD;
      for (const p of paras) {
        doc.fontSize(fs);
        p.forEach((run, i) => {
          doc.font(run[1] === 'i' ? 'I' : run[1] ? 'B' : 'R').text(run[0], i === 0 ? x + PAD : undefined, i === 0 ? ty : undefined, { width: w - 2 * PAD, continued: i < p.length - 1, align: align || 'left', lineBreak: true });
        });
        ty = doc.y + 2;
      }
    };
    // Draws a row of cells [{w(fraction), p: paras, span}], returns height. Optionally only measures.
    const row = (cells, opts = {}) => {
      const fs = opts.fs || FS;
      const ws = cells.map((c) => c.w * W);
      let h = Math.max(opts.minH || 0, ...cells.map((c, i) => measure(c.p || [[['', false]]], ws[i], fs) + 2 * PAD - 2));
      need(h);
      let x = L;
      cells.forEach((c, i) => {
        doc.rect(x, y, ws[i], h).stroke();
        if (c.p) paint(c.p, x, y, ws[i], fs, c.align);
        x += ws[i];
      });
      y += h;
      return h;
    };
    const P = (label, value, bold) => [[label ? [label + ' ', true] : null, [value, bold || false]].filter(Boolean)];

    // ---- header ----
    doc.font('B').fontSize(10).text(T.annex, L, y, { width: W, align: 'right' });
    doc.fontSize(12).text(T.title, L, y + 14, { width: W, align: 'center' });
    y += 36;

    // ---- section 1 ----
    row([{ w: 1, p: [[[T.s1, true]]] }]);
    const c1 = 0.55, c2 = 0.45;
    row([{ w: c1, p: P('Type of export :', ex.type_of_export) }, { w: c2, p: P('Form No:', s.form_no) }]);
    row([{ w: c1, p: P('Shipping Bill No. & Date:', ex.shipping_bill_text) }, { w: c2, p: P('Mode of Transport/Delivery:', checks(T.transport, ex.transport_mode)) }]);
    row([{ w: c1, p: P('Category of Exporter:', checks(T.category, ex.exporter_category, ex.exporter_category === 'others' ? ex.exporter_category_other : '')) }, { w: c2, p: P('AD code:', ex.ad_code) }]);
    row([{ w: c1, p: [...P('IE Code:', ex.ie_code), ...P('GSTIN:', ex.gstin || ''), ...P('PAN:', ex.pan || '')] }, { w: c2, p: P('AD Name & Address:', ex.ad_name_address) }]);
    row([{ w: c1, p: P('Exporters Name & Address:', `${ex.legal_name}, ${ex.address}`) }, { w: c2, p: P('Mode of Realisation:', checks(T.realisation, ex.realisation_mode, ex.realisation_note)) }]);
    row([{ w: c1, p: P('Consignee Name & Address:', s.client.name_and_address) }, { w: c2, p: P('Port of Loading / Source Port in case of SEZ:', ex.port_of_loading_text) }]);
    row([
      { w: c1, p: [...P('Third Party name & Address (In case of third Party Payments for Exports):', ex.third_party_text), ...P('Relationship between Exporter & Third Party:', ex.third_party_relationship)] },
      { w: c2 / 2, p: P('Country of Final Destination:', s.client.country) }, { w: c2 / 2, p: P('Port of Discharge:', ex.port_of_discharge_text) },
    ]);
    row([
      { w: c1, p: [...P('Name of the AD and AD code, in case of LC/BG:', ex.lc_bg_ad_text), ...P('Description of Goods/Services:', ex.default_services_description)] },
      { w: c2, p: P('Date of Let Export order (LEO):', ex.leo_text) },
    ]);
    row([{ w: 1, p: P('Total FOB/Services value in words (INR):', s.total_words, false) }]);

    // ---- section 2B ----
    need(120);
    row([{ w: 1, p: [[[T.s2b, true]]] }]);
    row([{ w: 1, p: [[[T.s2bSub, false]]] }]);

    const cw = [4, 18, 8, 10, 8, 6, 8, 9, 10, 11, 5, 8];
    const tot = cw.reduce((a, b) => a + b, 0);
    const X = cw.map((c) => (c / tot) * W);
    const FT = 7.5;
    const heads = ['S. No.', 'Service recipient Name & Address', 'Country', 'Invoice No.', 'Invoice Date', 'Currency', 'Invoice Amount', 'Net Realisable value', 'Contract No., if any, and Date', 'Description of services', 'SAC Code', 'Remarks'];
    const header = () => {
      const h1 = 14, h2 = 24, hh = h1 + h2;
      need(hh + 40);
      let x = L;
      doc.font('B').fontSize(FT);
      heads.forEach((t, i) => {
        if (i >= 3 && i <= 6) {
          if (i === 3) {
            const wsum = X[3] + X[4] + X[5] + X[6];
            doc.rect(x, y, wsum, h1).stroke();
            doc.text('Details of Invoice', x, y + 3, { width: wsum, align: 'center' });
          }
          doc.rect(x, y + h1, X[i], h2).stroke();
          doc.text(t, x + 2, y + h1 + 3, { width: X[i] - 4, align: 'center' });
        } else {
          doc.rect(x, y, X[i], hh).stroke();
          doc.text(t, x + 2, y + 3, { width: X[i] - 4, align: 'center' });
        }
        x += X[i];
      });
      y += hh;
    };
    header();
    s.invoices.forEach((inv, n) => {
      const vals = [String(n + 1), inv.name_and_address, inv.country, inv.invoice_no, inv.invoice_date, inv.currency, inv.invoice_amount, inv.net_realisable_value, inv.contract_ref || '', inv.service_description, inv.sac_code, inv.remarks || ''];
      doc.font('R').fontSize(FT);
      const h = Math.max(18, ...vals.map((v, i) => doc.heightOfString(v, { width: X[i] - 4 }) + 6));
      if (y + h > BOTTOM) { doc.addPage(); y = 36; header(); }
      let x = L;
      vals.forEach((v, i) => {
        doc.rect(x, y, X[i], h).stroke();
        doc.font('R').fontSize(FT).text(v, x + 2, y + 3, { width: X[i] - 4, align: i === 6 || i === 7 ? 'right' : 'left' });
        x += X[i];
      });
      y += h;
    });

    // ---- sections 3, 4, 5 (never split) ----
    const block = (h) => { need(h); };
    const est3 = 70, est4 = 150, est5 = 90;
    y += 8;
    block(est3 + 20);
    row([{ w: 1, p: [[[T.s3, true]]] }]);
    row([{ w: 0.6, p: [...P('Name of the Foreign post Office/Courier:', 'Not applicable'), ...P('Number & date of Parcel receipts:', 'Not applicable')] }, { w: 0.4, p: [[['Stamp & Signature of Authorised Dealer', false]]] }], { minH: 36 });

    block(est4);
    row([{ w: 1, p: [[[T.s4, true]]] }]);
    row([{ w: 1, p: [[[T.declaration(ex.realisation_months), false]]] }]);
    row([{ w: 0.4, p: P('Date:', s.declaration_date) }, { w: 0.6, p: [[[`For ${ex.legal_name} – (Signature of Exporter)  ${ex.signatory_label}`, false]]], align: 'right' }], { minH: 44 });

    block(est5);
    row([{ w: 1, p: [[[T.s5, true]]] }]);
    row([{ w: 1, p: [[[T.certified, false]]] }]);
    row([{ w: 0.4, p: P('Date:', '') }, { w: 0.6, p: [[[T.authSig, false]]], align: 'right' }], { minH: 44 });

    // footnotes
    y += 6;
    need(30);
    doc.font('I').fontSize(7.5).text(T.foot2, L, y, { width: W });
    doc.text(T.foot3, L, doc.y + 2, { width: W });

    // page numbers
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0;
      doc.font('R').fontSize(8).text(`Page ${i + 1} of ${range.count}`, L, 841.89 - 36, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

if (isNode) module.exports = { renderEdf }; else window.EdfPdf = { renderEdf };
})();
