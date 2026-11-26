# Studios (อีนิล + Ladyploy.Studio) และหน้า "กระแส AI": วิธีติดตั้ง

ยังไม่ได้รันกับฐานข้อมูลจริงและยังไม่ได้ deploy ทำตามลำดับนี้หลังตรวจทาน SQL แล้ว

## ก่อนเริ่ม

- หน้าเว็บเวอร์ชันใหม่ใช้งานได้ทั้งก่อนและหลังรัน migration
  ก่อนรันจะมีแค่อีนิล และปุ่ม Ladyploy.Studio ถูกปิดไว้
- ระบบโพสต์ Buffer ของอีนิล (`publishers`, `publishing_*`, bucket `publishing-media`)
  และ PIN ในตาราง `settings` ไม่ถูกแก้ไข

## 1. สำรองข้อมูล

Supabase Dashboard → Table Editor → `contents` และ `events` → Export → CSV
เก็บไฟล์ไว้ก่อนรัน migration

## 2. รัน migration

SQL Editor → New query → วางไฟล์ `migrations/202611270001_studios.sql` ทั้งไฟล์ → Run

ผลที่ควรได้: `Success. No rows returned`
ถ้ามี error ใดๆ ทั้งไฟล์จะถูกยกเลิกเอง (อยู่ใน `begin … commit`) ข้อมูลเดิมไม่เปลี่ยน

ตรวจผลด้วย query ใหม่:

```sql
select studio_id, count(*) from contents group by 1;   -- ทุกแถวต้องเป็น enil
select studio_id, count(*) from events group by 1;     -- ทุกแถวต้องเป็น enil
select id, name from studios;                          -- enil, ladyploy
select tablename, policyname, cmd, roles from pg_policies
 where tablename in ('contents','events','settings') order by 1;
```

## 3. ติดตั้งฟังก์ชันดึงข่าว `ai-trends`

> ติดตั้งแล้ว (2026-11-27): Dashboard ตั้งชื่อฟังก์ชันเป็น `dynamic-function`
> หน้าเว็บเรียกชื่อนี้ (`TRENDS_FUNCTION` ใน `trends.js`) เมื่อแก้โค้ดให้อัปเดตฟังก์ชันเดิม
> ด้วย `functions/ai-trends/index.ts` แล้วกด Deploy updates อย่าสร้างฟังก์ชันใหม่ซ้ำ

1. Edge Functions → Deploy a new function → Via Editor
2. ตั้งชื่อ `ai-trends` เก็บชื่อไฟล์ `index.ts` วางโค้ดจาก `functions/ai-trends/index.ts` → Deploy
3. Settings ของฟังก์ชัน: เปิด **Verify JWT** ไว้ (ค่าเริ่มต้น) หน้าเว็บเรียกด้วย anon key ซึ่งเป็น JWT
4. ไม่ต้องเพิ่ม secret ใหม่ ฟังก์ชันใช้ `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY`
   ที่ Supabase ใส่ให้อัตโนมัติ ห้ามนำ service role key ไปใส่ในหน้าเว็บ
5. ถ้าเว็บไม่ได้อยู่ที่ `https://otakubom001.github.io` ให้ตั้ง secret `TRENDS_ORIGIN` เป็นโดเมนของเว็บ

ทดสอบ: เข้าเว็บ → สลับเป็น Ladyploy.Studio → กระแส AI → กด "อัปเดตข่าว"
ระบบดึงใหม่ได้ทุก 15 นาที เรียกถี่กว่านั้นจะแสดงข้อมูลที่บันทึกไว้

แหล่งข้อมูลอยู่ในตาราง `ai_trend_sources` ปิดแหล่งไหนได้โดยตั้ง `enabled = false`
ผลการดึงแต่ละครั้ง (เวลา สำเร็จหรือไม่ จำนวน และสาเหตุที่ล้มเหลว) อยู่ใน `ai_trend_runs`

## 4. Deploy หน้าเว็บ

อัปโหลด/commit ไฟล์ `index.html`, `theme-init.js`, `studios.css`, `trends.js` ขึ้น GitHub Pages

## เรื่องสิทธิ์การเข้าถึง (สำคัญ)

เว็บยังเข้าด้วย PIN ร่วมกันเหมือนเดิม และตาราง `contents` / `events` ยังเปิดให้ anon key อ่าน/เขียนได้ทั้งหมด
การแยก Studio จึงป้องกันได้แค่ **การหยิบข้อมูลผิด Studio โดยไม่ตั้งใจ**:

- หน้าเว็บโหลด บันทึก แก้ และลบโดยระบุ `studio_id` เสมอ และตัดแถวของ Studio อื่นทิ้งซ้ำอีกชั้น
- ฐานข้อมูลห้ามย้ายงานหรือกำหนดการข้าม Studio และห้ามผูกกำหนดการกับเนื้อเรื่องของอีก Studio

แต่ **ไม่สามารถกันคนที่มี anon key (อยู่ในซอร์สหน้าเว็บ) ไม่ให้อ่านหรือแก้ข้อมูลของอีก Studio ได้**
และค่า PIN ในตาราง `settings` ก็อ่านได้ด้วย key เดียวกัน
ถ้าต้องการกันสิทธิ์จริง ต้องเปลี่ยนเป็นให้แต่ละคน login ด้วยบัญชีของตัวเอง (Supabase Auth)
แล้วเขียน RLS ตามสมาชิกของแต่ละ Studio

ตาราง `ai_trend_*` อ่านได้อย่างเดียวจากหน้าเว็บ เขียนได้เฉพาะฟังก์ชัน `ai-trends`

## ย้อนกลับ

SQL Editor → วาง `migrations/202611270001_studios_rollback.sql` → Run
- ถ้า Ladyploy.Studio มีงานหรือกำหนดการแล้ว สคริปต์จะหยุดเองโดยไม่แก้อะไร
  ให้ export ข้อมูล Ladyploy ออกก่อน แล้วค่อยลบเอง
- งานของอีนิลไม่ถูกแก้ไข สคริปต์แค่ลบคอลัมน์ `studio_id` และตารางใหม่ออก
- ลบฟังก์ชัน `ai-trends` ได้ที่ Edge Functions

## การทดสอบในเครื่อง

```
node tests/studios-migration.cjs      # migration บน Postgres จริง (PGlite)
node tests/trends-page.cjs
node tests/calendar-status.cjs
deno test tests/ai-trends.test.ts
node tests/fake-supabase.cjs 8090     # เปิดเว็บกับฐานข้อมูลจำลองที่ http://localhost:8090 (PIN ทดสอบ 1234)
```

ไฟล์ทดสอบที่ใช้ PGlite ต้องติดตั้งก่อน: `npm install @electric-sql/pglite@0.2.17`
แล้วรันด้วย `NODE_PATH=<โฟลเดอร์ node_modules>` หรือ `--pglite=<โฟลเดอร์ที่มี node_modules>`
