<!-- audience: public -->
# Energy & Reports: how it works (plain English)

This page explains, in simple words, how to read and export energy data in
Fleet Manager. It is written so that **anyone** (a developer, a support
agent, or an AI assistant) can understand which tool to use and why.

If you remember one thing: **there are two jobs: looking at data on a
screen and downloading data as a file. They use two different tools.**

---

## The tools

### 1. `Energy.Query`: "show it on screen, right now"

- **What it does**: sends the numbers straight back in the response. They land
  in a chart or a table instantly.
- **Where it's used**: the energy dashboard page
  (`frontend/src/pages/dash/energy/[id].vue`). It draws the charts.
- **Intended for**: live viewing (dashboards, charts, small tables).
- **Example**: "Show me today's power for 5 devices at 15-minute detail as a
  line chart." ~480 points, instant, drawn on screen.
- **Totals and cost**: it can also return grouped series (`groupBy`, with
  `totals` for one value per group) and server-side cost (`pricing`, from
  stored tariffs, up to 30 days). There is no separate "summary" method; the old `Energy.Summary`
  was removed.

### 2. `Report.Generate`: "make me a file"

- **What it does**: starts a background job. It returns a `jobId` at once.
  The server builds the file, then you fetch a download link with
  `Report.GetReport`. Related methods: `Report.Cancel`, `Report.Delete`.
- **Where it's used**: the Export / Download button. (Query draws the chart;
  Report.Generate produces the file.)
- **Kinds**: `energy` (the full energy report), `interval` (per-device
  readings of chosen metrics, CSV), `energy_dump` (legacy per-phase
  15-minute CSV, kept for old integrations), and `environment` (temperature,
  humidity, and similar sensors).
- **Formats**: `html`, `csv`, `xlsx`, `pdf`. The `energy` and `environment`
  kinds accept all four. `interval` and `energy_dump` are CSV only.
- **Example**: "Give me a CSV of last month's daily energy for 200 devices."
  A download link is ready when the job is ready.

### 3. `Energy.Current`: "power right now"

- **What it does**: returns live power (W) from in-memory device status. No
  database read.
- **Intended for**: "now" figures on live cards. Poll it every 1 to 3 seconds.

### Cheat-sheet

| Tool | Where it's used | Intended for | Example | Max |
|---|---|---|---|---|
| **Energy.Query** | dashboard charts | looking on screen | today's power, 5 devices, 15-min -> chart | 2M rows |
| **Report.Generate** | dashboard Export button | downloading a file | last month daily, 200 devices -> CSV | 365 days, 10,000 devices |
| **Energy.Current** | live cards | power right now | live watts for a group | live data only |

### The rule (memorize this)

- **Looking at it?** Use `Energy.Query` with a big bucket (day/week/month) so it
  fits the screen.
- **Downloading it?** Use `Report.Generate`. It runs as a job and streams to a
  file, so it has no row ceiling by default.
- **Power right now?** Use `Energy.Current`.
- **Huge and fine detail (a year x thousands of devices x 15-min)?** Use a
  report (`interval` kind), or chunk it into several reports (one per month or
  per group). It will not go in one `Energy.Query` call.

---

## A. Limits (all real, most configurable by ENV)

| Limit | Value | Env var | What it protects |
|---|---|---|---|
| Hard row ceiling (Query) | **2,000,000** | `FM_ENERGY_QUERY_ROW_LIMIT` | Node memory; "Result too large" above this |
| Row ceiling (Report) | **0 = unlimited** (default) | `FM_REPORT_MAX_ROWS` | a positive value adds a sanity cap on report rows |
| Max page size (`limit` param) | **50,000** | none | one response page; omit `limit` to get the full set up to the row ceiling |
| Max devices in a `devices` list (Query) | **500** | none | enforced by the request schema |
| Max devices per report | **10,000** | `FM_REPORT_MAX_DEVICES` | report size |
| Date range, Query (energy and environmental tags) | **365 days** | none | one year max |
| Date range, report | **365 days** | `FM_REPORT_MAX_RANGE_DAYS` | report size |
| Date range, Query `pricing` option | **30 days** | none | cost calculation |

**Key point:** for `Energy.Query` the real wall is **2 million rows**. Most
limits are tunable via ENV; the 500-device list, the 365-day Query range and
the 30-day pricing range are fixed in the API contract.

---

## B. Who can call what (permissions)

| Method | Permission | Notes |
|---|---|---|
| `Query` / `Current` | no role gate (`@NoPermissions`) | access is filtered **inside the handler**: you only ever see devices you are allowed to read; group/location scope needs scope-read; fleet view needs `dashboards:read` |
| `Report.Generate` | **`reports:update`** + rate-limited **`expensive`** | cannot spam big exports |
| `Report.GetReport` / `Cancel` / `Delete` | **`reports:update`**, owner-checked | you only see your own jobs |
| `Query` with `pricing` | also needs **`reports:read`** | |
| Classification (`Set` / `Delete` / `ApplyPreset`) | `devices:update` / `create` | |

**Intent:** permission is enforced by **which devices you can see**, not just a
role flag. Ask for 2000 devices but only have access to 5 -> you get 5, the
rest are silently dropped.

---

## C. How you target devices (scope model)

Two mutually-exclusive ways:

- **`devices: ["id1","id2"]`**: an explicit list, OR
- **`scope: { groupId | locationId | tagId }`**: a whole group, location or
  tag. Leave out both `scope` and `devices` for the entire fleet.

You cannot pass both at once. Whatever you target is always intersected with
your access rights.

---

## D. Shaping the output (the other params)

- **`bucket`**: the zoom level (see the bucket menu below).
- **`perDevice`** (default **true**): one row per device, or `false` =
  aggregated as "All Devices".
- **`perPhase`**: split by electrical phase (L1 / L2 / L3).
- **`pricing`** (Query): uses stored tariffs and their device/channel
  assignments to add cost. The `energy` report kind takes `tariff` and `currency`.
- **Units**: energy auto-converts **Wh -> kWh** (divide by 1000); values come
  back in display units, not raw.
- **`currency`** (`energy` report): ISO 4217 code (e.g. `EUR`, `USD`); falls back to
  the org default, then `EUR`.
- **`timezone`**: see the timezone rule below.

### Timezones (how a bill period maps to a day)

A utility bill covers a span of **calendar dates** in a specific place, and a
calendar day starts at a different instant in every zone. UTC midnight is not
Sofia midnight. So a bill period is only meaningful against a fixed timezone.

- **Standard:** IANA / Olson timezone **names**, for example `Europe/Sofia`,
  `America/New_York`, `UTC`. Not offsets like `+02:00` (those ignore DST). The
  backend validates the name by constructing an `Intl.DateTimeFormat`, so any
  zone the runtime knows is accepted.
- **Where the default is set:** **Settings -> General -> Organization ->
  Timezone**, or directly via `organization.SetProfile`
  (`patch.timezoneDefault`). Stored on `organization.profile.timezone_default`.
- **Per-report override:** pass `timezone` on the energy report to anchor that
  one run to a different zone.
- **Resolution order:** report `timezone` -> org `timezone_default` -> `UTC`.

### The bucket menu (zoom levels)

```text
1 minute, 5 minutes, 15 minutes, 30 minutes,
1 hour, 6 hours, 12 hours, 1 day, 1 week, 1 month
```

It is a **fixed list**, not free text. Ask for `18 minutes` and the request is
rejected. `15 minutes` and `30 minutes` are included because that is how real
electricity metering and billing work.

**Match the bucket to the range** so you do not drown in points:

- Looking at today -> small bucket (1–15 min).
- Looking at a month -> 1 hour or 1 day.
- Looking at a year -> 1 day, 1 week, or 1 month.

---

## E. Way of working (the pipeline, plain)

**`Energy.Query`:**

> validate -> figure out which devices you are allowed -> one DB query (capped
> at 2M) -> hold all rows in memory -> if too big, reject -> slice the page ->
> send JSON back.

**`Report.Generate`:**

> validate (range and device limits) -> create a job and return `jobId` ->
> a worker reads the data in bounded chunks and streams it to a file on disk ->
> bind the file to your user -> `Report.GetReport` returns `status: ready` and
> a download link -> an authenticated GET streams the file to you.

The difference: Query returns the data **inline in the response** (held in
memory, capped at 2M rows). Report **streams the output to a file** and memory
stays flat. Its limits are the range and device caps above.

---

## F. Export security

- The file lands in **`uploads/reports/`**.
- Ownership is stored as **filename -> your userId**, and expires after
  `FM_REPORT_OWNERSHIP_TTL_DAYS` (default **30 days**).
- **No token in the URL**: so the link cannot leak via browser history, access
  logs, or the Referer header.
- **Only the owner can download** (an ownership check runs first); the filename
  is regex-validated.
- After that time the binding expires and the file can no longer be fetched.

---

## G. Speed tricks running behind the scenes

- **15-minute rollup** (`device_em.energy_15min`): buckets of 15 minutes and
  longer read this rollup, so long ranges do not re-scan raw readings. Buckets
  of 1 minute and 5 minutes read raw readings. The old 5-minute, 24-hour and
  monthly continuous aggregates were dropped.
- **Caches:** device-id map (60s, `FM_ENERGY_IDMAP_CACHE_TTL_MS`).
- **DB-side `LIMIT`** so Postgres short-circuits instead of building a giant
  result set.

---

## H. The intent / design philosophy (the "why")

1. **Two endpoints on purpose**: viewing (small, inline, fast) vs exporting
   (big, streamed to a file). One endpoint cannot do both well.
2. **Fail loud, never silently truncate**: over the limit gives a clear error
   telling you to coarsen the bucket or shorten the range. You never get a
   quietly cut-off report.
3. **Caps protect the server**: both Node memory and Postgres are shielded; one
   user cannot take the system down with a giant query.
4. **Everything tunable via ENV**: single source of truth, no hardcoded limits.
5. **Permission by scope**: you see exactly your devices, enforced in the data
   layer.

---

## Worked example: "a year of 15-minute data for 2000 devices"

The math: 15-minute buckets = 96 per day. x 365 days = 35,040 per device.
x 2000 devices = **~70,000,000 rows** (per tag). That is 35x over the 2M limit.

What happens if you try it: **it is rejected, not crashed.** Postgres stops at
2M (the DB-side LIMIT), and the server replies:

> `Result too large (2000001 rows). Use a coarser bucket or shorter range.`

How to actually get it:

| Bucket | Rows (2000 devices x 1yr) | Verdict |
|---|---|---|
| 15 minutes | ~70,000,000 | rejected (35x over) |
| 1 hour | ~17,500,000 | rejected (8x over) |
| 1 day | ~730,000 | works (heavy) |
| 1 week | ~104,000 | comfortable |
| 1 month | ~24,000 | trivial |

If you genuinely need raw 15-minute detail for a full year of 2000 devices,
that is **not one call**: see "Big downloads" below.

---

## What we keep (data retention)

**Raw readings are kept for a short time. Long history is the 15-minute
rollup.**

- Raw energy readings (`device_em.stats`): the window comes from the deploy
  setting `EM_STATS_RETENTION`. The deploy script stores it through
  `device_em.fn_configure_stats_retention`
  (`backend/db/migration/postgresql/device/em/20053_em_rollup_retention_and_sync.sql`),
  which also clears the older 7-day job setting from migration 20031.
  `deploy/env/public.env` ships **7 days**; if the setting is empty, the
  script uses 1 year (`deploy/scripts/public/lib/state/retention.sh`). Raw is
  never dropped before it is rolled up.
- Long-term history is the 15-minute rollup `device_em.energy_15min`. It is
  kept for `EM_ROLLUP_RETENTION`; empty (the default) means forever.
- Because only the rollup is kept long term, 1-minute and 5-minute detail
  exists only for the raw window. Everything 15 minutes and coarser works for
  the whole history.

A "whole year at 15-minute detail" request for thousands of devices is still
tens of millions of rows. That is what the report jobs below are for.

---

## Big downloads: how to get "a year of 15-minute data"

The charts are already fine (they auto-shrink). For **downloading** a large
amount of data, use `Report.Generate`. It streams rows to a file instead of
holding them in memory, so it does not hit the 2-million-row wall of
`Energy.Query`.

### How it works (plain words)

1. **It is a background job.** You call `Report.Generate`; it replies
   immediately with a `jobId`.
2. **It streams to a file.** Rows are read in bounded chunks and written to a
   file on disk, so memory stays flat.
3. **CSV is gzipped** by default (`FM_REPORT_GZIP_CSV_ARTIFACTS`).
4. **You poll, then download.** Call `Report.GetReport({jobId})` until
   `status: "ready"`. The file is owner-bound; only you can fetch it.

### One endpoint: `Report.Generate`

There is a single front door for every report and export: **`Report.Generate`**.
It picks the report with `kind`:

- **`energy`**: the full utility-bill report (`format: html | csv | xlsx | pdf`).
- **`interval`**: per-device readings of chosen metrics at a chosen
  granularity, as CSV (add `per_phase: true` to keep phases separate).
- **`energy_dump`**: legacy per-phase 15-minute CSV, kept for old
  integrations. It routes to `interval` with `per_phase: true`.
- **`environment`**: the environmental report (`format: html | csv | xlsx | pdf`).

The only thing kept separate is **`Energy.Query`**. It feeds live on-screen
charts (inline data). Everything you *download* goes through `Report.Generate`.

### API flow (what an integrator does)

```text
1. RPC  Report.Generate({ kind: "interval", metrics, from, to,
                          granularity, scope|devices })
        -> { jobId, status: "pending" }            (returns immediately)

2. RPC  Report.GetReport({ jobId })                 (poll)
        -> { status: "pending" } ... then
        -> { status: "ready", downloadUrl: "/api/exports/download/<file>",
             artifacts: { ... } }

3. HTTP GET  <downloadUrl>   with Authorization: Bearer <token>
        -> streamed file  (owner-checked, no token in the URL)
```

Instead of `from` and `to` you can pass a `period` (`last_7_days`,
`last_month`, `mtd`, `last_year`, `ytd`, `billing_period`).

This is the Stripe / BigQuery / Snowflake pattern: async job -> file -> download
link.

**Status:** built. `Report.Generate`, `Report.GetReport`, `Report.Cancel` and
`Report.Delete`, plus the authenticated download route. A `Report.Ready`
WebSocket event fires on completion so clients can skip polling. `GetReport`
also returns `htmlUrl` and an `artifacts` object (CSV, HTML summary, XLSX, PDF
where the kind supports them). Job records and files expire after
`FM_REPORT_OWNERSHIP_TTL_DAYS`.
