# Device Backups

## Overview

The Backups system allows users to create, store, and restore configuration backups of Shelly devices through Fleet Manager. Backups capture the full device configuration as a `.zip` file and can be restored to any device of the same model.

The feature is accessible from the **Backups** tab in the Devices page (next to Firmware), and requires execute permissions.

## How It Works

### Architecture

```text
Frontend (browser)                    Backend (FM)                     Device
─────────────────                    ────────────                     ──────

1. User selects devices
2. Clicks "Start Backup"
        ──────────────────►
3. For each device:
   a. sendRPC(device, Sys.CreateBackup)  ───────────────────────────►  Device creates
                                                                        backup & reboots
   b. Poll Sys.GetStatus until           ───────────────────────────►  Device comes
      .backup.created appears                                           back online

   c. sendRPC(FM, Backup.DownloadFromDevice) ─►
                                         d. FM calls Sys.DownloadBackup ────►  Returns
                                            in chunks (8KB default)            base64 data
                                         e. FM saves .zip to disk
                                         f. FM stores metadata in registry
                                              ◄──────────────────────
        ◄──────────────────
4. User names backups
5. Backups appear in list
```

### Backup Creation Flow (Step by Step)

The backup creation follows the same wizard pattern as the Firmware tab:

**Step 1 - Device Selection:**

- User sees a grid of online devices with execute permission
- Can filter by group using the dropdown
- Select individual devices or "Select All"
- Click "Start Backup" to proceed

**Step 2 - Backup Progress:**

- Each selected device goes through these phases:
  1. **Creating** - `Sys.CreateBackup` is sent to the device. The device immediately responds with `null` and begins creating the backup internally. This triggers a device reboot.
  2. **Rebooting** - The frontend polls the device via `Sys.GetStatus` every 5 seconds, waiting for the device to come back online with `status.sys.backup.created` populated. Timeout: 2 minutes.
  3. **Downloading** - The frontend tells the backend to download the backup from the device. The backend calls `Sys.DownloadBackup` in 8KB chunks, concatenates the base64-encoded data, decodes it, and saves the resulting `.zip` file to `backend/data/backups/{id}.zip`. Metadata is stored in the registry at `backend/cfg/registry/backups.json`.
  4. **Success** or **Failed** - Final state per device.
- Devices are processed in batches of 3 to avoid overwhelming the system.
- Failed devices can be retried.

**Step 3 - Naming:**

- All successfully created backups are shown in a table
- Default name format: `{deviceName}-{YYYY-MM-DD}`
- User can customize names for each backup
- If a backup with the same name already exists, it will be overwritten
- Click "Save Names" or "Keep Defaults" to finish

### Backup Restore Flow

1. From the backup list, user clicks "Actions > Restore" on a backup card
2. A modal opens showing the backup details (model, firmware version, creation date)
3. User selects a target device from a dropdown that **only shows online devices matching the backup's model** (e.g., a backup from a ShellyPlus1PM can only be restored to another ShellyPlus1PM)
4. A warning reminds the user that the device will reboot
5. On confirmation, the backend:
   - Reads the stored `.zip` file
   - Converts it to base64
   - Sends it to the device via `Sys.RestoreBackup` in chunks
   - Each chunk includes `{offset, data}`, and the final chunk includes `{final: true}`
   - The device reboots with the restored configuration
6. An optional content filter can be passed with the final chunk to restore only specific parts of the backup

### Storage

**Backup files:**

```text
backend/data/backups/{backupId}.zip
```

**Backup metadata (JSON registry):**

```text
backend/cfg/registry/backups.json
```

Each entry contains:

```json
{
  "id": "1234567890-abc12345",
  "name": "Living Room Switch-2026-02-12",
  "shellyID": "shellyplus1pm-aabbccddeeff",
  "model": "SNSW-001P16EU",
  "app": "Plus1PM",
  "fwVersion": "1.5.0",
  "createdAt": 1739356800000,
  "fileSize": 2048,
  "contents": {
    "ble_bondings": true,
    "dynamic_components": true,
    "persistent_counters": true,
    "schedules": true,
    "scripts": true,
    "webhooks": true
  },
  "metadata": {}
}
```

## Backend RPC Methods

All methods are on the `Backup` component, called via `ws.sendRPC('FLEET_MANAGER', 'Backup.Method', params)`.

| Method | Permission | Params | Returns | Description |
| ------ | ---------- | ------ | ------- | ----------- |
| `Backup.List` | ReadOnly | none | `BackupMetadata[]` | List all stored backups |
| `Backup.Get` | ReadOnly | `{id}` | `BackupMetadata \| null` | Get single backup by ID |
| `Backup.DownloadFromDevice` | Execute (devices) | `{shellyID, name?}` | `BackupMetadata` | Download backup from device and store it. If no backup exists on the device, triggers `Sys.CreateBackup` and waits for reboot. |
| `Backup.Rename` | Write | `{id, name}` | `BackupMetadata` | Rename a backup. Overwrites if name collision. |
| `Backup.Delete` | Write | `{id}` | `{success: boolean}` | Delete backup file and metadata |
| `Backup.RestoreToDevice` | Execute (devices) | `{id, shellyID, restore?}` | `{success: boolean}` | Upload backup to target device. Model must match. Optional `restore` content filter. |
| `Backup.GetFile` | ReadOnly | `{id}` | `{data, name, size}` | Get base64-encoded backup file for client download |

## Shelly Device RPC Reference

These are the Shelly firmware RPCs used by the backup system:

### Sys.CreateBackup

Triggers backup creation on the device. The device reboots. Response is always `null`. After reboot, `Sys.GetStatus` will include a `backup` property with `created` timestamp and `contents`.

Optional content filter params (all default to `true`):

- `ble_bondings`, `dynamic_components`, `matter_storage`, `persistent_counters`, `schedules`, `scripts`, `webhooks`

### Sys.DownloadBackup

Downloads the backup in chunks.

**Request:** `{offset: number, len: number}`
**Response:** `{data: string (base64), left: number}`

Call repeatedly, incrementing `offset` by the decoded chunk size, until `left === 0`.

### Sys.RestoreBackup

Uploads a backup to the device in chunks.

**Request:** `{offset: number, data: string (base64), final?: boolean, restore?: object}`

Send chunks sequentially with increasing offsets. Set `final: true` on the last chunk to trigger the restore and reboot. The optional `restore` object is a content filter (same properties as `Sys.CreateBackup`).

### Sys.GetStatus (backup property)

After `Sys.CreateBackup` and reboot, the status includes:

```json
{
  "backup": {
    "href": "/backup.zip",
    "created": 1758267551,
    "contents": {
      "ble_bondings": true,
      "dynamic_components": true,
      "persistent_counters": true,
      "schedules": true,
      "scripts": true,
      "webhooks": true
    }
  }
}
```

If the backup failed, `backup.error` will be present instead.

## UI Structure

### Backups Tab Views

1. **List View** (default) - Grid of backup cards showing name, model, firmware version, date, size. Each card has an Actions dropdown (Restore, Rename, Download, Delete) and a blue info button with a metadata popover.

2. **Device Selection** - Same widget grid as Firmware tab step 1. Group dropdown, Select All, Clear, device cards with checkboxes.

3. **Backup Progress** - Table with columns: Device, Model, Progress bar, Status, Action. Status shows the current phase with color coding (blue=creating/downloading, yellow=rebooting, green=success, red=failed).

4. **Naming** - Table with editable name inputs for each successful backup. Option to keep defaults or save custom names.

### Restore Modal

Opened from the backup card Actions dropdown. Shows backup info, a device selector filtered to matching models only, a warning about reboot, and a Restore button with progress feedback.

## Important Notes

- **Model compatibility:** Backups can only be restored to devices of the exact same model. The system checks `device.info.model` against `backup.model`.
- **Device reboot:** Both `Sys.CreateBackup` and `Sys.RestoreBackup` (final chunk) cause the device to reboot. Users should be aware of temporary downtime.
- **Name collision:** If a backup with the same name already exists when saving/renaming, the old one is deleted and replaced.
- **Chunk size:** Default is 8192 bytes, configurable via the BackupComponent config.
- **Timeouts:** The system waits up to 2 minutes for a device to come back online after reboot. If the device doesn't respond in time, the backup is marked as failed.
- **Batching:** During creation, devices are processed 3 at a time to avoid overwhelming the transport layer.
- **Permissions:** The Backups tab requires execute permission on devices. List and Get operations are read-only.

## File Locations

| File | Purpose |
| ---- | ------- |
| `backend/src/model/component/BackupComponent.ts` | Backend component with all RPC methods |
| `backend/src/app.ts` | Component registration |
| `frontend/src/stores/backups.ts` | Pinia store for state management |
| `frontend/src/components/widgets/BackupWidget.vue` | Backup card widget |
| `frontend/src/pages/devices/backups.vue` | Main tab page with all views |
| `frontend/src/pages/devices.vue` | Tab registration |
| `backend/data/backups/` | Backup `.zip` file storage |
| `backend/cfg/registry/backups.json` | Backup metadata registry |
