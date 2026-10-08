<!-- audience: public -->
# Dev Mode Authentication

Local username/password auth for development. **One signal: `FM_DEV_MODE`.**

## Overview

| Mode             | Trigger                                   | Auth        |
| ---------------- | ----------------------------------------- | ----------- |
| **Dev**          | `FM_DEV_MODE=true` in env file            | admin/admin |
| **Production**   | `FM_DEV_MODE` unset or false              | Zitadel SSO |

The flag cascades:

1. `./deploy/deploy-public.sh up --env dev` sets `FM_DEV_MODE=true`. In the full
   source tree, `deploy/env/dev.env` sets it (the only env file with it true).
2. Docker compose passes it to the FM container.
3. Backend reads it → `DEV_MODE` constant ([config/index.ts](../../../backend/src/config/index.ts)) → skips Zitadel.
4. Entrypoint mirrors it into `runtime-config.js` → `window.__FM_RUNTIME_CONFIG__.devMode`.
5. Frontend `authStore.devMode` reads the same value → shows DEV badge + local form.
6. Deploy script reads it → skips Zitadel containers when true.

## How to enable

### Local Docker deploy

```bash
./deploy/deploy-public.sh up --env dev
```

Starts the database and Redis in Docker, then runs the backend and frontend
from source (Node.js 24). Local authentication is on (`FM_DEV_MODE=true`) and
Zitadel is not started.

It also generates the at-rest encryption key and salt
(`FM_SECRET_ENCRYPTION_KEY`, `FM_SECRET_KDF_SALT`) once and keeps them in
`deploy/state/.env`. Dev mode refuses to boot without them, because every
stored credential (channel secrets, device passwords) is encrypted with them.
If you start the backend by hand instead, set both in its environment.

### Configuration source

The public release ships no `dev.env`; `--env dev` sets the dev values itself.
Dev startup removes the obsolete root `.fleet-managerrc` so stale local values
cannot override the environment.

## Default Credentials

When the database is seeded, a default admin account is created:

| Field       | Value              |
| ----------- | ------------------ |
| Username    | `admin`            |
| Password    | `admin`            |
| Group       | `admin`            |
| Permissions | `*` (full access)  |

**Warning**: Change these credentials in any non-development environment.

## API Authentication

### Obtaining a Token

**Endpoint**: `POST /rpc`

**Request**:

```json
{
  "jsonrpc": "2.0",
  "method": "User.Authenticate",
  "params": {
    "username": "admin",
    "password": "admin"
  },
  "id": 1
}
```

**Response**:

```json
{
  "access_token": "<access_token>",
  "refresh_token": "<refresh_token>"
}
```

### Using the Token

Include the access token in the `Authorization` header:

```text
Authorization: Bearer <access_token>
```

**Example**:

```bash
curl -X POST http://localhost:7011/rpc \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{"jsonrpc":"2.0","method":"Device.List","params":{},"id":1}'
```

### Refreshing a Token

**Request**:

```json
{
  "jsonrpc": "2.0",
  "method": "User.Refresh",
  "params": {
    "refresh_token": "<refresh_token>"
  },
  "id": 1
}
```

**Response**:

```json
{
  "access_token": "<access_token>",
  "refresh_token": "<refresh_token>"
}
```

### Token Expiration

| Token Type    | Expiration |
| ------------- | ---------- |
| Access Token  | 24 hours   |
| Refresh Token | 1 year     |

## Frontend Behavior

The login page automatically detects dev mode and adjusts the UI:

- **Dev mode enabled**: Shows username/password form with "DEV MODE" badge. If Zitadel is also configured, shows both login options.
- **Dev mode disabled**: Shows only "Sign In with SSO" button.

## User Management

Dev mode reads its login credentials directly from the local `user` table.
The admin RPCs that used to maintain that table (`User.Create / Update /
Delete / List / Find`) were removed once Zitadel became the production
auth source: there is no in-app UI for editing dev users any more.
To add or change a dev account, insert / update rows in `user.users`
via SQL or the seed migration. Production user management goes through
the Zitadel surface (`User.ListZitadelUsers`, `User.CreateZitadelUser`,
etc.).

### Dev-user fields (in `user.users` table)

| Field         | Description                                                   |
| ------------- | ------------------------------------------------------------- |
| `name`        | Username for login                                            |
| `password`    | Plain text password (hashed in production Zitadel)            |
| `email`       | User email address                                            |
| `full_name`   | Display name                                                  |
| `group`       | Permission group: `admin`, `installer`, `viewer`, or custom   |
| `permissions` | Array of permission strings, `["*"]` for full access          |
| `enabled`     | Boolean to enable/disable the account                         |

### Permission Groups

| Group       | Description                          |
| ----------- | ------------------------------------ |
| `admin`     | Full access to all features          |
| `installer` | Can manage devices and waiting room  |
| `viewer`    | Read-only access                     |

## Security Considerations

1. **Never use dev mode in production** - Local authentication lacks the security features of Zitadel (MFA, audit logs, password policies).

2. **Change default credentials** - The `admin/admin` account should be changed or disabled.

3. **Use strong JWT secrets** - The `jwt_token` should be a long, random string in any shared environment.

4. **Network isolation** - Dev mode instances should not be exposed to public networks.

## Troubleshooting

### "Local authentication is disabled" error

`FM_DEV_MODE` is not true. Start the development instance with
`./deploy/deploy-public.sh up --env dev`.

### Empty device list with valid token

Verify the user has appropriate permissions. Admin users (`group: "admin"` or `permissions: ["*"]`) have access to all devices.

### Token not recognized

1. Ensure the token is copied without line breaks or extra spaces
2. Verify the `jwt_token` in config matches what was used when the token was issued
3. Check token expiration

### Login form not showing

1. Clear browser cache and localStorage.
2. Verify `runtime-config.js` is served and contains `devMode: true`:
   `curl https://localhost/runtime-config.js | grep devMode`
3. Check browser console for errors.
