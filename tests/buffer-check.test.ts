import { createHandler } from '../supabase/functions/buffer-check/index.ts';
const assert = (condition: unknown) => { if (!condition) throw new Error('Assertion failed'); };
const env = (name: string) => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-admin', BUFFER_API_KEY: 'test-buffer-secret' }[name]);
const request = (token = 'test-admin') => new Request('https://example.test/check', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });

Deno.test('new dashboard secret key works, public and foreign keys fail closed', async () => {
  let calls = 0;
  const handler = createHandler({
    env: name => name === 'SUPABASE_SECRET_KEYS' ? JSON.stringify({ default: 'sb_secret_test-private' }) : env(name),
    fetch: async () => { calls++; return Response.json({ data: { account: { organizations: [] } } }); },
  });
  for (const key of ['sb_publishable_public', 'sb_secret_foreign', '']) {
    const result = await handler(new Request('https://example.test/check', { method: 'POST', headers: { apikey: key } }));
    assert(result.status === 403 && calls === 0);
  }
  const result = await handler(new Request('https://example.test/check', { method: 'POST', headers: {
    apikey: 'sb_secret_test-private', Authorization: 'Bearer irrelevant-dashboard-token',
  } }));
  assert(result.status === 200 && calls === 1);
  assert(!(await result.text()).includes('sb_secret_test-private'));
});
Deno.test('invalid new-key configuration never authorizes caller', async () => {
  for (const config of ['broken-json', 'null', '{}', '{"default":""}', '{"default":"sb_publishable_test"}']) {
    const handler = createHandler({ env: name => name === 'SUPABASE_SECRET_KEYS' ? config : undefined,
      fetch: () => { throw new Error('Must not call upstream'); } });
    assert((await handler(new Request('https://example.test/check', { method: 'POST', headers: { apikey: 'sb_secret_test' } }))).status === 503);
  }
});

Deno.test('rejects public and user tokens before calling Buffer', async () => {
  const handler = createHandler({ env, fetch: () => { throw new Error('Must not call upstream'); } });
  for (const token of ['', 'anon-key', 'user-token']) assert((await handler(request(token))).status === 403);
});
Deno.test('returns channel summaries using read-only queries, without secrets', async () => {
  let calls = 0;
  const handler = createHandler({ env, fetch: async (url, options) => {
    calls++;
    assert(url === 'https://api.buffer.com');
    const body = JSON.parse(String(options?.body));
    assert(body.query.startsWith('query'));
    if (calls === 2) assert(body.variables.organizationId === 'org1');
    return Response.json({ data: calls === 1 ? { account: { organizations: [{ id: 'org1' }] } }
      : { channels: [{ id: 'channel1', name: 'Studio', displayName: 'Studio', service: 'youtube', isQueuePaused: false }] } });
  } });
  const response = await handler(request());
  const text = await response.text();
  const result = JSON.parse(text);
  assert(response.status === 200 && result.ok && result.readOnly && calls === 2);
  assert(result.channels[0].organizationId === 'org1');
  assert(!text.includes('test-admin') && !text.includes('test-buffer-secret'));
});
Deno.test('upstream errors are redacted', async () => {
  for (const status of [401, 429, 500]) {
    const handler = createHandler({ env, fetch: async () => new Response('test-buffer-secret', { status }) });
    const response = await handler(request());
    assert(response.status === 502);
    assert(!(await response.text()).includes('test-buffer-secret'));
  }
});
Deno.test('missing secret fails closed; malformed GraphQL response fails safely', async () => {
  const missing = createHandler({ env: () => undefined, fetch });
  assert((await missing(request())).status === 503);
  const handler = createHandler({ env, fetch: async () => Response.json({ errors: [{ message: 'test-buffer-secret' }] }) });
  const response = await handler(request());
  assert(response.status === 502 && !(await response.text()).includes('test-buffer-secret'));
});
