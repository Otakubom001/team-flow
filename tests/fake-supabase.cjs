// Local end-to-end harness: serves the website and a minimal PostgREST-compatible
// API backed by PGlite (real Postgres) with the production-like baseline schema.
// Nothing touches the real Supabase project.
//
//   node tests/fake-supabase.cjs [port] [--no-migration] [--pglite=<dir containing node_modules>]
//   (install once anywhere: npm install @electric-sql/pglite@0.2.17)
//
// --no-migration starts the database as production is today (no studios), to check
// that the website keeps working for อีนิล before the migration is run.
// Test PIN: 1234 (local only).
const http = require('http'), fs = require('fs'), path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv.find(a => /^\d+$/.test(a)) || 8090);
const MIGRATE = !process.argv.includes('--no-migration');
const REAL_URL = 'https://axaebqeezpgbvvkivnqn.supabase.co';

const BASELINE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table contents (id text primary key, title text, content text, assigned_to text, status text,
  post_date text, created_at text, updated_at text, voiced boolean default false);
create table events (id text primary key, title text, date text, type text, content_id text, description text);
create table settings (key text primary key, value text);
alter table contents enable row level security; alter table events enable row level security; alter table settings enable row level security;
create policy "public_contents" on contents for all using (true) with check (true);
create policy "public_events" on events for all using (true) with check (true);
create policy "public_settings" on settings for all using (true) with check (true);
grant usage on schema public to anon, authenticated, service_role;
grant all on contents, events, settings to anon, authenticated, service_role;
insert into settings values ('pin', '1234');`;

let db, queue = Promise.resolve();
const serial = fn => (queue = queue.then(fn, fn));
const ident = s => { if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw Object.assign(new Error('bad identifier ' + s), { code: 'PGRST100' }); return '"' + s + '"'; };

async function seed() {
    const statuses = ['waiting_clip', 'making_clip', 'making_image', 'ready', 'posted'];
    for (let i = 1; i <= 24; i++) {
        await db.query('insert into contents values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', ['enil' + i, 'อีนิล เรื่องที่ ' + i, '<p>เนื้อหาเดิม ' + i + '</p>',
            ['พลอย', 'บอม', 'เพชร'][i % 3], statuses[i % 5], i % 3 ? '2026-11-' + String(i + 3).padStart(2, '0') : null,
            '2026-10-01T00:00:00Z', '2026-11-' + String(i).padStart(2, '0') + 'T00:00:00Z', i % 2 === 0]);
    }
    await db.query("insert into events values ('enil-ev1','อีนิล: ไลฟ์ตอนพิเศษ','2026-11-28','important',null,'')");
}

function parseFilters(params) {
    const where = [], values = [];
    for (const [key, raw] of params) {
        if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue;
        const m = raw.match(/^(eq|neq|lt|gt|lte|gte|is|in)\.(.*)$/s);
        if (!m) throw Object.assign(new Error('unsupported filter ' + raw), { code: 'PGRST100' });
        const [, op, val] = m, col = ident(key);
        if (op === 'is') where.push(col + ' is ' + ({ null: 'null', true: 'true', false: 'false' }[val] || 'null'));
        else if (op === 'in') { const list = val.replace(/^\(|\)$/g, '').split(','); where.push(col + ' in (' + list.map(v => { values.push(v); return '$' + values.length; }).join(',') + ')'); }
        else { values.push(val); where.push(col + ' ' + { eq: '=', neq: '<>', lt: '<', gt: '>', lte: '<=', gte: '>=' }[op] + ' $' + values.length); }
    }
    return { where: where.length ? ' where ' + where.join(' and ') : '', values };
}
function selectList(params) {
    const sel = params.get('select');
    return !sel || sel === '*' ? '*' : sel.split(',').map(s => ident(s.trim())).join(',');
}
function orderBy(params) {
    const o = params.get('order');
    if (!o) return '';
    return ' order by ' + o.split(',').map(part => {
        const [col, dir, nulls] = part.split('.');
        return ident(col) + (dir === 'desc' ? ' desc' : ' asc') + (nulls === 'nullslast' ? ' nulls last' : nulls === 'nullsfirst' ? ' nulls first' : '');
    }).join(',');
}

async function rest(req, table, params, body) {
    const t = ident(table), method = req.method, prefer = req.headers.prefer || '';
    const wantRows = method === 'GET' || prefer.includes('return=representation');
    let sql, values = [];
    if (method === 'GET') {
        const f = parseFilters(params); values = f.values;
        sql = 'select ' + selectList(params) + ' from ' + t + f.where + orderBy(params) +
            (params.get('limit') ? ' limit ' + Number(params.get('limit')) : '') + (params.get('offset') ? ' offset ' + Number(params.get('offset')) : '');
    } else if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
        const tuples = rows.map(r => '(' + cols.map(c => { if (!(c in r)) return 'default'; values.push(r[c]); return '$' + values.length; }).join(',') + ')');
        const conflict = params.get('on_conflict');
        let onConflict = '';
        if (prefer.includes('resolution=ignore-duplicates')) onConflict = ' on conflict ' + (conflict ? '(' + conflict.split(',').map(ident).join(',') + ')' : '') + ' do nothing';
        if (prefer.includes('resolution=merge-duplicates')) {
            const keys = conflict ? conflict.split(',') : ['id'];
            onConflict = ' on conflict (' + keys.map(ident).join(',') + ') do update set ' + cols.filter(c => !keys.includes(c)).map(c => ident(c) + '=excluded.' + ident(c)).join(',');
        }
        sql = 'insert into ' + t + ' (' + cols.map(ident).join(',') + ') values ' + tuples.join(',') + onConflict + (wantRows ? ' returning ' + selectList(params) : '');
    } else if (method === 'PATCH') {
        const cols = Object.keys(body);
        const set = cols.map(c => { values.push(body[c]); return ident(c) + '=$' + values.length; }).join(',');
        const f = parseFilters(params);
        const shifted = f.where.replace(/\$(\d+)/g, (_, n) => '$' + (Number(n) + values.length));
        values.push(...f.values);
        sql = 'update ' + t + ' set ' + set + shifted + (wantRows ? ' returning ' + selectList(params) : '');
    } else if (method === 'DELETE') {
        const f = parseFilters(params); values = f.values;
        sql = 'delete from ' + t + f.where + (wantRows ? ' returning ' + selectList(params) : '');
    } else return [405, { message: 'method' }];

    await db.exec('set role anon');
    let result;
    try { result = await db.query(sql, values); }
    finally { await db.exec('reset role'); }
    const rows = result.rows;
    if ((req.headers.accept || '').includes('vnd.pgrst.object')) {
        if (rows.length !== 1) return [406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains ' + rows.length + ' rows' }];
        return [200, rows[0]];
    }
    return [method === 'POST' ? 201 : 200, wantRows ? rows : null];
}

function pgError(e) {
    const code = e.code || 'XX000';
    if (code === '42P01') return [404, { code: 'PGRST205', message: e.message }];
    const status = code === '42501' ? 403 : code === '23505' ? 409 : 400;
    return [status, { code, message: e.message, details: e.detail || null, hint: null }];
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serveStatic(req, res, pathname) {
    const file = path.normalize(path.join(ROOT, pathname === '/' ? 'index.html' : decodeURIComponent(pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    let content = fs.readFileSync(file);
    if (file.endsWith('index.html')) content = Buffer.from(content.toString('utf8').replace(REAL_URL, 'http://localhost:' + PORT));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(content);
}

(async () => {
    const dir = (process.argv.find(a => a.startsWith('--pglite=')) || '').slice(9);
    const { PGlite } = await import(pathToFileURL(require.resolve('@electric-sql/pglite', dir ? { paths: [dir] } : undefined)).href);
    db = new PGlite();
    await db.exec(BASELINE);
    await seed();
    if (MIGRATE) await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/migrations/202611270001_studios.sql'), 'utf8'));

    http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => serial(async () => {
            const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(obj === null ? '' : JSON.stringify(obj)); };
            try {
                if (url.pathname.startsWith('/rest/v1/')) {
                    const [status, out] = await rest(req, url.pathname.slice(9), url.searchParams, body ? JSON.parse(body) : null);
                    return send(status, out);
                }
                // Test-only control endpoint: run SQL as the service role (e.g. fake a trends run).
                if (url.pathname === '/__sql' && req.method === 'POST') {
                    const out = await db.query(body);
                    return send(200, out.rows);
                }
                if (url.pathname.startsWith('/functions/v1/')) return send(404, { code: 'NOT_FOUND', message: 'Function not found' });
                if (url.pathname.startsWith('/auth/v1/')) return send(404, { message: 'not used in tests' });
                serveStatic(req, res, url.pathname);
            } catch (e) {
                const [status, out] = pgError(e);
                send(status, out);
            }
        }));
    }).listen(PORT, () => console.log('fake supabase + site on http://localhost:' + PORT + (MIGRATE ? '' : ' (no migration)')));
})();
