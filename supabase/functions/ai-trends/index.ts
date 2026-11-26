// ai-trends: ดึงหัวข้อข่าว/เทรนด์ AI จากแหล่งที่ตั้งไว้ในตาราง ai_trend_sources
// แล้วบันทึกลง ai_trend_items พร้อมบันทึกผลแต่ละแหล่งใน ai_trend_runs
// - ไม่ใช้ AI API: เก็บเฉพาะหัวข้อ ลิงก์ วันที่ ตัวเลขความนิยม และหมวดที่จัดด้วยคำค้น
// - หน้าเว็บอ่านตารางได้อย่างเดียว ฟังก์ชันนี้เขียนด้วย service role ฝั่งเซิร์ฟเวอร์
// - เรียกซ้ำได้ทุก 15 นาที เรียกถี่กว่านั้นจะได้ข้อมูลเดิมกลับไป
//   (ตัวตั้งเวลาใน Supabase เรียกทุกชั่วโมง: migrations/202611270003_trends_schedule.sql)
// แหล่งข้อมูล:
//   rss            RSS/Atom ทั่วไป
//   google_trends  RSS ของ Google Trends (คำค้นยอดนิยม + ปริมาณการค้นหา)
//   hf_models      Hugging Face API: โมเดลที่กำลังมาแรง (ไม่ต้องใช้ key)
//   youtube        YouTube Data API v3: คลิป AI ยอดดูสูงในไทย (ต้องตั้ง secret YOUTUBE_API_KEY)
type Deps = { env: (name: string) => string | undefined; fetch: typeof fetch; now?: () => number };
type Kind = 'rss' | 'google_trends' | 'hf_models' | 'youtube';
type Source = { id: string; feed_url: string; kind: Kind; ai_only: boolean };
export type TrendItem = { title: string; url: string; category: string; detail: string | null; published_at: string | null; metric: number | null };

const STUDIO = 'ladyploy';
export const COOLDOWN_MS = 15 * 60000;
const MAX_ITEMS_PER_SOURCE = 40;
const RETENTION_DAYS = 120;
const RUN_RETENTION_DAYS = 30;
const NEW_MODEL_DAYS = 45;
const CLIP_DAYS = 7;

const AI = /(?:^|[^a-z])(?:ai|genai|llm|gpt)(?:[^a-z]|$)|ปัญญาประดิษฐ์|เอไอ|chatgpt|openai|gemini|claude|anthropic|copilot|midjourney|stable diffusion|dall-?e|firefly|sora|veo|runway|kling|perplexity|deepseek|grok|llama|notebooklm|machine learning|แมชชีนเลิร์นนิง/i;
// A launch or version of a named model family; checked before the other categories.
// The bare word "model" is too noisy (case studies, physics), so only named releases count.
const MODEL = /โมเดล|gpt-?\d|o\d-(?:mini|pro)|gemini\s*\d|claude\s+\w+\s*\d|llama\s*\d|qwen|mistral|deepseek[- ]?[vr]\d|veo\s*\d|imagen\s*\d|sora\s*\d|grok\s*\d|kling\s*\d/i;
const VIDEO = /วิดีโอ|วีดีโอ|คลิป|video|sora|veo|runway|kling|pika|hailuo|seedance/i;
const IMAGE = /สร้างภาพ|รูปภาพ|ภาพวาด|ภาพ\s*ai|image|midjourney|dall-?e|firefly|stable diffusion|imagen|nano banana/i;
const TOOLS = /เครื่องมือ|แอป|ฟีเจอร์|เปิดตัว|อัปเดต|อัพเดท|tool|app(?:[^a-z]|$)|feature|plugin|extension|chatgpt|gemini|claude|copilot|perplexity|notebooklm|cursor/i;

export function isAiRelated(text: string): boolean { return AI.test(text); }
export function categorize(text: string, kind: Kind): string {
  if (kind === 'google_trends') return 'search_trend';
  if (kind === 'youtube') return 'video_clip';
  if (kind === 'hf_models' || MODEL.test(text)) return 'new_model';
  if (VIDEO.test(text)) return 'video';
  if (IMAGE.test(text)) return 'image';
  if (TOOLS.test(text)) return 'ai_tools';
  return 'ai_news';
}
// "2,000+" -> 2000, "20K+" -> 20000, "1M+" -> 1000000
export function parseTraffic(value: string): number | null {
  const m = value.replace(/[,\s+]/g, '').match(/^(\d+(?:\.\d+)?)([km])?$/i);
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] ? (m[2].toLowerCase() === 'k' ? 1e3 : 1e6) : 1));
}
const groupDigits = (n: number) => n.toLocaleString('en-US');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decode(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
}
function tags(block: string, name: string): string[] {
  return [...block.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi'))].map(m => decode(m[1]));
}
export function safeHttps(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2000) return null;
    return url.href;
  } catch { return null; }
}
function isoDate(value: string): string | null {
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function parseFeed(xml: string, source: Pick<Source, 'kind' | 'ai_only'>): TrendItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map(m => m[2]);
  const items: TrendItem[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const title = tag(block, 'title').slice(0, 400);
    if (!title) continue;
    let url: string | null, detail: string | null = null, metric: number | null = null;
    if (source.kind === 'google_trends') {
      // The item <link> points back at the feed itself; link to the term on Google Trends.
      url = 'https://trends.google.com/trends/explore?geo=TH&q=' + encodeURIComponent(title);
      const traffic = tag(block, 'ht:approx_traffic'), news = tag(block, 'ht:news_item_title');
      metric = parseTraffic(traffic);
      detail = [traffic && 'ปริมาณค้นหา ' + traffic, news && 'ข่าวที่เกี่ยวข้อง: ' + news].filter(Boolean).join(' · ').slice(0, 200) || null;
    } else {
      const atomLink = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i)?.[1];
      url = safeHttps(decode(tag(block, 'link') || atomLink || ''));
      if (source.ai_only && !isAiRelated(title + ' ' + tags(block, 'category').join(' '))) continue;
    }
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push({
      title, url, detail, metric,
      category: categorize(title, source.kind),
      published_at: isoDate(tag(block, 'pubDate') || tag(block, 'dc:date') || tag(block, 'published') || tag(block, 'updated'))
    });
    if (items.length >= MAX_ITEMS_PER_SOURCE) break;
  }
  return items;
}

// Hugging Face trending models created recently ("โมเดลใหม่ที่มาแรง").
export function parseHfModels(json: unknown, now: number): TrendItem[] {
  if (!Array.isArray(json)) throw new Error('ข้อมูลจาก Hugging Face ไม่ถูกรูปแบบ');
  const items: TrendItem[] = [];
  for (const m of json) {
    const id = typeof m?.id === 'string' ? m.id : '';
    if (!/^[\w.-]{1,96}\/[\w.-]{1,96}$/.test(id)) continue;
    // Skip re-packaged copies of the same model and safety-stripped variants.
    if (/gguf|gptq|awq|mlx|[-_.](?:\d+bit|int\d|fp8|q\d)|uncensored|abliterated|nsfw/i.test(id)) continue;
    const created = isoDate(String(m.createdAt || ''));
    if (!created || now - Date.parse(created) > NEW_MODEL_DAYS * 86400000) continue;
    const likes = Number(m.likes) || 0, downloads = Number(m.downloads) || 0;
    items.push({
      title: id, url: 'https://huggingface.co/' + id, category: 'new_model', published_at: created,
      metric: Math.round(Number(m.trendingScore) || 0),
      detail: [typeof m.pipeline_tag === 'string' ? m.pipeline_tag : 'โมเดล', 'ถูกใจ ' + groupDigits(likes), 'ดาวน์โหลด ' + groupDigits(downloads)].join(' · '),
    });
    if (items.length >= 20) break;
  }
  return items;
}

// YouTube: most-viewed AI videos in Thailand from the past week.
async function fetchYoutube(deps: Deps, key: string, now: number): Promise<TrendItem[]> {
  const search = new URL('https://www.googleapis.com/youtube/v3/search');
  const params: Record<string, string> = { part: 'snippet', type: 'video', q: 'AI|ChatGPT|Gemini|ปัญญาประดิษฐ์|สอน AI',
    regionCode: 'TH', relevanceLanguage: 'th', order: 'viewCount', safeSearch: 'moderate', maxResults: '25',
    publishedAfter: new Date(now - CLIP_DAYS * 86400000).toISOString(), key };
  Object.entries(params).forEach(([k, v]) => search.searchParams.set(k, v));
  const youtubeError = async (r: Response) => {
    const reason = (await r.json().catch(() => null))?.error?.errors?.[0]?.reason;
    return new Error(reason === 'quotaExceeded' ? 'ใช้โควตา YouTube API ของวันนี้หมดแล้ว' : 'YouTube API ตอบกลับ HTTP ' + r.status + (reason ? ' (' + String(reason).slice(0, 40) + ')' : ''));
  };
  const found = await deps.fetch(search, { signal: AbortSignal.timeout(15000) });
  if (!found.ok) throw await youtubeError(found);
  const results = (await found.json())?.items;
  if (!Array.isArray(results)) throw new Error('ข้อมูลจาก YouTube ไม่ถูกรูปแบบ');
  const videos = results.filter(v => /^[\w-]{11}$/.test(v?.id?.videoId || ''));
  if (!videos.length) return [];
  const stats = new URL('https://www.googleapis.com/youtube/v3/videos');
  stats.searchParams.set('part', 'statistics');
  stats.searchParams.set('id', videos.map(v => v.id.videoId).join(','));
  stats.searchParams.set('key', key);
  const counted = await deps.fetch(stats, { signal: AbortSignal.timeout(15000) });
  if (!counted.ok) throw await youtubeError(counted);
  const views = new Map<string, number>(((await counted.json())?.items || []).map((v: any) => [v.id, Number(v.statistics?.viewCount) || 0]));
  return videos.map(v => {
    const count = views.get(v.id.videoId) ?? null;
    return {
      title: decode(String(v.snippet?.title || '')).slice(0, 400) || v.id.videoId,
      url: 'https://www.youtube.com/watch?v=' + v.id.videoId, category: 'video_clip', metric: count,
      published_at: isoDate(String(v.snippet?.publishedAt || '')),
      detail: ['ช่อง ' + decode(String(v.snippet?.channelTitle || 'ไม่ระบุ')).slice(0, 80), count === null ? '' : 'ยอดดู ' + groupDigits(count)].filter(Boolean).join(' · '),
    };
  });
}

export function createHandler(deps: Deps) {
  return async (request: Request): Promise<Response> => {
    const origin = deps.env('TRENDS_ORIGIN') || 'https://otakubom001.github.io';
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (request.headers.get('origin') && request.headers.get('origin') !== origin) return reply({ code: 'ORIGIN_DENIED' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ code: 'METHOD_NOT_ALLOWED' }, 405);
    const base = deps.env('SUPABASE_URL') || '', admin = deps.env('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!base || !admin) return reply({ code: 'SERVER_CONFIG_MISSING' }, 503);
    let input: any;
    try { input = await request.json(); } catch { return reply({ code: 'INVALID_REQUEST' }, 400); }
    if (input?.action !== 'refresh') return reply({ code: 'INVALID_REQUEST' }, 400);
    const now = deps.now ? deps.now() : Date.now();

    async function api(path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) {
      return await deps.fetch(base + '/rest/v1/' + path, { method, headers: { apikey: admin, Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json', ...extra },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    }
    async function rows(path: string) {
      const r = await api(path); if (!r.ok) throw new Error('database'); return await r.json();
    }
    async function collect(source: Source): Promise<TrendItem[]> {
      if (source.kind === 'youtube') {
        const key = deps.env('YOUTUBE_API_KEY');
        if (!key) throw new Error('ยังไม่ได้ตั้งค่า YOUTUBE_API_KEY');
        return await fetchYoutube(deps, key, now);
      }
      const feedUrl = safeHttps(source.feed_url);
      if (!feedUrl) throw new Error('ที่อยู่แหล่งข้อมูลไม่ใช่ https');
      const response = await deps.fetch(feedUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSS reader)',
        Accept: source.kind === 'hf_models' ? 'application/json' : 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9' },
        redirect: 'follow', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('แหล่งข่าวตอบกลับ HTTP ' + response.status);
      if (source.kind === 'hf_models') return parseHfModels(await response.json(), now);
      const text = (await response.text()).slice(0, 3_000_000);
      if (!/<(rss|feed|rdf:RDF)\b/i.test(text)) throw new Error('ไม่ใช่รูปแบบ RSS/Atom');
      return parseFeed(text, source);
    }
    try {
      const last = await rows(`ai_trend_runs?studio_id=eq.${STUDIO}&select=started_at&order=started_at.desc&limit=1`);
      if (last[0] && now - Date.parse(last[0].started_at) < COOLDOWN_MS) return reply({ ok: true, skipped: true, lastRunAt: last[0].started_at });
      const sources: Source[] = await rows('ai_trend_sources?enabled=eq.true&select=id,feed_url,kind,ai_only&order=id');
      const startedAt = new Date(now).toISOString();
      const results = await Promise.all(sources.map(async source => {
        let count = 0, error: string | null = null;
        try {
          const items = await collect(source);
          count = items.length;
          if (items.length) {
            // merge-duplicates keeps view counts and trending scores current on later runs.
            const saved = await api('ai_trend_items?on_conflict=studio_id,source_id,url', 'POST',
              items.map(i => ({ ...i, studio_id: STUDIO, source_id: source.id, fetched_at: new Date(now).toISOString() })),
              { Prefer: 'resolution=merge-duplicates,return=minimal' });
            if (!saved.ok) throw new Error('บันทึกข่าวไม่สำเร็จ');
          }
        } catch (e) {
          error = e instanceof Error && e.name !== 'TimeoutError' ? e.message : 'แหล่งข่าวไม่ตอบกลับภายในเวลา';
        }
        await api('ai_trend_runs', 'POST', { studio_id: STUDIO, source_id: source.id, started_at: startedAt, finished_at: new Date().toISOString(),
          ok: !error, item_count: count, error: error ? error.slice(0, 300) : null }, { Prefer: 'return=minimal' });
        return error ? { source: source.id, ok: false, error } : { source: source.id, ok: true, count };
      }));
      const cutoff = new Date(now - RETENTION_DAYS * 86400000).toISOString();
      await api(`ai_trend_items?studio_id=eq.${STUDIO}&fetched_at=lt.${cutoff}`, 'DELETE');
      await api(`ai_trend_runs?studio_id=eq.${STUDIO}&started_at=lt.${new Date(now - RUN_RETENTION_DAYS * 86400000).toISOString()}`, 'DELETE');
      return reply({ ok: true, results });
    } catch {
      return reply({ code: 'SERVICE_UNAVAILABLE' }, 503);
    }
  };
}
if (import.meta.main) Deno.serve(createHandler({ env: name => Deno.env.get(name), fetch }));
