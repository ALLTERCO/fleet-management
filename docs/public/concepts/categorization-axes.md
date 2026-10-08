<!-- audience: public -->
# Categorization axes: `device.list.kind`, `device.assetRole`, `group.groupType`, `group.kind`

FM has **four orthogonal categorization axes**. They look similar and
get confused. None replaces another. Each lives on a different row,
answers a different question, has a different SoT and consumer.

**Read this before touching anything that looks like a "type", "role",
"kind", or "category" on a device or a group.**

---

## The four axes

| # | Field | Per | TS source of truth | DB column | Range | Question it answers |
|---|---|---|---|---|---|---|
| 1 | `device.list.kind` | device | `backend/src/model/AbstractDevice.ts` + `backend/src/model/deviceListEntry.ts` | `device.list.kind` | `physical` · `bluetooth` · `extracted` · `composed` · `connector` *(5)* | What **shape** of device entity is this? |
| 2 | `device.assetRole` | device | `backend/src/types/api/assetRole.ts` (`ASSET_ROLES`) | `device.asset_role.asset_role` | `service_entrance` · `submeter` · `solar_pv` · `battery_bess` · `ev_charger` · `hvac` · `lighting` · `tenant` · `transformer` · `general` *(10)* | What **energy role** does the device play? |
| 3 | `group.groupType` | group | `backend/src/types/api/group.ts` (`GROUP_TYPES`) | `organization.groups.group_type` | `standard` · `operational` · `critical` · `custom` *(4)* | What **alerting + retention tier** is this group in? |
| 4 | `group.kind` | group | `backend/src/config/groupKindCatalog.ts` (`GROUP_KIND_CATALOG`) | `organization.groups.kind` (FK → `organization.group_kind.id`) | 239 entries / 41 categories: `manual`, `circuit`, `panel`, `solar_panel`, `datacenter`, … | What does the group **represent** in the real world? Also picks the metadata schema. |

---

## DO NOT confuse them

### `device.assetRole` ≠ `group.kind`
- `assetRole` is **per-device**, energy/electrical, **10 fixed values**, consumer = `ReportComponent` (main-meter resolution, solar/storage rollups).
- `group.kind` is **per-group**, semantic / structural, **239 catalog values**, consumer = `GroupComponent` (validation + dropdown UI).
- A device with `assetRole: 'hvac'` can belong to a group with `kind: 'circuit'`: both true, both needed, neither redundant.

### `group.groupType` ≠ `group.kind`
- `groupType` is the **policy tier** (4 values, controls alerting + retention defaults).
- `kind` is the **semantic class** (239 values, controls what the group represents + its metadata schema).
- Same `kind` legitimately sits in any `groupType`.

### `device.list.kind` ≠ `group.kind`
- Both happen to be named `kind`. They live on different tables.
- `device.list.kind` ∈ 5 values about device-entity shape.
- `group.kind` ∈ 239 catalog values about what a group represents.
- `WHERE kind = 'circuit'` only makes sense on `organization.groups`.

---

## Reserved cross-cutting key: `group.metadata.policy`

`metadata.policy.{severityFloor, retentionDays, auditRetentionDays}` is
**valid on any kind**. The validator
(`backend/src/modules/groupKindValidator.ts`) strips `policy` off
**before** checking the kind's schema. Don't put `policy` into a kind's
`properties`: that would force every kind to opt in to a system field.

DB CHECK constraints in `6085_groups_policy_metadata_check.sql` +
`6090_groups_policy_audit_retention_check.sql` enforce the values
server-side independently of the app validator.

---

## `manual` kind is permissive: do not change

Every pre-existing group has `kind = 'manual'` (column default applied
by migration `6582_group_kind.sql`). Their metadata may contain
arbitrary legacy fields.

`manual` uses `SCHEMA_PERMISSIVE` (`additionalProperties: true`).
Typed kinds (everything else) use strict schemas
(`additionalProperties: false`).

Pinned by a regression test in `backend/test/groupKindCatalog.test.ts`
("`manual` is permissive: legacy / freeform metadata is allowed").
Don't break the test by flipping `manual` to strict.

---

## Quick decision flow

When you see "type", "kind", "role", "category" in a request:

1. **What's the noun?** `device` or `group`?
2. **Is it semantic** (what the thing IS) or **policy** (how the thing is HANDLED)?
3. **Are the candidate values bounded** (small enum) or **catalog-driven** (hundreds)?

Map to:

- device + shape + 5 enums → **`device.list.kind`**
- device + energy-role + 10 enums → **`device.assetRole`**
- group + alerting-tier + 4 enums → **`group.groupType`**
- group + semantic + 239 catalog → **`group.kind`**

If it fits none, **ask the human** before inventing a fifth axis.

---

## Worked example: "Floor 3 HVAC" group with 4 rooftop units

| Axis | Value here | Why |
|---|---|---|
| `device.list.kind` (per device) | `physical` × 4 | All four units are real Shelly hardware on the network. |
| `device.assetRole` (per device) | `hvac` × 4 | They drive heating/cooling loads: reports treat them as HVAC consumption. |
| `group.groupType` | `operational` | Failures need alerts within hours, retain 365d. |
| `group.kind` | `circuit` | The group represents one electrical circuit serving floor 3. Metadata schema lets us record voltage, breaker rating, panel ref. |

Drop any one and you lose information that matters somewhere: reports
lose the "HVAC consumption" rollup (assetRole), alerting loses the
policy tier (groupType), the dropdown / dashboards lose the kind-specific
UI, the read path loses device-shape distinctions (physical vs. virtual).

---

## Common confusion points

**"Aren't `assetRole` and `kind` the same?"** No: device-energy vs. group-structure.

**"Aren't `groupType` and `kind` the same?"** No: policy tier vs. semantic class.

**"Should I move legacy `metadata` into the catalog schema?"** Not for
existing `manual` groups: that schema is permissive on purpose. For
new groups whose meaning is captured by a typed kind, yes: pick the
kind, fill the structured fields.

**"Where does `metadata.policy.*` fit?"** Reserved cross-cutting key
independent of kind. Lets a group override env-derived `groupType`
defaults without changing tier.

---

## Code consumers

- **`device.list.kind`**: `AbstractDevice.toListJSON`,
  `deviceListEntry.ts`, `virtualDeviceToListJSON`: gates the
  serialization shape per device.
- **`device.assetRole`**: `ReportComponent`
  (`backend/src/model/component/ReportComponent.ts`, main-meter +
  classification logic), operator energy-classification UI.
- **`group.groupType`**: `groupPolicy.ts`, alerting engine, retention
  sweeper, audit retention. Resolves env-default policy.
- **`group.kind`**: `GroupComponent.create/update/get/list`,
  `groupKindValidator.ts`, `Group.Kind.List` / `Group.Kind.Get` RPC.

---

## Grep cheatsheet

| Looking for | Run |
|---|---|
| All assetRole values | `grep -n "ASSET_ROLES" backend/src/types/api/assetRole.ts` |
| All groupType values | `grep -n "GROUP_TYPES" backend/src/types/api/group.ts` |
| All catalog `kind` entries | `grep -nE "^    \{$\|id:" backend/src/config/groupKindCatalog.ts` |

---

## Migration history (context: do NOT cite in code comments)

- `6572_asset_role.sql`: `device.asset_role` table + CHECK constraint
- `2005_groups.sql`: `groupType` CHECK constraint
- `6582_group_kind.sql`: `kind` column + FK + bootstrap `manual` row
- `6583_fn_group_kind_param.sql`: threads `kind` through
  `fn_group_create` / `fn_group_update` / `fn_group_get` / `fn_group_list`

---

## Related docs

- [energy-and-reports.md](../architecture/energy-and-reports.md): how `assetRole` flows into reports
