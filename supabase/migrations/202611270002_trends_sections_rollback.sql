-- ย้อนกลับ 202611270002_trends_sections.sql
-- ลบแหล่งข้อมูลใหม่ 4 แหล่งพร้อมข่าว/ผลการดึงของแหล่งนั้น และคืนเงื่อนไขเดิม
-- ไม่แตะข้อมูลงาน (contents/events)
-- ถ้าอัปเดตฟังก์ชันเป็นเวอร์ชันใหม่ไปแล้ว ให้คืนโค้ดฟังก์ชันเป็นเวอร์ชันก่อนหน้าด้วย

begin;

delete from public.ai_trend_items where source_id in ('openai', 'google_ai', 'huggingface', 'youtube_th')
   or category in ('new_model', 'video_clip');
delete from public.ai_trend_runs where source_id in ('openai', 'google_ai', 'huggingface', 'youtube_th');
delete from public.ai_trend_sources where id in ('openai', 'google_ai', 'huggingface', 'youtube_th');

alter table public.ai_trend_items drop column if exists metric;
alter table public.ai_trend_items drop constraint if exists ai_trend_items_category_check;
alter table public.ai_trend_items add constraint ai_trend_items_category_check
  check (category in ('ai_tools', 'image', 'video', 'search_trend', 'ai_news'));

alter table public.ai_trend_sources drop column if exists language;
alter table public.ai_trend_sources drop constraint if exists ai_trend_sources_kind_check;
alter table public.ai_trend_sources add constraint ai_trend_sources_kind_check
  check (kind in ('rss', 'google_trends'));

commit;
