> Deployment update (2026-11-21): the user created the publishing function as
> `smooth-responder`. The website now targets that name. Keep it and update it
> in place using `functions/buffer-publish/index.ts`; do not create another copy.
> Configure Verify JWT on `smooth-responder`. The instructions below that name
> `buffer-publish` refer to this same publishing handler. Code/settings still need
> verification; a function list alone does not prove its deployed source is correct.

# Buffer connection — phase 1: private connection check

The user has saved `BUFFER_API_KEY` in Supabase Edge Function Secrets.
No secret value belongs in this repository or browser code.

## Deploy through the Dashboard

1. Open the project's **Edge Functions** page.
2. Choose **Deploy a new function → Via Editor**.
3. Name the function `buffer-check`.
4. Replace the starter `index.ts` with `functions/buffer-check/index.ts` from this directory.
5. Deploy the updated code. In this function's Settings, disable **Verify JWT**:
   the new project secret keys are not JWTs. The handler itself verifies the exact
   default project secret from `SUPABASE_SECRET_KEYS` before making any Buffer request.
6. Open **Test**, choose POST, body `{}`, remove the manually added Authorization
   header, then choose **Add header → Add secret key** (default project secret).
   Never choose Add publishable key or copy credentials into chat or website code.
7. A successful response has `ok: true`, `readOnly: true`, and the connected channels.

The handler independently checks the full default project secret (or legacy service-role credential), so possession of
the website's public anon key is insufficient. It does not accept arbitrary GraphQL
queries, does not log secrets, and cannot publish or modify Buffer posts.

## Publishing setup (implemented locally; requires deployment)

Keep the existing `clever-api` diagnostic. Create a separate `buffer-publish`
function for the website. Do not replace the working diagnostic with this code.

1. In **SQL Editor**, run `migrations/202611200001_publishing.sql` once.
   It creates three RLS-protected tables, three fixed destination channels and a
   public `publishing-media` bucket limited to 50 MiB per file. It does not change
   the existing content/calendar tables. Check the three channel IDs against
   the successful `clever-api` response before running.
2. In **Authentication > Users > Add user > Create new user**, create the chosen
   publisher email. The owner enters a unique password privately and enables
   **Auto Confirm User** for this manually created account. Do not share the
   password in chat. This account is separate from the website PIN and Buffer login.
3. In SQL Editor, run `enable-publisher.sql`, replacing `owner@example.com`
   with that email. The script fails if the Auth user does not exist.
4. **Edge Functions > Deploy a new function > Via Editor**: name the function
   exactly `buffer-publish`, retain filename `index.ts`, paste
   `functions/buffer-publish/index.ts`, and deploy. The existing `BUFFER_API_KEY`
   secret is reused; no new Buffer key is needed. Keep it server-side.
5. In the new function's Settings, disable **Verify JWT with legacy secret**
   and save. The new handler calls Supabase Auth to validate the user's access
   token and checks the publisher table on EVERY request. It does not authorize
   with a frontend PIN, anon key, or unverified JWT claims.
6. Deploy `index.html`, `publish.js`, `publish.css`, and `buffer-client.js` to
   the existing GitHub Pages website. Click **เข้าสู่ระบบผู้โพสต์** and log in
   with the publisher email/password. No secret/project key belongs in this UI.
7. Save a test file as a local record. Check the destination names and disclosure
   fields in **ส่งเข้า Buffer**. Confirm only when ready for an actual queued
   post: this button will publish at the next free queue slot for each channel.
8. Inspect the Buffer queue, then click **ตรวจสถานะ** on the website. Only
   Buffer's `sent` state is shown as remotely published. `queued` is acceptance,
   not proof of publication. Complete a real test before declaring the system live.

### Behaviour and limits

- Files and draft records remain browser-local until the user explicitly confirms
  the upload and queue submission. Session tokens use sessionStorage by default. The optional remember-device checkbox migrates the publisher session to localStorage; unchecking moves it back. Sign-out clears both stores. Passwords are never saved by this feature. No self-signup
  UI or browser-accessible service/Buffer keys are added.
- Buffer requires a stable public direct file URL until publication. Public bucket
  URLs are not private storage: anyone with a URL can download the file. The UI
  explains this before upload. Authenticated publishers can insert only into their
  own folder; the website cannot overwrite or delete hosted media. Removing a
  local record does not cancel a Buffer post or delete its hosted file.
- Initial upload cap: 50 MiB; Supabase storage/egress quotas still apply. No paid
  plan is purchased. Standard upload is used; failed uploads can be tried again.
  Larger files remain usable with the manual-posting path.
- The browser reads dimensions/duration; the server revalidates these submitted
  values, checks actual stored object size/MIME and only builds URLs in the user's
  own bucket folder. It does not decode video or verify codecs/music rights.
  Buffer performs its own validation; initial checks are not publication guarantees.
- One file can target several channels. Each channel has its own durable delivery
  row, unique by user + local item UUID + platform. Concurrent or repeated requests
  for the same record cannot create a second Buffer post. Reimporting as a NEW
  record intentionally creates a new UUID, so this is not content-hash deduplication.
- Once a submission is claimed, timeouts or ambiguous failures never automatically
  retry. `unknown` or stale `sending` requires checking Buffer first. After manual
  reconciliation, an administrator may repair the delivery row; do not blindly
  delete it or reimport the file to retry. Explicit rejections stay recorded too.
- Status refresh is user-triggered, not a background polling job. Records are not
  synchronized between browsers/devices. Hosted media cleanup is manual in the
  Storage dashboard AFTER confirming no queued post still needs the file.
- The pre-existing content/calendar status behaviour is independent and unchanged.

### Verification

`deno test tests/buffer-check.test.ts tests/buffer-publish.test.ts`

`node tests/publish-rules.cjs` and `node tests/calendar-status.cjs`

Tests cover authentication, publisher allowlist, media limits/ownership paths,
concurrent sends, timeout ambiguity, persistence failures, error redaction and
remote status mapping. Local browser smoke testing uses an isolated demo with a
stub Buffer client; it does not upload or publish to real accounts.
SQL migration, storage policies and live delivery still require project deployment
and a real owner-authorized test.

## References

- https://developers.buffer.com/guides/authentication.html
- https://developers.buffer.com/reference.html
- https://developers.buffer.com/guides/hosting-media.html
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/functions/quickstart-dashboard

The existing diagnostic is deployed as `clever-api`. Its connection check succeeded
with three channels. This does not mean `buffer-publish` is deployed.
