// "กระแส AI" page for Ladyploy.Studio.
// Items come only from public.ai_trend_items, which the ai-trends Edge Function fills
// from real RSS feeds. The page never invents or shows sample headlines: when nothing
// has been fetched yet it says so.
(function (root) {
    'use strict';
    const STUDIO_ID = 'ladyploy';
    const CATEGORIES = {
        all: 'ทั้งหมด',
        ai_tools: 'เครื่องมือ AI',
        image: 'สร้างภาพ',
        video: 'สร้างวิดีโอ',
        search_trend: 'เทรนด์ค้นหา',
        ai_news: 'ข่าว AI'
    };
    const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

    // Only plain https links leave the page; anything else is treated as broken.
    function safeUrl(value) {
        try {
            const url = new URL(String(value));
            return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
        } catch (_) { return null; }
    }
    // Thai time (UTC+7) regardless of the viewer's device timezone.
    function thaiDateTime(value) {
        const t = Date.parse(value);
        if (!Number.isFinite(t)) return 'ไม่ระบุเวลา';
        const d = new Date(t + 7 * 3600000);
        return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + (d.getUTCFullYear() + 543) + ' ' +
            String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' น.';
    }
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    // Body for a new content idea: keeps the source link so the team can verify it later.
    function ideaHtml(item, sourceName) {
        const url = safeUrl(item.url);
        return '<p>ไอเดียจากหน้า “กระแส AI” · หมวด ' + escapeHtml(CATEGORIES[item.category] || item.category) + '</p>' +
            '<p>หัวข้อต้นฉบับ: ' + escapeHtml(item.title) + '</p>' +
            '<p>แหล่งที่มา: ' + escapeHtml(sourceName) + (url ? ' — <a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(url) + '</a>' : '') + '</p>' +
            '<p>เผยแพร่: ' + escapeHtml(item.published_at ? thaiDateTime(item.published_at) : 'ไม่ระบุ') +
            ' · ดึงข้อมูลเมื่อ ' + escapeHtml(thaiDateTime(item.fetched_at)) + '</p>' +
            '<p>ตรวจข้อเท็จจริงจากต้นฉบับก่อนทำคอนเทนต์</p>';
    }
    function isSavedIdea(contents, url) {
        const href = safeUrl(url);
        return !!href && contents.some(c => (c.content || '').includes('href="' + escapeHtml(href) + '"'));
    }
    // Missing tables = migration not applied; missing function = not deployed yet.
    function isMissingTable(error) {
        return !!error && (error.code === '42P01' || error.code === 'PGRST205' || error.status === 404);
    }

    const api = { CATEGORIES, safeUrl, thaiDateTime, ideaHtml, isSavedIdea, isMissingTable };
    if (typeof module === 'object' && module.exports) { module.exports = api; return; }

    // ---- Browser page --------------------------------------------------------
    const $ = id => document.getElementById(id);
    let state = { status: 'idle', items: [], sources: [], runs: [], error: '' };
    let category = 'all';
    let loadToken = 0;
    let refreshing = false;

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }
    function message(text) { $('trends-message').textContent = text || ''; }

    async function load() {
        const token = ++loadToken;
        state = { status: 'loading', items: [], sources: [], runs: [], error: '' };
        draw();
        const [sources, items, runs] = await Promise.all([
            sb.from('ai_trend_sources').select('id,name,homepage,kind,ai_only,enabled').order('id'),
            sb.from('ai_trend_items').select('id,source_id,title,url,category,detail,published_at,fetched_at')
                .eq('studio_id', STUDIO_ID).order('published_at', { ascending: false, nullsFirst: false }).limit(200),
            sb.from('ai_trend_runs').select('source_id,started_at,finished_at,ok,item_count,error')
                .eq('studio_id', STUDIO_ID).order('started_at', { ascending: false }).limit(120)
        ]);
        if (token !== loadToken) return;
        const failed = [sources, items, runs].find(r => r.error);
        if (failed) {
            state.status = isMissingTable(failed.error) ? 'not_installed' : 'error';
            state.error = failed.error.message || '';
        } else {
            state = { status: 'ready', items: items.data, sources: sources.data, runs: runs.data, error: '' };
        }
        draw();
    }

    function latestRun(sourceId) { return state.runs.find(r => r.source_id === sourceId); }

    function drawSources() {
        const box = $('trends-sources');
        box.replaceChildren();
        if (!state.sources.length) { box.append(el('p', 'empty-state', state.status === 'loading' ? 'กำลังโหลด…' : 'ยังไม่มีรายการแหล่งข้อมูล')); return; }
        for (const s of state.sources) {
            const row = el('div', 'trend-source');
            const link = el('a', 'trend-source-name', s.name);
            const home = safeUrl(s.homepage);
            if (home) { link.href = home; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
            row.append(link);
            const run = latestRun(s.id);
            const status = el('span', 'trend-source-status');
            if (!s.enabled) { status.textContent = 'ปิดใช้งาน'; status.dataset.kind = 'off'; }
            else if (!run) { status.textContent = 'ยังไม่ได้เชื่อม · ยังไม่เคยดึงข้อมูล'; status.dataset.kind = 'off'; }
            else if (run.ok) { status.textContent = 'อัปเดต ' + thaiDateTime(run.finished_at || run.started_at) + ' · ' + run.item_count + ' รายการ'; status.dataset.kind = 'ok'; }
            else { status.textContent = 'ดึงไม่สำเร็จ ' + thaiDateTime(run.started_at) + (run.error ? ' · ' + run.error : ''); status.dataset.kind = 'fail'; }
            row.append(status);
            if (s.kind === 'google_trends') row.append(el('span', 'trend-source-note', 'คำค้นทั่วไป ไม่ได้คัดเฉพาะ AI'));
            box.append(row);
        }
    }

    function drawFilters() {
        const box = $('trends-categories');
        box.replaceChildren();
        for (const [id, label] of Object.entries(CATEGORIES)) {
            const count = id === 'all' ? state.items.length : state.items.filter(i => i.category === id).length;
            const btn = el('button', 'trend-chip', label + ' ' + count);
            btn.type = 'button';
            btn.setAttribute('aria-pressed', String(id === category));
            btn.onclick = () => { category = id; draw(); };
            box.append(btn);
        }
    }

    function card(item) {
        const source = state.sources.find(s => s.id === item.source_id);
        const sourceName = source ? source.name : item.source_id;
        const url = safeUrl(item.url);
        const node = el('article', 'trend-card');
        const head = el('div', 'trend-card-head');
        const badge = el('span', 'trend-badge', CATEGORIES[item.category] || item.category);
        badge.dataset.category = item.category;
        head.append(badge, el('span', 'trend-source-label', sourceName));
        node.append(head, el('h3', 'trend-title', item.title));
        if (item.detail) node.append(el('p', 'trend-detail', item.detail));
        node.append(el('p', 'trend-meta', 'เผยแพร่ ' + (item.published_at ? thaiDateTime(item.published_at) : 'ไม่ระบุเวลา') + ' · ดึงเมื่อ ' + thaiDateTime(item.fetched_at)));
        const actions = el('div', 'trend-actions');
        if (url) {
            const open = el('a', 'btn btn-sm', 'เปิดต้นฉบับ ↗');
            open.href = url; open.target = '_blank'; open.rel = 'noopener noreferrer';
            actions.append(open);
        } else {
            actions.append(el('span', 'trend-broken', 'ลิงก์ต้นฉบับใช้ไม่ได้'));
        }
        const save = el('button', 'btn btn-sm btn-secondary');
        save.type = 'button';
        const saved = isSavedIdea(root.loadData().contents, item.url);
        save.textContent = saved ? 'บันทึกเป็นไอเดียแล้ว' : 'บันทึกเป็นไอเดีย';
        save.disabled = saved || !url || !root.dataReady;
        save.onclick = () => saveIdea(item, sourceName, save);
        actions.append(save);
        node.append(actions);
        return node;
    }

    function drawList() {
        const list = $('trends-list');
        list.replaceChildren();
        const notice = (title, text) => { const box = el('div', 'trends-empty'); box.append(el('strong', '', title), el('p', '', text)); list.append(box); };
        if (state.status === 'loading' || state.status === 'idle') { notice('กำลังโหลดกระแส AI…', ''); return; }
        if (state.status === 'not_installed') { notice('ยังไม่ได้ติดตั้งระบบกระแส AI', 'ต้องรัน migration ของ Studio ในฐานข้อมูลก่อน หน้านี้จึงยังไม่มีข้อมูลจริงให้แสดง'); return; }
        if (state.status === 'error') { notice('โหลดกระแส AI ไม่สำเร็จ', 'ลองกดอัปเดตข่าวหรือโหลดหน้าใหม่อีกครั้ง'); return; }
        if (!state.runs.length) { notice('ยังไม่ได้เชื่อมแหล่งข่าว', 'ยังไม่เคยดึงข้อมูลจริงสักครั้ง กด “อัปเดตข่าว” หลังติดตั้งฟังก์ชัน ai-trends แล้ว ระบบจะไม่แสดงข่าวตัวอย่างแทนข่าวจริง'); return; }
        const rows = state.items.filter(i => category === 'all' || i.category === category);
        if (!rows.length) { notice('ไม่มีรายการในหมวดนี้', 'แหล่งข่าวที่ดึงล่าสุดยังไม่มีหัวข้อที่ตรงกับหมวดนี้'); return; }
        rows.forEach(item => list.append(card(item)));
    }

    function draw() {
        drawFilters();
        drawList();
        drawSources();
        $('trends-refresh').disabled = refreshing || state.status === 'not_installed';
    }

    async function saveIdea(item, sourceName, button) {
        if (currentStudio !== STUDIO_ID || !root.dataReady) return;
        if (isSavedIdea(root.loadData().contents, item.url)) { button.disabled = true; return; }
        button.disabled = true;
        const now = new Date().toISOString();
        const idea = {
            id: root.genId(), title: String(item.title).slice(0, 200), content: ideaHtml(item, sourceName),
            assignedTo: null, status: 'waiting_clip', postDate: '', createdAt: now, updatedAt: now,
            voiced: false, studioId: STUDIO_ID
        };
        root.loadData().contents.push(idea);
        if (await root.saveContent(idea)) {
            button.textContent = 'บันทึกเป็นไอเดียแล้ว';
            root.showToast('บันทึก “' + idea.title.slice(0, 40) + '” เป็นไอเดียในเนื้อเรื่องแล้ว');
        } else {
            button.disabled = false;
        }
    }

    async function refresh() {
        if (refreshing) return;
        refreshing = true; draw();
        message('กำลังดึงข่าวจากแหล่งข้อมูล อาจใช้เวลาสักครู่…');
        try {
            const { data, error } = await sb.functions.invoke('ai-trends', { body: { action: 'refresh' } });
            if (error) {
                const status = error.context && error.context.status;
                message(status === 404 ? 'ยังไม่ได้ติดตั้งฟังก์ชัน ai-trends ใน Supabase จึงดึงข่าวไม่ได้' : 'ดึงข่าวไม่สำเร็จ กรุณาลองใหม่ภายหลัง');
            } else if (data && data.skipped) {
                message('เพิ่งอัปเดตไปเมื่อ ' + thaiDateTime(data.lastRunAt) + ' ระบบดึงใหม่ได้ทุก 15 นาที แสดงข้อมูลล่าสุดที่บันทึกไว้');
            } else if (data && Array.isArray(data.results)) {
                const failed = data.results.filter(r => !r.ok).length;
                message('อัปเดตแล้ว ' + (data.results.length - failed) + ' แหล่ง' + (failed ? ' · ล้มเหลว ' + failed + ' แหล่ง (ดูสาเหตุที่รายการแหล่งข้อมูล)' : ''));
            }
        } catch (_) {
            message('ติดต่อระบบดึงข่าวไม่ได้ กรุณาลองใหม่ภายหลัง');
        } finally {
            refreshing = false;
            await load();
        }
    }

    $('trends-refresh').addEventListener('click', refresh);

    root.TrendsPage = {
        render() { if (currentStudio === STUDIO_ID) load(); },
        reset() { loadToken++; category = 'all'; state = { status: 'idle', items: [], sources: [], runs: [], error: '' }; message(''); }
    };
})(typeof window === 'object' ? window : globalThis);
