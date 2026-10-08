<!-- audience: public -->
# Microsoft Teams setup for Notifications

Fleet Manager delivers alerts to Microsoft Teams via a **Power Automate
workflow** webhook (the successor to the deprecated Office 365
Connector). Each channel targets one Teams channel.

## 1. Create a Power Automate workflow

1. In Teams, right-click the target channel → **Workflows** → **Create
   a new workflow from blank template** (or pick "Post to a channel
   when a webhook request is received" from the gallery).
2. Choose **When a Teams webhook request is received** as the trigger.
   Power Automate generates an HTTPS endpoint URL ending in
   `webhook.office.com` or `logic.azure.com`.
3. Add the action **Post adaptive card in a chat or channel**:
   - `Post as`: *Flow bot* or *User*
   - `Post in`: *Channel*
   - `Team` / `Channel`: your targets
   - `Adaptive Card`: `@triggerBody()` (passes our card JSON through)
4. Save the flow. Copy the **HTTP POST URL** from the trigger step.
   This is the webhook URL Fleet needs (secret).

Alternative: any Azure Logic App with an HTTP trigger that calls the
`Post adaptive card` Teams connector works the same way.

## 2. Configure the channel

Minimal config:

```json
{
  "url": "https://prod-00.westeurope.logic.azure.com:443/workflows/.../triggers/manual/..."
}
```

Full config with optional fields:

```json
{
  "url": "https://prod-00.../manual/...",
  "headingTemplate": "[{{rule.name}}] {{alert.title}}",
  "footerTemplate": "Fleet Manager · {{alert.source.id}}",
  "additionalFacts": [
    {"title": "Severity", "value": "{{alert.severity}}"},
    {"title": "Fingerprint", "value": "{{alert.source.id}}"}
  ],
  "mentions": [
    {"id": "00000000-0000-0000-0000-000000000000", "name": "Oncall"}
  ],
  "cardTemplate": "{\"body\":[{\"type\":\"TextBlock\",\"text\":\"{{alert.title}}\"}]}"
}
```

All fields other than `url` are optional:

- **`headingTemplate`**: one-line override for the card title. Tokens supported.
- **`footerTemplate`**: small subtle text appended below the message body.
- **`additionalFacts[]`**: extra rows appended to the built-in FactSet
  (Rule / Source / Fired at). Values are token-rendered.
- **`mentions[]`**: users Teams will `@mention` (by default only on
  `critical`, configurable via `FM_TEAMS_MENTION_SEVERITIES`). `id` is
  the AAD object id or UPN; `name` is the display string.
- **`cardTemplate`**: full Adaptive Card JSON override. If the object
  contains `body` / `actions` / `msteams` it **merges over** the default
  card (keeps Fleet chrome). A full envelope with `attachments[]` is
  used as-is.

## 3. Default card anatomy

Fleet's built-in card (when no `cardTemplate` supplied):

- **Header container**: severity emoji + `SEVERITY` label + state badge
  (✅ acknowledged / ✔️ resolved when applicable). Critical alerts use
  `style: "attention"` (red border).
- **Title**: large bold text.
- **Message**: wrapping TextBlock.
- **FactSet**: Rule, Source, Fired at, plus any `additionalFacts`.
- **@mentions**: when configured and severity matches.
- **Footer**: subtle small text (if `footerTemplate` set).
- **Action.OpenUrl "Open alert"**: when `FM_ALERT_LINK_BASE` is set
  globally; points to `<base>/<alertId>`.

## 4. Test the channel

Hit **Channel.Test**. Fleet posts a small **connection-test card**
(not a fake alert) so you can see the webhook reach the channel without
a recorded delivery. If the POST fails (404, 401, malformed workflow),
the test surfaces the HTTP status + response snippet.

## 5. Operational tuning

Environment (operator-set, instance-wide):

| Var | Default | Purpose |
|---|---|---|
| `FM_TEAMS_CARD_VERSION` | `1.5` | Adaptive Card schema version |
| `FM_TEAMS_MAX_CARD_BYTES` | `25000` | Pre-send size cap (Teams drops >28KB) |
| `FM_TEAMS_DEFAULT_TEMPLATE` | *(empty)* | Instance-wide card JSON override |
| `FM_TEAMS_WEBHOOK_ALLOWED_HOSTS` | *(empty)* | CSV of host suffixes for SSRF hardening |
| `FM_TEAMS_MENTION_SEVERITIES` | `critical` | CSV of severities where mentions fire |
| `FM_ALERT_LINK_BASE` | *(empty)* | Base URL for the "Open alert" action |

For production we recommend:

```bash
FM_TEAMS_WEBHOOK_ALLOWED_HOSTS=.webhook.office.com,.logic.azure.com
FM_ALERT_LINK_BASE=https://fleet.example.com/alerts
```

## 6. Throttling

Power Automate workflows rate-limit at ~4 requests/second per flow. If
Fleet hits HTTP 429 with a `Retry-After` header, the outbox reschedules
the delivery honoring that interval instead of graphile-worker's
default exponential backoff. Sustained throttling is logged per-job
with the retry-after seconds; if you see this regularly, distribute
load across multiple workflow endpoints.

## 7. Traceability

On success Fleet captures the `x-ms-workflow-run-url` response header
as `delivery_attempts.provider_code`. Paste that URL into Azure Portal
to drill into the exact workflow run, inspect card JSON, and see why
Teams accepted (or silently dropped) the card.

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Card delivers blank | AdaptiveCard schema parse failed on Teams side | Check `cardTemplate` JSON; use the **Adaptive Card Designer** to validate |
| 401/403 | Webhook URL rotated or flow deleted | Re-copy URL from the Power Automate trigger |
| 404 | Flow turned off | Turn flow on in Power Automate |
| "card exceeds FM_TEAMS_MAX_CARD_BYTES" | Template renders > cap | Shorten `additionalFacts`, split long messages |
| "host not in FM_TEAMS_WEBHOOK_ALLOWED_HOSTS" | URL host outside allowlist | Add the suffix to the env var, or verify the URL is Microsoft-issued |
| @mention doesn't page user | `mention.text` vs `<at>name</at>` mismatch | `name` field in `mentions[]` must match the display text used in your `cardTemplate` body (Fleet default does this automatically) |
