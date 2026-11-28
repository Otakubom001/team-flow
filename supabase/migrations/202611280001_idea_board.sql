-- กระดานไอเดีย: โพสต์อิทวางแผนไอเดียรายเดือน แยกตาม Studio (อีนิล / Ladyploy.Studio)
-- รันหลัง 202611270001_studios.sql (ต้องมีตาราง studios แล้ว) ไฟล์นี้ไม่มีรหัสหรือ secret ใดๆ
--
-- สิ่งที่ไฟล์นี้ทำ:
--   1. สร้างตารางใหม่ idea_notes เท่านั้น ไม่แก้ contents, events, settings หรือข้อมูลเดิมใดๆ
--   2. studio_id ของโพสต์อิทเปลี่ยนไม่ได้ (ใช้ฟังก์ชันล็อกเดิมจาก migration Studio)
--   3. โพสต์อิทผูกได้เฉพาะเนื้อเรื่องใน Studio เดียวกัน
--   4. ข่าวเดียวกันจากหน้า "กระแส AI" แปะซ้ำใน Studio เดียวกันไม่ได้
--
-- สิทธิ์เหมือนตาราง contents: หน้าเว็บ (anon key + PIN) อ่าน/เขียนได้
-- ย้อนกลับได้ด้วย 202611280001_idea_board_rollback.sql

begin;

create table if not exists public.idea_notes (
  id text primary key check (id ~ '^[a-z0-9]{3,40}$'),
  studio_id text not null references public.studios(id),
  body text not null check (length(btrim(body)) between 1 and 500),
  color text not null default 'yellow'
    check (color in ('yellow', 'pink', 'blue', 'green', 'orange', 'purple', 'white')),
  tag text not null default '' check (length(tag) <= 40),
  -- เดือนที่วางแผนไว้ 'YYYY-MM' (ปี ค.ศ.) ว่าง = อยู่ในกองไอเดีย
  plan_month text check (plan_month is null or plan_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  source_url text check (source_url is null or (source_url ~ '^https://' and length(source_url) <= 1000)),
  -- เนื้อเรื่องที่สร้างจากโพสต์อิทนี้ (ถ้าเนื้อเรื่องถูกลบ ค่านี้ยังอยู่ หน้าเว็บจะถือว่ายังไม่ได้สร้างงาน)
  content_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idea_notes_studio_month_idx on public.idea_notes (studio_id, plan_month);
create unique index if not exists idea_notes_source_once
  on public.idea_notes (studio_id, source_url) where source_url is not null;

-- Postgres fires triggers in name order: the studio lock (10) runs before the guard (20).
drop trigger if exists idea_notes_10_lock_studio_id on public.idea_notes;
create trigger idea_notes_10_lock_studio_id before update on public.idea_notes
  for each row execute function public.teamflow_lock_studio_id();

create or replace function public.teamflow_idea_note_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(new.content_id, '') <> '' and exists (
    select 1 from public.contents c
    where c.id = new.content_id and c.studio_id <> new.studio_id
  ) then
    raise exception 'โพสต์อิทต้องผูกกับเนื้อเรื่องใน Studio เดียวกัน' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;

drop trigger if exists idea_notes_20_guard on public.idea_notes;
create trigger idea_notes_20_guard before insert or update on public.idea_notes
  for each row execute function public.teamflow_idea_note_guard();

alter table public.idea_notes enable row level security;
drop policy if exists idea_notes_public on public.idea_notes;
create policy idea_notes_public on public.idea_notes for all to anon, authenticated
  using (true) with check (true);
revoke all on public.idea_notes from anon, authenticated;
grant select, insert, update, delete on public.idea_notes to anon, authenticated;
grant all on public.idea_notes to service_role;

commit;
