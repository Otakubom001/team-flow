// Run: node tests/trends-page.cjs
const assert = require('assert');
const T = require('../trends.js');

assert.strictEqual(T.safeUrl('https://www.blognone.com/node/1'), 'https://www.blognone.com/node/1');
for (const bad of ['javascript:alert(1)', 'http://example.test', 'https://u:p@example.test', 'not a url', '', null]) {
    assert.strictEqual(T.safeUrl(bad), null, String(bad));
}

// Thai time is UTC+7 whatever the device timezone is.
assert.strictEqual(T.thaiDateTime('2026-11-26T17:30:00Z'), '27 พ.ย. 2569 00:30 น.');
assert.strictEqual(T.thaiDateTime('nope'), 'ไม่ระบุเวลา');

const item = { title: 'Sora <b>ใหม่</b> & "เร็วขึ้น"', url: 'https://example.test/a?x=1&y=2', category: 'video',
    published_at: '2026-11-25T03:00:00Z', fetched_at: '2026-11-27T02:00:00Z' };
const html = T.ideaHtml(item, 'Blognone <test>');
assert.ok(html.includes('Sora &lt;b&gt;ใหม่&lt;/b&gt; &amp; &quot;เร็วขึ้น&quot;'), 'title escaped');
assert.ok(html.includes('Blognone &lt;test&gt;'), 'source escaped');
assert.ok(html.includes('href="https://example.test/a?x=1&amp;y=2"'), 'link kept and escaped');
assert.ok(html.includes('หมวด สร้างวิดีโอ') && html.includes('25 พ.ย. 2569 10:00 น.') && html.includes('ดึงข้อมูลเมื่อ 27 พ.ย. 2569 09:00 น.'));
assert.ok(!T.ideaHtml({ ...item, url: 'javascript:alert(1)' }, 'x').includes('href='), 'unsafe link dropped');

assert.strictEqual(T.isSavedIdea([{ content: html }], item.url), true);
assert.strictEqual(T.isSavedIdea([{ content: html }], 'https://example.test/other'), false);
assert.strictEqual(T.isSavedIdea([{ content: null }], item.url), false);

assert.ok(T.isMissingTable({ code: 'PGRST205' }) && T.isMissingTable({ code: '42P01' }) && T.isMissingTable({ status: 404 }));
assert.ok(!T.isMissingTable({ code: '500' }) && !T.isMissingTable(null));
assert.deepStrictEqual(Object.keys(T.CATEGORIES), ['all', 'ai_tools', 'image', 'video', 'search_trend', 'ai_news', 'new_model', 'video_clip']);

// ---- Highlight sections ----
const NOW = Date.parse('2026-11-27T03:00:00Z');
const at = h => new Date(NOW - h * 3600000).toISOString();
const items = [
    // trending searches: only the latest snapshot counts, ranked by search volume
    { id: 1, category: 'search_trend', title: 'old trend', metric: 999999, fetched_at: at(5), published_at: at(5) },
    { id: 2, category: 'search_trend', title: 'small', metric: 200, fetched_at: at(0), published_at: at(1) },
    { id: 3, category: 'search_trend', title: 'big', metric: 20000, fetched_at: at(0), published_at: at(2) },
    // news: launches by major AI companies outrank generic news; > 7 days is excluded
    { id: 4, category: 'ai_news', title: 'บริษัทไทยจัดสัมมนา', fetched_at: at(0), published_at: at(1) },
    { id: 5, category: 'ai_tools', title: 'OpenAI เปิดตัวฟีเจอร์ใหม่ใน ChatGPT ฟรี', fetched_at: at(0), published_at: at(30) },
    { id: 6, category: 'ai_news', title: 'Google เปิดตัว Gemini', fetched_at: at(0), published_at: at(24 * 8) },
    // clips: latest search result ranked by views
    { id: 7, category: 'video_clip', title: 'clip low', metric: 10, fetched_at: at(0) },
    { id: 8, category: 'video_clip', title: 'clip high', metric: 5000, fetched_at: at(0) },
    // models: newest first, within 45 days
    { id: 9, category: 'new_model', title: 'older model', fetched_at: at(0), published_at: at(24 * 20) },
    { id: 10, category: 'new_model', title: 'newest model', fetched_at: at(0), published_at: at(3) },
    { id: 11, category: 'new_model', title: 'ancient model', fetched_at: at(0), published_at: at(24 * 60) }
];
const s = T.pickSections(items, NOW);
assert.deepStrictEqual(s.hot.map(i => i.title), ['big', 'small']);
assert.deepStrictEqual(s.watch.map(i => i.id), [5, 4]);
assert.deepStrictEqual(s.clips.map(i => i.title), ['clip high', 'clip low']);
assert.deepStrictEqual(s.models.map(i => i.title), ['newest model', 'older model']);
assert.ok(T.watchScore(items[4], NOW) > T.watchScore(items[3], NOW));
assert.deepStrictEqual(T.pickSections([], NOW), { hot: [], watch: [], clips: [], models: [] });

console.log('PASS: safe links only, Thai time independent of device timezone, escaped idea body with source, duplicate idea detection, missing-table states, highlight sections (latest trends by volume, keyword-scored news, clips by views, newest models)');
