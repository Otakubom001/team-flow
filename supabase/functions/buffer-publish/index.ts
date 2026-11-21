// Self-contained for Dashboard deployment. Never put these secrets in browser code.
type Deps = { env: (name: string) => string | undefined; fetch: typeof fetch };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateSchedule(input: any, now = Date.now()): string | null {
 if (input.scheduleMode === undefined || input.scheduleMode === 'queue') return input.dueAt == null ? null : 'INVALID_SCHEDULE';
 if (input.scheduleMode !== 'custom' || typeof input.dueAt !== 'string') return 'INVALID_SCHEDULE';
 const timestamp = Date.parse(input.dueAt);
 if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== input.dueAt || timestamp < now + 5*60000) return 'INVALID_SCHEDULE';
 return null;
}
export function validate(input: any): string | null {
  const scheduleError = validateSchedule(input); if (scheduleError) return scheduleError;
  const m = input?.meta, p = input?.platform;
  if (!UUID.test(input?.id || '') || !['facebook','tiktok','youtube'].includes(p)) return 'INVALID_REQUEST';
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 100 || typeof input.caption !== 'string' || input.caption.length > 5000) return 'INVALID_TEXT';
  if (!m || !Number.isFinite(m.size) || m.size <= 0 || m.size > 52428800 || !Number.isFinite(m.width) || !Number.isFinite(m.height) || m.width <= 0 || m.height <= 0) return 'INVALID_MEDIA';
  const ext = String(m.name).split('.').pop()?.toLowerCase();
  if (m.kind === 'image') return p === 'facebook' && ['jpg','jpeg','png'].includes(ext || '') ? null : 'MANUAL_REQUIRED';
  if (m.kind !== 'video' || !['mp4','mov','webm','m4v'].includes(ext || '') || !Number.isFinite(m.duration) || m.duration < 3 || m.duration > 360) return 'MANUAL_REQUIRED';
  if (p === 'facebook' && (ext === 'webm' || m.duration > 90 || Math.abs(m.width/m.height - 9/16) > .005 || m.width < 540 || m.height < 960)) return 'MANUAL_REQUIRED';
  if (p === 'youtube' && (m.duration > 180 || m.width > m.height)) return 'MANUAL_REQUIRED';
  if (p === 'tiktok' && (ext === 'm4v' || m.width < 360 || m.height < 360)) return 'MANUAL_REQUIRED';
  if (typeof input.aiGenerated !== 'boolean' || typeof input.madeForKids !== 'boolean') return 'METADATA_REQUIRED';
  return null;
}
export function createHandler(deps: Deps) {
 return async (request: Request): Promise<Response> => {
  const origin = deps.env('PUBLISH_ORIGIN') || 'https://otakubom001.github.io';
  const headers = {'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':origin,
   'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body),{status,headers});
  if (request.headers.get('origin') && request.headers.get('origin') !== origin) return reply({code:'ORIGIN_DENIED'},403);
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
  if (request.method !== 'POST') return reply({code:'METHOD_NOT_ALLOWED'},405);
  const base = deps.env('SUPABASE_URL') || '', admin = deps.env('SUPABASE_SERVICE_ROLE_KEY') || '', key = deps.env('BUFFER_API_KEY') || '';
  if (!base || !admin || !key) return reply({code:'SERVER_CONFIG_MISSING'},503);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return reply({code:'LOGIN_REQUIRED'},401);
  async function api(path: string, method = 'GET', body?: unknown, extra = {}) {
   return await deps.fetch(base + path,{method,headers:{apikey:admin,Authorization:`Bearer ${admin}`,'Content-Type':'application/json',...extra},
    ...(body !== undefined ? {body:JSON.stringify(body)} : {}),signal:AbortSignal.timeout(20000)});
  }
  async function rows(path: string) {
   const r = await api('/rest/v1/' + path); if (!r.ok) throw new Error('database'); return await r.json();
  }
  try {
   // Validate with Auth server, not a decoded/unverified JWT or the website PIN.
   const u = await deps.fetch(base + '/auth/v1/user',{headers:{apikey:admin,Authorization:auth},signal:AbortSignal.timeout(10000)});
   if (!u.ok) return reply({code:'LOGIN_REQUIRED'},401);
   const user = await u.json();
   if (!UUID.test(user.id || '')) return reply({code:'LOGIN_REQUIRED'},401);
   if (!(await rows(`publishers?user_id=eq.${user.id}&select=user_id`)).length) return reply({code:'PUBLISHER_REQUIRED'},403);
   const raw = await request.text(); if (raw.length > 20000) return reply({code:'INVALID_REQUEST'},400);
   let input; try {input = JSON.parse(raw);} catch {return reply({code:'INVALID_REQUEST'},400);}
   if (input.action === 'channels') return reply({ok:true,channels:await rows('publishing_channels?select=platform,name'),maxBytes:52428800,features:{customSchedule:true}});
   if (input.action !== 'send' && input.action !== 'status') return reply({code:'INVALID_REQUEST'},400);
   if (!UUID.test(input.id || '') || !['facebook','tiktok','youtube'].includes(input.platform)) return reply({code:'INVALID_REQUEST'},400);
   const filter = `user_id=eq.${user.id}&item_id=eq.${input.id}&platform=eq.${input.platform}`;
   const existing = await rows(`publishing_deliveries?${filter}&select=state,post_id`);
   // Unique DB key makes concurrent clicks/reloads safe. Never retry uncertain writes.
   if (existing.length) {
    const entry = existing[0];
    if (input.action === 'status' && entry.post_id) {
     const response = await deps.fetch('https://api.buffer.com',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({query:'query Status($input: PostInput!) { post(input: $input) { id status dueAt externalLink } }',variables:{input:{id:entry.post_id}}})});
     const result = await response.json();
     if (!response.ok || result.errors || !result.data?.post) return reply({code:'STATUS_UNAVAILABLE'},502);
     return reply({ok:true,...entry,providerStatus:result.data.post.status,url:result.data.post.externalLink,dueAt:result.data.post.dueAt});
    }
    return reply({ok:true,...entry});
   }
   if (input.action === 'status') return reply({ok:true,state:'not_sent'});
   const invalid = validate(input); if (invalid) return reply({code:invalid},400);
   const ext = input.meta.name.split('.').pop().toLowerCase();
   const path = `${user.id}/${input.id}/media.${ext}`;
   const listing = await api('/storage/v1/object/list/publishing-media','POST',{prefix:`${user.id}/${input.id}/`,limit:10});
   if (!listing.ok) return reply({code:'MEDIA_NOT_FOUND'},400);
   const files = await listing.json();
   const file = files.find((f:any) => f.name === `media.${ext}`);
   const expectedMime: Record<string,string> = {mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',m4v:'video/x-m4v',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png'};
   if (!file || Number(file.metadata?.size) !== input.meta.size || file.metadata?.mimetype !== expectedMime[ext]) return reply({code:'MEDIA_MISMATCH'},400);
   const channels = await rows(`publishing_channels?platform=eq.${input.platform}&select=channel_id`);
   if (!channels.length) return reply({code:'CHANNEL_MISSING'},503);
   const scheduleError = validateSchedule(input); if (scheduleError) return reply({code:scheduleError},400);
   const claim = await api('/rest/v1/publishing_deliveries','POST',{user_id:user.id,item_id:input.id,platform:input.platform,state:'sending'});
   if (claim.status === 409) return reply({ok:true,...(await rows(`publishing_deliveries?${filter}&select=state,post_id`))[0]});
   if (!claim.ok) return reply({code:'DATABASE_UNAVAILABLE'},503);
   const metadata = input.platform === 'facebook' ? {facebook:{type:input.meta.kind === 'video'?'reel':'post'}}
    : input.platform === 'youtube' ? {youtube:{title:input.title,categoryId:'24',privacy:'public',madeForKids:input.madeForKids,isAiGenerated:input.aiGenerated}}
    : {tiktok:{isAiGenerated:input.aiGenerated}};
   const postInput = {channelId:channels[0].channel_id,text:input.caption || input.title,metadata,
    schedulingType:'automatic',mode:input.scheduleMode === 'custom'?'customScheduled':'addToQueue',needsApproval:false,
    ...(input.scheduleMode === 'custom'?{dueAt:input.dueAt}:{}),
    assets:[{[input.meta.kind]:{url:base+'/storage/v1/object/public/publishing-media/'+path}}]};
   let state = 'unknown', post_id: string | null = null;
   try {
    const response = await deps.fetch('https://api.buffer.com',{method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
     headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
     body:JSON.stringify({query:'mutation Send($input: CreatePostInput!) { createPost(input: $input) { __typename ... on PostActionSuccess { post { id } } ... on MutationError { message } } }',variables:{input:postInput}})});
    const result = await response.json();
    const post = result.data?.createPost;
    if (response.ok && post?.__typename === 'PostActionSuccess' && typeof post.post?.id === 'string') {state='queued';post_id=post.post.id;}
    else if (response.ok && ['InvalidInputError','UnauthorizedError','NotFoundError','LimitReachedError'].includes(post?.__typename)) state='rejected';
    // HTTP failures, malformed data and timeouts can occur after creation: do not retry.
   } catch { /* Keep unknown: inspect Buffer before taking any further action. */ }
   const saved = await api('/rest/v1/publishing_deliveries?'+filter,'PATCH',{state,post_id});
   if (!saved.ok) return reply({ok:true,state:'unknown'});
   return reply({ok:true,state,post_id});
  } catch {return reply({code:'SERVICE_UNAVAILABLE'},503);}
 };
}
if (import.meta.main) Deno.serve(createHandler({env:name=>Deno.env.get(name),fetch}));
