<!-- audience: public -->
# Device Backups

## Overview

Fleet Manager can create, store, import, download and restore configuration
backups of Shelly devices. A backup is the `.zip` archive the device builds.
Fleet stores the archive on disk and keeps a metadata record for it.

Backup creation and restore run as durable backend jobs. The browser starts a
job and follows its progress. It does not drive the device itself.

The UI lives at **Operations > Backups** (`/operations/backups`), next to the
Firmware and Jobs tabs.

## Who can use it

- **The Operations section.** `/operations` is open only to users whose
  permissions mark them as admin (`isAdmin`). Other users are sent to the
  first section they can open.
- **Devices you can back up.** The Devices view lists a device only when all
  of these are true:
  - the device is online;
  - the user has `devices:execute` on it;
  - the device advertises `Sys.CreateBackup`, `Sys.DownloadBackup` and
    `Sys.RestoreBackup` in its method list (`capabilities.backup`).
- **Backend checks.** The backend checks its own permissions on every call.
  See the method table below. Starting a backup job needs `devices:update` on
  every listed device, which is a different check from the UI's
  `devices:execute`.
- **Ownership.** Each backup stores the organization that captured it
  (`organizationId`). A user from another organization gets `NotFound` for
  that backup, unless they can cross organization boundaries. Records saved
  before this field existed have `organizationId: null`. Fleet fills it in on
  first access when it can find the capture owner.

## Creating backups

### In the UI

1. Open the **Devices** toggle. Filter by group, model, tag or location if
   needed, and select devices.
2. Click **Back up** in the selection bar.
3. Under **Extra Content**, tick the optional sections to include (see
   [Content keys](#content-keys)). Nothing is ticked by default.
4. Click **Start Backup** and confirm. The UI calls
   `Backup.StartDownloadJob` once for all selected devices, with the content
   choice and a new idempotency key. The job also shows on the Jobs tab.
5. Each row shows `Waiting`, then `creating`, `rebooting`, `downloading`,
   and finally `Done` or the error text.
6. **Retry** starts a new job for the failed devices only.
7. When every device has finished, a **Name** column shows each new
   backup's generated name. **Save & Done** calls `Backup.Rename` for each
   name you changed. **Skip** keeps the generated names.

### Backend job

`Backup.StartDownloadJob` stores a job with mode `create` and one unit per
device. It returns `{jobId}`. If the same `idempotencyKey` was already used
for this organization with the same request, it returns the existing job and
queues nothing new. The same key with a different request is an error.

A background worker processes queued units:

- Only the leader process runs the worker.
- It runs up to `FM_BACKUP_JOB_CONCURRENCY` units at a time (default 3) and
  polls every `FM_BACKUP_JOB_POLL_INTERVAL_MS` (default 1000).
- The per-unit deadline in the worker loop is `FM_BACKUP_UNIT_TIMEOUT_MS`
  (default 120000).
- Before each unit it checks that the job's stored authority still allows
  work on that device. If not, the unit is stopped.
- On start, units left `in_progress` by an earlier run are not retried. They
  are marked `unknown` if they had already been sent to the device, and
  `stopped` if not. `FM_BACKUP_JOB_TIMEOUT_MS` (default 300000) sets how old
  such a unit must be.
- A job ends `done` when no unit failed, and `failed` otherwise.

Fleet runs one backup or restore per device at a time in a process. A second
one for the same device fails with `ResourceConflict`.

### Steps for one device

1. **Preflight.** The device must be connected, or the unit fails with
   `DeviceOffline`. Fleet reads `Sys.GetStatus` and notes the current
   `backup.created` time, so an older backup is not taken as the new one.
2. **Create.** Fleet sends `Sys.CreateBackup` with all seven content keys as
   `true` or `false`. The device reboots. If the call fails with an error that
   looks like the reboot (connection closed, timeout, codes `-109` or
   `-32900`), Fleet carries on.
3. **Wait.** Fleet waits up to 120 seconds (`REBOOT_TIMEOUT`) for a status with
   a `backup.created` time newer than the one from step 1. It listens for
   status and connect events and also calls `Sys.GetStatus`. If the status
   has `backup.error`, the unit fails. If time runs out, the unit fails.
4. **Compare.** Fleet compares the contents the device reports with the
   contents it asked for. A difference does not fail the unit. It is recorded
   in the metadata (`content_selection_honored: "no"`, `selection_warning`,
   `mismatched_keys`).
5. **Download.** Fleet calls `Sys.DownloadBackup` with `{offset, len}`, where
   `len` is the component's `chunkSize` (default 8192 bytes). Each base64
   chunk is decoded and written straight to `{id}.zip`. Fleet moves `offset`
   forward by the decoded size until the device reports `left: 0`. If the
   device drops off between chunks, the unit fails and the partial file is
   deleted.
6. **Persist.** Fleet writes the metadata record. If this fails, the file is
   deleted.

Progress is sent as `backup` component status events
(`backupProgress: {shellyID, phase}` with phase `creating`, `rebooting` or
`downloading`). Unit results arrive as job events. A failure also sends a
`backup_operation_failed` alert event for the device's organization.

### Names

- **Without a name** (the UI does not send one): Fleet builds
  `{deviceName}-{shellyID}-{YYYY-MM-DD}`, or `{shellyID}-{YYYY-MM-DD}` when the
  device has no name. The date is UTC. If any stored backup already has that
  name, Fleet adds a space and `(2)`, `(3)` and so on.
- **With a name** (`name` on `Backup.StartDownloadJob` or `Backup.Rename`):
  every other stored backup with exactly that name is deleted, file and
  record, and the response carries `replacedBackupId`. If one of those
  backups is being restored, the call fails with `ResourceConflict`.
- Both name lookups read every record in the registry. They do not filter by
  organization.
- Names are trimmed, must not be empty, and are at most
  `FM_BACKUP_NAME_MAX_LENGTH` characters (default 200).

## Restoring a backup

### In the UI

There are two ways to open the restore panel:

- Click a backup row, then **Restore** in the detail dialog.
- Select devices, click **Back up**, and pick a backup from the **Restore**
  dropdown. It lists backups whose model matches a selected device.

The panel lists target devices that are online, advertise `Sys.RestoreBackup`
and `Shelly.GetDeviceInfo` (`capabilities.restore`), and have the backup's
model. When both sides report an app, it must match too. You can pick
several targets. **Content** checkboxes start ticked for the sections the
backup holds, and sections the backup lacks are disabled. After you confirm,
the UI calls `Backup.StartRestoreJob` once per target.

### Backend job

`Backup.StartRestoreJob` checks that the caller can read the backup and has
`devices:update` on the target. It stores a job with mode `restore` and one
unit, and returns `{jobId}`. The same idempotency rules apply as for create.

Steps for the unit:

1. **Preflight.** The backup must exist and belong to the job's
   organization. The target must be connected. `info.model` must equal the
   backup's model, and when both have an app, `info.app` must equal it.
   Otherwise the unit fails with `NotFound`, `DeviceOffline` or
   `ResourceConflict` (`reason: model_mismatch` or `app_mismatch`).
2. **Upload.** Fleet reads the file in 1026-byte pieces and sends each as
   `Sys.RestoreBackup` with `{offset, data}`, where `data` is base64. The last
   chunk adds `final: true`. When content keys were chosen, it also adds
   `restore` with only the keys set to `true`.
3. **Chunk failures.** Each send times out after
   `FM_BACKUP_RESTORE_CHUNK_TIMEOUT_MS` (default 30000). When a send fails,
   Fleet waits `FM_BACKUP_RESTORE_RETRY_DELAY_MS` (default 5000) and starts the
   upload again from offset 0, up to `FM_BACKUP_RESTORE_MAX_RESTARTS` times
   (default 3). After that it retries the same chunk, up to
   `FM_BACKUP_RESTORE_CHUNK_MAX_RETRIES` attempts in total (default 3). If the
   device is offline when a chunk is due, Fleet waits and checks again within
   the same attempt count.
4. **Apply.** The device reboots after the final chunk. A reboot-like error
   on that chunk is accepted. Fleet then waits up to 120 seconds for the
   device to reconnect. If the final chunk was not acknowledged, Fleet also
   calls `Shelly.GetDeviceInfo` after the reconnect. If that call fails, the
   restore fails.

Progress is sent as `backup` component status events
(`restoreProgress: {shellyID, backupId, chunk, totalChunks, percent}`).
While a backup is being restored, it cannot be deleted, renamed or replaced.

## Importing a backup

The **Import** button uploads a `.zip` to `POST /media/importBackup`, as
multipart form data with the file in field `backup` and an optional `name`.

- Needs `devices:update`.
- Rate limit: `FM_HTTP_RATELIMIT_BACKUP_IMPORT_PER_MIN` (default 10).
- The file name must end in `.zip`.
- Size cap: `FM_BACKUP_IMPORT_MAX_BYTES` (default 50 MB).

The archive is validated before anything is stored
(`backend/src/modules/backup/backupArchive.ts`):

- It must open as a ZIP and must not be empty.
- At most 512 entries and 256 MB uncompressed.
- A JSON member must hold a device info object with a string `model` and
  `app`, plus a device id.
- The model must be a known Shelly model.

A rejected file gets an error with code `ValidationFailed` and a `reason`:
`not_a_shelly_backup`, `unknown_device_model` or `backup_too_large`.

The stored record has `source: "imported"` and the importer's organization.
Model, app, firmware and source device come from the archive. Contents are
detected from entry names. An import with a `name` does not replace other
backups with that name.

The same import is also available as a `FileTransfer` upload of kind
`backup_import`, which also needs `devices:update`.

## Downloading a backup

**Download** in the detail dialog calls `Backup.GetFile`. It returns the whole
file as base64. Files over 50 MB are refused with `ValidationFailed`. The
`FileTransfer` read of kind `backup` serves the same file in chunks, needs
`devices:read`, and uses the same 50 MB cap.

## Backups view

The **Backups** toggle shows a table with Name, Device, Model, Firmware, Date,
Size and Contents. You can sort, search, and filter by model, app, firmware,
date and group. There is also a CSV export and a refresh button. Clicking a
row opens a detail dialog with Delete, Rename, Download and Restore.

The view loads `Backup.List` once without paging, so it shows at most 500
backups. Fleet currently stores empty group lists for new backups, so the
group filter has nothing to match on them.

## Storage

Paths are relative to the backend directory.

- Archives: `data/backups/{id}.zip`
- Metadata: `cfg/registry/backups.json`, one entry per backup id.

The id is `{epoch ms}-{12 hex characters}`. When a record's file is missing,
Fleet removes the record the next time it reads it. Deletes move the file
aside first and remove it after the registry is updated.

Each record follows `BackupMetadata` in
`backend/src/model/component/BackupComponent.ts`:

| Field | Meaning |
| ----- | ------- |
| `id` | Backup id, also the file name |
| `organizationId` | Organization that captured or imported it; `null` on old records |
| `device` | `{id, external_id}`: device row id (or `null`) and Shelly ID at capture |
| `name` | Backup name |
| `shellyID` | Deprecated copy of `device.external_id` |
| `deviceName` | Device name at capture, or the Shelly ID |
| `model`, `app`, `fwVersion` | From the device info (`model`, `app`, `ver`) |
| `createdAt` | Epoch milliseconds |
| `createdDateKey` | `YYYY-MM-DD` (UTC) |
| `fileSize` | Bytes |
| `contents` | All seven content keys as booleans, as the device reported |
| `contentsSummary` | Enabled keys joined by a comma and a space, or `base config only` |
| `groupIds`, `groupNames` | Group snapshot; currently empty for new backups |
| `source` | `device` or `imported`; missing on old records, read as `device` |
| `metadata` | Extra details, see below |

`metadata` on a device backup holds `device_name`, `group_ids`,
`group_names`, `requested_contents`, `actual_contents` and
`content_selection_honored`. On a mismatch it adds `selection_warning` and
`mismatched_keys`. An imported backup holds `device_name`, `source`,
`actual_contents` and, if known, `original_file_name`.

Example:

```json
{
  "id": "1739356800000-a1b2c3d4e5f6",
  "organizationId": "org-1",
  "device": {"id": 42, "external_id": "shellyplus1pm-aabbccddeeff"},
  "name": "Living Room Switch-shellyplus1pm-aabbccddeeff-2025-02-12",
  "shellyID": "shellyplus1pm-aabbccddeeff",
  "deviceName": "Living Room Switch",
  "model": "SNSW-001P16EU",
  "app": "Plus1PM",
  "fwVersion": "1.5.0",
  "createdAt": 1739356800000,
  "createdDateKey": "2025-02-12",
  "fileSize": 2048,
  "contents": {
    "ble_bondings": false,
    "dynamic_components": false,
    "persistent_counters": false,
    "schedules": true,
    "scripts": true,
    "webhooks": false,
    "matter_storage": false
  },
  "contentsSummary": "schedules, scripts",
  "groupIds": [],
  "groupNames": [],
  "source": "device",
  "metadata": {
    "device_name": "Living Room Switch",
    "group_ids": [],
    "group_names": [],
    "requested_contents": "schedules, scripts",
    "actual_contents": "schedules, scripts",
    "content_selection_honored": "yes"
  }
}
```

## Content keys

Fleet knows seven optional sections (`BACKUP_CONTENT_KEYS` in
`backupArchive.ts`). The UI labels come from
`frontend/src/helpers/backupContents.ts`.

| Key | UI label |
| --- | -------- |
| `ble_bondings` | BLE pairings |
| `dynamic_components` | Virtual & BTHome components |
| `persistent_counters` | Persistent counters |
| `schedules` | Schedules |
| `scripts` | Scripts |
| `webhooks` | Actions |
| `matter_storage` | Matter configuration |

## Backend RPC methods

Call them as `ws.sendRPC('FLEET_MANAGER', 'Backup.<Method>', params)`.
Permissions are from `backend/src/types/api/backup.ts` and the decorators in
`BackupComponent.ts`. Methods that take a backup `id` also check the caller's
access to that backup's device and organization, and answer `NotFound` when
it is denied.

| Method | Permission | Params | Returns | Notes |
| ------ | ---------- | ------ | ------- | ----- |
| `Backup.Describe` | none | none | Describe output | Method catalog |
| `Backup.List` | `devices:read` | `{shellyID?, limit?, offset?}` | `{items, total, limit, offset, has_more}` | Shows only backups the caller can see. `limit` is capped at 500; `0` or no value means 500 |
| `Backup.Get` | `devices:read` | `{id}` | `BackupMetadata \| null` | `null` when no backup has that id |
| `Backup.StartDownloadJob` | `devices:update` on every device | `{shellyIDs, name?, contents?, idempotencyKey?}` | `{jobId}` | 1 to 500 devices. Used by the UI |
| `Backup.StartRestoreJob` | `devices:update` on the target, read on the backup | `{id, shellyID, restore?, idempotencyKey?}` | `{jobId}` | Used by the UI |
| `Backup.Rename` | `devices:update` | `{id, name}` | `BackupMetadata` with optional `replacedBackupId` | Replaces other backups with the same name |
| `Backup.Delete` | `devices:delete` | `{id}` | `{success: true}` | Deletes file and record |
| `Backup.GetFile` | `devices:read` | `{id}` | `{data, name, size}` | Base64 file, 50 MB cap |
| `Backup.DownloadFromDevice` | `devices:update` on `shellyID` | `{shellyID, name?, contents?}` | `BackupMetadata` with optional `replacedBackupId` | Older direct method. Runs the create steps inside the call. The UI does not use it |
| `Backup.RestoreToDevice` | `devices:update` on `shellyID`, read on the backup | `{id, shellyID, restore?}` | `{success: true}` | Older direct method. Runs the restore steps inside the call. The UI does not use it |

The component also has the inherited `Backup.ListMethods`, plus config
methods that exist only in dev mode. It has no `Backup.SetConfig`, because it
is registered with `set_config_methods: false`.

Param limits: `id` is 1 to 128 characters of letters, digits, `_`, `.` and
`-`. `name` is 1 to 200 characters. `idempotencyKey` is 8 to 128 characters.
`contents` and `restore` are maps of content key to boolean.

## Shelly device RPCs used

The public Shelly API docs say the Sys component supports backing up and
restoring device settings. They do not document `Sys.CreateBackup`,
`Sys.DownloadBackup`, `Sys.RestoreBackup` or a `backup` status property. The
descriptions below show only how Fleet calls these RPCs and what it reads
back.

### Sys.CreateBackup

Params: the seven content keys as booleans. The device reboots. Fleet does not
use the response.

### Sys.DownloadBackup

Request: `{offset, len}`. Response: `{data, left}`, where `data` is base64.
Fleet repeats the call, moving `offset` forward by the decoded size, until
`left` is `0`.

### Sys.RestoreBackup

Request: `{offset, data}`, where `data` is base64 of up to 1026 bytes. The last
call adds `final: true` and, when a filter was chosen, `restore` with the
enabled content keys. The device reboots after the last call.

### Sys.GetStatus (backup property)

Fleet reads `backup` from the `Sys.GetStatus` result, or `sys.backup` from a
full status:

- `created`: a number; Fleet waits for a value newer than before.
- `contents`: map of content key to boolean.
- `error`: when present, the backup failed.

```json
{
  "backup": {
    "created": 1758267551,
    "contents": {"schedules": true, "scripts": true}
  }
}
```

## File locations

| File | Purpose |
| ---- | ------- |
| `backend/src/model/component/BackupComponent.ts` | Backup RPC methods, create and restore steps, storage |
| `backend/src/types/api/backup.ts` | Param and response schemas, Describe permissions |
| `backend/src/modules/backup/jobWorker.ts` | Background worker for backup jobs |
| `backend/src/modules/backup/backupArchive.ts` | Import validation and content keys |
| `backend/src/modules/web/routes/backupImport.ts` | `POST /media/importBackup` |
| `backend/src/model/deviceCapabilities.ts` | `capabilities.backup` and `capabilities.restore` |
| `backend/src/config/tuning.ts` | `backup.*` tunables |
| `frontend/src/pages/operations/backups.vue` | Backups page |
| `frontend/src/pages/operations.vue` | Operations tabs |
| `frontend/src/stores/backups.ts` | Backups store |
| `frontend/src/components/backups/` | Detail, rename and import dialogs |
| `frontend/src/helpers/backupContents.ts` | Content keys and labels |
| `frontend/src/composables/useDeviceSelection.ts` | Device selection rules |
