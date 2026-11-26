-- ย้อนกลับ 202611270001_studios.sql
-- หยุดทันทีถ้า Ladyploy.Studio มีงานหรือกำหนดการแล้ว เพื่อไม่ให้ข้อมูลนั้นถูกรวมเข้าอีนิล
-- ถ้าต้องการย้อนกลับจริง ให้ export ข้อมูลของ Ladyploy ออกก่อน แล้วลบด้วยตัวเอง
-- งานของอีนิลไม่ถูกแก้ไข: แค่ลบคอลัมน์ studio_id ออก

begin;

do $$
begin
  if exists (select 1 from public.contents where studio_id <> 'enil')
     or exists (select 1 from public.events where studio_id <> 'enil') then
    raise exception 'ยังมีข้อมูลของ Studio อื่นที่ไม่ใช่อีนิล: export และลบเองก่อนย้อนกลับ';
  end if;
end $$;

drop table if exists public.ai_trend_runs;
drop table if exists public.ai_trend_items;
drop table if exists public.ai_trend_sources;

drop trigger if exists events_same_studio on public.events;
drop trigger if exists events_lock_studio_id on public.events;
drop trigger if exists contents_lock_studio_id on public.contents;
drop function if exists public.teamflow_event_same_studio();
drop function if exists public.teamflow_lock_studio_id();

alter table public.events drop column if exists studio_id;
alter table public.contents drop column if exists studio_id;

drop table if exists public.studios;

commit;
