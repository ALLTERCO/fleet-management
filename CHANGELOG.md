<!-- audience: public -->
# Changelog

Upgrade steps are in the release notes of each version.

## [1.92.0] 2026-10-08

### Added

- MCP: Add access levels, scoped keys, browser sign-in, approvals and audit
  for AI tools, and a Connect your AI page
- Node-RED: Add the Node-RED add-on (`up --nodered`) with Fleet Manager nodes,
  webhooks, backup and restore
- Billing: Add the bill page, utility quotes, stepped and block tariffs, taxes,
  gas units and export credit
- Reports: Add carbon totals, PDF files, streamed interval reports and
  multi-location reports
- Energy: Add consumption anomaly reads and an overnight baseline
- Energy: Add power-quality values and charts for every measured metric
- Alerts: Add one New alert menu, per-channel notification layouts and notify
  once
- Alerts: Show who resolved or silenced an alert
- Alerts: Add device key expiry warnings and a system alert banner
- Devices: Add a control panel for virtual components and battery module
  actions
- Devices: Add a device detail view with charts, debug and JSON tabs
- Devices: Add paced device key rotation and a list of expiring keys
- Devices: Add import of Shelly device backups and bulk firmware update checks
- Dashboards: Add new widgets and redesigned device, meter and group cards
- UI: Add app-wide search in the header, and language and region settings
- Access: Add roles limited to a location, and scoped tokens
- API: Add `User.GetMe`, and declared return types for more than 100 methods
- Metrics: Add database, Redis, HTTP, queue and capacity metrics on `/metrics`
- Installer: Add `upgrade --local`, `rollback --backup` and
  `rollback --image-only`
- Installer: Add `up --env dev` to run Fleet Manager from source
- Installer: Check `FM_SECRET_KDF_SALT` before every start and refuse when the
  saved and running values differ

### Changed

- MCP: `/mcp` no longer accepts browser sessions; use a scoped key or an OAuth
  token **BREAKING CHANGE**
- Database: `FM_DB_CONNECTIONS` replaces `FM_DB_POOL_MAX` and
  `FM_OUTBOX_CONCURRENCY` **BREAKING CHANGE**
- Energy: Keep raw energy readings 7 days (was 31); long-term history stays in
  the 15-minute rollup **BREAKING CHANGE**
- Installer: `upgrade` backs up, checks health and rolls back on failure
- Installer: New installs get random admin passwords
- Performance: Rework alerts, energy rollups and device snapshots for large
  fleets
- UI: Compress large live update messages to use less bandwidth
- UI: Use one chart library for all charts
- Bluetooth: Count devices as online through their gateway
- Access: Users with a limited role see only the devices and places in their
  scope
- Organizations: Default the time zone to UTC
- Devices: Use one wizard for all add-device flows
- Bundled versions: Zitadel v4.19.4, TimescaleDB 2.30.2, Traefik v3.7.13,
  Redis 7.4.11, Node-RED 5.0.7

### Fixed

- Energy: Fix missing water, gas and heat meters in energy reports
- Energy: Fix totals, rollups and live rows during a database outage
- Billing: Fix billing dates and partial coverage prices
- Waiting room: Fix approval, rejection and discovery
- Devices: Fix deleted devices coming back
- Bluetooth: Fix scan, pairing names and renames
- Notifications: Fix SMTP, Teams and test sends
- Alerts: Fix hold timers, quiet hours and repeat notifications
- Virtual components: Fix settings and sensor readings
- Users and locations: Fix user, service user and location edits
- Installer: Fix `upgrade` rolling itself back on the default HTTPS install
- Installer: Fix rollback after a failed upgrade with `FM_VERSION=latest`
- Installer: Fix a second `up` on a running install
- Installer: Fix `rollback` after `upgrade --migrate-first`
- Installer: Fix `migrate` losing Zitadel HTTPS settings

### Removed

- Energy: Remove environment data from the energy report and dashboard
- Installer: Remove the fixed default admin password

### Security

- Authentication: Users stopped in Zitadel can no longer use old credentials
- Audit: Audit log reads need manage rights or the auditor role
- Access: Scoped tokens and grants stay within their scope
- MCP: Redact secrets in AI results and logs
- Devices: Never store device keys in setup records
- Backups: Validate and size-cap backup imports
- Installer: Setup output no longer shows admin passwords
- Dependencies: Update `proxy-addr`, `js-yaml`, `fast-uri`, `undici`, `jspdf`
  and `maplibre-gl`

[1.92.0]: https://github.com/ALLTERCO/fleet-management/compare/v1.91.0...v1.92.0
