<!-- audience: public -->
# Naming conventions

Stable, searchable ids make the model legible to humans, code, and AI agents.
One rule governs all of them.

## The rule: bare id stored, qualified id referenced

An entry's **own `id` is a bare slug** (`^[a-z][a-z0-9_]*$`): e.g. a kind is
`solar_array`, a component is `em`. The slug is what lives in its catalog.

When you **reference that entry from another axis**, qualify it with its
namespace prefix so the reference is unambiguous on its own.

| Prefix | Scope | Bare id in catalog | Reference form |
|--------|-------|--------------------|----------------|
| `kind:` | kind catalog entries | `solar_array` | `kind:solar_array` |
| `component:` | component catalog entries | `em` | `component:em` |
| `metric:` | measurement names | `energy_kwh` | `metric:energy_kwh` |
| `serves:` | relationship verbs | n/a | `serves:powers` |
| `tag:` | reserved tag keys | `critical` | `tag:critical` |

`serves:` verbs and `tag:` keys are only ever used in reference form, so their
schema patterns include the prefix.

## Why bare-then-qualified

The existing 239-entry kind catalog already stores bare slugs and is validated
in CI against `catalog-entry.json`. Requiring a stored `kind:` prefix would
break every entry for no gain. Qualifying only at the reference site keeps the
catalog clean and the cross-axis references self-describing.

## Custom org additions

Customer-created kinds are namespaced per org to avoid collisions:

```
org_<uuid>:<slug>
```

> Example: `org_3f2a…:rooftop_array`. Uniqueness is enforced per org (Phase 4).

## Enforcement

The reference patterns above are enforced by the schemas in
`backend/src/types/api/_schemas/` and validated with the repo's `validateParams`
(the single validator used across the API). No second engine.
