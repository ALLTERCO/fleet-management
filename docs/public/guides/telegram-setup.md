<!-- audience: public -->
# Telegram Bot setup for Notifications

Fleet Manager delivers alerts to Telegram via a bot you create in
@BotFather. Each channel targets one chat: private DM,
group, or channel.

## 1. Create a bot

1. Open Telegram, start a chat with [@BotFather](https://t.me/BotFather).
2. Send `/newbot`. Pick a display name and a username (must end in `bot`).
3. BotFather replies with a token of the form `123456789:ABC-DEF...`.
   Copy it: this is the **`botToken`** (secret).
4. Optional: `/setprivacy` → `Disable` if you want the bot to read every
   message in groups (rarely needed for alert delivery).

## 2. Get the chat id

Fleet sends alerts to a specific `chat_id`, which depends on target:

### Private DM to a user

1. The user opens a chat with your bot and sends any message.
2. You (the operator) hit:
   `https://api.telegram.org/bot<token>/getUpdates`
3. Find `"chat":{"id": 123456789, ...}`. That positive integer is the
   user's DM chat id.

Shortcut: forward a message from the user to
[@userinfobot](https://t.me/userinfobot): it replies with the id.

### Group chat

1. Add the bot to the group as a member.
2. Post any message in the group.
3. Hit `getUpdates`. The group id is **negative** (e.g., `-123456789`
   for legacy groups, `-1001234567890` for supergroups).

### Public channel

Use `@channelname` (the public handle, starts with `@`). The bot must
be an **administrator** in the channel with at least post-message
permission.

### Private channel

Use the numeric id (starts with `-100`). The bot must be an
administrator.

## 3. Configure the channel

Minimal config:

```json
{
  "botToken": "123456789:ABC-DEF-your-token",
  "chatId": "-1001234567890"
}
```

Full config with optional fields:

```json
{
  "botToken": "123456789:ABC-DEF-your-token",
  "chatId": "@acme-alerts",
  "parseMode": "MarkdownV2",
  "messageTemplate": "*{{alert.title}}*\n{{alert.message}}\n_{{alert.severity}}_"
}
```

`botToken` is a secret: stored encrypted and redacted on reads. The
others are plain config.

## 4. Test

Hit **Channel.Test** on the channel. Fleet first calls Telegram's
`/getMe` to validate the bot token, then posts a real test message to
the chat. Any bad-token / bad-chatId / bot-not-in-group error comes back
as the test result; no alert delivery pipeline is involved.

## Default message format

Fleet's default template is plain text, safe under any parseMode:

```text
🔴 CRITICAL: Device offline · ✅ acknowledged

shelly-42 has not checked in for 5 minutes
```

- **Severity badge** (`🔴 CRITICAL` / `🟡 WARNING` / `🔵 INFO`) makes the
  priority visible at a glance.
- **State suffix** (`· ✅ acknowledged` / `· ✔️ resolved`) appears when
  the alert isn't in the `active` state.
- **Blank line** separates the header from the alert body.

Override the whole thing with `messageTemplate` if you want a different
shape or tone.

## Open alert button

If `FM_ALERT_LINK_BASE` is set, every message gets an inline keyboard
with a single "Open alert" button linking to the alert in the Fleet UI:

```text
[ Open alert ]
```

Same env as email's CTA button: single source across adapters. Omitted
when `FM_ALERT_LINK_BASE` is empty.

## State-change updates (edit in place)

When an alert transitions to `acknowledged` or `resolved` and a previous
successful delivery exists, the adapter calls `editMessageText` to
update the original message in place instead of sending a fresh one.
The chat reads as a single evolving message per alert rather than a
noisy thread of "fired / resolved / fired again" copies.

If the edit fails (message deleted client-side, chat migrated, etc.)
the adapter falls back to `sendMessage`. No operator action needed.

## Message formatting

Three modes:

- **Plain text (default)**: `parseMode` is unset. Any input is safe;
  no escaping needed. Recommended unless you specifically need bold /
  italic / links.
- **MarkdownV2**: `parseMode: "MarkdownV2"`. Supports `*bold*`,
  `_italic_`, inline code, `[link](url)`, etc. Fleet **auto-escapes**
  MarkdownV2 reserved chars (`_*[]()~>#+-=|{}.!\` plus backtick) in
  every `{{alert.*}}` / `{{rule.*}}` interpolation, so alert titles
  containing any of those won't break entity parsing. Static markdown
  in the template itself passes through as-is.
- **HTML**: `parseMode: "HTML"`. Supports `<b>`, `<i>`, `<code>`,
  `<a href="...">`, etc. Fleet auto-escapes `<`, `>`, `&` in every
  `{{alert.*}}` / `{{rule.*}}` interpolation.

When `messageTemplate` is unset, Fleet uses the default format above
(severity badge + state suffix + body) and omits `parse_mode`.

## Rendering and limits

- Message text is rendered through the same template engine the rest
  of the delivery pipeline uses (`{{alert.*}}` / `{{rule.*}}` tokens).
- Output is capped at Telegram's 4096-character `sendMessage` limit. If
  your template renders longer, the trailing content is replaced with
  `…`.
- Long alerts with very long device names or source details may hit the
  cap: consider a tighter template that trims/summarizes.

## Troubleshooting

### `Error: Unauthorized`

The bot token is wrong or was revoked. In @BotFather, `/mybots` →
select → `API Token` → regenerate and paste the new one into the
endpoint config. Old token stops working immediately.

### `Error: Bad Request: chat not found`

- User DM: the user hasn't started a chat with the bot yet. Telegram
  only allows bots to message users who initiated the conversation.
- Group: the bot isn't a member. Add it.
- Channel: the bot isn't an administrator, or the handle is wrong.

### `Error: Forbidden: bot was blocked by the user`

The target user blocked the bot. Endpoint is effectively dead for that
recipient: the block is user-side, the operator can't undo it.
Delivery attempts fail until unblocked.

### `Error: Too Many Requests: retry after N`

Telegram rate limits:

- 30 messages/second per bot total
- 1 message/second per chat

`Channel.Test` never triggers this. It's a single call.
But high-throughput fleets with one bot delivering to many chats might.
Split into multiple bots (one per high-volume destination group) or
live with the outbox retries.

### `Error: Bad Request: message is too long`

Telegram hard-caps `sendMessage` at 4096 characters. Fleet truncates
with `…` automatically, so this error shouldn't appear: but can if
you nest `sendMediaGroup` calls (not supported by this adapter) or
mix parse_mode with long interpolated content that fails validation.
