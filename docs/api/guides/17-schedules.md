## Schedules and scripts

Both schedules and scripts run **on the Shelly device itself**, not in Fleet
Manager. Fleet Manager relays the device's own namespaces so you manage them
fleet-wide through the same API.

### Schedules (`schedule` namespace)

A schedule is a cron-style job stored on the device. Each job is
`{ id, enable, timespec, calls }`:

- `timespec` is a 6-field cron string — `SEC MIN HOUR MDAY MON DOW`
  (e.g. `"0 0 8 * * MON,TUE,WED"` for 08:00 on weekdays).
- `calls` is a list of device RPC calls (`{ method, params }`) to run when the
  job fires — 1 to 20 per job.

Methods: `Schedule.List`, `Schedule.Create` (returns the device-assigned `id`),
`Schedule.Update`, `Schedule.Delete`, `Schedule.DeleteAll`. Creating or changing
a job requires permission to control the device.

### Scripts (`script` namespace)

Scripts are mJS programs that run on Gen2+ devices. You manage the slot and its
code, then start and stop it:

- Lifecycle — `Script.List`, `Script.Create` (returns `id`), `Script.Delete`,
  `Script.GetConfig`/`SetConfig`, `Script.GetStatus`.
- Code — `Script.GetCode` and `Script.PutCode` transfer source in chunks (by
  `offset`; `PutCode` with `append: false` truncates first).
- Run — `Script.Start`, `Script.Stop`, and `Script.Eval` to evaluate code in a
  running script's context.

Because the code executes on the device, its capabilities and limits are the
device's, not Fleet Manager's.
