// Tests supabase/migrations/202611270001_studios.sql on a real Postgres engine (PGlite).
// Run: NODE_PATH=<folder containing node_modules/@electric-sql/pglite> node tests/studios-migration.cjs
// The baseline mirrors production: contents/events created manually with allow-all
// policies for the anon key (the website uses a PIN screen, not database accounts).
const fs = require('fs'), path = require('path'), assert = require('assert');
const {pathToFileURL} = require('url');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/202611270001_studios.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root, 'supabase/migrations/202611270001_studios_rollback.sql'), 'utf8');

const baseline = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table contents (id text primary key, title text, content text, assigned_to text, status text,
  post_date text, created_at text, updated_at text, voiced boolean default false);
create table events (id text primary key, title text, date text, type text, content_id text, description text);
create table settings (key text primary key, value text);
alter table contents enable row level security; alter table events enable row level security;
alter table settings enable row level security;
create policy "public_contents" on contents for all using (true) with check (true);
create policy "public_events" on events for all using (true) with check (true);
create policy "public_settings" on settings for all using (true) with check (true);
grant usage on schema public to anon, authenticated, service_role;
grant all on contents, events, settings to anon, authenticated, service_role;
`;

async function asRole(db, role, sql, params) {
  await db.exec('set role ' + role);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
async function rejects(promise, pattern, label) {
  try { await promise; } catch (e) { assert.match(e.message, pattern, label); return; }
  assert.fail(label + ': expected an error');
}

(async () => {
  const {PGlite} = await import(pathToFileURL(require.resolve('@electric-sql/pglite')).href);
  const db = new PGlite();
  await db.exec(baseline);

  // Seed existing อีนิล data, including the queue-marker prefix and legacy null fields.
  for (let i = 0; i < 120; i++) {
    await db.query('insert into contents values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
      'old' + i, 'เรื่องเดิม ' + i, '<!--teamflow-queue:v1 mab 0-->เนื้อหา ' + i,
      ['พลอย', 'บอม', 'เพชร'][i % 3], ['waiting_clip', 'ready', 'posted'][i % 3],
      i % 4 ? '2026-11-' + String(1 + i % 28).padStart(2, '0') : null,
      '2026-10-01T00:00:00Z', i % 5 ? '2026-11-0' + (1 + i % 9) + 'T00:00:00Z' : null, i % 2 === 0]);
  }
  await db.query("insert into events values ('ev1','โพสต์','2026-11-20','post_schedule','old1','')," +
    "('ev2','สำคัญ','2026-11-21','important',null,''),('ev3','ผูกงานที่ถูกลบ','2026-11-22','important','gone','')");
  await db.query("insert into settings values ('pin','1234')");
  const before = (await db.query('select * from contents order by id')).rows;
  const eventsBefore = (await db.query('select * from events order by id')).rows;

  await db.exec(migration);
  await db.exec(migration); // must be safe to re-run

  // 1. All existing work stays in อีนิล, every other column unchanged.
  const after = (await db.query('select * from contents order by id')).rows;
  assert.strictEqual(after.length, before.length);
  after.forEach((row, i) => {
    assert.strictEqual(row.studio_id, 'enil');
    const {studio_id, ...rest} = row;
    assert.deepStrictEqual(rest, before[i]);
  });
  const evAfter = (await db.query('select * from events order by id')).rows;
  evAfter.forEach((row, i) => { const {studio_id, ...rest} = row; assert.strictEqual(studio_id, 'enil'); assert.deepStrictEqual(rest, eventsBefore[i]); });
  assert.strictEqual((await db.query("select value from settings where key='pin'")).rows[0].value, '1234');

  // 2. Ladyploy starts empty.
  assert.strictEqual((await db.query("select count(*)::int n from contents where studio_id='ladyploy'")).rows[0].n, 0);
  assert.strictEqual((await db.query("select count(*)::int n from events where studio_id='ladyploy'")).rows[0].n, 0);
  assert.deepStrictEqual((await asRole(db, 'anon', 'select id,name from studios order by id')).rows,
    [{id: 'enil', name: 'อีนิล'}, {id: 'ladyploy', name: 'Ladyploy.Studio'}]);

  // 3. Create, edit, delete in Ladyploy through the anon key without touching อีนิล.
  const enilSnapshot = JSON.stringify((await db.query("select * from contents where studio_id='enil' order by id")).rows);
  await asRole(db, 'anon', "insert into contents (id,title,status,studio_id,created_at,updated_at) values ('lp1','สอน AI','waiting_clip','ladyploy','t','t')");
  await asRole(db, 'anon', "update contents set title='สอน AI ตอน 2', updated_at='t2' where id='lp1' and studio_id='ladyploy'");
  await asRole(db, 'anon', "insert into events (id,title,date,type,content_id,studio_id) values ('lpe','ถ่าย','2026-12-01','important','lp1','ladyploy')");
  // A Ladyploy-scoped delete cannot remove อีนิล rows even with a matching id.
  const del = await asRole(db, 'anon', "delete from contents where id='old1' and studio_id='ladyploy' returning id");
  assert.strictEqual(del.rows.length, 0);
  await asRole(db, 'anon', "delete from events where content_id='lp1' and studio_id='ladyploy'");
  await asRole(db, 'anon', "delete from contents where id='lp1' and studio_id='ladyploy'");
  assert.strictEqual(JSON.stringify((await db.query("select * from contents where studio_id='enil' order by id")).rows), enilSnapshot);

  // Old cached website versions that omit studio_id still save into อีนิล.
  await asRole(db, 'anon', "insert into contents (id,title,status) values ('legacy','จากหน้าเว็บเก่า','waiting_clip')");
  assert.strictEqual((await db.query("select studio_id from contents where id='legacy'")).rows[0].studio_id, 'enil');
  await db.query("delete from contents where id='legacy'");

  // 4. Existing work can never be moved between studios; events cannot link across studios.
  await rejects(asRole(db, 'anon', "update contents set studio_id='ladyploy' where id='old2'"), /เปลี่ยนไม่ได้/, 'move content');
  await rejects(asRole(db, 'anon', "update events set studio_id='ladyploy' where id='ev1'"), /เปลี่ยนไม่ได้/, 'move event');
  await rejects(asRole(db, 'anon', "insert into events (id,title,date,type,content_id,studio_id) values ('x','x','2026-12-01','important','old1','ladyploy')"),
    /Studio เดียวกัน/, 'cross-studio event');
  await rejects(asRole(db, 'anon', "insert into contents (id,title,studio_id) values ('bad','x','nope')"), /foreign key/, 'unknown studio');
  // Legacy event whose content was deleted can still be edited.
  await asRole(db, 'anon', "update events set title='แก้ได้' where id='ev3'");

  // 5. Trend tables: readable, never writable from the website key.
  assert.strictEqual((await asRole(db, 'anon', 'select count(*)::int n from ai_trend_sources')).rows[0].n, 6);
  await rejects(asRole(db, 'anon', "insert into ai_trend_items (source_id,title,url,category) values ('blognone','x','https://x.test','ai_news')"), /permission denied/, 'anon insert trend');
  await rejects(asRole(db, 'anon', "insert into ai_trend_runs (source_id) values ('blognone')"), /permission denied/, 'anon insert run');
  await rejects(asRole(db, 'anon', "delete from ai_trend_sources"), /permission denied/, 'anon delete source');
  await asRole(db, 'service_role', "insert into ai_trend_items (source_id,title,url,category) values ('blognone','ข่าว AI','https://www.blognone.com/node/1','ai_news')");
  await rejects(asRole(db, 'service_role', "insert into ai_trend_items (source_id,title,url,category) values ('blognone','x','http://insecure.test','ai_news')"), /check constraint/, 'https only');
  assert.strictEqual((await asRole(db, 'anon', 'select studio_id from ai_trend_items')).rows[0].studio_id, 'ladyploy');

  // 6. Trend sections migration: new sources, categories and metric; still read-only for the site.
  const sections = fs.readFileSync(path.join(root, 'supabase/migrations/202611270002_trends_sections.sql'), 'utf8');
  const sectionsRollback = fs.readFileSync(path.join(root, 'supabase/migrations/202611270002_trends_sections_rollback.sql'), 'utf8');
  await db.exec(sections);
  await db.exec(sections); // re-run safe
  assert.strictEqual((await asRole(db, 'anon', 'select count(*)::int n from ai_trend_sources')).rows[0].n, 10);
  assert.deepStrictEqual((await db.query("select id, kind, language from ai_trend_sources where language='en' order by id")).rows.map(r => r.id), ['google_ai', 'huggingface', 'openai']);
  await asRole(db, 'service_role', "insert into ai_trend_items (source_id,title,url,category,metric) values ('huggingface','lab/m','https://huggingface.co/lab/m','new_model',1375),('youtube_th','คลิป','https://www.youtube.com/watch?v=abcdefghijk','video_clip',123456)");
  await rejects(asRole(db, 'service_role', "insert into ai_trend_items (source_id,title,url,category,metric) values ('blognone','x','https://x.test/1','ai_news',-1)"), /check constraint/, 'metric >= 0');
  await rejects(asRole(db, 'service_role', "insert into ai_trend_items (source_id,title,url,category) values ('blognone','x','https://x.test/2','gossip')"), /check constraint/, 'unknown category');
  await rejects(asRole(db, 'anon', "update ai_trend_items set metric=0"), /permission denied/, 'anon update trend');
  assert.strictEqual(JSON.stringify((await db.query("select * from contents where studio_id='enil' order by id")).rows), enilSnapshot, 'work untouched by trends migration');
  await db.exec(sectionsRollback);
  assert.strictEqual((await db.query('select count(*)::int n from ai_trend_sources')).rows[0].n, 6);
  assert.strictEqual((await db.query("select count(*)::int n from ai_trend_items where category in ('new_model','video_clip')")).rows[0].n, 0);
  assert.ok(!(await db.query("select column_name from information_schema.columns where table_name='ai_trend_items'")).rows.some(r => r.column_name === 'metric'));
  await db.exec(sections); // apply again so the studios rollback below is tested with it present

  // Rollback refuses while Ladyploy owns data, then restores the original shape.
  await asRole(db, 'anon', "insert into contents (id,title,studio_id) values ('lp2','x','ladyploy')");
  await rejects(db.exec(rollback), /Studio อื่น/, 'rollback guard');
  await db.exec('rollback'); // the SQL Editor discards the failed transaction the same way
  assert.ok((await db.query("select to_regclass('public.studios') r")).rows[0].r, 'guard must leave schema intact');
  await db.query("delete from contents where id='lp2'");
  await db.exec(rollback);
  const cols = (await db.query("select column_name from information_schema.columns where table_name='contents' order by ordinal_position")).rows.map(r => r.column_name);
  assert.ok(!cols.includes('studio_id'));
  const restored = (await db.query('select * from contents order by id')).rows;
  assert.deepStrictEqual(restored, before);
  assert.strictEqual((await db.query("select to_regclass('public.studios') r")).rows[0].r, null);

  console.log('PASS: existing data stays in อีนิล unchanged, Ladyploy starts empty, scoped create/edit/delete, ' +
    'studio lock, cross-studio event guard, legacy clients, read-only trend tables, trend sections migration + rollback, re-run and guarded rollback');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
