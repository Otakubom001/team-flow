// "กระแส AI" page for Ladyploy.Studio.
// Items come only from public.ai_trend_items, which the ai-trends Edge Function fills
// from real RSS feeds. The page never invents or shows sample headlines: when nothing
// has been fetched yet it says so.
(function (root) {
    'use strict';
    const STUDIO_ID = 'ladyploy';
    // Name the Dashboard gave the deployed copy of supabase/functions/ai-trends/index.ts.
    const TRENDS_FUNCTION = 'dynamic-function';
    const CATEGORIES = {
        all: 'ทั้งหมด',
        ai_tools: 'เครื่องมือ AI',
        image: 'สร้างภาพ',
        video: 'สร้างวิดีโอ',
        search_trend: 'เทรนด์ค้นหา',
        ai_news: 'ข่าว AI',
        new_model: 'โมเดลใหม่',
        video_clip: 'คลิป AI'
    };
    const DAY = 86400000;
    // "น่าจับตา" is a keyword score, not an AI judgement: launches, major AI companies,
    // things that matter to Thai viewers, plus a bonus for being recent.
    const WATCH_RULES = [
        [/เปิดตัว|ประกาศ|launch|introduc|release|unveil|รุ่นใหม่/i, 3],
        [/openai|chatgpt|gpt-?\d|google|gemini|anthropic|claude|meta|llama|microsoft|copilot|apple|nvidia|deepseek|xai|grok|midjourney|sora|veo|kling|runway/i, 2],
        [/ฟรี|free|ราคา|price|กฎหมาย|law|regulat|รัฐบาล|ไทย|thai/i, 1],
        [/โมเดล|agent|เอเจนต์|สร้างภาพ|สร้างวิดีโอ|image|video/i, 1]
    ];
    function itemTime(item) { return Date.parse(item.published_at || item.fetched_at) || 0; }
    function watchScore(item, now) {
        let score = 0;
        for (const [re, weight] of WATCH_RULES) if (re.test(item.title || '')) score += weight;
        return score + Math.max(0, 3 - (now - itemTime(item)) / DAY / 2);
    }
    // Items from the most recent fetch of a category: older snapshots of trending
    // searches or clips are no longer "trending now".
    function latestSnapshot(items) {
        const newest = Math.max(0, ...items.map(i => Date.parse(i.fetched_at) || 0));
        return items.filter(i => (Date.parse(i.fetched_at) || 0) >= newest - 5 * 60000);
    }
    const byMetric = (a, b) => (b.metric || 0) - (a.metric || 0);
    function pickSections(items, now) {
        const of = (...cats) => items.filter(i => cats.includes(i.category));
        return {
            hot: latestSnapshot(of('search_trend')).sort(byMetric).slice(0, 5),
            watch: of('ai_news', 'ai_tools', 'image', 'video').filter(i => now - itemTime(i) <= 7 * DAY)
                .map(i => [i, watchScore(i, now)]).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([i]) => i),
            clips: latestSnapshot(of('video_clip')).sort(byMetric).slice(0, 6),
            models: of('new_model').filter(i => now - itemTime(i) <= 45 * DAY).sort((a, b) => itemTime(b) - itemTime(a)).slice(0, 8)
        };
    }
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

    const api = { CATEGORIES, safeUrl, thaiDateTime, ideaHtml, isSavedIdea, isMissingTable, watchScore, pickSections };
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
        // select('*') keeps working whether or not the sections migration (metric,
        // language) has been run. Every run refreshes fetched_at of what is still in
        // the feeds, so ordering by it keeps current models/clips/trends in range.
        const [sources, items, runs] = await Promise.all([
            sb.from('ai_trend_sources').select('*').order('id'),
            sb.from('ai_trend_items').select('*')
                .eq('studio_id', STUDIO_ID).order('fetched_at', { ascending: false }).limit(400),
            sb.from('ai_trend_runs').select('source_id,started_at,finished_at,ok,item_count,error')
                .eq('studio_id', STUDIO_ID).order('started_at', { ascending: false }).limit(120)
        ]);
        if (token !== loadToken) return;
        const failed = [sources, items, runs].find(r => r.error);
        if (failed) {
            state.status = isMissingTable(failed.error) ? 'not_installed' : 'error';
            state.error = failed.error.message || '';
        } else {
            const newestFirst = items.data.slice().sort((a, b) => itemTime(b) - itemTime(a));
            state = { status: 'ready', items: newestFirst, sources: sources.data, runs: runs.data, error: '' };
        }
        draw();
    }

    function sourceOf(item) { return state.sources.find(s => s.id === item.source_id); }

    function saveButton(item, sourceName, small) {
        const url = safeUrl(item.url);
        const save = el('button', 'btn btn-sm btn-secondary' + (small ? ' trend-save-small' : ''));
        save.type = 'button';
        const saved = isSavedIdea(root.loadData().contents, item.url);
        save.textContent = saved ? (small ? 'บันทึกแล้ว' : 'บันทึกเป็นไอเดียแล้ว') : (small ? '+ ไอเดีย' : 'บันทึกเป็นไอเดีย');
        save.setAttribute('aria-label', (saved ? 'บันทึกแล้ว: ' : 'บันทึกเป็นไอเดีย: ') + item.title);
        save.disabled = saved || !url || !root.dataReady;
        save.onclick = () => saveIdea(item, sourceName, save);
        return save;
    }

    // One compact ranked row inside a highlight section.
    function sectionRow(item, rank) {
        const source = sourceOf(item);
        const sourceName = source ? source.name : item.source_id;
        const url = safeUrl(item.url);
        const row = el('li', 'trend-row');
        row.append(el('span', 'trend-rank', String(rank)));
        const body = el('div', 'trend-row-body');
        const title = url ? el('a', 'trend-row-title', item.title) : el('span', 'trend-row-title', item.title);
        if (url) { title.href = url; title.target = '_blank'; title.rel = 'noopener noreferrer'; }
        body.append(title);
        const meta = [sourceName, item.detail, item.published_at ? thaiDateTime(item.published_at) : ''].filter(Boolean).join(' · ');
        body.append(el('span', 'trend-row-meta', meta));
        if (source && source.language === 'en') body.append(el('span', 'trend-lang', 'อังกฤษ'));
        row.append(body, saveButton(item, sourceName, true));
        return row;
    }

    const SECTIONS = [
        { key: 'hot', icon: 'fa-fire', title: 'กระแสแรงตอนนี้', note: 'คำค้นที่คนไทยค้นมากที่สุดรอบล่าสุดจาก Google Trends เรียงตามปริมาณค้นหา (ทุกหมวด ไม่ใช่เฉพาะ AI)',
          sourceKind: 'google_trends', empty: 'ยังไม่มีข้อมูลจาก Google Trends' },
        { key: 'watch', icon: 'fa-eye', title: 'ข่าว AI ที่น่าจับตา', note: 'ข่าว 7 วันล่าสุด ให้คะแนนจากคำสำคัญ เช่น เปิดตัว บริษัท AI รายใหญ่ และความใหม่ ไม่ใช่การประเมินด้วย AI',
          empty: 'ยังไม่มีข่าว AI ในช่วง 7 วันนี้' },
        { key: 'clips', icon: 'fa-film', title: 'คลิป AI ที่เป็นกระแส', note: 'คลิปเกี่ยวกับ AI ที่ยอดดูสูงสุดใน YouTube ประเทศไทย ช่วง 7 วันล่าสุด',
          sourceKind: 'youtube', empty: 'ยังไม่มีคลิปในช่วง 7 วันนี้' },
        { key: 'models', icon: 'fa-microchip', title: 'โมเดล AI ที่เข้ามาใหม่', note: 'ประกาศโมเดลจาก OpenAI, Google และข่าวไทย รวมกับโมเดลที่กำลังมาแรงบน Hugging Face (45 วันล่าสุด)',
          empty: 'ยังไม่มีโมเดลใหม่ในช่วงนี้' }
    ];

    function drawSections() {
        const box = $('trend-sections');
        box.replaceChildren();
        box.hidden = state.status !== 'ready' || !state.runs.length;
        if (box.hidden) return;
        const picked = pickSections(state.items, Date.now());
        for (const s of SECTIONS) {
            const panel = el('section', 'trend-section card');
            panel.dataset.section = s.key;
            const head = el('h2', 'trend-section-title');
            const icon = el('i', 'fas ' + s.icon); icon.setAttribute('aria-hidden', 'true');
            head.append(icon, document.createTextNode(' ' + s.title));
            panel.append(head, el('p', 'trend-section-note', s.note));
            const rows = picked[s.key];
            if (rows.length) {
                const list = el('ol', 'trend-rows');
                rows.forEach((item, i) => list.append(sectionRow(item, i + 1)));
                panel.append(list);
            } else {
                // Explain *why* a section is empty when its only source failed or isn't set up.
                const source = s.sourceKind && state.sources.find(x => x.kind === s.sourceKind);
                const run = source && latestRun(source.id);
                let text = s.empty;
                if (s.sourceKind && !source) text = 'ยังไม่ได้ติดตั้งแหล่งข้อมูลส่วนนี้ (ต้องรัน migration กระแส AI รอบที่ 2)';
                else if (run && !run.ok) text = run.error && /YOUTUBE_API_KEY/.test(run.error)
                    ? 'ยังไม่ได้เชื่อม YouTube: ต้องตั้งค่า YOUTUBE_API_KEY ใน Supabase ก่อน ส่วนนี้จึงยังไม่มีคลิปจริงให้แสดง'
                    : 'ดึงข้อมูลไม่สำเร็จ: ' + (run.error || 'ไม่ทราบสาเหตุ');
                else if (source && !run) text = 'ยังไม่เคยดึงข้อมูลส่วนนี้ กด “อัปเดตข่าว” หรือรอรอบอัปเดตอัตโนมัติ';
                panel.append(el('p', 'trend-section-empty', text));
            }
            box.append(panel);
        }
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
            if (s.language === 'en') row.append(el('span', 'trend-source-note', 'ภาษาอังกฤษ'));
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
        const source = sourceOf(item);
        const sourceName = source ? source.name : item.source_id;
        const url = safeUrl(item.url);
        const node = el('article', 'trend-card');
        const head = el('div', 'trend-card-head');
        const badge = el('span', 'trend-badge', CATEGORIES[item.category] || item.category);
        badge.dataset.category = item.category;
        const label = el('span', 'trend-source-label', sourceName);
        if (source && source.language === 'en') label.append(' ', el('span', 'trend-lang', 'อังกฤษ'));
        head.append(badge, label);
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
        actions.append(saveButton(item, sourceName, false));
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
        drawSections();
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
            root.showToast('บันทึก “' + idea.title.slice(0, 40) + '” เป็นไอเดียในเนื้อเรื่องแล้ว');
            draw(); // the same item can appear in a section and in the full list
        } else {
            button.disabled = false;
        }
    }

    async function refresh() {
        if (refreshing) return;
        refreshing = true; draw();
        message('กำลังดึงข่าวจากแหล่งข้อมูล อาจใช้เวลาสักครู่…');
        try {
            const { data, error } = await sb.functions.invoke(TRENDS_FUNCTION, { body: { action: 'refresh' } });
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
