-- EDF platform: tables
create extension if not exists pgcrypto;

create table if not exists exporter_profile (
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
create unique index if not exists exporter_profile_singleton on exporter_profile ((true));

-- DUMMY values from the sample file. Replace via the app's Settings tab.
insert into exporter_profile (legal_name, address, ie_code, gstin, pan, ad_code, ad_name_address, default_services_description)
values ('ABC Global Services Pvt. Ltd.', '5th Floor, Tech Park, Andheri (E), Mumbai – 400093', '0512345678',
        '27AABCA1234F1Z5', 'AABCA1234F', '0510005',
        'XYZ Bank Ltd., Trade Finance Branch, Nariman Point, Mumbai – 400021',
        'Accounting, bookkeeping, payroll & finance support services (SAC 998221 / 998222)')
on conflict do nothing;

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_and_address text not null,
  country text not null,
  name_key text not null,
  default_contract_ref text,
  notes text,
  created_at timestamptz not null default now(),
  unique (name_key, country)
);

create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  row_count int not null,
  uploaded_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists edfs (
  id uuid primary key default gen_random_uuid(),
  form_no text not null unique,
  fy text not null,
  period_month date not null,
  client_id uuid not null references clients(id),
  status text not null default 'generated' check (status in ('generated','filed','void')),
  total_inr numeric not null,
  declaration_date date not null,
  snapshot jsonb not null,
  pdf_path text,
  generated_by uuid references auth.users(id) default auth.uid(),
  generated_at timestamptz not null default now(),
  filed_at timestamptz
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references import_batches(id) on delete set null,
  client_id uuid not null references clients(id),
  invoice_no text not null unique,
  invoice_date date not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  invoice_amount numeric(18,2) not null check (invoice_amount > 0),
  net_realisable_value numeric(18,2) not null check (net_realisable_value >= 0),
  exchange_rate numeric(14,4) not null check (exchange_rate > 0),
  inr_value numeric generated always as (net_realisable_value * exchange_rate) stored,
  contract_ref text,
  service_description text not null,
  sac_code text not null check (sac_code ~ '^[0-9]{6}$'),
  remarks text,
  edf_id uuid references edfs(id) on delete set null,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists invoices_client_idx on invoices (client_id);
create index if not exists invoices_date_idx on invoices (invoice_date);
create index if not exists invoices_edf_idx on invoices (edf_id);

create table if not exists form_no_counters (
  fy text not null,
  mon text not null,
  last_seq int not null default 0,
  primary key (fy, mon)
);
