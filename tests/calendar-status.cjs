const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const code = script.slice(script.indexOf('const metaPattern'), script.indexOf('function toggleColumn'));
const dashboardCode = script.slice(script.indexOf('function isCalendarScheduled'), script.indexOf('let dashboardView'));

async function roundTrip(status) {
    let stored = {id: 'test', title: 'Test', content: '<p>Body</p>', status,
        created_at: '2026-11-01', updated_at: '2026-11-14', post_date: null};
    let pending, conflict = false;
    const query = {
        update(row) { pending = row; return this; },
        eq() { return this; }, is() { return this; }, select() { return this; },
        async maybeSingle() {
            if (conflict) return {data: null, error: null};
            stored = {...pending}; return {data: stored, error: null};
        }
    };
    const ctx = vm.createContext({originalRows: new Map(), sb: {from: () => query},
        STATUS_LABELS: {waiting_clip: 'Waiting', making_clip: 'Clip', making_image: 'Image', ready: 'Ready', posted: 'Posted'},
        loadData: () => ({contents: []}), genId: () => 'test', showToast() {}});
    vm.runInContext(code, ctx);
    vm.runInContext(dashboardCode, ctx);
    ctx.row = stored;
    vm.runInContext("var item=unpackContent(row);item.calendarPreviousStatus=item.status;setQueuePosition(item,'posted');item.postDate='2026-11-15'", ctx);
    assert.equal(await vm.runInContext('saveContent(item)', ctx), true);
    assert.equal(stored.status, 'posted');
    assert.equal(vm.runInContext('dashboardViews.scheduled[1](item)', ctx), true);
    assert.equal(vm.runInContext('dashboardViews.posted[1](item)', ctx), false);
    assert.ok(vm.runInContext('item.postedAt > 0', ctx));
    // Reload from persisted metadata, then move to another calendar date.
    ctx.row = stored;
    vm.runInContext("item=unpackContent(row);item.postDate='2026-11-16'", ctx);
    await vm.runInContext('saveContent(item)', ctx);
    assert.equal(vm.runInContext('item.calendarPreviousStatus', ctx), status);
    assert.equal(vm.runInContext('dashboardViews.scheduled[1](item)', ctx), true);
    // Conflicting removal must leave the persisted status/date intact.
    conflict = true;
    vm.runInContext('item.postDate=null;restoreCalendarStatus(item)', ctx);
    assert.equal(await vm.runInContext('saveContent(item)', ctx), false);
    assert.equal(stored.status, 'posted');
    assert.equal(stored.post_date, '2026-11-16');
    conflict = false;
    vm.runInContext('item.postDate=null;restoreCalendarStatus(item)', ctx);
    assert.equal(await vm.runInContext('saveContent(item)', ctx), true);
    assert.equal(stored.status, status);
    assert.equal(stored.post_date, null);
    assert.equal(vm.runInContext('item.postedAt', ctx), 0);
    assert.equal(vm.runInContext('item.calendarPreviousStatus', ctx), null);
    assert.equal(vm.runInContext('dashboardViews.scheduled[1](item)', ctx), false);
    assert.equal(vm.runInContext('dashboardViews.posted[1](item)', ctx), false);
    assert.equal(vm.runInContext('dashboardViews.waiting[1](item)', ctx), status === 'waiting_clip');
    assert.equal(vm.runInContext('dashboardViews.unscheduled[1](item)', ctx), status === 'ready');
    assert.equal(vm.runInContext('item.content', ctx), '<p>Body</p>');
    // Legacy metadata stays readable and can use an explicitly selected status.
    ctx.row = {...stored, content: '<!--teamflow-queue:v1 m 123--><p>Old</p>', status: 'posted'};
    assert.equal(vm.runInContext('dashboardViews.posted[1](unpackContent(row))', ctx), true);
    vm.runInContext("item=unpackContent(row);restoreCalendarStatus(item,'ready')", ctx);
    assert.equal(vm.runInContext('item.status', ctx), 'ready');
    assert.equal(vm.runInContext('item.content', ctx), '<p>Old</p>');
}
(async () => {
    for (const status of ['waiting_clip', 'making_clip', 'making_image', 'ready']) await roundTrip(status);
    console.log('PASS: all original statuses, reload, move date, conflict rollback, removal and legacy records');
})().catch(error => { console.error(error); process.exitCode = 1; });
