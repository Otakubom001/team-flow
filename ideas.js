// "กระดานไอเดีย": post-it notes pinned to a cork board, planned by month.
// Each studio (อีนิล / Ladyploy.Studio) has its own board in public.idea_notes
// (supabase/migrations/202611280001_idea_board.sql). A note can become a real story
// ("สร้างงาน"), and stays on the board with that story's live status.
(function (root) {
    'use strict';
    const COLORS = {
        yellow: 'เหลือง', pink: 'ชมพู', blue: 'ฟ้า', green: 'เขียว', orange: 'ส้ม', purple: 'ม่วง', white: 'ขาวครีม'
    };
    const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
    const LANES_SHOWN = 3;

    // Month keys are 'YYYY-MM' in Thai time (UTC+7), whatever the device timezone is.
    function monthKey(time) {
        const d = new Date((typeof time === 'number' ? time : Date.parse(time)) + 7 * 3600000);
        return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
    }
    function addMonths(key, n) {
        const [y, m] = key.split('-').map(Number);
        const i = y * 12 + (m - 1) + n;
        return Math.floor(i / 12) + '-' + String(i % 12 + 1).padStart(2, '0');
    }
    function monthLabel(key) {
        if (!key) return 'กองไอเดีย';
        const [y, m] = key.split('-').map(Number);
        return MONTHS[m - 1] + ' ' + (y + 543);
    }
    // Stable small tilt per note so the board looks hand-pinned but doesn't jump on redraw.
    function tilt(id, salt) {
        let h = salt || 7;
        for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 997;
        return ((h % 11) - 5) * 0.55;
    }
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function safeUrl(value) {
        try {
            const url = new URL(String(value));
            return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
        } catch (_) { return null; }
    }
    // Mirrors the table's check constraints so the form explains problems before saving.
    function validateNote(n) {
        const body = String(n.body || '').trim();
        if (!body) return 'พิมพ์ไอเดียก่อนแปะ';
        if (body.length > 500) return 'ไอเดียยาวได้ไม่เกิน 500 ตัวอักษร';
        if (String(n.tag || '').length > 40) return 'แท็กยาวได้ไม่เกิน 40 ตัวอักษร';
        if (!COLORS[n.color]) return 'เลือกสีกระดาษ';
        if (n.plan_month && !MONTH_RE.test(n.plan_month)) return 'เดือนไม่ถูกต้อง';
        return '';
    }
    function linkedContent(note, contents) {
        return note.content_id ? contents.find(c => c.id === note.content_id) || null : null;
    }
    // Story fields for "สร้างงาน": title from the first line, body keeps the whole note.
    function taskFromNote(note) {
        const body = String(note.body).trim();
        const title = body.split('\n')[0].trim().slice(0, 200);
        const url = safeUrl(note.source_url);
        const html = '<p>' + escapeHtml(body).replace(/\n/g, '<br>') + '</p>' +
            (note.tag ? '<p>แท็ก: ' + escapeHtml(note.tag) + '</p>' : '') +
            (url ? '<p>แหล่งที่มา: <a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(url) + '</a></p>' : '') +
            '<p>จากกระดานไอเดีย · แผน' + (note.plan_month ? 'เดือน ' + monthLabel(note.plan_month) : ': ยังไม่กำหนดเดือน') + '</p>';
        return { title, content: html };
    }
    function monthSummary(notes, contents, key) {
        const mine = notes.filter(n => n.plan_month === key);
        return { total: mine.length, done: mine.filter(n => linkedContent(n, contents)).length, pile: notes.filter(n => !n.plan_month).length };
    }
    function hasSource(notes, url) {
        const href = safeUrl(url);
        return !!href && notes.some(n => n.source_url === href);
    }
    function sortNotes(notes) {
        return notes.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id));
    }

    const api = { COLORS, monthKey, addMonths, monthLabel, tilt, validateNote, linkedContent, taskFromNote, monthSummary, hasSource, sortNotes };
    if (typeof module === 'object' && module.exports) { module.exports = api; return; }

    // ---- Browser page --------------------------------------------------------
    const $ = id => document.getElementById(id);
    const thisMonth = () => monthKey(Date.now());
    let state = { status: 'idle', studio: null, notes: [], promise: null };
    let startMonth = thisMonth();
    let editing = null;      // note being edited, or null for a new note
    let formColor = 'yellow';
    let popover = null;
    let loadToken = 0;

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }
    function contents() { return root.dataReady ? root.loadData().contents : []; }
    function message(text) { $('ideas-message').textContent = text || ''; }
    function isMissing(error) { return !!error && (error.code === '42P01' || error.code === 'PGRST205' || error.status === 404); }

    function load() {
        const token = ++loadToken, studio = currentStudio;
        state = { status: 'loading', studio, notes: [], promise: null };
        state.promise = (async () => {
            if (!studiosEnabled) { if (token === loadToken) state.status = 'not_installed'; return; }
            const { data, error } = await sb.from('idea_notes').select('*').eq('studio_id', studio)
                .order('created_at').limit(2000);
            if (token !== loadToken) return;
            if (error) { state.status = isMissing(error) ? 'not_installed' : 'error'; return; }
            // Defence in depth: never keep another studio's note even if a filter was skipped.
            state.notes = data.filter(n => n.studio_id === studio);
            state.status = 'ready';
        })();
        return state.promise;
    }
    function ensureLoaded() {
        if (state.studio === currentStudio && state.promise && state.status !== 'error') return state.promise;
        return load();
    }

    // ---- Board ---------------------------------------------------------------
    function lanes() {
        const keys = [null];
        for (let i = 0; i < LANES_SHOWN; i++) keys.push(addMonths(startMonth, i));
        return keys;
    }

    function noteNode(n) {
        const wrap = el('div', 'idea-note-wrap');
        wrap.dataset.id = n.id;
        wrap.draggable = true;
        const tape = el('span', 'idea-tape');
        tape.style.setProperty('--tr', tilt(n.id, 3) + 'deg');
        tape.setAttribute('aria-hidden', 'true');
        const note = el('button', 'idea-note');
        note.type = 'button';
        note.dataset.color = n.color;
        note.style.setProperty('--r', tilt(n.id) + 'deg');
        note.setAttribute('aria-label', 'แก้ไขไอเดีย: ' + n.body.slice(0, 80));
        note.append(el('span', 'idea-note-text', n.body));
        if (n.tag) note.append(el('span', 'idea-note-tag', n.tag));
        if (n.source_url) note.append(el('span', 'idea-note-tag', '↗ มีลิงก์ต้นฉบับ'));
        const task = linkedContent(n, contents());
        if (task) note.append(el('span', 'idea-note-done', '✓ เป็นงานแล้ว · ' + (STATUS_LABELS[task.status] || task.status)));
        note.onclick = () => openEditor(n);
        const tools = el('div', 'idea-tools');
        const colorBtn = el('button', '', 'สี');
        colorBtn.type = 'button';
        colorBtn.setAttribute('aria-label', 'เปลี่ยนสีกระดาษ');
        colorBtn.onclick = e => { e.stopPropagation(); openColorPopover(n, colorBtn); };
        tools.append(colorBtn);
        if (!task) {
            const taskBtn = el('button', '', 'สร้างงาน →');
            taskBtn.type = 'button';
            taskBtn.setAttribute('aria-label', 'สร้างเป็นเนื้อเรื่อง: ' + n.body.slice(0, 60));
            taskBtn.onclick = e => { e.stopPropagation(); createTask(n, taskBtn); };
            tools.append(taskBtn);
        }
        wrap.append(tape, note, tools);
        return wrap;
    }

    function drawBoard() {
        const board = $('idea-board');
        board.replaceChildren();
        $('idea-range').textContent = monthLabel(startMonth) + ' – ' + monthLabel(addMonths(startMonth, LANES_SHOWN - 1));
        const ready = state.status === 'ready';
        $('idea-add').disabled = !ready;
        board.dataset.state = state.status;
        if (!ready) {
            const text = { loading: 'กำลังโหลดกระดานไอเดีย…', idle: 'กำลังโหลดกระดานไอเดีย…',
                not_installed: 'ยังไม่ได้ติดตั้งกระดานไอเดีย ต้องรัน migration 202611280001_idea_board.sql ในฐานข้อมูลก่อน',
                error: 'โหลดกระดานไอเดียไม่สำเร็จ ลองโหลดหน้าใหม่อีกครั้ง' }[state.status];
            board.append(el('p', 'idea-board-state', text));
            return;
        }
        const now = thisMonth();
        for (const key of lanes()) {
            const lane = el('section', 'idea-lane' + (key ? '' : ' is-pile'));
            lane.dataset.month = key || '';
            const mine = sortNotes(state.notes.filter(n => (n.plan_month || null) === key));
            const label = el('h2', 'idea-label');
            label.append(el('span', 'idea-pin'), document.createTextNode(monthLabel(key)));
            const sub = [key === now ? 'เดือนนี้' : key ? '' : 'ยังไม่กำหนดเดือน', mine.length + ' ใบ'].filter(Boolean).join(' · ');
            label.append(el('small', '', sub));
            lane.append(label);
            mine.forEach(n => lane.append(noteNode(n)));
            if (!mine.length) lane.append(el('p', 'idea-empty', key ? 'ลากไอเดียมาแปะตรงนี้' : 'กด “แปะไอเดีย” เพื่อเริ่ม'));
            board.append(lane);
        }
    }

    // ---- Writes ----------------------------------------------------------------
    function scopedNote(query) { return query.eq('studio_id', currentStudio); }

    async function updateNote(n, changes, okText) {
        const before = { ...n };
        Object.assign(n, changes);
        drawBoard();
        const { data, error } = await scopedNote(sb.from('idea_notes').update(changes).eq('id', n.id)).select().maybeSingle();
        if (error || !data) {
            Object.assign(n, before);
            drawBoard();
            root.showToast(error ? 'บันทึกโพสต์อิทไม่สำเร็จ กรุณาลองอีกครั้ง' : 'ไม่พบโพสต์อิทนี้แล้ว กรุณาโหลดหน้าใหม่');
            return false;
        }
        Object.assign(n, data);
        drawBoard();
        if (okText) root.showToast(okText);
        return true;
    }

    async function insertNote(fields) {
        const row = { id: root.genId(), studio_id: currentStudio, ...fields };
        const { data, error } = await sb.from('idea_notes').insert(row).select().single();
        if (error) return { error };
        if (state.studio === data.studio_id) state.notes.push(data);
        return { note: data };
    }

    async function deleteNote(n) {
        const { data, error } = await scopedNote(sb.from('idea_notes').delete().eq('id', n.id)).select('id');
        if (error) { root.showToast('ลบโพสต์อิทไม่สำเร็จ กรุณาลองอีกครั้ง'); return false; }
        state.notes = state.notes.filter(x => x.id !== n.id);
        drawBoard();
        root.showToast(data.length ? 'เอาโพสต์อิทออกแล้ว' : 'โพสต์อิทนี้ถูกลบไปแล้ว');
        return true;
    }

    async function createTask(n, button) {
        if (!root.dataReady) { root.showToast('ข้อมูลเนื้อเรื่องยังโหลดไม่เสร็จ'); return false; }
        if (linkedContent(n, contents())) { root.showToast('ไอเดียนี้เป็นงานแล้ว'); return false; }
        if (button) button.disabled = true;
        const now = new Date().toISOString();
        const { title, content } = taskFromNote(n);
        const story = { id: root.genId(), title, content, assignedTo: null, status: 'waiting_clip', postDate: '',
            createdAt: now, updatedAt: now, voiced: false, studioId: currentStudio };
        root.loadData().contents.push(story);
        if (!await root.saveContent(story)) { if (button) button.disabled = false; return false; }
        const linked = await updateNote(n, { content_id: story.id });
        root.showToast(linked ? 'สร้าง “' + title.slice(0, 40) + '” ในเนื้อเรื่องแล้ว (รอทำคลิป)'
            : 'สร้างงานแล้ว แต่ผูกกับโพสต์อิทไม่สำเร็จ ดูงานได้ในหน้าเนื้อเรื่อง');
        return true;
    }

    // ---- Drag between months (mouse); touch devices use the editor's month field ----
    function bindDrag() {
        const board = $('idea-board');
        let dragId = null;
        const clear = () => board.querySelectorAll('.is-over').forEach(x => x.classList.remove('is-over'));
        board.addEventListener('dragstart', e => {
            const w = e.target.closest('.idea-note-wrap'); if (!w) return;
            dragId = w.dataset.id; w.classList.add('is-dragging');
            e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
        });
        board.addEventListener('dragend', () => { dragId = null; clear(); board.querySelector('.is-dragging')?.classList.remove('is-dragging'); });
        board.addEventListener('dragover', e => {
            const lane = e.target.closest('.idea-lane'); if (!lane || !dragId) return;
            e.preventDefault(); if (!lane.classList.contains('is-over')) { clear(); lane.classList.add('is-over'); }
        });
        board.addEventListener('drop', e => {
            const lane = e.target.closest('.idea-lane'); if (!lane || !dragId) return;
            e.preventDefault(); clear();
            const n = state.notes.find(x => x.id === dragId); dragId = null;
            const month = lane.dataset.month || null;
            if (!n || (n.plan_month || null) === month) return;
            updateNote(n, { plan_month: month }, month ? 'ย้ายไป ' + monthLabel(month) + ' แล้ว' : 'ย้ายกลับกองไอเดียแล้ว');
        });
    }

    // ---- Color popover ---------------------------------------------------------
    function swatches(container, selected, onPick) {
        container.replaceChildren();
        for (const [key, name] of Object.entries(COLORS)) {
            const b = el('button', 'idea-swatch');
            b.type = 'button'; b.dataset.color = key;
            b.setAttribute('aria-label', 'กระดาษสี' + name); b.title = name;
            b.setAttribute('aria-pressed', String(key === selected));
            b.onclick = () => onPick(key);
            container.append(b);
        }
    }
    function closePopover() { if (popover) { popover.remove(); popover = null; } }
    function openColorPopover(n, anchor) {
        closePopover();
        popover = el('div', 'idea-popover');
        popover.setAttribute('role', 'group');
        popover.setAttribute('aria-label', 'เลือกสีกระดาษ');
        swatches(popover, n.color, key => { closePopover(); anchor.focus(); if (key !== n.color) updateNote(n, { color: key }); });
        document.body.append(popover);
        const r = anchor.getBoundingClientRect();
        popover.style.left = Math.max(8, Math.min(innerWidth - popover.offsetWidth - 8, r.left + scrollX - 100)) + 'px';
        popover.style.top = (r.bottom + scrollY + 8) + 'px';
        popover.querySelector('[aria-pressed="true"]')?.focus();
    }
    document.addEventListener('click', e => { if (popover && !popover.contains(e.target)) closePopover(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePopover(); });

    // ---- Editor dialog ----------------------------------------------------------
    function monthOptions(current) {
        const now = thisMonth(), keys = [];
        for (let i = -3; i <= 12; i++) keys.push(addMonths(now, i));
        if (current && !keys.includes(current)) keys.push(current);
        keys.sort();
        const select = $('idea-month');
        select.replaceChildren(new Option('กองไอเดีย (ยังไม่กำหนดเดือน)', ''));
        keys.forEach(k => select.append(new Option(monthLabel(k) + (k === now ? ' · เดือนนี้' : ''), k)));
        select.value = current || '';
    }
    function paintPreview() {
        const pv = $('idea-preview');
        pv.dataset.color = formColor;
        pv.textContent = $('idea-body').value.trim() || 'พิมพ์ไอเดียของคุณ…';
        swatches($('idea-colors'), formColor, key => { formColor = key; paintPreview(); $('idea-colors').querySelector('[data-color="' + key + '"]').focus(); });
    }
    function openEditor(n, presetMonth) {
        closePopover();
        editing = n || null;
        formColor = n ? n.color : 'yellow';
        $('idea-dialog-title').textContent = n ? 'แก้ไขไอเดีย' : 'แปะไอเดียใหม่';
        $('idea-body').value = n ? n.body : '';
        $('idea-tag').value = n ? n.tag : '';
        $('idea-error').textContent = '';
        monthOptions(n ? n.plan_month : presetMonth);
        const task = n && linkedContent(n, contents());
        $('idea-delete').hidden = !n;
        $('idea-task').hidden = !n || !!task;
        $('idea-source').hidden = !(n && safeUrl(n.source_url));
        if (n && safeUrl(n.source_url)) $('idea-source').href = safeUrl(n.source_url);
        $('idea-save').textContent = n ? 'บันทึก' : 'แปะเลย';
        paintPreview();
        $('idea-dialog').showModal();
        $('idea-body').focus();
    }
    function formFields() {
        return { body: $('idea-body').value.trim(), tag: $('idea-tag').value.trim(), color: formColor, plan_month: $('idea-month').value || null };
    }
    async function saveForm() {
        const fields = formFields(), problem = validateNote(fields);
        if (problem) { $('idea-error').textContent = problem; return null; }
        const dialog = $('idea-dialog');
        dialog.inert = true;
        try {
            if (editing) {
                const changed = Object.keys(fields).filter(k => (fields[k] || null) !== (editing[k] || null));
                if (changed.length && !await updateNote(editing, Object.fromEntries(changed.map(k => [k, fields[k]])))) {
                    $('idea-error').textContent = 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง'; return null;
                }
                return editing;
            }
            const { note, error } = await insertNote(fields);
            if (error) { $('idea-error').textContent = 'แปะไม่สำเร็จ กรุณาลองอีกครั้ง'; return null; }
            drawBoard();
            root.showToast(note.plan_month ? 'แปะไว้ที่ ' + monthLabel(note.plan_month) + ' แล้ว' : 'แปะไว้ในกองไอเดียแล้ว');
            return note;
        } finally { dialog.inert = false; }
    }

    $('idea-body').addEventListener('input', () => { $('idea-error').textContent = ''; paintPreview(); });
    $('idea-save').onclick = async () => { if (await saveForm()) $('idea-dialog').close(); };
    $('idea-cancel').onclick = () => $('idea-dialog').close();
    $('idea-delete').onclick = async () => {
        if (!editing || !confirm('เอาโพสต์อิทนี้ออกจากกระดาน? (เนื้อเรื่องที่สร้างไปแล้วไม่ถูกลบ)')) return;
        if (await deleteNote(editing)) $('idea-dialog').close();
    };
    $('idea-task').onclick = async () => {
        const n = await saveForm();
        if (n && await createTask(n)) $('idea-dialog').close();
    };
    $('idea-dialog').addEventListener('cancel', e => { if (e.currentTarget.inert) e.preventDefault(); });
    $('idea-add').onclick = () => openEditor(null);
    $('idea-prev').onclick = () => { startMonth = addMonths(startMonth, -1); drawBoard(); };
    $('idea-next').onclick = () => { startMonth = addMonths(startMonth, 1); drawBoard(); };
    $('idea-today').onclick = () => { startMonth = thisMonth(); drawBoard(); };
    bindDrag();

    // ---- Dashboard card ----------------------------------------------------------
    function drawDashboard() {
        const box = $('dashboard-ideas');
        if (!box) return;
        box.replaceChildren();
        if (state.status !== 'ready') {
            box.append(el('div', 'empty-state', state.status === 'not_installed' ? 'ยังไม่ได้ติดตั้งกระดานไอเดีย'
                : state.status === 'error' ? 'โหลดแผนเดือนนี้ไม่สำเร็จ' : 'กำลังโหลด…'));
            return;
        }
        const key = thisMonth(), s = monthSummary(state.notes, contents(), key);
        box.append(el('p', 'idea-dash-sum', monthLabel(key) + ': ' + s.total + ' ไอเดีย · เป็นงานแล้ว ' + s.done + ' · ในกองไอเดีย ' + s.pile));
        const list = el('div', 'idea-dash-notes');
        sortNotes(state.notes.filter(n => n.plan_month === key)).slice(0, 4).forEach(n => {
            const chip = el('span', 'idea-dash-note', n.body.split('\n')[0].slice(0, 60));
            chip.dataset.color = n.color;
            list.append(chip);
        });
        if (list.childNodes.length) box.append(list);
        else box.append(el('div', 'empty-state', 'ยังไม่มีไอเดียสำหรับเดือนนี้'));
        const open = el('button', 'btn btn-sm', 'เปิดกระดานไอเดีย →');
        open.type = 'button';
        open.onclick = () => root.navigateTo('ideas');
        box.append(open);
    }

    root.IdeasPage = {
        render() { drawBoard(); ensureLoaded().then(() => { if (state.studio === currentStudio) drawBoard(); }); },
        renderDashboard() { drawDashboard(); ensureLoaded().then(() => { if (state.studio === currentStudio) drawDashboard(); }); },
        reset() { loadToken++; closePopover(); startMonth = thisMonth(); state = { status: 'idle', studio: null, notes: [], promise: null }; message(''); },
        ensureLoaded,
        available() { return state.status === 'ready' && state.studio === currentStudio; },
        hasSource(url) { return state.studio === currentStudio && hasSource(state.notes, url); },
        // "+ ไอเดีย" from กระแส AI: pin the headline to the idea pile with its source link.
        async addFromTrend(item, tag) {
            const url = safeUrl(item.url);
            if (!url || hasSource(state.notes, url)) return false;
            const { note, error } = await insertNote({ body: String(item.title).slice(0, 500), tag: String(tag).slice(0, 40),
                color: 'blue', plan_month: null, source_url: url });
            if (error) { root.showToast(error.code === '23505' ? 'ข่าวนี้แปะไว้แล้ว' : 'แปะไอเดียไม่สำเร็จ กรุณาลองอีกครั้ง'); return false; }
            root.showToast('แปะ “' + note.body.slice(0, 40) + '” ไว้ในกองไอเดียแล้ว');
            return true;
        }
    };
})(typeof window === 'object' ? window : globalThis);
