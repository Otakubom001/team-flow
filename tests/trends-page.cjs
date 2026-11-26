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
assert.deepStrictEqual(Object.keys(T.CATEGORIES), ['all', 'ai_tools', 'image', 'video', 'search_trend', 'ai_news']);

console.log('PASS: safe links only, Thai time independent of device timezone, escaped idea body with source, duplicate idea detection, missing-table states');
