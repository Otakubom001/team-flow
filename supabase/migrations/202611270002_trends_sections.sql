-- กระแส AI: เพิ่มแหล่งข้อมูลสำหรับ "โมเดล AI ใหม่" และ "คลิป AI ที่เป็นกระแส"
-- พร้อมคอลัมน์ metric (ปริมาณค้นหา / ยอดดู / คะแนนมาแรง) สำหรับจัดอันดับ
-- รันหลัง 202611270001_studios.sql และก่อนอัปเดตฟังก์ชัน ai-trends (dynamic-function)
-- ไม่แตะข้อมูลงาน (contents/events) ของ Studio ใดๆ
-- ย้อนกลับได้ด้วย 202611270002_trends_sections_rollback.sql

begin;

alter table public.ai_trend_sources drop constraint if exists ai_trend_sources_kind_check;
alter table public.ai_trend_sources add constraint ai_trend_sources_kind_check
  check (kind in ('rss', 'google_trends', 'hf_models', 'youtube'));
-- ภาษาของแหล่ง เพื่อแสดงป้าย "อังกฤษ" ให้ทีมรู้ก่อนเปิดอ่าน
alter table public.ai_trend_sources add column if not exists language text not null default 'th'
  check (language in ('th', 'en'));

alter table public.ai_trend_items drop constraint if exists ai_trend_items_category_check;
alter table public.ai_trend_items add constraint ai_trend_items_category_check
  check (category in ('ai_tools', 'image', 'video', 'search_trend', 'ai_news', 'new_model', 'video_clip'));
-- ตัวเลขจากแหล่งต้นทาง: ปริมาณค้นหา (Google Trends), ยอดดู (YouTube), คะแนนมาแรง (Hugging Face)
alter table public.ai_trend_items add column if not exists metric bigint check (metric is null or metric >= 0);

insert into public.ai_trend_sources (id, name, homepage, feed_url, kind, ai_only, language) values
  ('openai', 'OpenAI News', 'https://openai.com/news/',
     'https://openai.com/news/rss.xml', 'rss', false, 'en'),
  ('google_ai', 'Google AI Blog', 'https://blog.google/technology/ai/',
     'https://blog.google/technology/ai/rss/', 'rss', false, 'en'),
  ('huggingface', 'Hugging Face: โมเดลมาแรง', 'https://huggingface.co/models?sort=trending',
     'https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=60', 'hf_models', false, 'en'),
  -- ต้องตั้ง Edge Function secret YOUTUBE_API_KEY ก่อน ไม่อย่างนั้นจะบันทึกว่า "ยังไม่ได้ตั้งค่า"
  ('youtube_th', 'YouTube: คลิป AI ยอดดูสูงในไทย', 'https://www.youtube.com/',
     'https://www.googleapis.com/youtube/v3/search', 'youtube', false, 'th')
on conflict (id) do nothing;

commit;
