# EDF Auto-Populate Platform

Upload the monthly sales Excel → review/fix rows → get one auto-populated **Export Declaration Form (EDF)** PDF per client (or per invoice), saved in Supabase, downloadable one by one or as a ZIP.

Static site (no build step, no server): the Excel is parsed and the PDFs are generated **in the browser**. Supabase provides login, database and PDF storage. Netlify hosts the site.

## One-time setup

### 1. Supabase
1. Create a project at supabase.com.
2. **SQL Editor** → run the three files in `supabase/migrations/` **in order** (`0001_init.sql`, `0002_functions.sql`, `0003_rls_storage.sql`). This creates the tables, functions, security rules and the private `edf-pdfs` storage bucket, and seeds the exporter profile with **dummy** values.
3. **Authentication → Providers → Email**: turn **off** "Allow new users to sign up". (Required – see security note below.)
4. **Authentication → Users → Add user → Create new user** (or *Invite*) for each colleague. Tick "Auto Confirm User" when creating with a password.
5. **Project Settings → API**: copy the **Project URL** and the **anon public** key. Never use or share the `service_role` key.

### 2. Netlify
1. Netlify → *Add new site → Import an existing project* → pick this GitHub repo. Settings are read from `netlify.toml` (build: `node scripts/gen-config.js`, publish: `public`).
2. **Site configuration → Environment variables**, add:
   - `SUPABASE_URL` = your Project URL
   - `SUPABASE_ANON_KEY` = your anon public key
3. Deploy. Every push to `main` redeploys.
4. Supabase → **Authentication → URL Configuration**: set **Site URL** to your Netlify URL.

### 3. First use
1. Open the site, sign in.
2. **Exporter settings**: replace the dummy exporter details (legal name, IE code, GSTIN, PAN, AD bank…) with the real ones and Save.
3. **Upload & Generate**: drop `samples/Dummy_Sales_Data.xlsx` (or your own file; use "Download blank template" for the format), review, click *Import & generate PDFs*.
4. Before real use, **clean out the sample data**: in the EDF history tab void the sample EDFs, then in Supabase *Table Editor* delete the sample rows from `invoices`, `edfs`, `clients` (and reset `form_no_counters`) so numbering starts clean.

## Day to day
- **Per client vs per invoice**: default is one EDF per client per month; tick "One EDF per invoice" to split.
- **Re-uploading a file** is safe: invoice numbers already in the database are skipped; invoices already on an EDF are not included again.
- **EDF history**: download, *Regenerate / Retry PDF* (re-renders from the saved data), *Mark filed*, *Void* (releases the invoices; the form number stays used).
- **Change exporter details**: Exporter settings tab. Past EDFs keep the details they were generated with.
- **Backups**: Supabase → Database → Backups; plus a monthly CSV export of `edfs` and `invoices` from the Table Editor.

## Security note
Row-level security allows **every authenticated user** to read and write everything. That is acceptable only because public sign-up is disabled and all users are trusted staff. Client names, invoices and PDFs are confidential: the PDF bucket is private (60-second signed links), no analytics or third-party CDN scripts are used (all libraries are in `public/vendor/`).

## Testing locally (optional)
- `npm install` then `npm test` – checks parsing, INR values and amounts-in-words against the sample, and renders 5 PDFs.
- To try the UI before deploying: copy `public/config.example.js` to `public/config.js`, fill in your Supabase values, run `npm run dev`, open http://localhost:8888 (add that URL under Supabase → Auth → URL Configuration if needed).

## Things to confirm with your bank / CA
- **One EDF per client** (the sample was one consolidated form with "multiple recipients").
- **9-month realisation period** is configurable (Exporter settings) – verify it against the currently applicable RBI/FEMA rule.
- The footnote wording in the PDF was written without access to the original form text – compare with the official EDF.

## Not included (Phase 2)
Invoices and Clients management screens, dashboard, signature/stamp image, live exchange rates, realisation tracking, e-mailing PDFs, multiple exporters, goods exports (Section 2A). PDFs use the built-in Helvetica font, so client names outside Latin-1 characters will not print correctly yet.

## Project layout
`public/` the site · `public/js/lib.js` parsing & validation · `public/js/pdf.js` EDF layout and fixed wording · `public/js/app.js` screens & Supabase calls · `supabase/migrations/` database · `scripts/` Netlify build + dev server · `samples/` sample form and data · `tests/` checks.
