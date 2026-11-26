// Run: deno test tests/ai-trends.test.ts
import { categorize, COOLDOWN_MS, createHandler, isAiRelated, parseFeed, parseHfModels, parseTraffic, safeHttps } from '../supabase/functions/ai-trends/index.ts';
const assert = (v: unknown, m = 'Assertion failed') => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(JSON.stringify(a) + ' !== ' + JSON.stringify(b)); };

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title><![CDATA[OpenAI เปิดตัว Sora รุ่นใหม่ สร้างวิดีโอได้ยาวขึ้น]]></title><link>https://example.test/a</link><pubDate>Tue, 03 Nov 2026 05:10:41 +0000</pubDate></item>
<item><title>Midjourney อัปเดตโมเดลสร้างภาพ</title><link>https://example.test/b</link><pubDate>bad date</pubDate></item>
<item><title>ราคาทองวันนี้</title><link>https://example.test/c</link></item>
<item><title>AINU บริษัทยืนยันตัวตน</title><link>https://example.test/d</link></item>
<item><title>Gemini &amp; Claude ช่วยเขียน &#3585;&#3634;&#3619;</title><link>https://example.test/e</link></item>
<item><title>AI ผ่าน http</title><link>http://insecure.test/x</link></item>
<item><title>ข่าวที่หมวดบอกว่าเกี่ยวกับ AI</title><category>AI</category><link>https://example.test/f</link></item>
<item><title><script>alert(1)</script>AI กับความปลอดภัย</title><link>https://example.test/g</link></item>
<item><title>AI ซ้ำ</title><link>https://example.test/a</link></item>
</channel></rss>`;

const TRENDS = `<?xml version="1.0"?><rss xmlns:ht="https://trends.google.com/trending/rss"><channel>
<item><title>ม่วย นิธิตรา</title><ht:approx_traffic>100+</ht:approx_traffic><link>https://trends.google.com/trending/rss?geo=TH</link>
<pubDate>Thu, 26 Nov 2026 06:10:00 -0800</pubDate><ht:news_item><ht:news_item_title>ข่าวบันเทิง</ht:news_item_title></ht:news_item></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>ChatGPT มีฟีเจอร์ใหม่</title><link href="https://example.test/atom"/><updated>2026-11-20T10:00:00Z</updated></entry></feed>`;

Deno.test('AI filter and categories', () => {
  assert(isAiRelated('ใช้ AI ทำงาน') && isAiRelated('ปัญญาประดิษฐ์') && isAiRelated('ChatGPT'));
  assert(!isAiRelated('AINU บริษัท') && !isAiRelated('ราคาทอง') && !isAiRelated('เกม Fortnite'));
  eq(categorize('Sora สร้างวิดีโอ', 'rss'), 'video');
  eq(categorize('สร้างภาพด้วย Firefly', 'rss'), 'image');
  eq(categorize('Gemini มีฟีเจอร์ใหม่', 'rss'), 'ai_tools');
  eq(categorize('รัฐบาลออกนโยบาย AI', 'rss'), 'ai_news');
  eq(categorize('อะไรก็ได้', 'google_trends'), 'search_trend');
  eq(categorize('อะไรก็ได้', 'youtube'), 'video_clip');
  // New model launches beat the other categories; feature posts do not count as models.
  eq(categorize('GPT-6 models demonstrate protein design', 'rss'), 'new_model');
  eq(categorize('Google เปิดตัว Veo 4 สร้างวิดีโอ', 'rss'), 'new_model');
  eq(categorize('Introducing Tool Retrieval in the Gemini API', 'rss'), 'ai_tools');
  eq(parseTraffic('100+'), 100); eq(parseTraffic('2,000+'), 2000); eq(parseTraffic('20K+'), 20000); eq(parseTraffic('1M+'), 1000000); eq(parseTraffic(''), null);
  eq(safeHttps('javascript:alert(1)'), null);
  eq(safeHttps('https://user:pw@example.test/'), null);
});

Deno.test('RSS parsing keeps only safe AI items with decoded text', () => {
  const items = parseFeed(RSS, { kind: 'rss', ai_only: true });
  eq(items.map(i => i.url), ['https://example.test/a', 'https://example.test/b', 'https://example.test/e', 'https://example.test/f', 'https://example.test/g']);
  eq(items[0].title, 'OpenAI เปิดตัว Sora รุ่นใหม่ สร้างวิดีโอได้ยาวขึ้น');
  eq(items[0].category, 'video');
  eq(items[0].published_at, '2026-11-03T05:10:41.000Z');
  eq(items[1].published_at, null);
  eq(items[1].category, 'new_model'); // "อัปเดตโมเดล"
  eq(items[2].title, 'Gemini & Claude ช่วยเขียน การ');
  assert(!items[4].title.includes('<'), 'markup stripped');
  // Non-AI sources keep everything with a safe, unique link (drops the http and duplicate items).
  eq(parseFeed(RSS, { kind: 'rss', ai_only: false }).length, 7);
});

Deno.test('Google Trends and Atom', () => {
  const [trend] = parseFeed(TRENDS, { kind: 'google_trends', ai_only: false });
  eq(trend.url, 'https://trends.google.com/trends/explore?geo=TH&q=' + encodeURIComponent('ม่วย นิธิตรา'));
  eq(trend.category, 'search_trend');
  eq(trend.detail, 'ปริมาณค้นหา 100+ · ข่าวที่เกี่ยวข้อง: ข่าวบันเทิง');
  eq(trend.published_at, '2026-11-26T14:10:00.000Z');
  eq(trend.metric, 100);
  const [atom] = parseFeed(ATOM, { kind: 'rss', ai_only: true });
  eq([atom.url, atom.category], ['https://example.test/atom', 'ai_tools']);
});

const NOW = Date.parse('2026-11-27T03:00:00Z');
const HF = [
  { id: 'lab/new-model', likes: 6161, downloads: 96527, trendingScore: 1374.5, createdAt: '2026-11-17T00:26:57.000Z', pipeline_tag: 'image-text-to-text' },
  { id: 'lab/old-model', likes: 9, downloads: 1, trendingScore: 900, createdAt: '2025-01-01T00:00:00.000Z' },
  { id: '../../evil', likes: 1, trendingScore: 5, createdAt: '2026-11-20T00:00:00.000Z' },
  { id: 'unsloth/New-Model-GGUF', likes: 1, trendingScore: 800, createdAt: '2026-11-20T00:00:00.000Z' },
  { id: 'someone/New-Model-Uncensored', likes: 1, trendingScore: 700, createdAt: '2026-11-20T00:00:00.000Z' },
];

Deno.test('Hugging Face: only recent, well-formed model ids', () => {
  const items = parseHfModels(HF, NOW);
  eq(items.map(i => [i.url, i.metric, i.category]), [['https://huggingface.co/lab/new-model', 1375, 'new_model']]);
  eq(items[0].detail, 'image-text-to-text · ถูกใจ 6,161 · ดาวน์โหลด 96,527');
  let threw = false; try { parseHfModels({ error: 'x' }, NOW); } catch { threw = true; }
  assert(threw, 'non-array rejected');
});

function harness(opts: { lastRun?: string; badStore?: boolean; youtubeKey?: string; youtubeQuota?: boolean } = {}) {
  const now = NOW;
  const inserted: any[] = [], runs: any[] = [], deletes: string[] = [], prefer: string[] = [];
  let youtubeUrls: string[] = [];
  const sources = [
    { id: 'blognone', feed_url: 'https://www.blognone.com/atom.xml', kind: 'rss', ai_only: true },
    { id: 'google_trends_th', feed_url: 'https://trends.google.com/trending/rss?geo=TH', kind: 'google_trends', ai_only: false },
    { id: 'broken', feed_url: 'https://down.test/feed', kind: 'rss', ai_only: true },
    { id: 'huggingface', feed_url: 'https://huggingface.co/api/models?sort=trendingScore', kind: 'hf_models', ai_only: false },
    { id: 'youtube_th', feed_url: 'https://www.googleapis.com/youtube/v3/search', kind: 'youtube', ai_only: false },
  ];
  const env: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'server-secret' };
  if (opts.youtubeKey) env.YOUTUBE_API_KEY = opts.youtubeKey;
  const handler = createHandler({
    now: () => now,
    env: n => env[n],
    fetch: async (url, init) => {
      const path = String(url), body = init?.body ? JSON.parse(String(init.body)) : null;
      if (path.startsWith('https://db.test/rest/v1/')) {
        assert((init?.headers as any).Authorization === 'Bearer server-secret');
        if (path.includes('ai_trend_runs?') && init?.method !== 'DELETE') return Response.json(opts.lastRun ? [{ started_at: opts.lastRun }] : []);
        if (path.includes('ai_trend_sources?')) return Response.json(sources);
        if (path.includes('ai_trend_items?on_conflict')) {
          if (opts.badStore) return new Response('', { status: 500 });
          prefer.push((init?.headers as any).Prefer); inserted.push(...body); return new Response(null, { status: 201 });
        }
        if (path.endsWith('/ai_trend_runs')) { runs.push(body); return new Response(null, { status: 201 }); }
        if (init?.method === 'DELETE') { deletes.push(path); return new Response(null, { status: 204 }); }
        throw new Error('unexpected db call ' + path);
      }
      if (path === 'https://www.blognone.com/atom.xml') return new Response(RSS);
      if (path.startsWith('https://trends.google.com/')) return new Response(TRENDS);
      if (path.startsWith('https://huggingface.co/api/models')) return Response.json(HF);
      if (path === 'https://down.test/feed') return new Response('oops', { status: 502 });
      if (path.startsWith('https://www.googleapis.com/youtube/v3/')) {
        youtubeUrls.push(path);
        if (opts.youtubeQuota) return Response.json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 });
        if (path.includes('/search?')) return Response.json({ items: [
          { id: { videoId: 'abcdefghijk' }, snippet: { title: 'สอน AI &amp; ChatGPT', channelTitle: 'ช่องสอน', publishedAt: '2026-11-25T10:00:00Z' } },
          { id: { videoId: 'bad id!' }, snippet: { title: 'x' } },
        ] });
        if (path.includes('/videos?')) return Response.json({ items: [{ id: 'abcdefghijk', statistics: { viewCount: '123456' } }] });
      }
      throw new Error('unexpected fetch ' + path);
    },
  });
  const call = (body: unknown, origin = 'https://otakubom001.github.io', method = 'POST') =>
    handler(new Request('https://fn.test/ai-trends', { method, headers: { origin, 'content-type': 'application/json', authorization: 'Bearer anon' }, body: method === 'POST' ? JSON.stringify(body) : undefined }));
  return { call, inserted, runs, deletes, prefer, now, youtubeUrls: () => youtubeUrls };
}

Deno.test('refresh stores items, logs every source and isolates a failing feed', async () => {
  const h = harness();
  const res = await h.call({ action: 'refresh' });
  const json = await res.json();
  eq(res.status, 200);
  eq(json.results.map((r: any) => [r.source, r.ok]), [['blognone', true], ['google_trends_th', true], ['broken', false], ['huggingface', true], ['youtube_th', false]]);
  assert(h.inserted.every(i => i.studio_id === 'ladyploy' && i.fetched_at === new Date(NOW).toISOString()), 'all items belong to Ladyploy');
  eq(h.inserted.filter(i => i.source_id === 'blognone').length, 5);
  eq(h.inserted.find(i => i.source_id === 'google_trends_th').metric, 100);
  assert(h.prefer.every(p => p.includes('merge-duplicates')), 'counts refresh on later runs');
  eq(h.runs.length, 5);
  const broken = h.runs.find(r => r.source_id === 'broken');
  eq([broken.ok, broken.item_count, broken.error], [false, 0, 'แหล่งข่าวตอบกลับ HTTP 502']);
  // Without a key YouTube is reported as not configured, never called.
  eq(h.runs.find(r => r.source_id === 'youtube_th').error, 'ยังไม่ได้ตั้งค่า YOUTUBE_API_KEY');
  eq(h.youtubeUrls().length, 0);
  assert(h.deletes.some(d => d.includes('ai_trend_items?studio_id=eq.ladyploy') && d.includes('fetched_at=lt.')), 'old items pruned for Ladyploy only');
  assert(h.deletes.some(d => d.includes('ai_trend_runs?studio_id=eq.ladyploy') && d.includes('started_at=lt.')), 'old run logs pruned');
});

Deno.test('YouTube: most-viewed AI clips with view counts, safe ids, quota errors', async () => {
  const h = harness({ youtubeKey: 'yt-key' });
  await h.call({ action: 'refresh' });
  const clips = h.inserted.filter(i => i.source_id === 'youtube_th');
  eq(clips.map(c => [c.title, c.url, c.metric, c.category, c.detail]),
    [['สอน AI & ChatGPT', 'https://www.youtube.com/watch?v=abcdefghijk', 123456, 'video_clip', 'ช่อง ช่องสอน · ยอดดู 123,456']]);
  const search = new URL(h.youtubeUrls()[0]);
  eq([search.searchParams.get('regionCode'), search.searchParams.get('order'), search.searchParams.get('publishedAfter')],
    ['TH', 'viewCount', new Date(NOW - 7 * 86400000).toISOString()]);
  const quota = harness({ youtubeKey: 'yt-key', youtubeQuota: true });
  await quota.call({ action: 'refresh' });
  const run = quota.runs.find(r => r.source_id === 'youtube_th');
  eq([run.ok, run.error], [false, 'ใช้โควตา YouTube API ของวันนี้หมดแล้ว']);
  assert(!JSON.stringify(quota.runs).includes('yt-key'), 'API key never logged');
});

Deno.test('cooldown, validation, origin and storage failure', async () => {
  const recent = new Date(Date.parse('2026-11-27T03:00:00Z') - COOLDOWN_MS + 60000).toISOString();
  const cooled = harness({ lastRun: recent });
  const skip = await (await cooled.call({ action: 'refresh' })).json();
  eq([skip.skipped, skip.lastRunAt], [true, recent]);
  eq(cooled.runs.length, 0);
  eq((await harness().call({ action: 'delete' })).status, 400);
  eq((await harness().call({ action: 'refresh' }, 'https://evil.test')).status, 403);
  eq((await harness().call(null, 'https://otakubom001.github.io', 'GET')).status, 405);
  const bad = harness({ badStore: true });
  const out = await (await bad.call({ action: 'refresh' })).json();
  eq(out.results.find((r: any) => r.source === 'blognone').error, 'บันทึกข่าวไม่สำเร็จ');
});
