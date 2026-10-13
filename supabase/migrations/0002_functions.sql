-- EDF platform: functions

-- Atomically allocate the next form number: EDF/2026-27/OCT/0001 (Indian FY starts 1 April).
create or replace function next_form_no(p_period date) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_year int := extract(year from p_period)::int;
  v_month int := extract(month from p_period)::int;
  v_start int := case when v_month >= 4 then v_year else v_year - 1 end;
  v_fy text := v_start || '-' || lpad(((v_start + 1) % 100)::text, 2, '0');
  v_mon text := (array['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'])[v_month];
  v_seq int;
  v_prefix text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select form_no_prefix into v_prefix from exporter_profile limit 1;
  insert into form_no_counters (fy, mon, last_seq) values (v_fy, v_mon, 1)
    on conflict (fy, mon) do update set last_seq = form_no_counters.last_seq + 1
    returning last_seq into v_seq;
  return coalesce(v_prefix, 'EDF') || '/' || v_fy || '/' || v_mon || '/' || lpad(v_seq::text, 4, '0');
end $$;

-- Import parsed invoice rows. Atomic. Existing invoice numbers are skipped.
create or replace function import_batch(p_filename text, p_rows jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_batch uuid;
  r jsonb;
  v_cid uuid;
  v_key text;
  v_inserted int := 0;
  v_skipped int := 0;
  v_clients int := 0;
begin
  insert into import_batches (filename, row_count) values (p_filename, jsonb_array_length(p_rows))
    returning id into v_batch;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_key := lower(regexp_replace(trim(r->>'client_name'), '\s+', ' ', 'g'));
    select id into v_cid from clients where name_key = v_key and country = r->>'country';
    if v_cid is null then
      insert into clients (name, name_and_address, country, name_key)
        values (r->>'client_name', r->>'name_and_address', r->>'country', v_key)
        returning id into v_cid;
      v_clients := v_clients + 1;
    end if;
    if exists (select 1 from invoices where invoice_no = r->>'invoice_no') then
      v_skipped := v_skipped + 1;
    else
      insert into invoices (batch_id, client_id, invoice_no, invoice_date, currency, invoice_amount,
                            net_realisable_value, exchange_rate, contract_ref, service_description, sac_code, remarks)
      values (v_batch, v_cid, r->>'invoice_no', (r->>'invoice_date')::date, r->>'currency',
              (r->>'invoice_amount')::numeric, (r->>'net_realisable_value')::numeric, (r->>'exchange_rate')::numeric,
              nullif(r->>'contract_ref',''), r->>'service_description', r->>'sac_code', nullif(r->>'remarks',''));
      v_inserted := v_inserted + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'clients_created', v_clients);
end $$;

-- Create an EDF for one client: assigns the form number and locks the invoices to it.
create or replace function create_edf(
  p_client_id uuid, p_period date, p_invoice_ids uuid[], p_declaration_date date, p_snapshot jsonb
) returns edfs
language plpgsql set search_path = public as $$
declare
  v_n int;
  v_form text;
  v_total numeric;
  v_fy text;
  v_row edfs;
begin
  perform 1 from invoices where id = any(p_invoice_ids) for update;
  select count(*) into v_n from invoices
    where id = any(p_invoice_ids) and client_id = p_client_id and edf_id is null;
  if v_n <> coalesce(cardinality(p_invoice_ids), 0) or v_n = 0 then
    raise exception 'One or more invoices are already on an EDF or do not belong to this client';
  end if;
  select coalesce(sum(inr_value), 0) into v_total from invoices where id = any(p_invoice_ids);
  v_form := next_form_no(p_period);
  v_fy := split_part(v_form, '/', 2);
  insert into edfs (form_no, fy, period_month, client_id, total_inr, declaration_date, snapshot)
    values (v_form, v_fy, date_trunc('month', p_period)::date, p_client_id, v_total, p_declaration_date,
            p_snapshot || jsonb_build_object('form_no', v_form, 'fy', v_fy))
    returning * into v_row;
  update invoices set edf_id = v_row.id where id = any(p_invoice_ids);
  return v_row;
end $$;

-- Void an EDF and release its invoices so they can be re-issued. The form number stays used.
create or replace function void_edf(p_edf_id uuid) returns void
language plpgsql set search_path = public as $$
begin
  update edfs set status = 'void' where id = p_edf_id;
  update invoices set edf_id = null where edf_id = p_edf_id;
end $$;
