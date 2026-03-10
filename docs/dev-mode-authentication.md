# Dev Mode Authentication

This document describes the development mode authentication system for Fleet Manager.

## Overview

Fleet Manager supports two authentication modes:

| Mode                               | Local Auth | Zitadel SSO |
| ---------------------------------- | ---------- | ----------- |
| **Production** (`dev-mode: false`) | Disabled   | Required    |
| **Development** (`dev-mode: true`) | Enabled    | Optional    |

In production, all authentication is handled through Zitadel OIDC. In development mode, local username/password authentication is available, with optional Zitadel support if configured.

## Configuration

### Enabling Dev Mode

Set `dev-mode: true` in your `.fleet-managerrc` configuration file:

```json
{
  "dev-mode": true,
  "components": {
    "web": {
      "port": 7011,
      "jwt_token": "your-secret-token-change-in-production"
    }
  },
  "internalStorage": {
    "connection": {
      "host": "localhost",
      "port": 5432,
      "user": "fleet",
      "password": "fleet",
      "database": "fleet"
    }
  }
}
```

### JWT Token Configuration

The `jwt_token` in `components.web` is used to sign local authentication tokens. In production, this should be a strong, randomly generated secret. In development, any string can be used.

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
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
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
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
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

In dev mode, users can be managed through the Settings > Accounts page (`/settings/accounts`).

### User Properties

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

Dev mode is not enabled. Check that `dev-mode: true` is set in `.fleet-managerrc`.

### Empty device list with valid token

Verify the user has appropriate permissions. Admin users (`group: "admin"` or `permissions: ["*"]`) have access to all devices.

### Token not recognized

1. Ensure the token is copied without line breaks or extra spaces
2. Verify the `jwt_token` in config matches what was used when the token was issued
3. Check token expiration

### Login form not showing

1. Clear browser cache and localStorage
2. Verify `/api/variables` endpoint returns `"dev-mode": true`
3. Check browser console for errors
