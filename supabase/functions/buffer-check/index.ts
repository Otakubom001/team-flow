// Dashboard-only diagnostic. This function cannot create or publish posts.
// Never expose SUPABASE_SERVICE_ROLE_KEY or BUFFER_API_KEY in the website.
type Dependencies = { env: (name: string) => string | undefined; fetch: typeof fetch };
type Channel = { id: string; name: string; displayName: string; service: string; isQueuePaused: boolean };

export function createHandler(deps: Dependencies) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  async function sameSecret(a: string, b: string) {
    const encode = new TextEncoder();
    const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', encode.encode(s))));
    const left = new Uint8Array(x), right = new Uint8Array(y);
    let difference = 0;
    for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
    return difference === 0;
  }
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    const adminKey = deps.env('SUPABASE_SERVICE_ROLE_KEY');
    let modernKey: string | undefined;
    try {
      const keys = JSON.parse(deps.env('SUPABASE_SECRET_KEYS') || '{}');
      if (typeof keys?.default === 'string' && keys.default.startsWith('sb_secret_')) modernKey = keys.default;
    } catch { /* Invalid configuration must never authorize a caller. */ }
    if (!adminKey && !modernKey) return json({ ok: false, code: 'SERVER_CONFIG_MISSING' }, 503);
    // Dashboard's Add secret key sends the default project key in apikey.
    // This check replaces gateway JWT verification for non-JWT secret keys.
    const apiKey = request.headers.get('apikey');
    const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    const modernAllowed = !!(modernKey && apiKey && apiKey.length <= 8192 && await sameSecret(apiKey, modernKey));
    const legacyAllowed = !!(adminKey && token && token.length <= 8192 && await sameSecret(token, adminKey));
    if (!modernAllowed && !legacyAllowed) {
      return json({ ok: false, code: apiKey && !modernKey ? 'DEFAULT_SECRET_KEY_MISSING' : 'ADMIN_ONLY',
        message: 'Use Add secret key in the Supabase Dashboard tester (default project secret key).' }, 403);
    }
    const key = deps.env('BUFFER_API_KEY')?.trim();
    if (!key) return json({ ok: false, code: 'BUFFER_KEY_MISSING' }, 503);
    let failureCode = 'BUFFER_UNAVAILABLE';
    async function query<T>(query: string, variables: Record<string, string> = {}): Promise<T> {
      const response = await deps.fetch('https://api.buffer.com', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      if (!response.ok) {
        failureCode = response.status === 401 || response.status === 403 ? 'BUFFER_KEY_REJECTED'
          : response.status === 429 ? 'BUFFER_RATE_LIMIT' : 'BUFFER_UNAVAILABLE';
        throw new Error('Buffer request failed');
      }
      const result = await response.json();
      if (result.errors?.length || !result.data) {
        failureCode = 'BUFFER_QUERY_FAILED';
        throw new Error('Buffer query failed');
      }
      return result.data as T;
    }
    try {
      const account = await query<{ account: { organizations: { id: string }[] } }>(
        'query { account { organizations { id } } }',
      );
      const organizations = account.account.organizations;
      const channels: (Channel & { organizationId: string })[] = [];
      // Bound upstream calls even if the account belongs to many workspaces.
      for (const organization of organizations.slice(0, 10)) {
        const result = await query<{ channels: Channel[] }>(
          'query Channels($organizationId: OrganizationId!) { channels(input: { organizationId: $organizationId }) { id name displayName service isQueuePaused } }',
          { organizationId: organization.id },
        );
        channels.push(...result.channels.map(c => ({
          organizationId: organization.id, id: c.id, name: c.name,
          displayName: c.displayName, service: c.service, isQueuePaused: c.isQueuePaused,
        })));
      }
      return json({ ok: true, readOnly: true, organizations, channels, truncated: organizations.length > 10 });
    } catch {
      // Never return upstream response bodies, request headers, or secret values.
      return json({ ok: false, code: failureCode, message: 'Connection check failed. No posts were created.' }, 502);
    }
  };
}

if (import.meta.main) Deno.serve(createHandler({ env: name => Deno.env.get(name), fetch }));
