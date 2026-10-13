(function () {
'use strict';
const $ = (s) => document.querySelector(s);
const L = window.EdfLib;
const Decimal = L.Decimal;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

const cfg = window.EDF_CONFIG || {};
let sb = null;
let rows = [];

function msg(t, kind) {
  const m = $('#msg');
  m.textContent = t || '';
  m.className = t ? (kind === 'ok' ? 'o' : 'e') : 'hidden';
  if (t) m.scrollIntoView({ block: 'nearest' });
}
// Turn database/network errors into readable sentences.
function human(e) {
  const t = (e && (e.message || e.error_description)) || String(e);
  if (/Invalid login credentials/i.test(t)) return 'Wrong email or password.';
  if (/already on an EDF/i.test(t)) return 'One or more invoices are already on an EDF (or belong to another client).';
  if (/duplicate key/i.test(t)) return 'That record already exists.';
  if (/Failed to fetch|NetworkError/i.test(t)) return 'Could not reach the server. Check your internet connection.';
  return t;
}

// ---------- boot / auth ----------
function show(view) {
  $('#login').classList.toggle('hidden', view !== 'login');
  $('#nav').classList.toggle('hidden', view !== 'app');
  $('#who').classList.toggle('hidden', view !== 'app');
  if (view !== 'app') for (const p of ['gen', 'hist', 'set']) $('#p-' + p).classList.add('hidden');
  else tab(currentTab);
}
let currentTab = 'gen';
function tab(name) {
  currentTab = name;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  for (const p of ['gen', 'hist', 'set']) $('#p-' + p).classList.toggle('hidden', p !== name);
  if (name === 'hist') loadHistory();
  if (name === 'set') loadSettings();
}
document.querySelectorAll('#nav button').forEach((b) => (b.onclick = () => { msg(''); tab(b.dataset.tab); }));

function boot() {
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    msg('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (see README) and redeploy.');
    return;
  }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange((_ev, session) => {
    if (session) { $('#email').textContent = session.user.email; show('app'); } else show('login');
  });
  sb.auth.getSession().then(({ data }) => { if (!data.session) show('login'); });
}
$('#loginform').onsubmit = async (e) => {
  e.preventDefault(); msg('');
  const { error } = await sb.auth.signInWithPassword({ email: $('#lemail').value.trim(), password: $('#lpass').value });
  if (error) msg(human(error));
};
$('#signout').onclick = () => sb.auth.signOut();

// ---------- upload / review ----------
const COLS = [
  ['name_and_address', 'Recipient name & address'], ['country', 'Country'], ['invoice_no', 'Invoice No.'], ['invoice_date', 'Invoice date (yyyy-mm-dd)'],
  ['currency', 'Cur.'], ['invoice_amount', 'Invoice amt'], ['net_realisable_value', 'Net realisable'], ['exchange_rate', 'FX rate'],
  ['contract_ref', 'Contract ref'], ['service_description', 'Description'], ['sac_code', 'SAC'], ['remarks', 'Remarks']];

const drop = $('#drop'), file = $('#file');
drop.onclick = () => file.click();
drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); };
file.onchange = () => { if (file.files[0]) upload(file.files[0]); };
let fileName = '';

async function upload(f) {
  msg(''); $('#out').classList.add('hidden');
  try {
    const r = await L.parseWorkbook(await f.arrayBuffer(), f.name);
    rows = r.rows.map(L.toJSONRow);
    fileName = f.name;
    drop.firstChild.textContent = `Loaded ${f.name} (sheet “${r.sheet}”, header row ${r.header_row}). Drop another file to replace. `;
    render();
  } catch (e) { msg(human(e)); }
}

function render() {
  $('#review').classList.remove('hidden');
  const errs = rows.filter((r) => r.errors.length).length, warns = rows.filter((r) => r.warnings.length).length;
  const clients = new Set(rows.map((r) => (r.client_name + '|' + r.country).toLowerCase())).size;
  $('#strip').innerHTML = `<span><b>${rows.length}</b> rows</span><span><b>${rows.length - errs}</b> valid</span><span class="${errs ? 'err' : ''}"><b>${errs}</b> errors</span><span class="${warns ? 'warn' : ''}"><b>${warns}</b> warnings</span><span><b>${clients}</b> clients</span>`;
  const t = $('#tbl');
  t.innerHTML = '<tr><th>#</th><th>Status</th>' + COLS.map((c) => `<th>${c[1]}</th>`).join('') + '<th>INR value</th></tr>';
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    const st = r.errors.length ? `<span class="err">✖ ${esc(r.errors.join('; '))}</span>` : r.warnings.length ? `<span class="warn">⚠ ${esc(r.warnings.join('; '))}</span>` : '<span class="ok">✔</span>';
    tr.innerHTML = `<td>${i + 1}</td><td style="min-width:160px">${st}</td>` + COLS.map((c) => `<td><input aria-label="${esc(c[1])} row ${i + 1}" data-i="${i}" data-k="${c[0]}" value="${esc(r[c[0]] ?? '')}"></td>`).join('') + `<td style="white-space:nowrap">${esc(r.inr_value || '')}</td>`;
    t.appendChild(tr);
  });
  $('#go').disabled = errs > 0 || !rows.length;
}

let tmr;
$('#tbl').addEventListener('input', (e) => {
  const i = e.target.dataset.i; if (i === undefined) return;
  rows[i][e.target.dataset.k] = e.target.value;
  clearTimeout(tmr);
  tmr = setTimeout(() => {
    const a = document.activeElement, pos = a && a.dataset && a.dataset.i !== undefined ? [a.dataset.i, a.dataset.k, a.selectionStart] : null;
    rows = L.rowsFromClient(rows).map(L.toJSONRow);
    render();
    if (pos) { const el = document.querySelector(`input[data-i="${pos[0]}"][data-k="${pos[1]}"]`); if (el) { el.focus(); el.setSelectionRange(pos[2], pos[2]); } }
  }, 600);
});

// ---------- snapshot + render + store ----------
function groupPending(invs, perInvoice) {
  const g = new Map();
  for (const r of invs) {
    const month = r.invoice_date.slice(0, 7);
    const key = (perInvoice ? r.invoice_no : '') + '|' + r.client_id + '|' + month;
    if (!g.has(key)) g.set(key, { client: r.clients, period: month, invoices: [] });
    g.get(key).invoices.push(r);
  }
  const list = [...g.values()];
  list.forEach((x) => x.invoices.sort((a, b) => a.invoice_date.localeCompare(b.invoice_date) || a.invoice_no.localeCompare(b.invoice_no)));
  list.sort((a, b) => a.period.localeCompare(b.period) || a.client.name.localeCompare(b.client.name));
  return list;
}

function buildSnapshot(exporter, group, declIso, description) {
  const [y, m] = group.period.split('-').map(Number);
  const decl = declIso ? L.fromIso(declIso) : L.lastDayOfMonth(y, m);
  const total = group.invoices.reduce((a, r) => a.plus(new Decimal(r.inr_value)), new Decimal(0));
  return {
    exporter: { ...exporter, default_services_description: description || exporter.default_services_description },
    client: { name: group.client.name, name_and_address: group.client.name_and_address, country: group.client.country },
    declaration_date: L.fmtDate(decl),
    declaration_iso: L.isoDate(decl),
    total_inr: total.toFixed(2),
    total_words: L.rupeesInWords(total),
    invoices: group.invoices.map((r) => ({
      invoice_no: r.invoice_no, invoice_date: L.fmtDate(L.fromIso(r.invoice_date)), currency: r.currency,
      invoice_amount: L.fmtMoney(r.invoice_amount), net_realisable_value: L.fmtMoney(r.net_realisable_value),
      contract_ref: r.contract_ref || '', service_description: r.service_description, sac_code: r.sac_code, remarks: r.remarks || '',
      name_and_address: group.client.name_and_address, country: group.client.country,
      exchange_rate: String(r.exchange_rate), inr_value: new Decimal(r.inr_value).toFixed(2),
    })),
  };
}

const pdfPath = (edf, clientName) => `${edf.period_month.slice(0, 7)}/${edf.form_no.replace(/\//g, '_')}__${slug(clientName)}.pdf`;

async function renderAndStore(edf, clientName) {
  const blob = await window.EdfPdf.renderEdf(edf.snapshot);
  const path = pdfPath(edf, clientName);
  const up = await sb.storage.from('edf-pdfs').upload(path, blob, { contentType: 'application/pdf', upsert: true });
  if (up.error) throw up.error;
  const upd = await sb.from('edfs').update({ pdf_path: path }).eq('id', edf.id);
  if (upd.error) throw upd.error;
  return { blob, path };
}

const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };

$('#go').onclick = async () => {
  msg(''); const btn = $('#go'); btn.disabled = true; btn.textContent = 'Working…';
  const out = $('#out'); out.classList.remove('hidden'); out.innerHTML = '<b>Importing…</b>';
  try {
    const clean = L.rowsFromClient(rows).map(L.toJSONRow);
    if (clean.some((r) => r.errors.length)) throw new Error('Fix the rows marked with errors first.');
    const payload = clean.map((r) => ({
      client_name: r.client_name, name_and_address: r.name_and_address, country: r.country, invoice_no: r.invoice_no,
      invoice_date: r.invoice_date, currency: r.currency, invoice_amount: r.invoice_amount, net_realisable_value: r.net_realisable_value,
      exchange_rate: r.exchange_rate, contract_ref: r.contract_ref, service_description: r.service_description, sac_code: r.sac_code, remarks: r.remarks,
    }));
    const imp = await sb.rpc('import_batch', { p_filename: fileName, p_rows: payload });
    if (imp.error) throw imp.error;

    const nos = payload.map((r) => r.invoice_no);
    const pend = await sb.from('invoices').select('*, clients(*)').in('invoice_no', nos).is('edf_id', null);
    if (pend.error) throw pend.error;
    const ex = await sb.from('exporter_profile').select('*').limit(1).single();
    if (ex.error) throw ex.error;
    const groups = groupPending(pend.data, $('#perinv').checked);
    const already = nos.length - pend.data.length;

    const done = [];
    const failed = [];
    const zip = new JSZip();
    const declIso = $('#decl').value || null, desc = $('#desc').value.trim() || null;
    for (const g of groups) {
      out.innerHTML = `<b>Generating ${done.length + failed.length + 1} of ${groups.length}…</b> ${esc(g.client.name)}`;
      let edf;
      try {
        const snap = buildSnapshot(ex.data, g, declIso, desc);
        const [y, m] = g.period.split('-').map(Number);
        const res = await sb.rpc('create_edf', {
          p_client_id: g.client.id, p_period: `${g.period}-01`, p_invoice_ids: g.invoices.map((r) => r.id),
          p_declaration_date: snap.declaration_iso, p_snapshot: snap,
        });
        if (res.error) throw res.error;
        edf = res.data;
      } catch (e) { failed.push({ client: g.client.name, why: human(e) }); continue; }
      try {
        const { blob, path } = await renderAndStore(edf, g.client.name);
        zip.file(path.split('/').pop(), blob);
        done.push({ edf, client: g.client, blob, file: path.split('/').pop() });
      } catch (e) { failed.push({ client: g.client.name, why: `${edf.form_no} created, but the PDF failed (${human(e)}). Use “Retry PDF” in EDF history.` }); }
    }
    let html = `<div class="row" style="justify-content:space-between"><b>${done.length} EDF PDF(s) generated</b>`;
    if (done.length) html += `<button class="pri" id="zipbtn">Download all (ZIP)</button>`;
    html += `</div><p style="color:var(--mut)">Imported ${imp.data.inserted} new invoice(s), skipped ${imp.data.skipped} already in the database${already ? `; ${already} invoice(s) are already on an EDF and were not included` : ''}.</p>`;
    if (done.length) html += '<table><tr><th>Form No</th><th>Client</th><th>Invoices</th><th>Total (INR)</th><th>In words</th><th></th></tr>' +
      done.map((d, i) => `<tr><td>${esc(d.edf.form_no)}</td><td>${esc(d.client.name)}<br><small>${esc(d.client.country)}</small></td><td>${d.edf.snapshot.invoices.length}</td><td>${L.fmtMoney(d.edf.total_inr)}</td><td>${esc(d.edf.snapshot.total_words)}</td><td><a class="dl" data-i="${i}" tabindex="0">Download</a></td></tr>`).join('') + '</table>';
    if (failed.length) html += '<p class="err"><b>Problems:</b></p><ul>' + failed.map((f) => `<li class="err">${esc(f.client)}: ${esc(f.why)}</li>`).join('') + '</ul>';
    out.innerHTML = html;
    out.querySelectorAll('a.dl').forEach((a) => (a.onclick = () => download(done[a.dataset.i].blob, done[a.dataset.i].file)));
    const zb = $('#zipbtn'); if (zb) zb.onclick = async () => download(await zip.generateAsync({ type: 'blob' }), 'EDFs.zip');
    out.scrollIntoView({ behavior: 'smooth' });
  } catch (e) { out.classList.add('hidden'); msg(human(e)); }
  btn.disabled = false; btn.textContent = 'Import & generate PDFs';
};

// ---------- history ----------
async function loadHistory() {
  const t = $('#htbl');
  t.innerHTML = '<tr><td>Loading…</td></tr>';
  const r = await sb.from('edfs').select('*, clients(name)').order('generated_at', { ascending: false }).limit(300);
  if (r.error) { t.innerHTML = ''; return msg(human(r.error)); }
  if (!r.data.length) { t.innerHTML = '<tr><td>No EDFs generated yet.</td></tr>'; return; }
  t.innerHTML = '<tr><th>Form No</th><th>Client</th><th>Period</th><th>Total (INR)</th><th>Status</th><th>Generated</th><th>Actions</th></tr>' +
    r.data.map((e) => `<tr data-id="${e.id}"><td>${esc(e.form_no)}</td><td>${esc(e.clients ? e.clients.name : '')}</td><td>${e.period_month.slice(0, 7)}</td><td>${L.fmtMoney(e.total_inr)}</td>
      <td><span class="badge ${e.status}">${e.status}</span>${e.pdf_path ? '' : ' <span class="warn">no PDF</span>'}</td><td>${new Date(e.generated_at).toLocaleString()}</td>
      <td class="row" style="gap:6px">${e.status === 'void' ? '' : `${e.pdf_path ? '<button class="sm" data-a="dl">Download</button>' : ''}<button class="sm" data-a="regen">${e.pdf_path ? 'Regenerate PDF' : 'Retry PDF'}</button>${e.status === 'generated' ? '<button class="sm" data-a="filed">Mark filed</button>' : ''}<button class="sm danger" data-a="void">Void</button>`}</td></tr>`).join('');
  t.onclick = async (ev) => {
    const b = ev.target.closest('button[data-a]'); if (!b) return;
    const e = r.data.find((x) => x.id === b.closest('tr').dataset.id);
    msg('');
    try {
      if (b.dataset.a === 'dl') {
        const s = await sb.storage.from('edf-pdfs').createSignedUrl(e.pdf_path, 60);
        if (s.error) throw s.error;
        window.open(s.data.signedUrl, '_blank');
      } else if (b.dataset.a === 'regen') {
        b.disabled = true; b.textContent = 'Working…';
        await renderAndStore(e, e.clients.name);
        msg(`PDF for ${e.form_no} regenerated.`, 'ok'); loadHistory();
      } else if (b.dataset.a === 'filed') {
        const u = await sb.from('edfs').update({ status: 'filed', filed_at: new Date().toISOString() }).eq('id', e.id);
        if (u.error) throw u.error; loadHistory();
      } else if (b.dataset.a === 'void') {
        if (!confirm(`Void ${e.form_no}? Its invoices will be released so they can be re-issued. The form number stays used.`)) return;
        const u = await sb.rpc('void_edf', { p_edf_id: e.id });
        if (u.error) throw u.error; loadHistory();
      }
    } catch (err) { msg(human(err)); loadHistory(); }
  };
}
$('#refresh').onclick = loadHistory;

// ---------- settings ----------
const LABELS = { legal_name: 'Exporter legal name', address: 'Exporter address', ie_code: 'IE Code', gstin: 'GSTIN', pan: 'PAN', ad_code: 'AD code', ad_name_address: 'AD name & address', type_of_export: 'Type of export', shipping_bill_text: 'Shipping Bill No. & Date',
  transport_mode: ['Mode of transport', ['air', 'land', 'sea', 'post_courier', 'internet', 'others']], exporter_category: ['Category of exporter', ['custom_dta', 'sez', 'eou_100', 'warehouse', 'others']], exporter_category_other: 'Category – others (specify)',
  realisation_mode: ['Mode of realisation', ['lc', 'bg', 'others']], realisation_note: 'Realisation note', third_party_text: 'Third party name & address', third_party_relationship: 'Third party relationship', lc_bg_ad_text: 'AD name & code (LC/BG)', leo_text: 'Date of LEO',
  port_of_loading_text: 'Port of loading', port_of_discharge_text: 'Port of discharge', default_services_description: 'Description of services', realisation_months: 'Realisation period (months)', signatory_label: 'Signatory label', form_no_prefix: 'Form number prefix' };
let exporterId = null;
async function loadSettings() {
  const r = await sb.from('exporter_profile').select('*').limit(1).single();
  if (r.error) return msg(human(r.error));
  exporterId = r.data.id;
  $('#setgrid').innerHTML = Object.entries(LABELS).map(([k, l]) => {
    if (Array.isArray(l)) return `<label class="f">${l[0]}<select data-k="${k}">${l[1].map((o) => `<option ${r.data[k] === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
    return `<label class="f">${l}<input data-k="${k}" value="${esc(r.data[k] ?? '')}"></label>`;
  }).join('');
}
$('#save').onclick = async () => {
  const o = {}; document.querySelectorAll('#setgrid [data-k]').forEach((el) => (o[el.dataset.k] = el.value));
  o.realisation_months = Number(o.realisation_months) || 9;
  o.updated_at = new Date().toISOString();
  const r = await sb.from('exporter_profile').update(o).eq('id', exporterId);
  if (r.error) msg(human(r.error)); else msg('Exporter details saved.', 'ok');
};

// ---------- blank template ----------
$('#tmpl').onclick = async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Invoices');
  ws.addRow(['Service recipient Name & Address', 'Country', 'Invoice No.', 'Invoice Date', 'Currency', 'Invoice Amount', 'Net Realisable value', 'Exch. Rate (INR)', 'Contract No., if any, and Date', 'Description of services', 'SAC Code', 'Remarks']).font = { bold: true };
  ws.addRow(['Northbridge Accounting LLC, 120 Market St, San Francisco, CA 94105', 'USA', 'ABC/EXP/26-27/101', new Date(Date.UTC(2026, 9, 5)), 'USD', 12500, 12500, 83.85, 'MSA-NB-2024 dt 01-Apr-2024', 'Monthly bookkeeping and accounting support', '998222', 'Periodical billing']);
  ws.columns.forEach((c) => (c.width = 24)); ws.getColumn(4).numFmt = 'dd-mmm-yyyy';
  ws.getColumn(11).numFmt = '@';
  download(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'EDF_sales_template.xlsx');
};
$('#tmpl').onkeydown = (e) => { if (e.key === 'Enter') $('#tmpl').click(); };

boot();
})();
