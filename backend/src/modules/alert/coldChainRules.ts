/**
 * Cold-chain alert rules for refrigerated retail fixtures.
 *
 * One signal — the fixture's air probe — carries three different meanings, and
 * what separates them is height and time, never the reading on its own:
 *
 *   above band, back inside a defrost's length   -> scheduled defrost (info)
 *   above band, outlives any defrost             -> over temperature (warning)
 *   above what a defrost can ever reach, and stays -> malfunction (critical)
 *
 * Every definition below is an ordinary `component_threshold` /
 * `component_state` / `flood_alarm` rule evaluated by the existing engine. No
 * new rule kind is introduced: the layering of threshold height against
 * `forSec` is what makes a defrost distinguishable from a fault.
 */
import type {AlertRuleKind, AlertSeverity} from '../../types/api/alert';

/** Air temperature a chilled multideck display case holds. Australian retail
 *  practice runs chilled display product at 2-4 °C. */
export const DISPLAY_CASE_SETPOINT_C = 3;

/** Frozen storage limit: frozen product must be held at or below -18 °C. */
export const FREEZER_SETPOINT_C = -18;

/** Half-width of the band a healthy fixture cycles through. A thermostat cuts
 *  in and out, so the top of the band — not the setpoint — is the first line
 *  an alert is allowed to draw. */
export const HOLDING_BAND_C = 1;

/** Rise above setpoint a scheduled hot-gas defrost may produce. A defrost is
 *  normal operation and is bounded by the product mass the fixture coasts on;
 *  a fixture above this has stopped defrosting and has lost control. */
export const DEFROST_CEILING_RISE_C = 2;

/** How long a fixture may sit above its band and still be defrosting. Retail
 *  defrosts run about 24 minutes, so 30 covers a whole defrost plus pull-down
 *  and no defrost can ever satisfy a rule that waits this long. */
export const DEFROST_MAX_DURATION_SEC = 1800;

/** How long above band before the excursion is worth reporting at all. Under
 *  this it is thermostat overshoot or one noisy probe sample. */
export const DEFROST_CONFIRM_SEC = 300;

/** How long a fixture door may stand open. A customer reach-in is seconds; two
 *  minutes means the door was left ajar or blocked and the case is dumping its
 *  cold air into the aisle. */
export const DOOR_OPEN_ALERT_SEC = 120;

/** Where a fixture's case air and door state actually arrive.
 *
 *  A relay measures no air and watches no door, so a store puts BLU sensors in
 *  the fixture — a BLU H&T and a BLU Door/Window — and the fixture's own
 *  controller relays them as BTHome components. The component id range is the
 *  durable marker: Shelly firmware reserves [0..99] for a device's own
 *  peripherals and assigns BTHome components from [200..299], so a reading on
 *  these paths came from a paired BLU sensor by construction. A sales-floor
 *  Shelly H&T publishes its own measurement on `temperature:0` and can never
 *  appear here, whatever it reads. That is the marker; the number on the
 *  sensor is not.
 *
 *  Both fixtures pair the same two BLU models in the same order, so both read
 *  the same keys; what separates a case from a freezer is the setpoint it
 *  holds and the catalog kind the store stamps on its controller. */
export interface FixtureSignal {
    component: string;
    field: string;
}

/** BLU H&T temperature object (0x45) — first sensor of the first paired
 *  child. A BTHome sensor reports one reading, in the object's own unit. */
const BLU_AIR_SIGNAL: FixtureSignal = {
    component: 'bthomesensor:201',
    field: 'value'
};

/** BLU Door/Window window object (0x2D), "1 - open, 0 - closed" — first sensor
 *  of the second paired child. */
const BLU_DOOR_SIGNAL: FixtureSignal = {
    component: 'bthomesensor:211',
    field: 'value'
};

/** The value object 0x2D carries while the door stands open. */
export const DOOR_OPEN_VALUE = 1;

export interface ColdChainFixture {
    key: 'display_case' | 'freezer';
    /** Wording an operator reads in the alert. */
    label: string;
    /** `device.list.catalog_kind` the store seed stamps on this fixture. */
    catalogKind: string;
    setpointC: number;
    probe: FixtureSignal;
    door: FixtureSignal;
}

export const COLD_CHAIN_FIXTURES: readonly ColdChainFixture[] = Object.freeze([
    {
        key: 'display_case',
        label: 'Refrigerated display case',
        catalogKind: 'refrigerated_display_case',
        setpointC: DISPLAY_CASE_SETPOINT_C,
        probe: BLU_AIR_SIGNAL,
        door: BLU_DOOR_SIGNAL
    },
    {
        key: 'freezer',
        label: 'Freezer island',
        catalogKind: 'freezer_island',
        setpointC: FREEZER_SETPOINT_C,
        probe: BLU_AIR_SIGNAL,
        door: BLU_DOOR_SIGNAL
    }
]);

/** Top of the band a healthy fixture cycles inside. */
export function holdingCeilingC(fixture: ColdChainFixture): number {
    return fixture.setpointC + HOLDING_BAND_C;
}

/** Highest reading a scheduled defrost can produce on this fixture. */
export function defrostCeilingC(fixture: ColdChainFixture): number {
    return fixture.setpointC + DEFROST_CEILING_RISE_C;
}

/** The case air this device reports, or null when it reports none.
 *
 *  Whether a device is a refrigerated fixture at all is decided here, purely by
 *  which component it publishes on — never by how cold a number looks. A
 *  sales-floor Shelly H&T publishes on `temperature:0` and so is not a
 *  candidate even when it reads below freezing. */
export function coldChainProbeC(
    status: Readonly<Record<string, unknown>>
): number | null {
    for (const fixture of COLD_CHAIN_FIXTURES) {
        const component = status[fixture.probe.component];
        if (!component || typeof component !== 'object') continue;
        const value = (component as Record<string, unknown>)[
            fixture.probe.field
        ];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return null;
}

/** Which class a reading that is ALREADY known to be case air belongs to: the
 *  fixture whose setpoint is nearest. Both fixtures pair the same BLU models,
 *  so the component path cannot separate them; the setpoints sit 21 °C apart
 *  and a defrost lifts a fixture by at most DEFROST_CEILING_RISE_C, so a
 *  defrosting fixture is never read as the other class. */
export function classifyFixture(tC: number): ColdChainFixture {
    let nearest = COLD_CHAIN_FIXTURES[0];
    for (const fixture of COLD_CHAIN_FIXTURES) {
        if (
            Math.abs(tC - fixture.setpointC) < Math.abs(tC - nearest.setpointC)
        ) {
            nearest = fixture;
        }
    }
    return nearest;
}

export type ColdChainRuleKey =
    | 'defrost'
    | 'over_temperature'
    | 'malfunction'
    | 'door_open'
    | 'water_leak';

export interface ColdChainRuleDefinition {
    /** Stable identity for callers and tests; the display name is wording. */
    key: ColdChainRuleKey;
    /** Unique per organization — the seed upserts on it. */
    name: string;
    kind: AlertRuleKind;
    severity: AlertSeverity;
    /** Catalog kind the rule is scoped to, or null for every scoped device. */
    catalogKind: string | null;
    config: Record<string, unknown>;
    summaryTemplate: string;
    messageTemplate: string;
}

/** Above the band for longer than a defrost can last: the fixture is genuinely
 *  over temperature. `clearThreshold` at the setpoint stops it flapping on the
 *  thermostat's own cycle. */
function overTemperatureRule(
    fixture: ColdChainFixture
): ColdChainRuleDefinition {
    return {
        key: 'over_temperature',
        name: `Cold chain · Over temperature · ${fixture.label}`,
        kind: 'component_threshold',
        severity: 'warning',
        catalogKind: fixture.catalogKind,
        config: {
            component: fixture.probe.component,
            field: fixture.probe.field,
            operator: 'gt',
            threshold: holdingCeilingC(fixture),
            clearThreshold: fixture.setpointC,
            forSec: DEFROST_MAX_DURATION_SEC
        },
        summaryTemplate: `${fixture.label} over temperature`,
        messageTemplate:
            `{{context.shellyID}} is at {{context.current}} °C, above its ` +
            `{{context.threshold}} °C limit for longer than a defrost lasts.`
    };
}

/** Above the band, but no claim yet that it is a fault. Info only: a defrost
 *  is scheduled, normal work. It clears itself when the fixture pulls back to
 *  setpoint, which a defrost always does and a fault never does. */
function defrostRule(fixture: ColdChainFixture): ColdChainRuleDefinition {
    return {
        key: 'defrost',
        name: `Cold chain · Defrost in progress · ${fixture.label}`,
        kind: 'component_threshold',
        severity: 'info',
        catalogKind: fixture.catalogKind,
        config: {
            component: fixture.probe.component,
            field: fixture.probe.field,
            operator: 'gt',
            threshold: holdingCeilingC(fixture),
            clearThreshold: fixture.setpointC,
            severity: 'info',
            forSec: DEFROST_CONFIRM_SEC
        },
        summaryTemplate: `${fixture.label} defrosting`,
        messageTemplate:
            `{{context.shellyID}} is at {{context.current}} °C, above its ` +
            `{{context.threshold}} °C band. Normal for a scheduled defrost; ` +
            `it is a fault only if it is still climbing after 30 minutes.`
    };
}

/** Past the highest point a defrost can reach, and still there after longer
 *  than a defrost runs. Critical, and named on the fixture's own controller so
 *  the operator can open that device. */
function malfunctionRule(fixture: ColdChainFixture): ColdChainRuleDefinition {
    return {
        key: 'malfunction',
        name: `Cold chain · Refrigeration malfunction · ${fixture.label}`,
        kind: 'component_threshold',
        severity: 'critical',
        catalogKind: fixture.catalogKind,
        config: {
            component: fixture.probe.component,
            field: fixture.probe.field,
            operator: 'gt',
            threshold: defrostCeilingC(fixture),
            clearThreshold: fixture.setpointC,
            severity: 'critical',
            forSec: DEFROST_MAX_DURATION_SEC
        },
        summaryTemplate: `${fixture.label} not holding temperature`,
        messageTemplate:
            `{{context.shellyID}} is at {{context.current}} °C, past the ` +
            `{{context.threshold}} °C a defrost can reach, and not recovering. ` +
            `Attend the fixture on this controller.`
    };
}

/** The BLU Door/Window on the fixture, reading open past what a customer
 *  reach-in takes. */
function doorOpenRule(fixture: ColdChainFixture): ColdChainRuleDefinition {
    return {
        key: 'door_open',
        name: `Cold chain · Door open too long · ${fixture.label}`,
        kind: 'component_state',
        severity: 'warning',
        catalogKind: fixture.catalogKind,
        config: {
            component: fixture.door.component,
            field: fixture.door.field,
            equals: DOOR_OPEN_VALUE,
            forSec: DOOR_OPEN_ALERT_SEC
        },
        summaryTemplate: `${fixture.label} door left open`,
        messageTemplate:
            `The door on {{context.shellyID}} has been open for over ` +
            `${DOOR_OPEN_ALERT_SEC} seconds.`
    };
}

/** A wet floor under refrigeration is almost always melt water from a fixture
 *  whose drain is blocked, so the alert names the fixture the engine
 *  attributed it to rather than reporting a leak with no owner. */
function waterLeakRule(): ColdChainRuleDefinition {
    return {
        key: 'water_leak',
        name: 'Cold chain · Water leak',
        kind: 'flood_alarm',
        severity: 'critical',
        catalogKind: null,
        config: {},
        summaryTemplate: 'Water leak in the refrigeration area',
        messageTemplate:
            `Water detected by {{context.shellyID}}, most likely melt water ` +
            `from {{context.defrostingApplianceLabel}} ` +
            `({{context.defrostingApplianceShellyID}}) at ` +
            `{{context.defrostingApplianceTempC}} °C. Check the drain on that fixture.`
    };
}

/** Every cold-chain rule, in the order an operator meets them: what is normal,
 *  what is wrong, what is broken, then the two conditions that are neither. */
export function coldChainRuleDefinitions(): ColdChainRuleDefinition[] {
    const rules: ColdChainRuleDefinition[] = [];
    for (const fixture of COLD_CHAIN_FIXTURES) {
        rules.push(defrostRule(fixture));
        rules.push(overTemperatureRule(fixture));
        rules.push(malfunctionRule(fixture));
        rules.push(doorOpenRule(fixture));
    }
    rules.push(waterLeakRule());
    return rules;
}
