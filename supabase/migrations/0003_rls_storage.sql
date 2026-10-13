-- EDF platform: row level security + private storage bucket.
-- Access is open to every *authenticated* user. That is only safe because public sign-up is disabled
-- (Authentication -> Providers -> Email -> turn off "Allow new users to sign up") and users are invited.

alter table exporter_profile enable row level security;
alter table clients enable row level security;
alter table import_batches enable row level security;
alter table edfs enable row level security;
alter table invoices enable row level security;
alter table form_no_counters enable row level security;  -- no policy: only next_form_no (security definer) touches it

do $$
declare t text;
begin
  foreach t in array array['exporter_profile','clients','import_batches','edfs','invoices'] loop
    execute format('drop policy if exists "staff_all" on %I', t);
    execute format('create policy "staff_all" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;

insert into storage.buckets (id, name, public) values ('edf-pdfs', 'edf-pdfs', false)
  on conflict (id) do nothing;

drop policy if exists "edf_pdfs_select" on storage.objects;
drop policy if exists "edf_pdfs_insert" on storage.objects;
drop policy if exists "edf_pdfs_update" on storage.objects;
create policy "edf_pdfs_select" on storage.objects for select to authenticated using (bucket_id = 'edf-pdfs');
create policy "edf_pdfs_insert" on storage.objects for insert to authenticated with check (bucket_id = 'edf-pdfs');
create policy "edf_pdfs_update" on storage.objects for update to authenticated using (bucket_id = 'edf-pdfs');
