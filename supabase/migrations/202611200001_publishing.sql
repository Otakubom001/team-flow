-- Run once in Supabase SQL Editor. No credentials belong in this file.
begin;
create table if not exists public.publishers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.publishers enable row level security;
revoke all on public.publishers from anon, authenticated;
grant select on public.publishers to authenticated;
create policy publisher_self on public.publishers for select to authenticated using (user_id = auth.uid());

create table public.publishing_channels (
  platform text primary key check (platform in ('facebook','tiktok','youtube')),
  channel_id text not null unique,
  name text not null
);
insert into public.publishing_channels values
 ('facebook','6b0050c4ece6dfde5f321b9a','อีนิล หนังสั้นก่อนนอน'),
 ('tiktok','6b005220ece6dfde5f322699','midnightstudio.official'),
 ('youtube','6b00525cece6dfde5f322868','อีนิล');
alter table public.publishing_channels enable row level security;
revoke all on public.publishing_channels from anon, authenticated;

create table public.publishing_deliveries (
 user_id uuid not null references auth.users(id),
 item_id uuid not null,
 platform text not null references public.publishing_channels(platform),
 state text not null check (state in ('sending','queued','unknown','rejected')),
 post_id text,
 created_at timestamptz not null default now(),
 primary key(user_id,item_id,platform)
);
alter table public.publishing_deliveries enable row level security;
revoke all on public.publishing_deliveries from anon, authenticated;
grant select on public.publishing_deliveries to authenticated;
create policy own_deliveries on public.publishing_deliveries for select to authenticated
 using (user_id = auth.uid() and exists(select 1 from public.publishers where user_id = auth.uid()));
grant all on public.publishers, public.publishing_channels, public.publishing_deliveries to service_role;

-- Public, permanent media URLs are required by Buffer. Uploads are publisher-only,
-- immutable, and cannot be deleted from the website while queued posts need them.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('publishing-media','publishing-media',true,52428800,array['video/mp4','video/quicktime','video/webm','video/x-m4v','image/jpeg','image/png']);
create policy publisher_media_insert on storage.objects for insert to authenticated
with check (bucket_id = 'publishing-media'
 and (storage.foldername(name))[1] = auth.uid()::text
 and exists(select 1 from public.publishers where user_id = auth.uid()));
create policy publisher_media_read on storage.objects for select to authenticated
using (bucket_id = 'publishing-media'
 and (storage.foldername(name))[1] = auth.uid()::text
 and exists(select 1 from public.publishers where user_id = auth.uid()));
commit;
