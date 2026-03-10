# Custom Permissions

Fleet Manager supports a granular CRUD+E (Create, Read, Update, Delete, Execute) permission system. Permissions are stored as user metadata in Zitadel and injected into the user's token via a Zitadel Action script.

If no custom permissions are configured, users fall back to role-based permissions (admin/viewer/installer) based on their Zitadel project roles.

---

## Zitadel Setup

To enable custom permissions for an organization, you need to add an Action script in Zitadel and wire it to the token flow.

### Step 1: Create the Action Script

1. In Zitadel, go to **Actions > Scripts > New**
2. Set the name to `injectFmPermissions`
3. Paste the following script:

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
      return b64;
    }
  }

  function extractValueCandidate(res) {
    if (!res) return null;
    if (res.value) return res.value;
    if (res.metadata) {
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

    setClaimSafe('fm_meta_debug', {
      resType: typeof res,
      resKeys: res && typeof res === 'object' ? Object.keys(res) : null,
      metadataType: res && res.metadata ? (Array.isArray(res.metadata) ? 'array' : typeof res.metadata) : null,
      metadataKeys: res && res.metadata && typeof res.metadata === 'object' && !Array.isArray(res.metadata) ? Object.keys(res.metadata) : null,
      candidateType: typeof candidate,
      candidatePreview: safeStringPreview(candidate)
    });

    if (candidate == null) return;

    var decoded = decodeBase64Utf8(candidate);

    if (decoded && typeof decoded === 'object') {
      setClaimSafe(KEY, decoded);
      return;
    }

    if (typeof decoded !== 'string') {
      setClaimSafe('fm_permissions_error', 'Decoded metadata is not a string/object');
      return;
    }

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

### Step 2: Wire It to the Token Flow

1. Go to **Actions > Flows**
2. Select the **Complement Token** flow type
3. Add a **Pre Userinfo Creation** trigger
4. Attach the `injectFmPermissions` script to this trigger

This ensures that every time a token is issued, the user's `fm_permissions` metadata is decoded and injected into the userinfo claims. Fleet Manager reads it from there on each request.

---

## Setting User Permissions

Permissions are stored as Zitadel user metadata under the key `fm_permissions`. The value is a JSON object that gets base64-encoded by Zitadel automatically.

You can set it via:
- **Zitadel Console**: Go to the user > Metadata > Add key `fm_permissions` with the JSON value
- **Zitadel Management API**: `POST /management/v1/users/{userId}/metadata/_bulk`
- **Fleet Manager UI**: Use the built-in Permission Config Editor (available to admins)

---

## Permission Format

Permissions follow a CRUD+E model per component:

```json
{
  "components": {
    "devices": {
      "create": true,
      "read": true,
      "update": true,
      "delete": true,
      "execute": true,
      "scope": "ALL"
    },
    "groups": {
      "create": false,
      "read": true,
      "update": false,
      "delete": false,
      "scope": "ALL"
    }
  }
}
```

### Components

| Component | Scoped | Execute | Description |
|-----------|--------|---------|-------------|
| `devices` | Yes | Yes | IoT devices and their entities. Entity permissions are inherited from the parent device. |
| `actions` | No | Yes | Automated actions and macros. Visibility is derived from device access. |
| `groups` | Yes | No | Device groups. |
| `dashboards` | Yes | No | UI dashboards. |
| `waiting_room` | No | No | Device approval queue. |
| `configurations` | No | No | Device profiles and settings. |
| `plugins` | Yes | No | System extensions. |

### Operations

| Operation | Meaning |
|-----------|---------|
| `create` | Add new items |
| `read` | View/list items |
| `update` | Modify existing items |
| `delete` | Remove items |
| `execute` | Send commands to devices, trigger actions |

### Scope

Scoped components (`devices`, `groups`, `dashboards`, `plugins`) support access restriction:

- `"scope": "ALL"` — Access to all items
- `"scope": "SELECTED"` — Access only to specific items listed in `selected`

```json
{
  "components": {
    "devices": {
      "read": true,
      "execute": true,
      "scope": "SELECTED",
      "selected": ["shellypro4pm-a0a3b3d1e2f3", "shellyplus1-b1c2d3e4f5a6"]
    },
    "groups": {
      "read": true,
      "scope": "SELECTED",
      "selected": [1, 5, 10]
    }
  }
}
```

For `devices` and `plugins`, `selected` is an array of string IDs. For `groups` and `dashboards`, it's an array of numeric IDs.

---

## Presets

The system includes built-in presets. You can use these as a starting point and customize as needed.

### Admin
Full access to everything.

### Viewer
Read-only access to all components. No create, update, delete, or execute.

### Operator
Read + execute on devices, read on everything else. Can interact with devices but not modify system configuration.

### Installer
Read devices and groups, manage waiting room (accept/reject pending devices), read configurations. No access to dashboards, actions, or plugins.

---

## Partial Configs

You only need to specify the components you want to grant access to. Omitted components default to all-false (no access). For example, to grant read-only access to devices and groups:

```json
{
  "components": {
    "devices": { "read": true, "scope": "ALL" },
    "groups": { "read": true, "scope": "ALL" }
  }
}
```

---

## Fallback Behavior

If no `fm_permissions` metadata is found for a user, Fleet Manager falls back to role-based permissions derived from the user's Zitadel project roles:

| Zitadel Role | Maps to |
|-------------|---------|
| `admin` | Full access (Admin preset) |
| `viewer` | Read-only (Viewer preset) |
| `installer` | Installer preset |
| No role | No access |
