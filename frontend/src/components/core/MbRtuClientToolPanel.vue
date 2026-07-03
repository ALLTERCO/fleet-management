<template>
    <div class="cfg-panel">
        <div class="cfg-panel__row">
            <div class="cfg-panel__row-label">
                <strong>Operation</strong>
            </div>
            <Dropdown
                :default="form.operation"
                :options="OPERATION_LABELS"
                @selected="onOperationSelect"
            />
        </div>

        <div class="cfg-panel__row">
            <div class="cfg-panel__row-label">
                <strong>Slave id</strong>
            </div>
            <input
                v-model.number="form.sid"
                type="number"
                min="1"
                max="247"
                class="cfg-panel__input"
            />
        </div>

        <div class="cfg-panel__row">
            <div class="cfg-panel__row-label">
                <strong>Start address</strong>
            </div>
            <input
                v-model.number="form.addr"
                type="number"
                min="0"
                max="65535"
                class="cfg-panel__input"
            />
        </div>

        <div v-if="currentOp?.kind === 'read'" class="cfg-panel__row">
            <div class="cfg-panel__row-label">
                <strong>Quantity</strong>
            </div>
            <input
                v-model.number="form.qty"
                type="number"
                min="1"
                :max="currentOp.qtyMax"
                class="cfg-panel__input"
            />
        </div>

        <div v-if="currentOp?.kind === 'writeRegs'" class="cfg-panel__row">
            <div class="cfg-panel__row-label">
                <strong>Values</strong>
            </div>
            <input
                v-model="form.valuesText"
                type="text"
                placeholder="100, 200, 300"
                class="cfg-panel__input"
            />
        </div>

        <div v-if="currentOp?.kind === 'writeSingle'" class="cfg-panel__row">
            <div class="cfg-panel__row-label">
                <strong>Value</strong>
            </div>
            <input
                v-model.number="form.singleValue"
                type="number"
                min="0"
                max="65535"
                class="cfg-panel__input"
            />
        </div>

        <div v-if="currentOp?.kind === 'writeCoils'" class="cfg-panel__row">
            <div class="cfg-panel__row-label">
                <strong>Coil values</strong>
            </div>
            <input
                v-model="form.coilsText"
                type="text"
                placeholder="true, false, 1, 0"
                class="cfg-panel__input"
            />
        </div>

        <div class="cfg-panel__footer">
            <Button type="blue" size="sm" :loading="executing" @click="execute">
                Execute
            </Button>
        </div>

        <div
            v-if="resultError"
            class="cfg-panel__notice cfg-panel__notice--error"
        >
            <i class="fas fa-triangle-exclamation" /> {{ resultError }}
        </div>

        <pre v-else-if="result" class="mbrtu-result">{{ resultDisplay }}</pre>
    </div>
</template>

<script setup lang="ts">
import {computed, reactive, ref} from 'vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import Button from './Button.vue';
import Dropdown from './Dropdown.vue';

type OpDef =
    | {
          kind: 'read';
          method: string;
          label: string;
          qtyMax: number;
      }
    | {
          kind: 'writeRegs';
          method: string;
          label: string;
      }
    | {
          kind: 'writeSingle';
          method: string;
          label: string;
      }
    | {
          kind: 'writeCoils';
          method: string;
          label: string;
      };

const OPERATIONS: Record<string, OpDef> = {
    'Read Holding Registers (FC 0x03)': {
        kind: 'read',
        method: 'MbRtuClient.ReadHoldingRegisters',
        label: 'Read Holding Registers (FC 0x03)',
        qtyMax: 123
    },
    'Read Input Registers (FC 0x04)': {
        kind: 'read',
        method: 'MbRtuClient.ReadInputRegisters',
        label: 'Read Input Registers (FC 0x04)',
        qtyMax: 123
    },
    'Read Discrete Inputs (FC 0x02)': {
        kind: 'read',
        method: 'MbRtuClient.ReadDiscreteInputs',
        label: 'Read Discrete Inputs (FC 0x02)',
        qtyMax: 2000
    },
    'Read Coils (FC 0x01)': {
        kind: 'read',
        method: 'MbRtuClient.ReadCoils',
        label: 'Read Coils (FC 0x01)',
        qtyMax: 2000
    },
    'Write Holding Registers (FC 0x10)': {
        kind: 'writeRegs',
        method: 'MbRtuClient.WriteHoldingRegisters',
        label: 'Write Holding Registers (FC 0x10)'
    },
    'Write Single Register (FC 0x06)': {
        kind: 'writeSingle',
        method: 'MbRtuClient.WriteSingleRegister',
        label: 'Write Single Register (FC 0x06)'
    },
    'Write Coils (FC 0x0F)': {
        kind: 'writeCoils',
        method: 'MbRtuClient.WriteCoils',
        label: 'Write Coils (FC 0x0F)'
    }
};
const OPERATION_LABELS = Object.keys(OPERATIONS);

const REG_MIN = 0;
const REG_MAX = 65535;
const COIL_MIN_ITEMS = 1;
const COIL_MAX_ITEMS = 2000;
const REG_MAX_ITEMS = 123;

const props = defineProps<{shellyID: string}>();
const toast = useToastStore();

const form = reactive({
    operation: OPERATION_LABELS[0],
    sid: 1,
    addr: 0,
    qty: 1,
    valuesText: '',
    singleValue: 0,
    coilsText: ''
});

const currentOp = computed<OpDef | undefined>(() => OPERATIONS[form.operation]);
const executing = ref(false);
const result = ref<unknown>(null);
const resultError = ref<string | null>(null);

const resultDisplay = computed(() =>
    result.value == null ? '' : JSON.stringify(result.value, null, 2)
);

function onOperationSelect(label: string): void {
    form.operation = label;
    result.value = null;
    resultError.value = null;
}

function decodeNumeric(s: string): number {
    const trimmed = s.trim();
    if (!trimmed) throw new Error('Empty value');
    // Reject hex literals to avoid silent base confusion.
    if (/^0x/i.test(trimmed)) {
        throw new Error(`Hex literal "${trimmed}" not allowed; use decimal`);
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
        throw new Error(`Not an integer: "${trimmed}"`);
    }
    return n;
}

function parseIntList(text: string, bounds: {min: number; max: number}): number[] {
    return text
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => {
            const n = decodeNumeric(s);
            if (n < bounds.min || n > bounds.max) {
                throw new Error(
                    `Value ${n} out of range; expected ${bounds.min}..${bounds.max}`
                );
            }
            return n;
        });
}

function parseBoolList(text: string): boolean[] {
    return text
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0)
        .map((s) => {
            if (s === 'true' || s === '1') return true;
            if (s === 'false' || s === '0') return false;
            throw new Error(`Not a boolean: "${s}"`);
        });
}

function ensureFiniteInt(value: number, label: string): number {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
        throw new Error(`${label} must be a whole number`);
    }
    return value;
}

async function execute(): Promise<void> {
    executing.value = true;
    result.value = null;
    resultError.value = null;
    try {
        const op = currentOp.value;
        if (!op) throw new Error('No operation selected');

        ensureFiniteInt(form.sid, 'Slave id');
        if (form.sid < 1 || form.sid > 247) {
            throw new Error('Slave id must be 1..247');
        }
        ensureFiniteInt(form.addr, 'Start address');
        if (form.addr < 0 || form.addr > 65535) {
            throw new Error('Start address must be 0..65535');
        }

        const base = {
            shellyID: props.shellyID,
            id: 0,
            sid: form.sid,
            addr: form.addr
        };

        if (op.kind === 'read') {
            ensureFiniteInt(form.qty, 'Quantity');
            if (form.qty < 1 || form.qty > op.qtyMax) {
                throw new Error(`Quantity must be 1..${op.qtyMax}`);
            }
            result.value = await sendRPC<unknown>('FLEET_MANAGER', op.method, {
                ...base,
                qty: form.qty
            });
        } else if (op.kind === 'writeRegs') {
            const values = parseIntList(form.valuesText, {
                min: REG_MIN,
                max: REG_MAX
            });
            if (values.length < 1 || values.length > REG_MAX_ITEMS) {
                throw new Error(`Provide 1..${REG_MAX_ITEMS} values`);
            }
            await sendRPC('FLEET_MANAGER', op.method, {...base, values});
            toast.success(`Wrote ${values.length} register(s)`);
        } else if (op.kind === 'writeSingle') {
            ensureFiniteInt(form.singleValue, 'Value');
            if (form.singleValue < REG_MIN || form.singleValue > REG_MAX) {
                throw new Error(`Value must be ${REG_MIN}..${REG_MAX}`);
            }
            await sendRPC('FLEET_MANAGER', op.method, {
                ...base,
                value: form.singleValue
            });
            toast.success('Register written');
        } else {
            // writeCoils
            const values = parseBoolList(form.coilsText);
            if (
                values.length < COIL_MIN_ITEMS ||
                values.length > COIL_MAX_ITEMS
            ) {
                throw new Error(
                    `Provide ${COIL_MIN_ITEMS}..${COIL_MAX_ITEMS} coil values`
                );
            }
            await sendRPC('FLEET_MANAGER', op.method, {...base, values});
            toast.success(`Wrote ${values.length} coil(s)`);
        }
    } catch (err: unknown) {
        resultError.value = rpcErrorMessage(err);
    } finally {
        executing.value = false;
    }
}
</script>

<style scoped>
.mbrtu-result {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-family: var(--font-mono, monospace);
    font-size: var(--type-caption);
    white-space: pre-wrap;
}
</style>
