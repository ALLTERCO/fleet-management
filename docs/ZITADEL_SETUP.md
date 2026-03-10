# Zitadel Authentication Setup

Fleet Manager uses Zitadel for authentication. This document explains how to set up Zitadel and Fleet Manager for both local development and containerized deployment.

---

## Table of Contents

1. [Deployment Options](#deployment-options)
2. [Quick Start - Local Development](#quick-start---local-development)
3. [Quick Start - Full Containerized](#quick-start---full-containerized)
4. [Zitadel Configuration](#zitadel-configuration)
   - [Step 1: Log In](#step-1-log-in-to-zitadel-console)
   - [Step 2: Create Project](#step-2-create-a-project)
   - [Step 3: Create Roles](#step-3-create-project-roles)
   - [Step 4: Create Backend App](#step-4-create-backend-application-api)
   - [Step 5: Create Frontend App](#step-5-create-frontend-application-spa)
   - [Step 6: Create Action Script](#step-6-create-the-zitadel-action)
   - [Step 7: Create User](#step-7-create-your-first-user)
   - [Step 8: Assign Role](#step-8-assign-role-to-user)
5. [Fleet Manager Configuration](#fleet-manager-configuration)
6. [User Permissions](#user-permissions)
   - [Role-Based Permissions](#role-based-permissions)
   - [Custom Permission Config](#custom-permission-config-advanced)
7. [User Migration](#user-migration)
8. [Service Accounts](#service-accounts)
9. [Troubleshooting](#troubleshooting)
10. [Production Deployment](#production-deployment)

---

## Deployment Options

Fleet Manager supports two deployment modes:

| Mode | Description | Best For |
| --- | --- | --- |
| **Local Development** | Zitadel runs in Docker, Fleet Manager runs locally (npm) | Development, debugging |
| **Full Containerized** | Everything runs in Docker | Production, staging, demo |

---

## Quick Start - Local Development

Run Zitadel in Docker while developing Fleet Manager locally.

```bash
# 1. Copy configuration templates
cp .env.example .env
cp .fleet-managerrc.example .fleet-managerrc

# 2. Configure environment (edit .env if needed)
# Default: ZITADEL_HOSTNAME="localhost", ZITADEL_EXTERNALPORT="9090"

# 3. Start Zitadel and supporting services
docker-compose -f zitadel-docker-compose.yaml up -d

# 4. Wait for Zitadel to start (1-2 minutes)
# Check: http://localhost:9090/debug/healthz should return "ok"

# 5. Configure Zitadel (see "Zitadel Configuration" section below)
# Login: http://localhost:9090 with root/RootPassword1!

# 6. Edit .fleet-managerrc with your Zitadel credentials
# (See "Fleet Manager Configuration" section)

# 7. Start Fleet Manager backend
cd backend && npm run dev

# 8. Start Fleet Manager frontend (in another terminal)
cd frontend && npm run dev

# 9. Open http://localhost:5173 and click "Sign In with SSO"
```

### What Gets Started (Local Development)

| Service | URL | Purpose |
| --- | --- | --- |
| Zitadel | <http://localhost:9090> | Authentication server |
| PostgreSQL (Zitadel) | localhost:5432 (internal) | Zitadel database |
| TimescaleDB | localhost:5434 | Fleet Manager database |
| Mailcatcher | <http://localhost:1080> | Email testing UI |
| Grafana | <http://localhost:3000> | Metrics dashboards |

---

## Quick Start - Full Containerized

Run Fleet Manager in Docker, connecting to a Zitadel instance.

### Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    Docker Network (fleet-net)               │
│                                                             │
│  ┌─────────────────┐     ┌─────────────────────────────┐   │
│  │     Zitadel     │     │      Fleet Manager(s)       │   │
│  │  (shared auth)  │◄────│  (one or many instances)    │   │
│  └────────┬────────┘     └──────────────┬──────────────┘   │
│           │                             │                   │
│  ┌────────▼────────┐     ┌──────────────▼──────────────┐   │
│  │   PostgreSQL    │     │        TimescaleDB          │   │
│  │ (Zitadel data)  │     │    (Fleet Manager data)     │   │
│  └─────────────────┘     └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Key point**: Zitadel runs independently and can serve multiple Fleet Manager instances.

### Prerequisites

- Docker and Docker Compose installed
- Git (for cloning the repository)

### Step 1: Start Zitadel (One-Time Setup)

```bash
# 1. Copy environment file
cp .env.example .env

# 2. Start Zitadel and its dependencies
docker-compose -f zitadel-docker-compose.yaml up -d

# 3. Wait for Zitadel to initialize (1-2 minutes)
docker logs -f zitadel-fleet-management
# Wait for: "server is listening" then press Ctrl+C

# 4. Configure Zitadel (see "Zitadel Configuration" section below)
#    - Login: http://localhost:9090 with root/RootPassword1!
#    - Create Project, Roles, Applications, Action (follow all steps)
#    - Note down your Client IDs and Client Secret
```

### Step 2: Start Fleet Manager

```bash
# 1. Copy configuration template for Docker deployment
cp .fleet-managerrc.docker.example .fleet-managerrc

# 2. Edit .fleet-managerrc with your Zitadel credentials:
#    - Set oidc.backend.authorization.clientId and clientSecret
#    - Set oidc.frontend.client_id
#    See "Containerized Configuration Notes" below for details

# 3. Build and start Fleet Manager
docker-compose -f docker-compose.full.yaml up -d --build

# 4. Check Fleet Manager logs
docker logs -f fleet-manager
# Wait for: "Server started on port 7011"

# 5. Open http://localhost:7011 and click "Sign In with SSO"
```

### Rebuilding After Configuration Changes

If you change `.fleet-managerrc`, you need to rebuild:

```bash
# The frontend embeds OIDC config at build time
docker-compose -f docker-compose.full.yaml up -d --build fleet-manager
```

### Running Multiple Fleet Manager Instances

To run multiple Fleet Manager instances connecting to the same Zitadel:

1. Clone the repository to different directories
2. Configure each with unique ports in `.fleet-managerrc`
3. Create separate Zitadel applications (frontend) for each instance with matching redirect URIs
4. Start each instance with its own docker-compose

### What Gets Started (Full Containerized)

| Service | URL | Purpose |
| --- | --- | --- |
| Fleet Manager | <http://localhost:7011> | Main application (backend + frontend) |
| Zitadel | <http://localhost:9090> | Authentication server |
| PostgreSQL (Zitadel) | internal | Zitadel database |
| TimescaleDB | internal | Fleet Manager database |
| Mailcatcher | <http://localhost:1080> | Email testing UI |
| Grafana | <http://localhost:3000> | Metrics dashboards |

### Containerized Configuration Notes

When running Fleet Manager in Docker, the backend communicates with Zitadel via Docker's internal network, while the frontend (running in the browser) uses localhost.

**Key difference from local development:**

- Backend authority: `http://zitadel-fleet-management:8080` (Docker internal)
- Frontend authority: `http://localhost:9090` (browser access)
- Database host: `timescale-fleet-manager` (Docker internal)

Example `.fleet-managerrc` for containerized deployment:

```json
{
    "oidc": {
        "backend": {
            "authority": "http://zitadel-fleet-management:8080",
            "authorization": {
                "type": "basic",
                "clientId": "YOUR_BACKEND_CLIENT_ID@fleet-manager",
                "clientSecret": "YOUR_BACKEND_CLIENT_SECRET"
            }
        },
        "frontend": {
            "authority": "http://localhost:9090",
            "client_id": "YOUR_FRONTEND_CLIENT_ID@fleet-manager",
            "redirect_uri": "http://localhost:7011/callback",
            "response_type": "code",
            "scope": "openid profile email",
            "filterProtocolClaims": true,
            "loadUserInfo": true,
            "metadata": {
                "issuer": "http://localhost:9090",
                "authorization_endpoint": "http://localhost:9090/oauth/v2/authorize",
                "token_endpoint": "http://localhost:9090/oauth/v2/token",
                "userinfo_endpoint": "http://localhost:9090/oidc/v1/userinfo",
                "end_session_endpoint": "http://localhost:9090/oidc/v1/end_session"
            }
        }
    },
    "internalStorage": {
        "connection": {
            "host": "timescale-fleet-manager",
            "user": "postgres",
            "port": 5432,
            "password": "mysecretpassword",
            "database": "fleet"
        }
    }
}
```

---

## Zitadel Configuration

After Zitadel is running, configure it through the Zitadel Console.

### Step 1: Log In to Zitadel Console

1. Open <http://localhost:9090> in your browser
2. Click **Login**
3. Enter credentials: `root` / `RootPassword1!`
4. You'll be prompted to change your password on first login

### Step 2: Create a Project

1. In the left sidebar, click **Projects**
2. Click **Create New Project**
3. Enter project name: `Fleet Manager`
4. Click **Continue**
5. Note your **Project ID** (visible in the URL)

### Step 3: Create Project Roles

Create roles that define user access levels. Users without a role will have **no access**.

1. Inside your project, go to the **Roles** tab
2. Click **New**
3. Create each of the following roles:

| Role Key | Display Name | Description |
| --- | --- | --- |
| `admin` | Administrator | Full access to all features |
| `installer` | Installer | Read devices + manage waiting room (approve/reject new devices) |
| `viewer` | Viewer | Read-only access to all components |

**Role Permissions Summary:**

| Role | Devices | Groups | Dashboards | Actions | Waiting Room | Configurations | Plugins |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **admin** | Full CRUD+Execute | Full CRUD | Full CRUD | Full CRUD+Execute | Full CRUD | Full CRUD | Full CRUD |
| **installer** | Read only | None | None | None | Full CRUD | Read only | None |
| **viewer** | Read only | Read only | Read only | Read only | Read only | Read only | Read only |
| **(no role)** | None | None | None | None | None | None | None |

### Step 4: Create Backend Application (API)

This application is used by the Fleet Manager backend for token introspection.

1. Inside your project, click **New** (in Applications section)
2. Enter application name: `fleet-backend`
3. Select application type: **API**
4. Click **Continue**
5. Select authentication method: **Basic**
6. Click **Create**
7. **Important**: Copy and save the **Client ID** and **Client Secret** immediately
   - The secret is only shown once!
   - Example Client ID: `284174112292626123@fleet-manager`

### Step 5: Create Frontend Application (SPA)

This application is used by the Fleet Manager web interface.

1. In your project, click **New** again
2. Enter application name: `fleet-frontend`
3. Select application type: **User Agent**
4. Click **Continue**
5. Select authentication method: **PKCE**
6. Click **Continue**
7. Configure Redirect URIs:
   - For local development: `http://localhost:5173/callback`
   - For containerized: `http://localhost:7011/callback`
8. Configure Post-Logout Redirect URIs:
   - `http://localhost:5173`
   - `http://localhost:7011`
9. Click **Create**
10. Copy the **Client ID**

### Step 6: Create the Zitadel Action

The Action injects user metadata (permissions) into the userinfo endpoint so Fleet Manager can read them.

#### 6a. Create the Action Script

1. In the left sidebar, click **Actions** → **Scripts**
2. Click **New**
3. Configure the action:
   - **Name**: `injectFmPermissions`
   - **Script**:

```javascript
function injectFmPermissions(ctx, api) {
  var KEY = 'fm_permissions';

  function setClaimSafe(name, val) {
    try { api.v1.claims.setClaim(name, val); } catch (e) {}
  }

  function safeStringPreview(v) {
    try {
      if (typeof v === 'string') return v.slice(0, 200);
      return null;
    } catch (e) {
      return null;
    }
  }

  function decodeBase64Utf8(b64) {
    // Only decode if it *looks* like base64 (avoid double decode)
    if (typeof b64 !== 'string') return b64;
    try {
      var binary = atob(b64);
      var esc = '';
      for (var i = 0; i < binary.length; i++) {
        var hex = binary.charCodeAt(i).toString(16);
        if (hex.length < 2) hex = '0' + hex;
        esc += '%' + hex;
      }
      return decodeURIComponent(esc);
    } catch (e) {
      // not base64 or decoding failed -> return original string
      return b64;
    }
  }

  function extractValueCandidate(res) {
    // Return the best candidate for the metadata "value"
    if (!res) return null;

    // shapes we've seen: { count, sequence, timestamp, metadata: ... }
    if (res.value) return res.value;

    if (res.metadata) {
      // metadata can be { key, value } or { value } or array
      if (typeof res.metadata === 'object' && !Array.isArray(res.metadata)) {
        if (res.metadata.value) return res.metadata.value;
        if (res.metadata.metadata && res.metadata.metadata.value) return res.metadata.metadata.value;
      }
      if (Array.isArray(res.metadata) && res.metadata.length > 0) {
        var m0 = res.metadata[0];
        if (m0.value) return m0.value;
        if (m0.metadata && m0.metadata.value) return m0.metadata.value;
      }
    }

    return null;
  }

  function handle(res) {
    var candidate = extractValueCandidate(res);

    // debug the shapes/types
    setClaimSafe('fm_meta_debug', {
      resType: typeof res,
      resKeys: res && typeof res === 'object' ? Object.keys(res) : null,
      metadataType: res && res.metadata ? (Array.isArray(res.metadata) ? 'array' : typeof res.metadata) : null,
      metadataKeys: res && res.metadata && typeof res.metadata === 'object' && !Array.isArray(res.metadata) ? Object.keys(res.metadata) : null,
      candidateType: typeof candidate,
      candidatePreview: safeStringPreview(candidate)
    });

    if (candidate == null) return;

    // decode if needed (or no-op if already plain JSON string)
    var decoded = decodeBase64Utf8(candidate);

    // If decoded is already an object, just set it
    if (decoded && typeof decoded === 'object') {
      setClaimSafe(KEY, decoded);
      return;
    }

    if (typeof decoded !== 'string') {
      setClaimSafe('fm_permissions_error', 'Decoded metadata is not a string/object');
      return;
    }

    // Parse JSON
    try {
      var parsed = JSON.parse(decoded.trim());
      setClaimSafe(KEY, parsed);
    } catch (e) {
      setClaimSafe('fm_permissions_error', 'JSON parse failed: ' + e.toString());
      setClaimSafe('fm_permissions_preview', decoded.slice(0, 200));
    }
  }

  try {
    var p = ctx.v1.user.getMetadata(KEY);
    if (p && typeof p.then === 'function') {
      return p.then(handle).catch(function (e) {
        setClaimSafe('fm_permissions_error', 'getMetadata failed: ' + e.toString());
      });
    }
    handle(p);
  } catch (e) {
    setClaimSafe('fm_permissions_error', 'Exception: ' + e.toString());
  }
}
```

1. Click **Add**

#### 6b. Add Action to Flow

1. Go to **Actions** → **Flows**
2. Select **Complement Token** flow
3. Find **Pre Userinfo creation** trigger
4. Click **Add Action**
5. Select `injectFmPermissions`
6. Click **Save**

### Step 7: Create Your First User

1. In the left sidebar, click **Users**
2. Click **New**
3. Select **Human User**
4. Fill in user details:
   - Username: `fleetadmin`
   - First Name: `Fleet`
   - Last Name: `Admin`
   - Email: `admin@example.com`
5. Click **Create**
6. Set initial password:
   - Click on the user
   - Go to **Password** section
   - Click **Set New Password**

### Step 8: Assign Role to User

1. Go to **Authorizations** tab for the user
2. Click **New**
3. Select your project (`Fleet Manager`)
4. Select the role (`admin`, `installer`, or `viewer`)
5. Click **Continue** and **Save**

**Important**: Users **must** have a role assigned to access Fleet Manager. Users without any role will see a "no permissions" message

---

## Fleet Manager Configuration

### Configuration File Structure

Create `.fleet-managerrc` in the project root:

```json
{
    "oidc": {
        "backend": {
            "authority": "http://localhost:9090",
            "authorization": {
                "type": "basic",
                "clientId": "YOUR_BACKEND_CLIENT_ID@fleet-manager",
                "clientSecret": "YOUR_BACKEND_CLIENT_SECRET"
            }
        },
        "frontend": {
            "authority": "http://localhost:9090",
            "client_id": "YOUR_FRONTEND_CLIENT_ID@fleet-manager",
            "redirect_uri": "http://localhost:5173/callback",
            "response_type": "code",
            "scope": "openid profile email",
            "filterProtocolClaims": true,
            "loadUserInfo": true,
            "metadata": {
                "issuer": "http://localhost:9090",
                "authorization_endpoint": "http://localhost:9090/oauth/v2/authorize",
                "token_endpoint": "http://localhost:9090/oauth/v2/token",
                "userinfo_endpoint": "http://localhost:9090/oidc/v1/userinfo",
                "end_session_endpoint": "http://localhost:9090/oidc/v1/end_session"
            }
        }
    },
    "serviceAccounts": {
        "nodered": {
            "userId": "",
            "token": ""
        }
    },
    "components": {
        "web": {
            "port": 7011,
            "port_ssl": -1,
            "jwt_token": "your-jwt-secret-for-alexa"
        }
    },
    "internalStorage": {
        "connection": {
            "host": "localhost",
            "user": "postgres",
            "port": 5434,
            "password": "mysecretpassword",
            "database": "fleet"
        }
    }
}
```

### Configuration by Deployment Mode

| Setting | Local Development | Containerized |
| --- | --- | --- |
| `oidc.backend.authority` | `http://localhost:9090` | `http://zitadel-fleet-management:8080` |
| `oidc.frontend.authority` | `http://localhost:9090` | `http://localhost:9090` |
| `oidc.frontend.redirect_uri` | `http://localhost:5173/callback` | `http://localhost:7011/callback` |
| `internalStorage.connection.host` | `localhost` | `timescale-fleet-manager` |
| `internalStorage.connection.port` | `5434` | `5432` |

---

## User Permissions

Fleet Manager supports two permission systems:

1. **Role-Based** (Simple): Assign a role to the user → permissions are automatic
2. **Custom Config** (Advanced): Store detailed CRUD permissions in user metadata

### Role-Based Permissions

The simplest approach: just assign a project role to the user.

| Role | Access Level |
| --- | --- |
| `admin` | Full access to everything |
| `installer` | Read devices + full waiting room access (for device setup) |
| `viewer` | Read-only access to all components |
| *(no role)* | No access - user sees "contact admin" message |

**How it works**: When a user logs in, Fleet Manager reads their project role from the JWT token and maps it to a predefined permission set.

### Custom Permission Config (Advanced)

For fine-grained control, store a JSON permission configuration in the user's metadata.

#### Setting Up Custom Permissions

1. Go to the user in Zitadel Console
2. Click **Metadata** tab
3. Click **Add**
4. Set:
   - **Key**: `fm_permissions`
   - **Value**: JSON configuration (see examples below)
5. Click **Save**

**Important**: The Zitadel Action (Step 6) must be configured for custom permissions to work.

#### Permission Config Format

```json
{
  "components": {
    "devices": {
      "create": false,
      "read": true,
      "update": false,
      "delete": false,
      "execute": false,
      "scope": "ALL"
    },
    "groups": {
      "create": false,
      "read": true,
      "update": false,
      "delete": false,
      "scope": "ALL"
    },
    "dashboards": {
      "create": false,
      "read": true,
      "update": false,
      "delete": false,
      "scope": "ALL"
    },
    "actions": {
      "create": false,
      "read": true,
      "update": false,
      "delete": false,
      "execute": false
    },
    "waiting_room": {
      "create": false,
      "read": true,
      "update": false,
      "delete": false
    },
    "configurations": {
      "create": false,
      "read": true,
      "update": false,
      "delete": false
    },
    "plugins": {
      "create": false,
      "read": true,
      "update": false,
      "delete": false,
      "scope": "ALL"
    }
  }
}
```

#### Component Permissions

| Component | Operations | Scope Support | Description |
| --- | --- | --- | --- |
| `devices` | CRUD + Execute | Yes (`ALL`/`SELECTED`) | Device management and control |
| `groups` | CRUD | Yes (`ALL`/`SELECTED`) | Device groups |
| `dashboards` | CRUD | Yes (`ALL`/`SELECTED`) | Custom dashboards |
| `actions` | CRUD + Execute | No | Automation actions |
| `waiting_room` | CRUD | No | Pending device approval |
| `configurations` | CRUD | No | System configurations |
| `plugins` | CRUD | Yes (`ALL`/`SELECTED`) | Plugin management |

#### Scope: Limiting Access to Specific Items

For components that support scoping, you can limit access to specific items:

```json
{
  "components": {
    "devices": {
      "read": true,
      "execute": true,
      "scope": "SELECTED",
      "selected": ["shellyplus1-abc123", "shellyplus2-def456"]
    },
    "groups": {
      "read": true,
      "scope": "SELECTED",
      "selected": [1, 2, 5]
    }
  }
}
```

#### Example Configs

**Power User** - Can control devices but not delete them:

```json
{
  "components": {
    "devices": { "create": false, "read": true, "update": true, "delete": false, "execute": true, "scope": "ALL" },
    "groups": { "create": false, "read": true, "update": false, "delete": false, "scope": "ALL" },
    "dashboards": { "create": true, "read": true, "update": true, "delete": false, "scope": "ALL" },
    "actions": { "create": false, "read": true, "update": false, "delete": false, "execute": true },
    "waiting_room": { "create": false, "read": true, "update": false, "delete": false },
    "configurations": { "create": false, "read": true, "update": false, "delete": false },
    "plugins": { "create": false, "read": true, "update": false, "delete": false, "scope": "ALL" }
  }
}
```

**Building Manager** - Access only to specific groups:

```json
{
  "components": {
    "devices": { "create": false, "read": true, "update": false, "delete": false, "execute": true, "scope": "ALL" },
    "groups": { "create": false, "read": true, "update": false, "delete": false, "scope": "SELECTED", "selected": [3, 7] },
    "dashboards": { "create": false, "read": true, "update": false, "delete": false, "scope": "SELECTED", "selected": [1] },
    "actions": { "create": false, "read": true, "update": false, "delete": false, "execute": false },
    "waiting_room": { "create": false, "read": false, "update": false, "delete": false },
    "configurations": { "create": false, "read": false, "update": false, "delete": false },
    "plugins": { "create": false, "read": false, "update": false, "delete": false, "scope": "ALL" }
  }
}
```

#### Generating Permission Configs

Fleet Manager includes a UI to generate permission configs:

1. Log in as an admin
2. Go to **Settings** → **Permissions**
3. Configure the desired permissions using the visual editor
4. Click **Copy JSON**
5. Paste into the user's `fm_permissions` metadata in Zitadel

### Permission Priority

When both a role and custom metadata exist:

1. **Custom `fm_permissions` metadata takes priority** over role
2. If no metadata exists, the role determines permissions
3. If neither exists, user has no access

---

## User Migration

If migrating from legacy PostgreSQL-based authentication:

### Dry Run (Preview)

```bash
cd backend
npx tsx scripts/migrate-users-to-zitadel.ts --dry-run
```

### Full Migration

```bash
cd backend
npx tsx scripts/migrate-users-to-zitadel.ts --send-reset
```

### Options

| Option | Description |
| --- | --- |
| `--dry-run` | Preview changes without making them |
| `--skip-existing` | Skip users that already exist in Zitadel |
| `--send-reset` | Send password reset emails to migrated users |

---

## Service Accounts

For Node-RED and other integrations, create machine users (service accounts):

### Create Service Accounts

```bash
cd backend
npx tsx scripts/create-service-accounts.ts --all
```

### Options

| Option | Description |
| --- | --- |
| `--nodered` | Create only the Node-RED service account |
| `--alexa` | Create only the Alexa service account |
| `--all` | Create all service accounts |
| `--dry-run` | Preview without creating |

### Configure Service Accounts

After running the script, add the generated tokens to `.fleet-managerrc`:

```json
{
    "serviceAccounts": {
        "nodered": {
            "userId": "generated-user-id",
            "token": "generated-pat-token"
        }
    }
}
```

---

## Troubleshooting

### Zitadel Won't Start

**Symptom**: Docker container exits or health check fails.

**Solutions**:

```bash
# Check container status
docker ps -a

# View logs
docker logs zitadel-fleet-management --tail 100

# Verify PostgreSQL is healthy
docker logs postgresql-fleet-manager

# Restart if needed
docker-compose -f zitadel-docker-compose.yaml restart
```

### "OIDC configuration is required"

**Symptom**: Backend fails to start with this error.

**Solutions**:

1. Verify `.fleet-managerrc` exists in project root
2. Check JSON syntax is valid
3. Ensure `oidc.backend` section is present

### "Failed to get service token"

**Symptom**: Backend can't communicate with Zitadel.

**Solutions**:

1. Verify Zitadel is running: `curl http://localhost:9090/debug/healthz`
2. Check client credentials are correct
3. Verify the application type is "API" with "Basic" authentication
4. For containerized deployment, ensure backend uses internal hostname

### Users Have No Permissions (403 Forbidden)

**Symptom**: User logs in but can't access features or sees "no permissions" message.

**Solutions**:

1. **Check user has a role assigned**:
   - Go to user → Authorizations
   - Ensure they have a project grant with a role (`admin`, `installer`, or `viewer`)
   - Users without any role will have NO access

2. **If using custom permissions**, check the metadata:
   - Go to user → Metadata
   - Verify `fm_permissions` exists and contains valid JSON
   - The JSON must have the `components` key with proper structure

3. **Verify the Zitadel Action is configured**:
   - Go to Actions → Flows → Complement Token
   - Ensure `injectFmPermissions` is added to "Pre Userinfo creation" trigger
   - Without this action, custom `fm_permissions` metadata won't work

4. **Check the role is spelled correctly**:
   - Role keys must be exactly: `admin`, `installer`, or `viewer` (lowercase)
   - Any other role name will result in no permissions

### Login Redirects Fail

**Symptom**: After clicking "Sign In with SSO", you see an error.

**Solutions**:

1. Verify redirect URI in Zitadel matches exactly:
   - Local dev: `http://localhost:5173/callback`
   - Containerized: `http://localhost:7011/callback`
2. Check browser console for errors (F12)
3. Clear browser cache and cookies

### Docker Network Issues (Containerized)

**Symptom**: Fleet Manager can't reach Zitadel.

**Solutions**:

```bash
# Verify containers are on same network
docker network inspect fleet-manager_fleet-net

# Check DNS resolution inside container
docker exec fleet-manager ping zitadel-fleet-management

# Restart with fresh network
docker-compose -f docker-compose.full.yaml down
docker-compose -f docker-compose.full.yaml up -d
```

### Fleet Manager Container Won't Start

**Symptom**: Container starts but exits or can't connect.

**Solutions**:

1. **Check the logs**:

```bash
docker logs fleet-manager --tail 100
```

1. **Verify database connection**:

```bash
# Check if TimescaleDB is healthy
docker logs timescale-fleet-manager --tail 50

# Test connection from Fleet Manager container
docker exec fleet-manager ping timescale-fleet-manager
```

1. **Verify configuration is mounted**:

```bash
# Check if .fleet-managerrc is accessible inside container
docker exec fleet-manager cat /app/.fleet-managerrc
```

1. **Rebuild after config changes**:

```bash
# The frontend embeds OIDC config at build time
docker-compose -f docker-compose.full.yaml up -d --build fleet-manager
```

### OIDC/SSO Issues in Containerized Setup

**Symptom**: Login fails with "invalid redirect_uri" or token errors.

**Solutions**:

1. **Check Zitadel redirect URIs include containerized URL**:
   - Must include: `http://localhost:7011/callback`

2. **Verify frontend config points to external Zitadel URL**:

   ```json
   {
     "oidc": {
       "frontend": {
         "authority": "http://localhost:9090",
         "redirect_uri": "http://localhost:7011/callback"
       }
     }
   }
   ```

3. **Verify backend config points to internal Zitadel URL**:

   ```json
   {
     "oidc": {
       "backend": {
         "authority": "http://zitadel-fleet-management:8080"
       }
     }
   }
   ```

4. **Rebuild after changing OIDC config** (frontend embeds config at build time):

   ```bash
   docker-compose -f docker-compose.full.yaml up -d --build fleet-manager
   ```

---

## Production Deployment

### 1. Use HTTPS

Update all URLs to use HTTPS:

```json
{
    "oidc": {
        "backend": {
            "authority": "https://auth.yourdomain.com"
        },
        "frontend": {
            "authority": "https://auth.yourdomain.com",
            "redirect_uri": "https://fleet.yourdomain.com/callback",
            "metadata": {
                "issuer": "https://auth.yourdomain.com",
                "authorization_endpoint": "https://auth.yourdomain.com/oauth/v2/authorize",
                "token_endpoint": "https://auth.yourdomain.com/oauth/v2/token",
                "userinfo_endpoint": "https://auth.yourdomain.com/oidc/v1/userinfo",
                "end_session_endpoint": "https://auth.yourdomain.com/oidc/v1/end_session"
            }
        }
    }
}
```

### 2. Configure Zitadel for Production

```bash
# Production environment variables
ZITADEL_EXTERNALSECURE=true
ZITADEL_EXTERNALDOMAIN=auth.yourdomain.com
ZITADEL_EXTERNALPORT=443
```

### 3. Use Secrets Management

Don't store credentials in `.fleet-managerrc` for production. Use environment variables or a secrets manager.

### 4. Security Considerations

1. **Never commit credentials** - Add `.fleet-managerrc` to `.gitignore`
2. **Use HTTPS in production** - All OAuth flows should use TLS
3. **Rotate secrets regularly** - Regenerate client secrets periodically
4. **Limit permissions** - Grant users only the permissions they need
5. **Protect service tokens** - Service account tokens have elevated access
6. **Monitor authentication logs** - Zitadel provides audit logs

---

## Docker Compose Files Reference

| File | Description | Services |
| --- | --- | --- |
| `docker-compose.yml` | Base services | TimescaleDB, Grafana, mDNS repeater |
| `zitadel-docker-compose.yaml` | Authentication server (includes base) | Zitadel, PostgreSQL, Mailcatcher |
| `docker-compose.full.yaml` | Fleet Manager container (includes base) | Fleet Manager |

**Important**: `zitadel-docker-compose.yaml` and `docker-compose.full.yaml` are **independent**. They both include the base `docker-compose.yml` but don't include each other. This allows:

- Running Zitadel once, shared by multiple Fleet Manager instances
- Starting/stopping Fleet Manager without affecting Zitadel

### Configuration Files Reference

| File | Description | Use Case |
| --- | --- | --- |
| `.fleet-managerrc.example` | Configuration template for local development | Backend at localhost, frontend at localhost:5173 |
| `.fleet-managerrc.docker.example` | Configuration template for Docker deployment | Backend uses Docker network, frontend at localhost:7011 |
| `.env.example` | Environment variables template | Zitadel hostname, ports, mDNS config |

### Commands Quick Reference

```bash
# ============================================
# ZITADEL (run once, shared authentication)
# ============================================
# Start Zitadel
docker-compose -f zitadel-docker-compose.yaml up -d

# View Zitadel logs
docker-compose -f zitadel-docker-compose.yaml logs -f zitadel-fleet-management

# Stop Zitadel (stops auth for all Fleet Managers!)
docker-compose -f zitadel-docker-compose.yaml down

# ============================================
# FLEET MANAGER (containerized)
# ============================================
# Build and start Fleet Manager
docker-compose -f docker-compose.full.yaml up -d --build

# View Fleet Manager logs
docker-compose -f docker-compose.full.yaml logs -f fleet-manager

# Rebuild after code or config changes
docker-compose -f docker-compose.full.yaml up -d --build fleet-manager

# Stop Fleet Manager (Zitadel keeps running)
docker-compose -f docker-compose.full.yaml down

# Restart Fleet Manager
docker-compose -f docker-compose.full.yaml restart fleet-manager

# ============================================
# LOCAL DEVELOPMENT (Fleet Manager via npm)
# ============================================
# Start Zitadel + base services
docker-compose -f zitadel-docker-compose.yaml up -d

# Then run Fleet Manager locally:
cd backend && npm run dev    # Terminal 1
cd frontend && npm run dev   # Terminal 2
```

---

## Additional Resources

- [Zitadel Documentation](https://zitadel.com/docs)
- [Zitadel GitHub](https://github.com/zitadel/zitadel)
- [OIDC Specification](https://openid.net/specs/openid-connect-core-1_0.html)
