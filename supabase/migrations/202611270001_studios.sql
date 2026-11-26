-- Studios: แยกข้อมูลงานของ "อีนิล" และ "Ladyploy.Studio" ภายในเว็บเดียวกัน
-- รันครั้งเดียวใน Supabase SQL Editor หลังตรวจทานแล้ว ไฟล์นี้ไม่มีรหัสหรือ secret ใดๆ
--
-- สิ่งที่ไฟล์นี้ทำ:
--   1. สร้างตาราง studios พร้อม ID คงที่ 'enil' และ 'ladyploy'
--   2. เพิ่มคอลัมน์ studio_id ให้ contents และ events
--      แถวเดิมทุกแถวได้ค่า 'enil' จากค่าเริ่มต้นของคอลัมน์ โดยไม่แก้คอลัมน์อื่น
--      (ไม่มีคำสั่ง UPDATE กับข้อมูลเดิม จึงไม่เปลี่ยน updated_at หรือเนื้อหา)
--   3. ล็อก studio_id ไม่ให้แก้ภายหลัง: งานของอีนิลจะย้ายไป Ladyploy ไม่ได้
--   4. กันกำหนดการผูกกับเนื้อเรื่องของ Studio อื่น
--   5. สร้างตารางข่าว "กระแส AI" ที่อ่านได้อย่างเดียวจากหน้าเว็บ
--      เขียนได้เฉพาะ Edge Function ai-trends (service role) เท่านั้น
--
-- ไม่แตะตาราง settings (PIN), publishers หรือ publishing_* ของระบบโพสต์ Buffer
-- ย้อนกลับได้ด้วย 202611270001_studios_rollback.sql

begin;

-- 1. Studios ------------------------------------------------------------------
create table if not exists public.studios (
  id text primary key check (id ~ '^[a-z][a-z0-9_-]{1,31}$'),
  name text not null,
  created_at timestamptz not null default now()
);
insert into public.studios (id, name) values
  ('enil', 'อีนิล'),
  ('ladyploy', 'Ladyploy.Studio')
on conflict (id) do nothing;

alter table public.studios enable row level security;
drop policy if exists studios_read on public.studios;
create policy studios_read on public.studios for select to anon, authenticated using (true);
revoke all on public.studios from anon, authenticated;
grant select on public.studios to anon, authenticated;

-- 2. studio_id on existing tables ---------------------------------------------
-- ค่าเริ่มต้น 'enil' คงไว้ถาวร: ถ้าเบราว์เซอร์ที่ยังเปิดหน้าเว็บเวอร์ชันเก่าบันทึกงานเข้ามา
-- งานนั้นจะเข้าอีนิลเหมือนเดิม ไม่หลุดไปอยู่ Ladyploy
alter table public.contents add column if not exists studio_id text not null default 'enil';
alter table public.events   add column if not exists studio_id text not null default 'enil';

alter table public.contents drop constraint if exists contents_studio_id_fkey;
alter table public.contents add constraint contents_studio_id_fkey
  foreign key (studio_id) references public.studios(id);
alter table public.events drop constraint if exists events_studio_id_fkey;
alter table public.events add constraint events_studio_id_fkey
  foreign key (studio_id) references public.studios(id);

create index if not exists contents_studio_id_idx on public.contents (studio_id);
create index if not exists events_studio_id_idx   on public.events (studio_id);

-- 3. studio_id เป็นค่าถาวร ---------------------------------------------------
create or replace function public.teamflow_lock_studio_id()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.studio_id is distinct from old.studio_id then
    raise exception 'studio_id ของรายการเดิมเปลี่ยนไม่ได้' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists contents_lock_studio_id on public.contents;
create trigger contents_lock_studio_id before update on public.contents
  for each row execute function public.teamflow_lock_studio_id();
drop trigger if exists events_lock_studio_id on public.events;
create trigger events_lock_studio_id before update on public.events
  for each row execute function public.teamflow_lock_studio_id();

-- 4. กำหนดการต้องอยู่ Studio เดียวกับเนื้อเรื่องที่ผูก ----------------------------
-- ตรวจเฉพาะเมื่อเนื้อเรื่องนั้นมีอยู่จริง เพื่อไม่ให้กำหนดการเก่าที่ผูกกับงานที่ถูกลบไปแล้วแก้ไขไม่ได้
create or replace function public.teamflow_event_same_studio()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(new.content_id, '') <> '' and exists (
    select 1 from public.contents c
    where c.id = new.content_id and c.studio_id <> new.studio_id
  ) then
    raise exception 'กำหนดการต้องผูกกับเนื้อเรื่องใน Studio เดียวกัน' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists events_same_studio on public.events;
create trigger events_same_studio before insert or update on public.events
  for each row execute function public.teamflow_event_same_studio();

-- 5. กระแส AI ------------------------------------------------------------------
create table if not exists public.ai_trend_sources (
  id text primary key check (id ~ '^[a-z][a-z0-9_-]{1,31}$'),
  name text not null,
  homepage text not null check (homepage ~ '^https://'),
  feed_url text not null check (feed_url ~ '^https://'),
  kind text not null check (kind in ('rss', 'google_trends')),
  ai_only boolean not null default true,
  enabled boolean not null default true
);
-- ai_only = true: เก็บเฉพาะข่าวที่หัวข้อหรือหมวดพูดถึง AI
insert into public.ai_trend_sources (id, name, homepage, feed_url, kind, ai_only) values
  ('google_trends_th', 'Google Trends ประเทศไทย', 'https://trends.google.com/trending?geo=TH',
     'https://trends.google.com/trending/rss?geo=TH', 'google_trends', false),
  ('aiat', 'สมาคมปัญญาประดิษฐ์ประเทศไทย (AIAT)', 'https://aiat.or.th/',
     'https://aiat.or.th/feed/', 'rss', false),
  ('blognone', 'Blognone', 'https://www.blognone.com/',
     'https://www.blognone.com/atom.xml', 'rss', true),
  ('techsauce', 'Techsauce', 'https://techsauce.co/',
     'https://techsauce.co/feed', 'rss', true),
  ('beartai', 'beartai', 'https://www.beartai.com/',
     'https://www.beartai.com/feed', 'rss', true),
  ('droidsans', 'DroidSans', 'https://droidsans.com/',
     'https://droidsans.com/feed/', 'rss', true)
on conflict (id) do nothing;

create table if not exists public.ai_trend_items (
  id bigint generated always as identity primary key,
  studio_id text not null default 'ladyploy' references public.studios(id),
  source_id text not null references public.ai_trend_sources(id),
  title text not null check (length(title) between 1 and 400),
  url text not null check (url ~ '^https://'),
  category text not null check (category in ('ai_tools', 'image', 'video', 'search_trend', 'ai_news')),
  detail text check (detail is null or length(detail) <= 200),
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  unique (studio_id, source_id, url)
);
create index if not exists ai_trend_items_recent_idx
  on public.ai_trend_items (studio_id, published_at desc nulls last);

-- บันทึกการดึงข้อมูลทุกครั้ง เพื่อให้ทีมตรวจย้อนหลังได้ว่าแหล่งไหนอัปเดตเมื่อไร หรือล้มเหลว
create table if not exists public.ai_trend_runs (
  id bigint generated always as identity primary key,
  studio_id text not null default 'ladyploy' references public.studios(id),
  source_id text not null references public.ai_trend_sources(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  item_count integer not null default 0,
  error text check (error is null or length(error) <= 300)
);
create index if not exists ai_trend_runs_recent_idx
  on public.ai_trend_runs (studio_id, source_id, started_at desc);

alter table public.ai_trend_sources enable row level security;
alter table public.ai_trend_items   enable row level security;
alter table public.ai_trend_runs    enable row level security;
revoke all on public.ai_trend_sources, public.ai_trend_items, public.ai_trend_runs from anon, authenticated;
grant select on public.ai_trend_sources, public.ai_trend_items, public.ai_trend_runs to anon, authenticated;
drop policy if exists ai_trend_sources_read on public.ai_trend_sources;
create policy ai_trend_sources_read on public.ai_trend_sources for select to anon, authenticated using (true);
drop policy if exists ai_trend_items_read on public.ai_trend_items;
create policy ai_trend_items_read on public.ai_trend_items for select to anon, authenticated using (true);
drop policy if exists ai_trend_runs_read on public.ai_trend_runs;
create policy ai_trend_runs_read on public.ai_trend_runs for select to anon, authenticated using (true);
-- ไม่มี policy สำหรับ insert/update/delete: หน้าเว็บเขียนไม่ได้ มีแต่ service role ใน Edge Function
grant all on public.ai_trend_sources, public.ai_trend_items, public.ai_trend_runs to service_role;

commit;
