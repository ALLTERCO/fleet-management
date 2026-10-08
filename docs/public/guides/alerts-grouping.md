<!-- audience: public -->
# Alert Grouping: Operator Guide

Fleet Manager uses Alertmanager-style grouping so a single mass event
(e.g., 7000 devices going offline at once) turns into **one notification
per endpoint**, not 7000.

## The four knobs

```text
FM_ALERT_GROUP_WAIT_SEC=60            # default: wait for siblings before first notify
FM_ALERT_IMMEDIATE_SEVERITIES=critical # these severities skip the wait and send at once
FM_ALERT_GROUP_INTERVAL_SEC=300       # 5 min between subsequent notifications for same group
FM_ALERT_REPEAT_INTERVAL_SEC=14400    # 4h renotify for unresolved groups
FM_ALERT_GROUP_BY=organization_id,rule_id,severity
```

Copied verbatim from [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/configuration/)

+ [Grafana Alerting](https://grafana.com/docs/grafana/latest/alerting/fundamentals/notifications/group-alert-notifications/).
Battle-tested at PagerDuty/Datadog scale.

Constraints enforced at boot (loud error if violated):

```text
FM_ALERT_REPEAT_INTERVAL_SEC % FM_ALERT_GROUP_INTERVAL_SEC == 0
FM_ALERT_GROUP_WAIT_SEC <= FM_ALERT_GROUP_INTERVAL_SEC
```

## How it works

```text
Alert fires
  ↓
Match or create open group keyed by (organization_id, rule_id, severity)
  ↓
Accumulate siblings for GROUP_WAIT_SEC
  ↓
Flush → 1 notification per endpoint listing N alerts
  ↓
While group still has active members:
  └─ Next batch in GROUP_INTERVAL_SEC
  └─ Renotify at REPEAT_INTERVAL_SEC anchor
```

Three render modes, chosen automatically:

| Group size | Adapter renders |
|---|---|
| 1 alert | Single-alert card (existing format, zero regression) |
| 2..`FM_ALERT_STORM_SUMMARY_THRESHOLD` | List of alerts in one card |
| > threshold | Summary line: "42 alerts: 5 critical, 37 warning. Open in Fleet Manager." |

Default storm threshold: **25**. Tune via `FM_ALERT_STORM_SUMMARY_THRESHOLD`.

## Storm cap

```text
FM_ALERT_GROUP_MAX_MEMBERS=1000
```

When a group hits this many members, flush immediately instead of
waiting for `GROUP_WAIT_SEC`. PagerDuty's proven at-scale limit.
Rendering beyond this point stops being useful anyway.

## Per-rule override

Expose `groupBy` on any rule to override the instance-wide default:

```json
{
  "name": "Critical site alerts",
  "kind": "device_offline",
  "severity": "critical",
  "groupBy": ["organization_id", "rule_id", "kind"]
}
```

null / unset = use `FM_ALERT_GROUP_BY`. Allowed label names:
`organization_id`, `rule_id`, `severity`, `kind`, `subject_type`.

## Per-rule `deliveryMode`

Set on the rule itself. Controls the in-app inbox path only.

```json
{
  "name": "Low-priority info digest",
  "kind": "device_offline",
  "severity": "info",
  "deliveryMode": "digest",
  "digestWindowMinutes": 30
}
```

| Value | Behaviour | Use it for |
|---|---|---|
| `instant` (default) | Inbox fires immediately for each user, honouring their per-user pref | Critical + warning alerts |
| `digest` | All recipients pile into the per-user digest queue, **overriding per-user preference**, flushed per window | Low-priority info that would be noise if instant |

Mirrors Alertmanager `group_wait`/`group_interval` at the rule level + Datadog monitor renotify interval. `digestWindowMinutes` null = platform default. External channels (email/Slack/Teams/Telegram/webhook) still flow through the normal group-flush path. `deliveryMode` does **not** delay them.

## How `deliveryMode` and `groupBy` compose

They're orthogonal. Read together:

+ **`groupBy`** = how 500 alerts collapse into 1 notification (fan-out collapse).
+ **`deliveryMode`** = whether the inbox shows alerts immediately or in a per-user digest (rule-level override of user pref).

Common shapes:

| Rule mode | groupBy | What the user sees |
|---|---|---|
| `instant` + default `groupBy` | `org, rule` | 1 inbox row "500 devices offline" within group window |
| `digest` + default `groupBy` | `org, rule` | 1 digest row per `digestWindowMinutes` (e.g. every 30 min) batching whatever fired |
| `instant` + per-subject `groupBy` | `org, rule, subject_id` | 1 inbox row per device. **Storm risk**: only for very low-volume rules |
| `digest` + per-severity `groupBy` | `org, rule, severity` | Critical/warning/info digests batched separately |

## Stacking with existing dedup

Fleet's fingerprint-based `alert_instance` dedup (Opsgenie-style) is
**not replaced** by grouping: it's the layer below:

+ **Fingerprint dedup** (per-rule `cooldownSec` / `dedupeWindowSec`): stops
  a single flapping device from creating 100 alert rows.
+ **Grouping** (this doc): stops 100 distinct alerts from creating 100
  notifications.

Both run. A flapping device at scale would: coalesce in fingerprint
dedup (1 alert row) *and* batch with other alerts at group flush (1
notification).

## What goes through grouping

+ Alert *fires* (`Alert.Created`)
+ Alert state transitions (`Alert.Triggered` re-fires, `Alert.Acknowledged`,
  `Alert.Resolved`)
+ Motion auto-clear (`motion_clear` task)

Everything that used to call `createDeliveryJobs` now lands in a group
and flushes via `delivery_group_flush`.

## DB shape

Two new tables under `notifications` schema:

+ `delivery_group(id, organization_id, rule_id, group_key_hash, group_key JSONB, first_alert_at, last_alert_at, last_notified_at, resolved_at, state, member_count)`
  + `state ∈ {open, flushed, resolved}`
  + `open`: not yet notified, accumulating for `group_wait`
  + `flushed`: notified at least once, **still accumulating** for `group_interval`
  + `resolved`: all members resolved, closed
  + Unique constraint: one unresolved group (`state IN ('open','flushed')`) per `group_key_hash`
  + Follow-on alerts landing in a `flushed` group stay in that group; they
    don't create a duplicate. Alertmanager's actual semantics.
+ `delivery_group_member(group_id, alert_id, endpoint_id, added_at)`: one row per (alert × endpoint) pairing

An alert firing and then changing state multiple times during a
`group_wait` creates multiple `delivery_jobs` rows (one per state
transition). At flush time, `fn_delivery_job_for_group` picks the
**latest queued job per alert** and marks the older ones
`state='superseded'` so the endpoint gets one notification instead of
N duplicates, and the audit trail records which jobs were collapsed.

Five DB functions (in `notifications.`):

+ `fn_delivery_group_upsert_and_add_members`: atomic find-or-create +
  member insert
+ `fn_delivery_group_flush_load`: load alert ids per endpoint
+ `fn_delivery_group_mark_notified`: record flush, return active-members flag
+ `fn_delivery_group_resolve_if_all_resolved`: close group when all
  alerts are resolved
+ `fn_delivery_group_repeat_due`: repeat_interval sweep

## Graphile-worker tasks

+ `delivery_group_flush`: per-group, scheduled at `group_wait` after
  the first alert lands. `jobKey=group_flush:{group_id}` so repeated
  adds to the same group share one run.
+ `delivery_group_repeat_sweep`: cron every `GROUP_INTERVAL_SEC`;
  finds unresolved flushed groups past `REPEAT_INTERVAL_SEC` age and
  enqueues another flush.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Notifications delayed by ~60s | Working as designed: that's `group_wait` batching. Critical alerts skip the wait on the first notice by default (`FM_ALERT_IMMEDIATE_SEVERITIES=critical`), so a delay on a critical alert means something else. Repeats still follow the group interval | Lower `FM_ALERT_GROUP_WAIT_SEC`, or add severities to `FM_ALERT_IMMEDIATE_SEVERITIES` (but see delivery-physics note below) |
| All alerts arriving as summary cards | Group size > `FM_ALERT_STORM_SUMMARY_THRESHOLD` | Raise threshold, or split the group via per-rule `groupBy` |
| Resolved alert never sent | Group closed before final flush | Check `delivery_group.state='resolved'` row exists; flush should have been scheduled immediately |
| Renotify spamming every group_interval | `REPEAT_INTERVAL_SEC` not a multiple of `GROUP_INTERVAL_SEC` | Backend refuses to boot with this misconfig; check logs for the error |
| 7000 separate notifications anyway | Grouping disabled or fn_delivery_group_upsert_and_add_members failing | Check AlertEngine logs for "alert-group dispatch ... failed" |

## Delivery-physics note

Lowering `group_wait` below ~30s buys you nothing in practice:

+ Telegram bot API: 30 msg/sec cap → 7000 sends take 4+ minutes
+ SMTP relays: 10-100 msg/sec → 1-12 minutes
+ Teams Power Automate: ~4 rps per workflow → 30+ minutes

So a 60s group_wait gives real coalescing headroom *well inside* what
the transport could ship even if we tried to fan out 7000 messages
individually. That's why Alertmanager ships 30s and PagerDuty 300s.
The default isn't arbitrary.

## Out of scope (future follow-ups)

+ **Mass-event collapse at evaluation layer**: reduce `alert_instance`
  row count by inserting one aggregate row when a rule matches > N% of
  fleet in one tick. Separate from delivery grouping (which is what
  this doc covers).
+ **Per-endpoint `digestWindowSec`**: currently global/per-rule only.
+ **Intelligent grouping** (PagerDuty-style ML): out of scope.
+ **Prometheus counters**: groups_opened/flushed/size histogram;
  hook-up exists but metrics not wired yet.
+ **`Admin.ListOpenAlertGroups` RPC**: DB fn exists
  (`fn_delivery_group_list_open`) but not exposed on a public component
  yet; ops can query it directly for now.
