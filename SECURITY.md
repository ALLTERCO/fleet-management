# Security Policy

## Reporting a vulnerability

Report suspected vulnerabilities privately to security@shelly.com.

Do not open a public issue, discussion, or pull request with vulnerability
details, credentials, personal data, or a working exploit.

Please include:

- The Fleet Manager version or image digest you tested.
- How you installed it (for example `deploy-public.sh up`) and the relevant
  settings, with secrets removed.
- Clear steps to reproduce it and the security impact you expect.
- Logs or evidence with tokens, passwords, device IDs, and personal data
  removed.

Follow Shelly's published vulnerability disclosure process:
https://www.shelly.com/pages/security-information-and-vulnerability-reporting

## Supported versions

Security fixes target the latest public release. Older releases do not get
separate fixes. Reports against an older release are still welcome when the
latest release is also affected.

## Scope

This repository contains the Fleet Manager community edition:

- The backend and the web app.
- The HTTP, RPC, MCP, browser WebSocket, and device connection interfaces.
- The installer (`deploy/deploy-public.sh`) and its Docker setup, including
  PostgreSQL, Redis, Zitadel, Traefik, and the optional Node-RED add-on.
- Backup, migration, upgrade, rollback, and secret handling in the installer.
- The example plugins.

## What to report

Report findings that show realistic unauthorized access, privilege escalation,
remote code execution, exposure of secrets or personal data, lasting data
corruption, a bypass of a security control, or a way to tamper with installs
or upgrades.

A scanner warning on its own is not a vulnerability. Please show how it can be
reached and what the real impact is.

## Usually out of scope

- Performance, availability, or user interface problems with no security
  impact.
- Dependency advisories that cannot be reached in Fleet Manager.
- Development-only defaults that do not apply to a normal install.
- Issues that need the same or higher access than the one you would gain.
- Behavior that only exists in older releases.

Never include working production credentials or unneeded personal data in a
report.
