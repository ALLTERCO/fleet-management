// Shared constants for fleet-wide component coverage. Lives in its own
// file so EntityComposer and componentCoverage can both consume the name
// without forming a circular import.

// Bare name — Observability prepends `fm_` when exporting to Prometheus.
export const UNKNOWN_COMPONENT_TYPE_COUNTER = 'unknown_component_types_seen';
