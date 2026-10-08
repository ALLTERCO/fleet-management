<!-- audience: public -->
# Well-known tag keys

Tags are free-form, but a few keys are **reserved** for cross-cutting filters so
they mean the same thing everywhere. Reserved keys are referenced as
`tag:<key>` (see [naming-conventions.md](naming-conventions.md)).

These are reserved now and surfaced by the picker (Phase 5). Reports do not key
off them yet: that stays an explicit, opt-in decision per phase.

| Key | Meaning |
|-----|---------|
| `critical` | Loss of this device/load is operationally significant. |
| `under-warranty` | Still covered by manufacturer/vendor warranty. |
| `submetered` | Measured by a downstream submeter, not the service entrance. |
| `tenant-billable` | Consumption is rebilled to a tenant. |
| `backup-powered` | On a UPS / generator / battery backup circuit. |
| `demand-response` | Enrolled in a utility demand-response program. |

## Rules

- A reserved key keeps its meaning across every subject type (device, location,
  group, entity).
- Free-form tags must not shadow a reserved key with a different meaning.
  Use honest names only.
- Adding a reserved key is a documented change here plus the picker's suggested
  list; one source of truth, no scattered literals.
