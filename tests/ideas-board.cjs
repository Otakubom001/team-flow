// Run: node tests/ideas-board.cjs
const assert = require('assert');
const I = require('../ideas.js');

// Month keys follow Thai time: 17:30 UTC on 30 Nov is already December in Thailand.
assert.strictEqual(I.monthKey(Date.parse('2026-11-30T17:30:00Z')), '2026-12');
assert.strictEqual(I.monthKey('2026-11-30T16:59:00Z'), '2026-11');
assert.strictEqual(I.addMonths('2026-12', 1), '2027-01');
assert.strictEqual(I.addMonths('2027-01', -1), '2026-12');
assert.strictEqual(I.addMonths('2026-11', 14), '2028-01');
assert.strictEqual(I.monthLabel('2026-12'), 'ธ.ค. 2569');
assert.strictEqual(I.monthLabel(null), 'กองไอเดีย');

// Tilt is stable per note and stays small.
assert.strictEqual(I.tilt('abc123'), I.tilt('abc123'));
for (const id of ['a1', 'zz9', 'mf3k2q', 'x']) assert.ok(Math.abs(I.tilt(id)) <= 2.75, id);

// Validation mirrors the table constraints.
const ok = { body: 'ไอเดีย', tag: '', color: 'pink', plan_month: '2026-12' };
assert.strictEqual(I.validateNote(ok), '');
assert.strictEqual(I.validateNote({ ...ok, plan_month: null }), '');
assert.ok(I.validateNote({ ...ok, body: '   ' }));
assert.ok(I.validateNote({ ...ok, body: 'x'.repeat(501) }));
assert.ok(I.validateNote({ ...ok, tag: 'x'.repeat(41) }));
assert.ok(I.validateNote({ ...ok, color: 'red' }));
assert.ok(I.validateNote({ ...ok, plan_month: '2026-13' }));
assert.deepStrictEqual(Object.keys(I.COLORS), ['yellow', 'pink', 'blue', 'green', 'orange', 'purple', 'white']);

// Story from a note: first line as title, body escaped, https source kept, others dropped.
const note = { body: 'คลิป <b>ปีใหม่</b>\nทำนายดวงด้วย AI', tag: '#เทศกาล & ปีใหม่', plan_month: '2026-12', source_url: 'https://example.test/a?x=1&y=2' };
const t = I.taskFromNote(note);
assert.strictEqual(t.title, 'คลิป <b>ปีใหม่</b>');
assert.ok(t.content.includes('คลิป &lt;b&gt;ปีใหม่&lt;/b&gt;<br>ทำนายดวงด้วย AI'));
assert.ok(t.content.includes('แท็ก: #เทศกาล &amp; ปีใหม่'));
assert.ok(t.content.includes('href="https://example.test/a?x=1&amp;y=2"'));
assert.ok(t.content.includes('แผนเดือน ธ.ค. 2569'));
assert.ok(!I.taskFromNote({ ...note, source_url: 'javascript:alert(1)' }).content.includes('href='));
assert.ok(I.taskFromNote({ ...note, plan_month: null }).content.includes('ยังไม่กำหนดเดือน'));

// Done = the linked story still exists; a deleted story makes the note plannable again.
const contents = [{ id: 'c1', status: 'making_clip' }];
const notes = [
    { id: 'n1', plan_month: '2026-12', content_id: 'c1', created_at: '2' },
    { id: 'n2', plan_month: '2026-12', content_id: 'gone', created_at: '1' },
    { id: 'n3', plan_month: null, created_at: '3', source_url: 'https://news.test/1' },
    { id: 'n4', plan_month: '2027-01', created_at: '4' }
];
assert.strictEqual(I.linkedContent(notes[0], contents).status, 'making_clip');
assert.strictEqual(I.linkedContent(notes[1], contents), null);
assert.deepStrictEqual(I.monthSummary(notes, contents, '2026-12'), { total: 2, done: 1, pile: 1 });
assert.ok(I.hasSource(notes, 'https://news.test/1') && !I.hasSource(notes, 'https://news.test/2') && !I.hasSource(notes, 'nope'));
assert.deepStrictEqual(I.sortNotes(notes).map(n => n.id), ['n2', 'n1', 'n3', 'n4']);

console.log('PASS: Thai-time month keys, month math and labels, stable tilt, validation matching the table, escaped story from a note, done status from live stories, month summary, duplicate source detection');
