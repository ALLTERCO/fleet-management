// Column model for the shared SlowOpsPanel — one home for the table contract
// so every slow-* panel is just a title + RPC method + column list.

export type SlowOpsRow = Record<string, unknown>;

export interface SlowOpsColumn {
    label: string;
    cellClass?: string;
    value: (entry: SlowOpsRow) => string | number;
    // Optional per-row class (e.g. highlight a dropped action).
    rowClass?: (entry: SlowOpsRow) => string | undefined;
}
