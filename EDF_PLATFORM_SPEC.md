# EDF Auto-Populate Platform — Build Spec for Claude Code

> **How to use this file:** put it in an empty project folder together with the two sample files in `./samples/`
> (`EDF.pdf` = the blank form, `Dummy_Sales_Data.xlsx` = sample sales data). Then tell Claude Code:
> *"Read EDF_PLATFORM_SPEC.md and build the whole thing, following section 13 (Build order). Stop and ask me only for the items in section 0."*
> You may also rename this file to `CLAUDE.md` so it is loaded automatically in every session.

---

## 0. What Claude Code needs from the human (ask once, up front)

Do not invent any of these. Ask, then continue.

1. **Supabase**: a project already created at supabase.com. Need the *Project URL*, the *anon (public) key*, and either `supabase login` + `supabase link --project-ref <ref>` done in the terminal, or the DB password so migrations can be pushed.
2. **Netlify**: a Netlify account. Run `netlify login` and `netlify init` (or connect the GitHub repo in the Netlify UI).
3. **Exporter details** — a seed row is provided in section 5.1 using the *dummy* values from the sample file. Ask the human for the real values (legal name, address, IE code, GSTIN, PAN, AD code, AD name & address) or tell them they can edit these in **Settings → Exporter Profile** after deployment.
4. **Users**: the email addresses of the colleagues who should be able to log in (they will be invited from the Supabase dashboard — public sign-up is disabled).

Never put the Supabase `service_role` key in the frontend, in the repo, or in Netlify env vars used by the browser build.

---

## 1. Goal

Our firm exports services to many overseas clients. The **Export Declaration Form (EDF)** is the same form every time; only the client and invoice details change, and the exporter's own details (IE code, GSTIN, PAN, AD bank, etc.) never change.

Build a small internal web app where staff:

1. **Upload the monthly sales Excel** (invoice-level data).
2. The app **validates and stores** it in **Supabase** (clients + invoices).
3. Pick a month → the app **auto-populates the EDF and generates one PDF per client**, ready to download individually or as one ZIP.
4. Every generated EDF is **saved** (PDF in Supabase Storage + a data snapshot) so it can be re-downloaded, audited, voided, or marked as filed with the bank.

Hosted as a static site on **Netlify**; **Supabase** is the only backend (Auth, Postgres, Storage). No custom server.

**Primary success criterion:** upload `samples/Dummy_Sales_Data.xlsx` → get 5 correct PDFs (one each for Northbridge, Thames, Rhein Finanz, Harbour CPA, Gulf Advisory) whose layout matches `samples/EDF.pdf`, in under a minute, with zero manual typing.

---

## 2. What the two sample files actually contain (verified)

**`EDF.pdf`** — 2 pages, A4, Arial-style font, produced from Word. **It has no fillable form fields**, so we cannot "fill" it; the PDF must be **re-created programmatically** to match its look (section 8). It contains: Section 1 General Information, 2A goods export value (not used for services), 2B services export value table, 3 FPO/Couriers, 4 Declaration by exporter, 5 Space for specified authority, and three footnotes. Page numbers "9" and "10" in its footer come from a larger parent document — do not reproduce them (use "Page x of y").

**`Dummy_Sales_Data.xlsx`** — one sheet (`EDF Dummy - Services`). It is *itself laid out like the form*, not a flat table:

| Rows | What it is |
|---|---|
| 5–17 | **Exporter-level fields** (Form No, IE code, GSTIN, PAN, AD code, AD name/address, exporter name/address, mode of realisation, "Not applicable" fields, services description, total) — these are the same for every client |
| 20 | **Header row** of the invoice table (A20 = `S. No.`) |
| 21–25 | **5 invoice rows**, one per client (data columns A–N) |
| 26 | `Total (INR equivalent)` — must be ignored by the importer |
| 28–37 | Static form text (sections 3, 4, 5, notes) — ignore |

Invoice table columns: `S. No. | Service recipient Name & Address | Country | Invoice No. | Invoice Date | Currency | Invoice Amount | Net Realisable value | Contract No., if any, and Date | Description of services | SAC Code | Remarks | Exch. Rate (INR) | INR Value`.

Things the importer must handle (all present in the sample):
- **Client name and address are one combined cell** (`"Northbridge Accounting LLC, 120 Market St, San Francisco, CA 94105"`).
- **`Net Realisable value` can differ from `Invoice Amount`** (Rhein Finanz: 9,200 invoiced, 9,000 realisable, remark "EUR 200 bank charges deducted").
- **Exchange rate is a manual per-invoice input** (column M, labelled "Working (not part of form)"); **INR Value is a formula** (`= Net Realisable × Exch. Rate`) — recompute it, do not trust cached values (the sample's cached value for row 21 is `1048124.9999999999`, a floating-point artefact).
- Dates are real Excel dates; SAC codes are text; recipients are in USA, UK, Germany, Australia, UAE; non-ASCII characters appear (`Königsallee`, `Düsseldorf`, en-dashes `–`).
- The sample's "Total … in words" cell actually prints digits (`Rupees 38,35,545 only`). **We will print real words** (section 7).

---

## 3. Decisions already taken (change only if the human says so)

| # | Decision | Why / how to change |
|---|---|---|
| D1 | **One EDF per client per month** by default (all of that client's un-filed invoices in the month go into that client's Section 2B table). A toggle on the generate screen switches to **one EDF per invoice**. | User asked for "different PDFs for each client". |
| D2 | In a per-client EDF, **Consignee Name & Address = the client**, **Country of Final Destination = client's country**, and Section 2B lists **only that client's invoices**. | Sample used "As per Section 2B (multiple service recipients)" because it was one consolidated form. **Flag to the human:** confirm with the AD bank that per-client EDFs are acceptable. |
| D3 | **Section 2A (goods) is omitted**; sections 1, 2B, 3, 4, 5 are printed. | Sample says "Section 2A not applicable for export of services". |
| D4 | **Exporter details live in one Supabase row** (`exporter_profile`) edited in Settings. Never read from the Excel header block. | "Our services export firm is the same". |
| D5 | **Exchange rate comes from the Excel** (per invoice). No live rate API in v1. | Matches sample. |
| D6 | **Realisation period = 9 months** stored as a setting and printed in the declaration. | Taken from the sample text. **Flag to the human:** verify against the currently applicable RBI/FEMA rule; it is configurable so no code change is needed. |
| D7 | **PDFs are generated in the browser** (no server rendering) and uploaded to Supabase Storage. | Avoids serverless/Chromium limits on Netlify. |
| D8 | **Money is never handled as JS floats.** Use `decimal.js` (or integer minor units) everywhere; the DB uses `numeric`. | Avoids the `1048124.9999999999` problem. |
| D9 | **Dates print as `dd-Mon-yyyy`** (e.g. `05-Oct-2026`). Parse Excel dates using **UTC getters** — the team is in IST and local-time parsing shifts dates by a day. | Matches sample. |

---

## 4. Tech stack (pin exact versions in `package.json`, commit the lockfile)

- **Vite + React 18 + TypeScript (strict)**, React Router, Tailwind CSS
- **@supabase/supabase-js v2** (Auth, DB, Storage) — Supabase CLI for migrations; generate types with `supabase gen types typescript`
- **exceljs** — parse `.xlsx` in the browser (read values; do *not* rely on formula cached results)
- **@react-pdf/renderer** — build the EDF PDF as a React component (flexbox + borders replicate the form's grid well; supports repeated table headers and page numbers)
- **Fonts**: bundle **Liberation Sans** (metric-compatible with Arial) *and* **Noto Sans** (fallback for non-Latin client names) as `.ttf` in `public/fonts/` and register them with `Font.register`. Do not rely on built-in Helvetica (no Unicode beyond Latin-1).
- **jszip** + **file-saver** — "download all as ZIP"
- **zod** — validate each imported row; **decimal.js**; **date-fns**
- **vitest** + **@testing-library/react** — unit tests; **Playwright** for one end-to-end test (install its browser normally on this machine)
- Deploy: **Netlify** (static `dist/` + SPA redirect)

---

## 5. Supabase backend

Put everything in `supabase/migrations/0001_init.sql` (and further numbered files). Enable RLS on **every** table.

### 5.1 Tables

```sql
-- Single-row settings for OUR firm (the exporter). Same on every EDF.
create table exporter_profile (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  address text not null,
  ie_code text not null,
  gstin text,
  pan text,
  ad_code text not null,
  ad_name_address text not null,
  type_of_export text not null default 'Service',
  shipping_bill_text text not null default 'Not applicable (export of services)',
  transport_mode text not null default 'internet'
    check (transport_mode in ('air','land','sea','post_courier','internet','others')),
  exporter_category text not null default 'custom_dta'
    check (exporter_category in ('custom_dta','sez','eou_100','warehouse','others')),
  exporter_category_other text,
  realisation_mode text not null default 'others'
    check (realisation_mode in ('lc','bg','others')),
  realisation_note text default 'SWIFT remittance',
  third_party_text text default 'Not applicable – payments received directly from service recipients',
  third_party_relationship text default 'Not applicable',
  lc_bg_ad_text text default 'Not applicable',
  leo_text text default 'Not applicable',
  port_of_loading_text text default 'Not applicable',
  port_of_discharge_text text default 'Not applicable',
  default_services_description text not null,
  realisation_months int not null default 9 check (realisation_months between 1 and 60),
  signatory_label text not null default 'Authorised Signatory',
  form_no_prefix text not null default 'EDF',
  updated_at timestamptz not null default now()
);
create unique index exporter_profile_singleton on exporter_profile ((true));  -- max one row

-- Seed with the DUMMY values from the sample file (replace with real values later):
-- legal_name 'ABC Global Services Pvt. Ltd.'
-- address    '5th Floor, Tech Park, Andheri (E), Mumbai – 400093'
-- ie_code '0512345678', gstin '27AABCA1234F1Z5', pan 'AABCA1234F', ad_code '0510005'
-- ad_name_address 'XYZ Bank Ltd., Trade Finance Branch, Nariman Point, Mumbai – 400021'
-- default_services_description
--   'Accounting, bookkeeping, payroll & finance support services (SAC 998221 / 998222)'

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,                 -- short name; used for matching + file names
  name_and_address text not null,     -- EXACT text printed on the EDF
  country text not null,
  name_key text not null,             -- normalised name (lower, trimmed, collapsed spaces), set by app
  default_contract_ref text,
  notes text,
  created_at timestamptz not null default now(),
  unique (name_key, country)
);

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  row_count int not null,
  uploaded_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table edfs (
  id uuid primary key default gen_random_uuid(),
  form_no text not null unique,       -- e.g. EDF/2026-27/OCT/0001
  fy text not null,                   -- '2026-27'
  period_month date not null,         -- first day of the month
  client_id uuid not null references clients(id),
  status text not null default 'generated' check (status in ('generated','filed','void')),
  total_inr numeric not null,
  declaration_date date not null,
  snapshot jsonb not null,            -- the EXACT data that was rendered (source of truth for regenerating the PDF)
  pdf_path text,                      -- storage path in bucket edf-pdfs; null = upload pending
  generated_by uuid references auth.users(id) default auth.uid(),
  generated_at timestamptz not null default now(),
  filed_at timestamptz
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references import_batches(id) on delete set null,
  client_id uuid not null references clients(id),
  invoice_no text not null unique,
  invoice_date date not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  invoice_amount numeric(18,2) not null check (invoice_amount > 0),
  net_realisable_value numeric(18,2) not null check (net_realisable_value >= 0),
  exchange_rate numeric(14,4) not null check (exchange_rate > 0),
  inr_value numeric generated always as (net_realisable_value * exchange_rate) stored,  -- unrounded, like Excel
  contract_ref text,                  -- free text, e.g. 'MSA-NB-2024 dt 01-Apr-2024'
  service_description text not null,
  sac_code text not null check (sac_code ~ '^[0-9]{6}$'),
  remarks text,
  edf_id uuid references edfs(id) on delete set null,   -- null = not yet on an EDF
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on invoices (client_id);
create index on invoices (invoice_date);
create index on invoices (edf_id);

create table form_no_counters (
  fy text not null, mon text not null, last_seq int not null default 0,
  primary key (fy, mon)
);
```

### 5.2 Functions (Postgres, `security definer` where noted, `set search_path = public`)

1. **`next_form_no(p_period date) returns text`** (security definer) — atomically increments `form_no_counters` (`insert … on conflict do update … returning`) and returns `{form_no_prefix}/{FY}/{MON}/{seq 4-digit}`. Indian financial year starts 1 April.
   Tests: Oct-2026 → `EDF/2026-27/OCT/0001`, then `…/0002`; Mar-2027 → `EDF/2026-27/MAR/0001`; Apr-2027 → `EDF/2027-28/APR/0001`. Numbers of voided EDFs are never reused.
2. **`import_batch(p_filename text, p_rows jsonb) returns jsonb`** — in ONE transaction: upsert clients (by `name_key, country`), insert the batch row, insert invoices (skip rows whose `invoice_no` already exists unless that invoice has `edf_id is null` and `p_overwrite = true`), return `{inserted, skipped, clients_created}`. Atomic: all or nothing.
3. **`create_edf(p_client_id uuid, p_period date, p_invoice_ids uuid[], p_declaration_date date, p_overrides jsonb) returns edfs`** — verifies every invoice belongs to the client and has `edf_id is null`, gets `next_form_no`, builds `snapshot` (exporter profile + client + invoice rows + computed totals + words string + overrides), inserts the `edfs` row, sets `invoices.edf_id`. Raises a clear error if any invoice is already on an EDF.
4. **`void_edf(p_edf_id uuid)`** — sets status `void`, sets `invoices.edf_id = null` for its invoices (so they can be re-issued). Form number stays consumed.

### 5.3 Security

- **Auth**: email + password (or magic link). **Disable public sign-ups** (Auth → Providers → Email → turn off "Allow new users to sign up"); invite colleagues from the dashboard.
- **RLS**: on every table, policies `for all to authenticated using (true) with check (true)`. This is acceptable *only because* sign-up is disabled and all users are trusted staff — note this in the README. `anon` role gets nothing.
- **Storage**: private bucket `edf-pdfs`; policies on `storage.objects` allowing `authenticated` select/insert/update where `bucket_id = 'edf-pdfs'`. Download via **signed URLs** (60 s expiry). Path: `{YYYY-MM}/{form_no with / replaced by _}__{client_slug}.pdf`.
- Client names, invoices and PDFs are confidential financial data: no public buckets, no analytics scripts, no third-party fonts loaded from CDNs (fonts are bundled).

---

## 6. Excel import (the "auto-populating" part)

**Flow:** drop `.xlsx` → *detect* → *map columns* → *validate (review table)* → *confirm* → `import_batch` RPC.

1. **Header-row detection**: scan the first 50 rows of every sheet; the header row is the one matching the most known column aliases (≥ 6 matches). In the sample this is row 20. Data = rows below it until a row whose first cell starts with `Total` or until 3 consecutive blank rows. **Ignore everything above the header** (exporter block) and below the data (static form text).
2. **Alias matching** (case-/punctuation-insensitive; show a manual dropdown mapping step if anything required is unmatched, and remember the mapping in `localStorage` — wrapped in try/catch):

| Canonical field | Accepted header aliases |
|---|---|
| `name_and_address` | Service recipient Name & Address · Client Name & Address · Client / Recipient |
| `client_name` + `client_address` (optional pair, used if the combined column is absent; joined as `name, address`) | Client Name · Client Address |
| `country` | Country |
| `invoice_no` | Invoice No. · Invoice Number · Inv No |
| `invoice_date` | Invoice Date · Inv Date |
| `currency` | Currency · Invoice Currency |
| `invoice_amount` | Invoice Amount |
| `net_realisable_value` (optional → defaults to invoice amount) | Net Realisable value · Net Realizable Value · NRV |
| `exchange_rate` | Exch. Rate (INR) · Exchange Rate · FX Rate |
| `contract_ref` (optional) | Contract No., if any, and Date · Contract No · Contract Ref |
| `service_description` | Description of services · Description |
| `sac_code` | SAC Code · SAC · HSN/SAC |
| `remarks` (optional) | Remarks |

   Ignore `S. No.` and `INR Value` columns (recomputed).
3. **Cell normalisation**: SAC → string (keep leading zeros, trim); amounts → Decimal (strip thousands separators/currency symbols; accept `12,500.00`); dates → accept Excel dates, `dd-Mon-yyyy`, `dd/mm/yyyy`, `dd-mm-yyyy` (**day-first**), read via UTC; currency → uppercase; text → trim + collapse whitespace; formula cells → use `result` but never rely on it for amounts that we recompute.
4. **Client derivation**: `name_and_address` is stored verbatim; `name` = text before the first comma (editable in the review step); `name_key` = lowercase, trimmed, whitespace-collapsed `name`; match to existing client on `(name_key, country)`. New clients are listed in the review table as "NEW" so a typo does not silently create a duplicate.
5. **Validation (zod) — per row, shown inline, errors block import, warnings don't:**
   - **Errors:** missing required field; currency not 3 letters; amount/rate ≤ 0; invalid date; SAC not 6 digits; duplicate `invoice_no` *within the file*; net realisable > invoice amount.
   - **Warnings:** `invoice_no` already in the database (will be skipped); net realisable < invoice amount (show the difference, e.g. "−200.00 – check remarks"); exchange rate differs by > 10% from the previous invoice in the same currency in the file; invoice date more than 12 months old; unknown country spelling.
6. Review table: editable cells (fix a typo without re-uploading), row status icons, summary strip ("5 rows · 5 valid · 0 errors · 5 new clients"), **Import** button disabled while errors remain.
7. Provide a **"Download blank template"** button that generates a flat `.xlsx` with the headers above plus the 5 sample rows.

---

## 7. EDF field mapping (what goes where)

**A. Constant for every EDF — from `exporter_profile`**

| EDF field | Source |
|---|---|
| Type of export | `type_of_export` ("Service") |
| Shipping Bill No. & Date | `shipping_bill_text` |
| Mode of Transport/Delivery | `transport_mode` — print the **full original option list** (Air, Land, Sea, Post/Couriers, Internet, others) with `[X]` on the selected one and `[ ]` on the rest |
| Category of Exporter | `exporter_category` — full list (Custom (DTA units), SEZ, 100% EOU, Warehouse export, others (Specify)) with `[X]` on the selected one |
| AD code / AD Name & Address | `ad_code` / `ad_name_address` |
| IE Code / GSTIN / PAN | `ie_code` / `gstin` / `pan` |
| Exporters Name & Address | `legal_name` + ", " + `address` |
| Mode of Realisation | `realisation_mode` — options L/C, BG, Others (advance payment, etc. including transfer/remittance to bank a/c maintained overseas) with `[X]`; append `realisation_note` after the selected one |
| Third Party name & Address / Relationship | `third_party_text` / `third_party_relationship` |
| Name of the AD and AD code, in case of LC/BG | `lc_bg_ad_text` |
| Date of Let Export order (LEO) | `leo_text` |
| Port of Loading / Source Port | `port_of_loading_text` |
| Port of Discharge | `port_of_discharge_text` |
| Description of Goods/Services | `default_services_description` (overridable per EDF in the preview step) |
| Section 4 declaration text | Use the **sample's services wording verbatim** (Dummy_Sales_Data.xlsx cell A32) with "within 9 months" replaced by `realisation_months`. Signature block: `For {legal_name} – (Signature of Exporter)  {signatory_label}` |

**B. Per EDF — generated**

| EDF field | Source |
|---|---|
| Form No | `next_form_no(period)` → `EDF/2026-27/OCT/0001` |
| Consignee Name & Address | `clients.name_and_address` |
| Country of Final Destination | `clients.country` |
| Total FOB/Services value in words (INR) | Σ(`inr_value`) of the EDF's invoices, rounded to whole rupees → **Indian-system words**: `Rupees Thirty Eight Lakh Thirty Five Thousand Five Hundred Forty Five only` followed by ` (INR 38,35,545)`. Units: Thousand, Lakh, Crore. |
| Section 4 `Date:` | `declaration_date` (default = last day of the period month; editable at generation) |

**C. Section 2B rows (one per invoice of that client, ordered by invoice date then invoice no.)**

`S. No.` (1,2,3…) · Service recipient Name & Address (`clients.name_and_address`) · Country · Invoice No. · Invoice Date · Currency · Invoice Amount (`#,##0.00`) · Net Realisable value (`#,##0.00`) · Contract No. & Date · Description of services · SAC Code · Remarks.
**Do not print** exchange rate or INR value inside the 2B table (the sample marks them "Working (not part of form)"). They are shown on the web preview only. If the EDF has several invoices in different currencies, the table still just lists each row in its own currency.

---

## 8. PDF layout spec (match `samples/EDF.pdf`)

Convert the sample pages to PNG (e.g. `pdftoppm -r 100 -png samples/EDF.pdf ref` if poppler is installed, otherwise render with Playwright/Chromium or any PDF-to-image tool) and use them as the visual reference while building.

- **A4 portrait**, margins ≈ 36 pt, font **Liberation Sans** 9 pt (labels) — bold for the section headings and for the left-hand "Type of export" label. Thin (0.75 pt) black borders; the form is one large outer box divided into rows.
- Top right: **"Annex"** bold. Centred bold: **"Export Declaration Form"**.
- **Section 1** (full-width bold header row "1. General Information:"), then two-column rows (≈ 55 % / 45 %):
  1. `Type of export : …` | `Form No: …`
  2. `Shipping Bill No. & Date: …` | `Mode of Transport/Delivery: [X] Air …` (checkbox list wrapping)
  3. `Category of Exporter: …` (checkbox list) | `AD code: …`
  4. `IE Code / GSTIN / PAN` (three stacked lines) | `AD Name & Address: …`
  5. `Exporters Name & Address: …` | `Mode of Realisation: …`
  6. `Consignee Name & Address: …` | `Port of Loading / Source Port in case of SEZ: …`
  7. `Third Party name & Address …` + `Relationship between Exporter & Third Party: …` | `Country of Final Destination:` and `Port of Discharge:` side by side
  8. `Name of the AD and AD code, in case of LC/BG:` and below it `Description of Goods/Services:` | `Date of Let Export order (LEO): …` (right cell spans both rows)
  9. `Total FOB/Services value in words (INR): …` (full width)
- **Section 2B** heading (`2B. Details of Export Value^ of Services`), sub-line `Details of services provided to multiple recipients`, then the 12-column table with a two-level header (`Details of Invoice` spans No., Date, Currency, Amount). **Header row repeats on every page** if the table breaks. Column widths: S.No 4 %, Recipient 18 %, Country 8 %, Inv No 10 %, Date 8 %, Currency 6 %, Amount 8 %, Net realisable 9 %, Contract 10 %, Description 11 %, SAC 5 %, Remarks 8 % (tune so long text wraps and never overflows).
- **Section 3** (FPO/Couriers): "Name of the Foreign post Office/Courier: Not applicable", "Number & date of Parcel receipts: Not applicable", right cell "Stamp & Signature of Authorised Dealer".
- **Section 4** declaration box with `Date:` bottom-left and signature block bottom-right. **Section 5** box with the certification text, `Date:` and the authority signature caption.
- Footnotes 2 and 3 from the sample (the `^` note and the nil-value note), italic, small. Footer: `Page x of y`, centred.
- **Pagination rules:** sections 3, 4, 5 must never split across pages (`wrap={false}`); Section 1 stays on page 1; with 1–3 invoices the whole form is 2 pages, like the sample.
- Header block, labels and all fixed wording come from one `edfTemplate.ts` constants file so the wording can be changed in one place.
- PDF metadata: Title = `EDF {form_no} – {client name}`, Author = exporter legal name.

---

## 9. App screens

| Route | Purpose |
|---|---|
| `/login` | Email/password; redirect to `/` when signed in |
| `/` Dashboard | Counts (invoices pending EDF, EDFs this month), latest imports, latest EDFs, shortcuts to Upload / Generate |
| `/upload` | The import flow in section 6 |
| `/invoices` | Table with filters (month, client, status = pending / on EDF), sort, search by invoice no.; row click → detail; delete only if not on an EDF |
| `/clients` | List/edit clients (name, printed name & address, country, default contract ref). Merge-duplicates action |
| `/generate` | Pick month (default: latest with pending invoices) → grouped list: *client · #invoices · currencies · INR total · checkbox* → toggle "One EDF per client / per invoice" → **Preview** (renders the first selected EDF in an inline PDF viewer; shows the exch. rate/INR working in a side panel; editable `declaration date` and `services description`) → **Generate selected** with a per-client progress list → **Download each** or **Download all (ZIP)** |
| `/edfs` | History: form no, client, period, total, status badge; actions: download, **regenerate PDF from snapshot**, mark as filed, void (with confirm) |
| `/settings/exporter` | Edit the single `exporter_profile` row (all fields in section 5.1) with a live "what will print" preview |

UX requirements: plain, fast, desktop-first but usable on a tablet; clear empty states; every destructive action confirmed; errors shown as readable sentences ("Invoice ABC/EXP/26-27/103 is already on EDF EDF/2026-27/OCT/0003"), never raw SQL errors. Keyboard accessible, visible focus, sufficient contrast.

**Generation sequence (per EDF):** `create_edf` RPC (assigns number, locks invoices) → render PDF from the returned `snapshot` → upload to Storage → update `pdf_path`. If render/upload fails, the EDF stays in the list with a **"Retry PDF"** button (regenerates from the snapshot; no number is wasted, no invoices are left locked without an EDF).

---

## 10. Netlify

`netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "22"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
```

- Netlify env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` only. Provide `.env.example`; add `.env*` to `.gitignore`.
- In Supabase → Auth → URL Configuration, set **Site URL** and **Redirect URLs** to the Netlify URL (and `http://localhost:5173` for dev).
- Deploy: push to GitHub and connect the repo in Netlify (continuous deploy), **or** `netlify deploy --build --prod`. After the first deploy, open the live URL and run the end-to-end check in section 13 step 9.
- Write a **README.md** covering: first-time setup, how to invite a user, how to change exporter details, how to back up (Supabase → Database → Backups; plus a monthly CSV export of `edfs` and `invoices`), and the "RLS is open to all authenticated users" note.

---

## 11. Suggested project structure

```
/ (repo root)
├─ EDF_PLATFORM_SPEC.md            (this file / CLAUDE.md)
├─ samples/                        EDF.pdf, Dummy_Sales_Data.xlsx
├─ supabase/migrations/            0001_init.sql, 0002_functions.sql, 0003_rls_storage.sql, seed.sql
├─ public/fonts/                   LiberationSans-*.ttf, NotoSans-*.ttf
├─ src/
│  ├─ lib/ supabase.ts, money.ts (Decimal helpers), dates.ts, indianWords.ts, fy.ts
│  ├─ import/ detectHeader.ts, aliases.ts, parseWorkbook.ts, validateRows.ts
│  ├─ pdf/ EdfDocument.tsx, edfTemplate.ts, buildSnapshot.ts, renderPdf.ts
│  ├─ pages/ Login, Dashboard, Upload, Invoices, Clients, Generate, Edfs, ExporterSettings
│  ├─ components/ …
│  └─ types/ database.ts (generated)
├─ tests/ unit/*.test.ts, e2e/edf.spec.ts
├─ netlify.toml  ·  .env.example  ·  README.md
```

---

## 12. Test fixtures (derive from `samples/Dummy_Sales_Data.xlsx`; assert these exactly)

| Client | Invoice | Net realisable | Rate | INR value | Words |
|---|---|---|---|---|---|
| Northbridge Accounting LLC | ABC/EXP/26-27/101 | USD 12,500 | 83.85 | 10,48,125.00 | Rupees Ten Lakh Forty Eight Thousand One Hundred Twenty Five only |
| Thames Payroll Solutions Ltd | …/102 | GBP 6,800 | 110.40 | 7,50,720.00 | Rupees Seven Lakh Fifty Thousand Seven Hundred Twenty only |
| Rhein Finanz GmbH | …/103 | EUR 9,000 (invoice 9,200) | 97.20 | 8,74,800.00 | Rupees Eight Lakh Seventy Four Thousand Eight Hundred only |
| Harbour CPA Pty Ltd | …/104 | AUD 15,000 | 55.10 | 8,26,500.00 | Rupees Eight Lakh Twenty Six Thousand Five Hundred only |
| Gulf Advisory FZ-LLC | …/105 | USD 4,000 | 83.85 | 3,35,400.00 | Rupees Three Lakh Thirty Five Thousand Four Hundred only |
| **All five** | | | | **38,35,545.00** | Rupees Thirty Eight Lakh Thirty Five Thousand Five Hundred Forty Five only |

Other unit tests: `indianWords` for 0, 1, 99, 100, 1,000, 99,999, 1,00,000, 1,00,00,000, 12,34,56,789; money helpers never produce float artefacts (`12500 × 83.85` = `1048125` exactly); date parsing of `05-Oct-2026`, `5/10/2026` (day-first) and an Excel date serial stay on the correct day under `TZ=Asia/Kolkata` **and** `TZ=America/Los_Angeles`; header detection finds row 20 of the sample; the `Total` row is excluded; the SAC `998222` survives as text; the Rhein row produces a warning (net < invoice) but no error; duplicate re-upload of the same file inserts 0 and skips 5.

---

## 13. Build order (do in this order; run the check at each step before moving on)

1. **Scaffold** — Vite + React + TS + Tailwind, ESLint/Prettier, vitest, git init, `.gitignore`, `.env.example`. Read both files in `samples/` and rasterise the PDF for reference. *Check:* `npm run build` passes.
2. **Database** — migrations (tables, functions, RLS, storage bucket + policies), seed `exporter_profile` with the dummy values; push with the Supabase CLI; generate TS types. *Check:* SQL tests for `next_form_no` (section 5.2) and for `create_edf` rejecting an already-used invoice.
3. **Auth + shell** — login, protected routes, layout/nav, sign-out. *Check:* unauthenticated user is redirected; a second tab reflects sign-out.
4. **Money / dates / words utilities** + unit tests (section 12). *Check:* all pass.
5. **Excel import** — detect, map, validate, review table, `import_batch`. *Check:* sample file → 5 valid rows, 5 new clients, Rhein warning; re-upload → 0 inserted / 5 skipped.
6. **Clients & Invoices screens.**
7. **PDF template** — `EdfDocument.tsx` driven only by a `snapshot` object. *Check:* generate the Northbridge PDF, rasterise at 100 dpi, **look at it next to the reference page images** and fix spacing, borders, wrapping until the layout is visually equivalent; test with a long recipient address and with 8 invoices (table breaks across pages, header repeats, sections 3-5 stay together); test non-Latin text renders (fallback to Noto Sans).
8. **Generate flow** — grouping, preview, `create_edf`, upload, ZIP, history, retry, void, mark filed. *Check:* section 1 success criterion with the sample file; void releases invoices; retry-PDF works after simulating an upload failure.
9. **Deploy to Netlify** — `netlify.toml`, env vars, Supabase redirect URLs, deploy. *Check on the LIVE URL:* log in, upload the sample, generate 5 PDFs, download ZIP, open each PDF and confirm form numbers `…/0001`–`…/0005` and totals from section 12. Then **delete the sample data from the live database** (or void and remove) so the real database starts clean — ask the human before deleting.
10. **Write README.md**, then give the human a short summary: live URL, how to invite users, and the three items flagged in section 3 (D2, D6, and the per-client Section 2B approach) for them to confirm with their bank/CA.

**Definition of done:** all unit tests and the Playwright e2e test pass; the live site works end-to-end with the sample; PDFs visually match the reference form; no secrets in the repo; README written.

---

## 14. Out of scope for v1 (list in the README as "Phase 2")

Uploading a signature/stamp image to print on the declaration; live RBI/bank reference exchange-rate lookup; tracking payment realisation against each EDF (days remaining of the realisation period, overdue alerts); e-mailing PDFs to clients or the bank; multi-exporter (several legal entities) support — the schema can be extended by adding `exporter_id` to `edfs`; goods exports (Section 2A).
