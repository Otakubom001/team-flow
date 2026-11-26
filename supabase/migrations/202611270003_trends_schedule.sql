-- ตั้งเวลาให้ Supabase ดึงกระแส AI เองทุกชั่วโมง (นาทีที่ 5 ของทุกชั่วโมง)
-- ใช้ pg_cron + pg_net ซึ่งมีในแพ็กเกจฟรี
-- เรียกฟังก์ชัน dynamic-function (โค้ด functions/ai-trends/index.ts) ด้วย anon key
-- ตัวเดียวกับที่อยู่ในหน้าเว็บอยู่แล้ว (ไม่ใช่ความลับ) ไม่ต้องใช้ service role key
-- ฟังก์ชันมีช่วงพัก 15 นาที ถ้ามีคนกด "อัปเดตข่าว" ไปก่อนหน้านั้นไม่นาน รอบนั้นจะข้ามไปเอง
--
-- เปลี่ยนความถี่: แก้ '5 * * * *' เช่น '5 0,6,12 * * *' = วันละ 3 ครั้ง (07:05, 13:05, 19:05 เวลาไทย; cron ใช้เวลา UTC)
-- ดูประวัติการทำงาน: select * from cron.job_run_details order by start_time desc limit 20;
-- หยุดตั้งเวลา:       select cron.unschedule('ladyploy-ai-trends');

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'ladyploy-ai-trends';

select cron.schedule(
  'ladyploy-ai-trends',
  '5 * * * *',
  $job$
  select net.http_post(
    url := 'https://axaebqeezpgbvvkivnqn.supabase.co/functions/v1/dynamic-function',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4YWVicWVlenBnYnZ2a2l2bnFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4OTkxNzUsImV4cCI6MjEwMDQ3NTE3NX0.uu82si5hlYV5dSBGTrrorAS465Yo8FwakNU86fSY6Vw',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4YWVicWVlenBnYnZ2a2l2bnFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4OTkxNzUsImV4cCI6MjEwMDQ3NTE3NX0.uu82si5hlYV5dSBGTrrorAS465Yo8FwakNU86fSY6Vw'
    ),
    body := '{"action":"refresh"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

select jobid, jobname, schedule, active from cron.job where jobname = 'ladyploy-ai-trends';
