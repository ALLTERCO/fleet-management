<!-- audience: public -->
# SMTP setup for Notifications

Fleet Manager sends alert notifications as email via SMTP endpoints
configured under **Settings → Alerts → Channels**. This doc
covers:

- [Picking a provider](#picking-a-provider)
- [Per-provider setup](#per-provider-setup)
- [TLS + authentication](#tls--authentication)
- [DNS deliverability: SPF + DKIM + DMARC](#dns-deliverability)
- [Troubleshooting](#troubleshooting)

---

## Picking a provider

Your endpoint works in one of three modes:

| Mode | Typical provider | Trade-off |
| --- | --- | --- |
| **Account SMTP with app password** | Gmail, Outlook.com personal, Yahoo, iCloud, Fastmail, Zoho | Simplest for a single operator sending from their own mailbox. Requires 2FA and an app password. Deliverability is OK for internal or small audiences. |
| **Transactional relay with API key** | SendGrid, Mailgun, Postmark, Amazon SES, Brevo, Mailjet, SparkPost | Recommended for production fleets. Best deliverability, generous daily limits, usable audit trail on the provider side. No OAuth2, no app password; the provider's API key is the password. |
| **Enterprise tenant SMTP** | Microsoft 365, Google Workspace | Business accounts. Both support OAuth2 (see the OAuth2 section below). M365 also requires OAuth2 by default since SMTP AUTH is disabled. |

If you are shipping a Shelly-based fleet at any scale, use a
transactional relay. Personal mailboxes have hidden send-rate caps
and will silently throttle.

---

## Per-provider setup

### Gmail / Google Workspace

- Preset: `gmail` or `google_workspace`
- Host: `smtp.gmail.com`, port `465` (SSL) or `587` (STARTTLS)
- 2FA must be enabled on the account
- Generate an app password: <https://myaccount.google.com/apppasswords>
- Username: your full Gmail / Workspace address
- Password: the 16-character app password (not your account password)

### Microsoft 365 (business)

- Preset: `microsoft365`
- Host: `smtp.office365.com`, port `587`, STARTTLS
- **SMTP AUTH is disabled by default** across M365 tenants since
  October 2022. You have three options:
  1. Use OAuth2 (see [OAuth2 authentication](#oauth2-authentication-gmail--microsoft-365)).
  2. Ask the tenant admin to re-enable SMTP AUTH on the sending
     mailbox. Docs:
     <https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission>
  3. Relay through SendGrid / SES / Postmark instead: usually the
     best answer for SaaS deployments.

### Outlook.com / Hotmail (personal)

- Preset: `outlook_personal`
- Host: `smtp-mail.outlook.com`, port `587`, STARTTLS
- 2FA required. Generate an app password:
  <https://account.live.com/proofs/AppPassword>

### Yahoo Mail / AOL

- Presets: `yahoo`, `aol`
- Hosts: `smtp.mail.yahoo.com:465`, `smtp.aol.com:465`
- App password required (2FA only):
  <https://help.yahoo.com/kb/generate-third-party-passwords-sln15241.html>

### Apple iCloud Mail

- Preset: `icloud`
- Host: `smtp.mail.me.com`, port `587`, STARTTLS
- App-specific password required: [Apple docs](https://support.apple.com/en-us/102654).
- Username is your full iCloud email (`name@icloud.com`)

### Proton Mail (via Bridge)

- Preset: `proton_bridge`
- Host: `127.0.0.1`, port `1025`
- Requires Proton Mail Bridge running on the same host as Fleet Manager
- Bridge supplies a local-only username + password
- Docs: <https://proton.me/mail/bridge>

### SendGrid

- Preset: `sendgrid`
- Host: `smtp.sendgrid.net`, port `587`, STARTTLS
- **Username: `apikey` literally.** Password: your SendGrid API key.
- Docs: <https://docs.sendgrid.com/for-developers/sending-email/integrating-with-the-smtp-api>

### Mailgun

- Presets: `mailgun_us` (`smtp.mailgun.org`), `mailgun_eu` (`smtp.eu.mailgun.org`)
- Port `587`, STARTTLS
- Username + password: SMTP credentials from your Mailgun domain
  settings (NOT the account login)

### Postmark

- Preset: `postmark`
- Host: `smtp.postmarkapp.com`, port `587`, STARTTLS
- Username and password are both the Server API Token from the
  Postmark dashboard

### Amazon SES

- Presets: `amazon_ses_us_east_1`, `amazon_ses_us_west_2`,
  `amazon_ses_eu_west_1`, `amazon_ses_eu_central_1`,
  `amazon_ses_ap_southeast_1`, `amazon_ses_ap_northeast_1`
- Port `587`, STARTTLS
- Create **SMTP credentials** in the SES console (NOT regular IAM keys;
  they are IAM-backed but use a separate generator)
- Docs: <https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html>

### Mailjet / Brevo (Sendinblue) / SparkPost / Mandrill / Elastic Email / SMTP2GO

- See the preset dropdown for hosts and ports. All use
  username-and-API-key auth over STARTTLS on 587 (or 2525 for Elastic
  Email / SMTP2GO).

### Custom / self-hosted SMTP

- Preset: `custom`
- Fill `host`, `port`, `secure` manually
- For anything on the public internet always use TLS

---

## TLS + authentication

Fleet Manager enforces TLS by default:

- `secure: true`: implicit TLS on connection (port 465)
- `secure: false`: plaintext connect, then STARTTLS upgrade
  (required; the client refuses to fall back to plain text). Use on
  port 587 or 2525.
- `tls.minVersion`: endpoint override; when unset, falls back to
  `FM_SMTP_DEFAULT_TLS_MIN_VERSION` (ships at `TLSv1.2`).
- `tls.rejectUnauthorized`: endpoint override; when unset, falls back
  to `FM_SMTP_DEFAULT_TLS_REJECT_UNAUTHORIZED` (ships at `true`).
  Disable only for pinned self-signed internal relays.

Timeouts come from the tuning config (override any of:
`FM_SMTP_CONNECTION_TIMEOUT_MS`, `FM_SMTP_GREETING_TIMEOUT_MS`,
`FM_SMTP_SOCKET_TIMEOUT_MS` in the deploy env file).

---

## DNS deliverability

None of this is Fleet Manager code: it is DNS you configure on the
domain you send **from**. Without it your alerts will land in spam,
especially on Gmail / M365 recipient inboxes.

Assume you send from `alerts@acme.com`:

### SPF (required)

TXT record on `acme.com`, merging every sender you authorise:

```text
v=spf1 include:_spf.google.com include:sendgrid.net ~all
```

Common `include:` values:

| Provider | Include |
| --- | --- |
| Gmail / Workspace | `include:_spf.google.com` |
| M365 | `include:spf.protection.outlook.com` |
| SendGrid | `include:sendgrid.net` |
| Mailgun | `include:mailgun.org` |
| Postmark | `include:spf.mtasv.net` |
| Amazon SES | `include:amazonses.com` |
| Brevo | `include:spf.brevo.com` |

`~all` (soft fail) is safe while you test; switch to `-all` (hard fail)
once every sender is listed and your DMARC reports look clean.

### DKIM (required for good deliverability)

DKIM is a signature on every outbound message, verified by the recipient
MX against a public key you publish at `<selector>._domainkey.acme.com`.
Two ways to sign; **pick one**:

**Option A: provider signs (most common)**. The sending provider
generates a DKIM keypair and asks you to publish the public part as a
TXT / CNAME record. The provider's setup wizard walks you through it:

- Gmail / Workspace Admin console → Apps → Google Workspace → Gmail →
  Authenticate email
- M365 admin → Email authentication → DKIM
- SendGrid → Settings → Sender Authentication → Authenticate Your Domain
- Mailgun → Domain → DNS records
- SES → Verified identities → DKIM → Easy DKIM
- Postmark → Sender signatures → DKIM

**Option B: Fleet Manager signs (direct MTA / internal relay)**. Only
useful when you're **not** going through a transactional relay: e.g.
an internal `postfix` on the Fleet host, or direct delivery to recipient
MX. Steps:

1. Generate an Ed25519 or RSA key pair (2048-bit min):

   ```bash
   openssl genrsa -out dkim.private 2048
   openssl rsa -in dkim.private -pubout -out dkim.public
   ```

2. Pick a **selector** (any lowercase label, e.g. `fleet2024`).
3. Publish the public key as a TXT record at
   `fleet2024._domainkey.acme.com`:

   ```text
   v=DKIM1; k=rsa; p=<base64 of dkim.public, stripped of PEM headers>
   ```

4. On the Fleet email channel, set:

   ```json
   "dkim": {
     "domainName": "acme.com",
     "keySelector": "fleet2024",
     "privateKey": "<contents of dkim.private, full PEM>"
   }
   ```

   The `privateKey` is stored encrypted and never read back over the API.

Rotate keys by publishing a new selector, swapping the endpoint config,
then removing the old DNS record after ~24h.

**Alignment requirement**: Fleet rejects the endpoint config at save
time if `dkim.domainName` is not the same as or a parent of the `from`
address domain. This prevents signing mail as an unrelated domain (which
would pass DKIM on the wire but fail DMARC at the recipient):

- ✅ `from: alerts@acme.com` + `dkim.domainName: acme.com`
- ✅ `from: alerts@mail.acme.com` + `dkim.domainName: acme.com` (sign
  the parent, deliver from the subdomain)
- ❌ `from: alerts@acme.com` + `dkim.domainName: example.com` (rejected)

### DMARC (required to stop spoofing)

TXT record on `_dmarc.acme.com`:

```text
v=DMARC1; p=quarantine; rua=mailto:dmarc@acme.com; adkim=s; aspf=s
```

- Start with `p=none` for the first week and watch the reports
- Move to `p=quarantine`
- Move to `p=reject` once every legitimate sender aligns

Reporting services like dmarcian / Postmark DMARC digest the daily
aggregate reports for you.

---

## Troubleshooting

### `Error: Required env var FM_API_CONTRACT_VERSION is not set`

Unrelated to SMTP: the backend container is missing runtime-metadata
env vars. See `deploy/env/*.env`.

### `Error: Invalid login: 535-5.7.8 Username and Password not accepted`

Gmail / Outlook: you are using the account password instead of an app
password. Turn on 2FA and regenerate an app password.

### `Error: ... EAUTH 534-5.7.9 Application-specific password required`

Gmail refuses regular passwords when 2FA is on. Use an app password.

### `Error: Can't send mail - all recipients were rejected`

Relay rejected every `toAddress`. Causes:

- SES in sandbox mode: verify every recipient address OR request
  production access
- Postmark / SendGrid: the sender domain must be verified
- M365: the `from` address must be a mailbox the authenticated user
  has SendAs permission on

### `Error: self signed certificate in certificate chain`

You are using a self-hosted SMTP relay with a self-signed cert. Either
install the cert on the Fleet Manager host trust store, or set
`tls.rejectUnauthorized: false` on the channel config (ONLY for
private pinned relays).

### Test passes but real alerts never arrive

1. Check the notification history in Fleet Manager (Notifications →
   Delivery history): if the state is `failed`, click through for
   the provider error.
2. Check the provider dashboard: SendGrid / SES / Postmark all show
   per-recipient delivery events (delivered, bounced, blocked, spam).
3. Check the recipient's spam folder.
4. Verify SPF + DKIM + DMARC (see the [DNS](#dns-deliverability) section).

### `Error: connect ETIMEDOUT`

Network-level: the container cannot reach the SMTP host. Typical
causes:

- Your ISP blocks outbound 25 / 465 / 587 (common on residential
  connections). Switch to a different port (587 vs 465) or run from
  a VPS.
- Firewall between the container and the SMTP host.
- Wrong host in the preset override.

Raise `FM_SMTP_CONNECTION_TIMEOUT_MS` if the path is intermittent.

### Endpoint test succeeds but the message silently disappears

The provider accepted the mail at SMTP but then dropped or filtered
it. Check the provider's activity log / suppression list. Common
causes: the recipient bounced previously and is now suppressed, or
the sender domain is not verified.

---

## Reusable email templates

Save a subject/html/text body once, reference it from many endpoints via
`emailTemplateId`. Inline templates on the channel override the saved
ones field-by-field (so you can share a "branded body" and override the
subject per endpoint).

**RPCs (namespace `notification`):**

| Method | What it does |
| --- | --- |
| `EmailTemplate.List` | Paged list of saved templates for this org. |
| `EmailTemplate.Get` | Fetch one by id. |
| `EmailTemplate.Create` | Save a new template (name + any of subject/html/text). |
| `EmailTemplate.Update` | Patch any field; pass `null` to clear. |
| `EmailTemplate.Delete` | Delete by id. |

**Wire-up:** set `config.emailTemplateId` on an `email_smtp` endpoint
to use a saved template. The delivery pipeline + `Channel.Test` both
resolve the library id before handing the config to the adapter, so
test behaviour matches real delivery.

## OAuth2 authentication (Gmail + Microsoft 365)

For Gmail and M365 you can either use an **app password** (simpler, works
today) or **OAuth2 / XOAUTH2** (no long-lived password stored anywhere;
just a refresh token your consent flow produced). Configure via the
`auth.type` field on the channel config:

- `auth.type: 'password'` (default): `auth.user` + `auth.pass` (the
  password, stored encrypted).
- `auth.type: 'oauth2_google'`: `auth.user` + `auth.clientId`
  (public) plus `auth.clientSecret` + `auth.refreshToken` (both
  encrypted).
- `auth.type: 'oauth2_microsoft'`: same as Google plus optional
  `auth.tenant` (defaults to `common`).

### Gmail / Workspace OAuth2 setup

1. In the Google Cloud Console, create an OAuth client of type
   "Desktop app" or "Web application": note the Client ID and Client
   Secret.
2. Enable the Gmail API for that project.
3. Add the scope `https://mail.google.com/` to the consent screen.
4. Run a one-time consent flow (the OAuth Playground works for
   getting started: <https://developers.google.com/oauthplayground/>)
   to obtain a **refresh token**. Check "Use your own OAuth credentials"
   in the Playground settings and paste your Client ID / Secret.
5. On the endpoint config set:

   ```json
   {
     "preset": "gmail",
     "from": "alerts@acme.com",
     "toAddresses": ["ops@acme.com"],
     "auth": {
       "type": "oauth2_google",
       "user": "alerts@acme.com",
       "clientId": "<GOOGLE_CLIENT_ID>",
       "clientSecret": "<GOOGLE_CLIENT_SECRET>",
       "refreshToken": "<REFRESH_TOKEN>"
     }
   }
   ```

Nodemailer auto-refreshes the access token when it's close to expiry.
No background scheduler needed on our side.

### Microsoft 365 OAuth2 setup

1. In Azure Portal → App registrations, register a new application.
2. Under "API permissions", add delegated **SMTP.Send** (under
   Microsoft Graph / Office 365 Exchange Online).
3. Grant admin consent on the tenant.
4. Under "Certificates & secrets" create a client secret: copy it now
   (Azure won't show it again).
5. Use a one-time consent flow to obtain a refresh token with the
   `https://outlook.office.com/SMTP.Send offline_access` scope.
6. Endpoint config:

   ```json
   {
     "preset": "microsoft365",
     "from": "alerts@acme.com",
     "toAddresses": ["ops@acme.com"],
     "auth": {
       "type": "oauth2_microsoft",
       "user": "alerts@acme.com",
       "clientId": "<APP_REGISTRATION_ID>",
       "clientSecret": "<CLIENT_SECRET>",
       "refreshToken": "<REFRESH_TOKEN>",
       "tenant": "<TENANT_ID_OR_common>"
     }
   }
   ```

**Secrets:** `clientSecret` and `refreshToken` flow into the encrypted
channel secrets table. They're never returned by
any Get/List read; the UI only shows "has credentials" / "missing
credentials".

### In-app consent flow (no manual OAuth Playground)

Fleet can handle the consent dance itself: operator clicks a "Connect
Gmail" / "Connect Microsoft 365" button in the UI, signs in at the
provider, and the refresh token is stored on the channel automatically.
No copy-pasting from OAuth Playground.

**One-time deployment setup**:

1. Set `FM_OAUTH_REDIRECT_BASE` in your env to the Fleet instance URL
   (e.g. `https://fleet.acme.com`). The callback URL becomes
   `<base>/api/oauth/callback/email`.
2. In your Google / Microsoft OAuth app registration, add that exact
   callback URL to the allowed redirect URIs.
3. Restart Fleet so the env is picked up.

**Per-channel flow**:

1. Create an email_smtp channel with `auth.type: 'oauth2_google'` or
   `'oauth2_microsoft'`, and fill in `auth.user`, `auth.clientId`,
   `auth.clientSecret`. Leave `auth.refreshToken` blank.
2. Call `Notification.OAuth.Start({channelId, provider, tenant?})`.
   The backend returns `{authUrl, state, expiresAt}`.
3. The UI opens `authUrl` in a popup window. The user signs in at the
   provider and consents.
4. The provider redirects back to `/api/oauth/callback/email?code=...&state=...`.
   The callback verifies the state (single-use, TTL-enforced, CSRF-safe
   via PKCE), exchanges the code for a refresh token, writes it onto
   the channel's encrypted secrets, and returns a landing page that
   `postMessage`s the opener and auto-closes.
5. The UI refreshes the channel: `secretState.hasSecretFields` is now
   true. `Channel.Test` should succeed.

State rows live in `notifications.oauth_states`. Expired / consumed
rows are pruned on a `FM_OAUTH_STATE_PRUNE_INTERVAL_MS` timer (default
5 min). TTL per state is `FM_OAUTH_STATE_TTL_SECONDS` (default 10 min).

**Scopes** default to minimal-send for each provider and are overridable
via `FM_OAUTH_GMAIL_SCOPES` / `FM_OAUTH_MICROSOFT_SCOPES` (space-delimited
string, as the providers expect).

**Sovereign clouds**: Microsoft GCC High / 21Vianet / Gov cloud users
override `FM_OAUTH_MICROSOFT_AUTH_URL_TEMPLATE` (with `{tenant}`
placeholder) and `FM_SMTP_OAUTH2_MICROSOFT_TOKEN_URL_TEMPLATE`.

## Binary email assets (in-editor image upload)

Instead of hosting logos on a CDN, operators can upload images directly
and reference them by id. Assets live in `notifications.email_assets`
as bytea, deduplicated per-org by sha256.

### Upload

```http
POST /api/notifications/email-assets
Content-Type: multipart/form-data

[multipart part named "file"]
```

- Auth: cookie/bearer session (same as any authenticated Fleet endpoint)
- Max size per file: `FM_EMAIL_ATTACHMENT_MAX_BYTES` (default 5 MiB)
- Allowed content types: `FM_EMAIL_ASSETS_CONTENT_TYPES` (default:
  `image/png`, `image/jpeg`, `image/gif`, `image/svg+xml`, `image/webp`)
- Per-org quota: `FM_EMAIL_ASSETS_ORG_QUOTA_BYTES` (default 50 MiB).
  It is enforced atomically in the DB, so concurrent uploads can't race past
  the cap.

Response:

```json
{
  "id": 42,
  "filename": "logo.png",
  "contentType": "image/png",
  "sizeBytes": 12483,
  "sha256": "...",
  "createdAt": "2026-04-23T10:00:00Z",
  "deduped": false
}
```

`deduped: true` means the same sha256 was already uploaded for this org;
the existing id is returned unchanged. Reuploads never duplicate bytes.

### Inline download

```http
GET /api/notifications/email-assets/<id>
```

Streams the raw bytes with `Content-Type: <stored mime>` and
`Content-Disposition: inline`. Use in template editors as
`<img src="/api/notifications/email-assets/42">` for browser preview.

### Reference from a template / endpoint

```json
{
  "attachments": [
    {"filename": "logo.png", "assetId": 42, "cid": "logo"}
  ]
}
```

Each attachment has **exactly one** of `url` or `assetId`. The SMTP
adapter fetches URL-based attachments over HTTPS at send time and
loads asset-based ones from the DB. Inline images: use `cid` +
`<img src="cid:logo">` in your HTML template.

### Metadata RPCs

- `Notification.EmailAsset.List({limit?, offset?})`: paginated metadata
  list (no bytes; use the GET endpoint for those).
- `Notification.EmailAsset.Get({id})`: single asset's metadata.
- `Notification.EmailAsset.Delete({id})`: remove from storage.
  Templates / endpoints still referencing the assetId will fail at send
  time; audit references before deleting.

### Caps exposed to the UI

The frontend pre-validates uploads and attachment lists against the
operator's live env via `Channel.ListProviders`. The
email_smtp descriptor carries an `emailCaps` field:

```json
{
  "key": "email_smtp",
  "emailCaps": {
    "maxAttachments": 10,
    "maxAttachmentBytes": 5242880,
    "allowHttpAttachments": false,
    "assetOrgQuotaBytes": 52428800,
    "assetAllowedContentTypes": [
      "image/png", "image/jpeg", "image/gif", "image/svg+xml", "image/webp"
    ]
  }
}
```

These values reflect the same ENV reads the backend uses for enforcement
(`FM_EMAIL_MAX_ATTACHMENTS`, `FM_EMAIL_ATTACHMENT_MAX_BYTES`,
`FM_EMAIL_ATTACHMENT_ALLOW_HTTP`, `FM_EMAIL_ASSETS_ORG_QUOTA_BYTES`,
`FM_EMAIL_ASSETS_CONTENT_TYPES`) so the UI rejects the same inputs the
backend would reject: no round-trip to discover limits.

## Phase plan

- **Phase A (done)**: provider presets, TLS hardening, timeouts,
  `Channel.Test` now calls `transporter.verify()`.
- **Phase B (done)**: 30+ preset catalog, cc/bcc/replyTo/priority,
  subjectTemplate, reusable template library.
- **Phase C (done: manual refresh-token entry)**: OAuth2 for Gmail +
  M365 via nodemailer's built-in XOAUTH2.
- **Phase D (done)**: in-app OAuth consent flow (redirect →
  code → token exchange) so operators don't need the Playground
  detour.
