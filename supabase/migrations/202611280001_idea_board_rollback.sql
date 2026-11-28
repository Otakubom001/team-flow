-- ย้อนกลับกระดานไอเดีย (202611280001_idea_board.sql)
-- ถ้ายังมีโพสต์อิทอยู่ สคริปต์จะหยุดเองโดยไม่ลบอะไร ให้ export ตาราง idea_notes ก่อน
-- แล้วลบแถวเอง (delete from public.idea_notes;) จากนั้นค่อยรันไฟล์นี้อีกครั้ง
-- ไม่แตะ contents, events หรือ settings

begin;

do $$
begin
  if to_regclass('public.idea_notes') is not null
     and exists (select 1 from public.idea_notes) then
    raise exception 'ยังมีโพสต์อิทในกระดานไอเดีย กรุณา export และลบก่อนย้อนกลับ';
  end if;
end $$;

drop table if exists public.idea_notes;
drop function if exists public.teamflow_idea_note_guard();

commit;
