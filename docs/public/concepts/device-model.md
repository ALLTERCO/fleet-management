<!-- audience: public -->
# Device model

Fleet Manager classifies every device and group on four independent axes,
plus two derived concepts. Each answers one question. Pick the axis by the
question you are answering: never force one axis to do another's job.

| Concept | Question it answers | Cardinality |
|---------|---------------------|-------------|
| Location | Where is it physically? | one per device |
| Kind | What is it? | one per device/group |
| Tag | What labels apply? | many per subject |
| Group | What collection is it in? | many memberships |
| Component | What can the hardware do? | auto-discovered |
| Serves | What does it serve? | many relations |

## Location: physical "where"

A tree of places, such as site → building → floor → room. There are 14
location types, but they are not 14 required levels: each type lists which
types it may sit inside, and you create only the levels you need. A device
has one location assignment. See
[Organize equipment across premises](../product-guide/organize-equipment.md).

> Example: meter `shelly-em-7` is in `Sofia HQ → Floor 2 → Server Room`.

## Kind: what the thing IS

A single value from the kind catalog (`groupKindCatalog.ts`, customer-extensible
per org). A device has one kind; a group has one kind from the same catalog.
Device catalog kind is stored on `device.list.catalog_kind`; group catalog kind
is stored on `organization.groups.kind`.

Do not confuse device catalog kind with `device.list.kind`. That column is the
structural identity class used by the backend (`physical`, `bluetooth`,
`extracted`, `composed`, `connector`).

> Example: `shelly-em-7` has kind `submeter`; the group "Rack A feeds" has kind
> `circuit`.

## Tag: free-form label

Many per subject, polymorphic across devices, locations, groups, entities.
Stored in `tag_assignments`. Use for cross-cutting filters that are not "what
it is".

> Example: `shelly-em-7` is tagged `critical` and `under-warranty`.

## Group: collection membership

A named collection a device belongs to. The group itself carries a kind from
the catalog, so a group is also classifiable.

> Example: group "HVAC" (kind `hvac_zone`) contains the three rooftop units.

## Component: auto-discovered capability

A hardware-level capability reported by the Shelly device over RPC (`switch`,
`em`, `cover`, `light`). Nobody edits these: they are discovered. The
component catalog (`componentCatalog.ts`, Phase 2) maps each to the metrics it
exposes.

> Example: `shelly-em-7` reports an `em` component exposing `metric:energy_kwh`
> and `metric:power_w`.

## Serves: functional relationship

An independent graph edge: subject *serves* object. Distinct from Component
(hardware composition) and from Group (membership).

> Example: chiller `chiller-1` *serves* floors 2–5; shared meter `meter-3`
> *serves* tenants A, B and C.

## See also

- [naming-conventions.md](naming-conventions.md): id prefixes and the
  bare-id vs. qualified-reference rule
- [well-known-tags.md](well-known-tags.md): reserved tag keys
