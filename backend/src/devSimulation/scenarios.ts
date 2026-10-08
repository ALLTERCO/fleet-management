import {createHash} from 'node:crypto';
import {bthomeObjectInfos} from '../config/BTHomeData';
import {
    DEFAULT_POWER_FACTOR,
    EM_PHASES,
    NOMINAL_VOLTAGE_V,
    neutralCurrent,
    type PhasorReading,
    powerTriangle,
    round
} from './electrical';
import {
    bluChildComponents,
    bthomeDeviceKey,
    bthomeSensorKey
} from './profiles/blu';
import {
    ADDON_COMPONENT_ID_BASE,
    ADDON_TYPE_SENSOR,
    addonInputComponents,
    addonTemperatureComponents,
    mergeComponents,
    type ProfileComponents,
    withComponents
} from './profiles/shared';
import type {
    ColdChainFitment,
    ExpandedDeviceProfile,
    JsonObject,
    PremisesFitment
} from './types';

export type SimulationScenario =
    | 'aussie-grocers'
    | 'oasis'
    | 'berlin-vending'
    | 'blu-alarms';

export const SIMULATION_SCENARIOS: readonly SimulationScenario[] = [
    'aussie-grocers',
    'oasis',
    'berlin-vending',
    'blu-alarms'
];

// ── Aussie Grocers store model ───────────────────────────────────────────
//
// Energy convention: the MAIN METER reads TOTAL SITE LOAD (gross), and the
// PV inverter is a separate producing device. That is the only convention
// consistent with the shared template rules (BM_MAIN_METER_KIND /
// BM_SOURCE_KINDS): a scope's consumption IS its main meter's reading, and a
// source is never consumption — so generation must sit outside the meter, not
// be netted off inside it. Grid import is therefore
// `main meter - solar generation`, and only that derived figure may go
// negative (feed-in); the meter itself never does.
//
// One store's hardware, in the order deploy/seed/aussie-grocers.json lists
// `simulator.profiles`. This list is the single source of the store's size:
// every slot constant below is its position in it and
// `AUSSIE_DEVICES_PER_STORE` is its length, so adding a slot here is the whole
// change on this side. The fixture pins the profile each slot runs and the seed
// pins the catalog kind, both by the same index, and
// deploy/tests/aussie-grocers-profile-acceptance.sh fails if the three drift.
//
// Cold chain: no relay measures air and no relay watches a door, so the store
// fits the sensors itself, and the slots below carry BOTH kits a real chain
// deploys, side by side:
//   * BLU — a battery sensor broadcasting BTHome, relayed by the controller's
//     own gateway. Firmware assigns those components ids in [200..299].
//   * Add-on — a wired probe or dry contact on a Sensor Add-On board. Firmware
//     assigns those components ids in [100..199].
// Both ranges are reserved, so neither can ever be read as one of the device's
// own peripherals at [0..99].
const AUSSIE_SLOT_ORDER = [
    'main-meter', // Pro 3EM — the site intake, reads total store load
    'pv-inverter', // EM Gen4 — rooftop array, generation only
    'display-case', // 1PM Gen4 + BLU H&T + BLU Door/Window
    'freezer-island', // Pro 1PM + BLU H&T + BLU Door/Window
    'climate-sensor', // H&T Gen3 — sales-floor air
    'leak-sensor', // Flood Gen4 — floor beside the case drain
    'presence-sensor', // Presence Gen4 — mmWave zones, after-hours cover
    'sales-floor-lighting', // Pro 2PM contactor + BLU Motion in the aisle
    'hvac', // virtual controller on the plant supply
    'hot-food', // 1PM Mini Gen4 — oven / warmer / air curtain
    'smoke-detector', // Plus Smoke — the only Gen2+ page with a Smoke component
    'signage-lighting', // Dimmer 0/1-10V Gen3 — the fleet's only Light channel
    'dock-door', // Pro 1 + Pro Sensor Add-On dry contact on the dock door
    'walk-in-cooler' // 1PM Gen3 + Sensor Add-On DS18B20 in the cold room
] as const;

type AussieSlotName = (typeof AUSSIE_SLOT_ORDER)[number];

function aussieSlotOf(name: AussieSlotName): number {
    return AUSSIE_SLOT_ORDER.indexOf(name);
}

export const AUSSIE_DEVICES_PER_STORE = AUSSIE_SLOT_ORDER.length;
export const AUSSIE_MAIN_METER_SLOT = aussieSlotOf('main-meter');
export const AUSSIE_SOLAR_SLOT = aussieSlotOf('pv-inverter');
export const AUSSIE_DISPLAY_CASE_SLOT = aussieSlotOf('display-case');
export const AUSSIE_FREEZER_SLOT = aussieSlotOf('freezer-island');
export const AUSSIE_CLIMATE_SLOT = aussieSlotOf('climate-sensor');
export const AUSSIE_LEAK_SLOT = aussieSlotOf('leak-sensor');
export const AUSSIE_LIGHTING_SLOT = aussieSlotOf('sales-floor-lighting');
export const AUSSIE_HVAC_SLOT = aussieSlotOf('hvac');
export const AUSSIE_SMOKE_SLOT = aussieSlotOf('smoke-detector');
export const AUSSIE_SIGNAGE_SLOT = aussieSlotOf('signage-lighting');
export const AUSSIE_DOCK_DOOR_SLOT = aussieSlotOf('dock-door');
export const AUSSIE_WALK_IN_COOLER_SLOT = aussieSlotOf('walk-in-cooler');
const AUSSIE_HOT_FOOD_SLOT = aussieSlotOf('hot-food');

// Rated active power of each SUBMETERED load, W. The sensor slots report no
// power at all, so they are not part of the site total; everything a store
// actually meters is. Lighting and HVAC are usually a grocery store's second
// and third largest loads after refrigeration, and a main meter that skipped
// them would read far under the store it claims to measure.
const AUSSIE_LOAD_RATED_W: Readonly<Record<number, number>> = {
    [AUSSIE_DISPLAY_CASE_SLOT]: 8_000,
    [AUSSIE_FREEZER_SLOT]: 6_500,
    [AUSSIE_LIGHTING_SLOT]: 5_200,
    [AUSSIE_HVAC_SLOT]: 9_000,
    [AUSSIE_HOT_FOOD_SLOT]: 4_500,
    // Illuminated fascia and display accent lighting on a dimmer: small beside
    // the sales floor, and never switched fully off, which is why it is its own
    // circuit rather than part of the contactor above.
    [AUSSIE_SIGNAGE_SLOT]: 900,
    // Walk-in cooler compressor. Smaller than the sales-floor cases it stocks,
    // and it runs on the same ambient-driven duty they do.
    [AUSSIE_WALK_IN_COOLER_SLOT]: 3_200
};

/** Slots whose draw the main meter must add up to, lowest first. */
export const AUSSIE_LOAD_SLOTS: readonly number[] = Object.keys(
    AUSSIE_LOAD_RATED_W
)
    .map(Number)
    .sort((left, right) => left - right);

/** Store counts per city, in fixture order (Melbourne, Sydney, Brisbane). */
const MELBOURNE_STORES = 10;
const SYDNEY_STORES = 9;

/** Eastern-Australia standard time. Daylight saving is out of scope: the demo
 *  needs a stable day/night boundary, not a legal clock. */
const LOCAL_UTC_OFFSET_HOURS = 10;

/** Trading hours; outside them only pilot lights and standby draw. */
const TRADING_OPEN_HOUR = 7;
const TRADING_CLOSE_HOUR = 21;
const TRADING_STANDBY_SHARE = 0.12;

/** AC output the rooftop array reaches at the top of a clear summer day, W.
 *  Deliberately under the store's midday load so grid import stays positive —
 *  a store that exports at noon would make "site load" and "grid import"
 *  indistinguishable in the demo. */
const PV_PEAK_AC_W = 14_000;

/** Fixed, unequal phase split of the site load. Sums to exactly 1; phase C
 *  takes the rounding remainder so a+b+c is the total to the last watt. */
const MAIN_METER_PHASE_SHARES = [0.34, 0.32, 0.34] as const;

export function aussieSlot(deviceIndex: number): number {
    return deviceIndex % AUSSIE_DEVICES_PER_STORE;
}

export function aussieStoreIndex(deviceIndex: number): number {
    return Math.floor(deviceIndex / AUSSIE_DEVICES_PER_STORE);
}

function localDate(ts: number): Date {
    return new Date((ts + LOCAL_UTC_OFFSET_HOURS * 3600) * 1000);
}

/** Local hour with its minutes as a fraction, so a 15-minute history bucket
 *  moves along the curve instead of stepping once an hour. */
function localHourOfDay(ts: number): number {
    const date = localDate(ts);
    return date.getUTCHours() + date.getUTCMinutes() / 60;
}

/** 1 at midsummer (mid-January, southern hemisphere), 0 at midwinter. */
function summerShare(ts: number): number {
    const date = localDate(ts);
    const dayOfYear =
        (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000;
    const MIDSUMMER_DAY = 15;
    return (
        0.5 +
        0.5 * Math.cos(((dayOfYear - MIDSUMMER_DAY) / 365.25) * 2 * Math.PI)
    );
}

/** Climate baseline of the store's city — Brisbane runs its refrigeration and
 *  HVAC hardest, Melbourne least. */
function storeCityLoadFactor(storeIndex: number): number {
    if (storeIndex < MELBOURNE_STORES) return 0.94;
    if (storeIndex < MELBOURNE_STORES + SYDNEY_STORES) return 1.08;
    return 1.26;
}

/** Same three cities ranked by irradiance instead of cooling demand. */
function storeCitySolarFactor(storeIndex: number): number {
    if (storeIndex < MELBOURNE_STORES) return 0.92;
    if (storeIndex < MELBOURNE_STORES + SYDNEY_STORES) return 1.05;
    return 1.15;
}

export type StoreClimate = 'cool-temperate' | 'humid-subtropical' | 'tropical';

/** The store's climate, read off the same city boundaries this file already
 *  uses for load and solar. It is not a new mapping: `cities[*].climate` in
 *  deploy/seed/aussie-grocers.json states it (Melbourne cool-temperate, Sydney
 *  humid subtropical, Brisbane tropical/subtropical) and the fixture is the
 *  authority — the boundaries are only how a device index finds its city. */
export function storeClimate(storeIndex: number): StoreClimate {
    if (storeIndex < MELBOURNE_STORES) return 'cool-temperate';
    if (storeIndex < MELBOURNE_STORES + SYDNEY_STORES) {
        return 'humid-subtropical';
    }
    return 'tropical';
}

/** Deterministic store-to-store spread — no randomness, so a re-run of the
 *  history generator reproduces the same bytes. */
function storeSpread(storeIndex: number, amplitude: number): number {
    return 1 - amplitude + ((storeIndex % 7) / 6) * 2 * amplitude;
}

/** Compressor duty tracks ambient: coolest around 05:00, hottest around 15:00,
 *  and higher through summer. */
function refrigerationShape(ts: number): number {
    const hour = localHourOfDay(ts);
    const diurnal = 1 + 0.18 * Math.cos(((hour - 15) / 24) * 2 * Math.PI);
    const seasonal = 0.85 + 0.3 * summerShare(ts);
    return diurnal * seasonal;
}

/** Hot food, ovens and signage follow the shop's own hours. */
function tradingShape(_storeIndex: number, ts: number): number {
    const hour = localHourOfDay(ts);
    if (hour < TRADING_OPEN_HOUR || hour >= TRADING_CLOSE_HOUR) {
        return TRADING_STANDBY_SHARE;
    }
    const share =
        (hour - TRADING_OPEN_HOUR) / (TRADING_CLOSE_HOUR - TRADING_OPEN_HOUR);
    // Bake-off in the morning, hot food again before the evening rush.
    return 0.8 + 0.35 * Math.sin(share * 2 * Math.PI);
}

/** Sales-floor lighting comes up before the doors open and goes down after the
 *  last customer leaves; overnight only the security and case lighting stay
 *  on. Nothing here follows daylight — a supermarket sales floor is lit to a
 *  fixed level whatever the sun is doing. */
const LIGHTING_PREOPEN_HOURS = 1;
const LIGHTING_POSTCLOSE_HOURS = 1;
const LIGHTING_OVERNIGHT_SHARE = 0.18;

function lightingShape(_storeIndex: number, ts: number): number {
    const hour = localHourOfDay(ts);
    const lit =
        hour >= TRADING_OPEN_HOUR - LIGHTING_PREOPEN_HOURS &&
        hour < TRADING_CLOSE_HOUR + LIGHTING_POSTCLOSE_HOURS;
    return lit ? 1 : LIGHTING_OVERNIGHT_SHARE;
}

/** Share of HVAC rated power each climate draws at midsummer and at midwinter.
 *  Melbourne's peak is the winter heating season, Sydney's is the summer
 *  cooling season, and Brisbane's plant runs hard all year — which is exactly
 *  what the fixture's own `loadProfile` per city says. */
const HVAC_SEASON_SHARE: Readonly<
    Record<StoreClimate, {summer: number; winter: number}>
> = {
    'cool-temperate': {summer: 0.45, winter: 0.95},
    'humid-subtropical': {summer: 0.95, winter: 0.4},
    tropical: {summer: 1, winter: 0.8}
};

/** Plant starts before the doors open so the floor is at temperature, and is
 *  set back rather than switched off overnight. */
const HVAC_PRECOOL_HOURS = 2;
const HVAC_SETBACK_SHARE = 0.35;

function hvacShape(storeIndex: number, ts: number): number {
    const season = HVAC_SEASON_SHARE[storeClimate(storeIndex)];
    const summer = summerShare(ts);
    const seasonal = season.winter + (season.summer - season.winter) * summer;
    const hour = localHourOfDay(ts);
    const occupied =
        hour >= TRADING_OPEN_HOUR - HVAC_PRECOOL_HOURS &&
        hour < TRADING_CLOSE_HOUR;
    return seasonal * (occupied ? 1 : HVAC_SETBACK_SHARE);
}

/** Which curve each submetered slot follows. Every slot in
 *  `AUSSIE_LOAD_RATED_W` needs one, or its rated power would never be shaped
 *  and the store would draw its nameplate around the clock. */
const AUSSIE_LOAD_SHAPE: Readonly<
    Record<number, (storeIndex: number, ts: number) => number>
> = {
    [AUSSIE_DISPLAY_CASE_SLOT]: (_storeIndex, ts) => refrigerationShape(ts),
    [AUSSIE_FREEZER_SLOT]: (_storeIndex, ts) => refrigerationShape(ts),
    [AUSSIE_LIGHTING_SLOT]: lightingShape,
    [AUSSIE_HVAC_SLOT]: hvacShape,
    [AUSSIE_HOT_FOOD_SLOT]: tradingShape,
    [AUSSIE_SIGNAGE_SLOT]: lightingShape,
    [AUSSIE_WALK_IN_COOLER_SLOT]: (_storeIndex, ts) => refrigerationShape(ts)
};

/** Active power one submetered load draws at `ts`, W. Zero for every slot the
 *  store does not submeter, which is what keeps the main meter honest: it can
 *  only sum what a device actually reports. */
export function aussieLoadW(
    slot: number,
    storeIndex: number,
    ts: number
): number {
    const rated = AUSSIE_LOAD_RATED_W[slot];
    if (rated === undefined) return 0;
    const shape = AUSSIE_LOAD_SHAPE[slot];
    if (!shape) {
        throw new Error(`Aussie Grocers load slot ${slot} has no load curve`);
    }
    return round(
        rated *
            shape(storeIndex, ts) *
            storeCityLoadFactor(storeIndex) *
            storeSpread(storeIndex, 0.08)
    );
}

/** Total site load — the figure the main meter must read. */
export function aussieStoreLoadW(storeIndex: number, ts: number): number {
    return round(
        AUSSIE_LOAD_SLOTS.reduce(
            (total, slot) => total + aussieLoadW(slot, storeIndex, ts),
            0
        )
    );
}

/** The site load split across the main meter's three phases. Sums to
 *  `aussieStoreLoadW` exactly — phase C absorbs the rounding. */
export function aussieMainMeterPhaseW(
    storeIndex: number,
    ts: number
): [number, number, number] {
    const total = aussieStoreLoadW(storeIndex, ts);
    const a = round(total * MAIN_METER_PHASE_SHARES[0]);
    const b = round(total * MAIN_METER_PHASE_SHARES[1]);
    return [a, b, round(total - a - b)];
}

/** PV output at `ts`, W, and never below zero: the array produces nothing
 *  between dusk and dawn, and the day it produces over is shorter in winter. */
export function aussieSolarW(storeIndex: number, ts: number): number {
    const summer = summerShare(ts);
    const dayLengthHours = 9.5 + 5 * summer;
    const sunrise = 12 - dayLengthHours / 2;
    const hour = localHourOfDay(ts);
    if (hour <= sunrise || hour >= sunrise + dayLengthHours) return 0;
    const arc = Math.sin(((hour - sunrise) / dayLengthHours) * Math.PI);
    // Winter loses output twice over: fewer clear days and a lower sun angle.
    const clearness = 0.72 + 0.23 * summer;
    return round(
        PV_PEAK_AC_W *
            arc *
            clearness *
            storeCitySolarFactor(storeIndex) *
            storeSpread(storeIndex, 0.12)
    );
}

// ── Cold chain, doors and water ──────────────────────────────────────────
//
// The seeded history and the connected fleet have to describe one store, so
// the fixture model lives here with the rest of the store model and the
// telemetry tick reads it back. Everything below is a pure function of the
// unit's own seed and the timestamp: same store, same second, same reading.

/** Air temperature each refrigerated fixture holds. Australian retail practice
 *  runs a chilled display case at 2-4 °C and a freezer island at -18 °C. */
export const DISPLAY_CASE_SETPOINT_C = 3;
export const FREEZER_SETPOINT_C = -18;

/** Half-width of the band a healthy fixture cycles inside: a thermostat cuts
 *  in and out, it never holds one number. */
const REFRIGERATION_BAND_C = 1;
const REFRIGERATION_CYCLE_MINUTES = 40;

/** Hot-gas defrost runs on a timer; four a day is the retail norm. */
const DEFROST_INTERVAL_HOURS = 6;
const DEFROST_MINUTES = 24;

/** Peak rise above setpoint during a defrost. Small and bounded on purpose: a
 *  defrost is normal operation, so a loaded case coasting on product mass must
 *  stay inside the cold-chain limit an alert watches, and the rise must be
 *  bounded or a defrost could not be told apart from a failure. */
const DEFROST_PEAK_RISE_C = 1.8;

/** A fixture that has stopped holding temperature. One unit in twelve is
 *  fault-prone, and a fault-prone unit fails about once every nine days and
 *  keeps climbing until someone attends it — rare enough that the alert means
 *  something, frequent enough to appear inside a demo window. */
const FAULT_ONE_IN = 12;
const FAULT_SELECTOR = 5;
const FAULT_INTERVAL_HOURS = 24 * 9;
const FAULT_HOURS = 5;
const FAULT_RISE_C_PER_HOUR = 2.4;

/** The unit's serial position, from the last four hex digits of its MAC — the
 *  only stable per-device identity a telemetry tick is handed. This scenario
 *  mints one copy of each profile per store, so every device in a store carries
 *  the same seed; that is what lets a wet floor be tied to the case that was
 *  defrosting above it. */
const MAC_ORDINAL_HEX_DIGITS = 4;

export function unitSeedFromMac(mac: string): number | undefined {
    const ordinal = Number.parseInt(mac.slice(-MAC_ORDINAL_HEX_DIGITS), 16);
    return Number.isSafeInteger(ordinal) ? ordinal : undefined;
}

/** Spreads schedules that would otherwise line up. Every device in one store
 *  shares a seed, so a second number separates them: a fixture uses the
 *  setpoint it holds, and each non-thermal schedule uses a constant of its own,
 *  which is why the case never defrosts in the same minute as the freezer and
 *  the dock door does not open every time the smoke head trips. A prime modulus
 *  keeps neighbouring stores off a common phase. */
const PHASE_MODULUS = 997;
const PHASE_SEED_STRIDE = 37;
const PHASE_KEY_STRIDE = 101;

/** Phase keys for the schedules that are not a fixture holding a setpoint. The
 *  values only have to be distinct from each other and from the setpoints. */
const SMOKE_PHASE_KEY = 7;
const AISLE_MOTION_PHASE_KEY = 13;
const DOCK_DOOR_PHASE_KEY = 23;

function fixturePhase(unitSeed: number, phaseKey: number): number {
    const mixed =
        unitSeed * PHASE_SEED_STRIDE + Math.round(phaseKey) * PHASE_KEY_STRIDE;
    const wrapped = ((mixed % PHASE_MODULUS) + PHASE_MODULUS) % PHASE_MODULUS;
    return wrapped / PHASE_MODULUS;
}

/** Seconds into the current repeat of `periodSeconds`, offset per schedule. */
function cycleOffsetSeconds(input: {
    unitSeed: number;
    phaseKey: number;
    ts: number;
    periodSeconds: number;
}): number {
    const start =
        fixturePhase(input.unitSeed, input.phaseKey) * input.periodSeconds;
    const into = (input.ts - start) % input.periodSeconds;
    return (into + input.periodSeconds) % input.periodSeconds;
}

/** True while `ts` falls inside the first `windowSeconds` of a repeating
 *  `periodSeconds` cycle that only runs while the store trades. Every
 *  intermittent premises event below is this shape; spelling it once keeps the
 *  three of them on one definition of "during trading". */
function tradingHoursWindow(input: {
    unitSeed: number;
    phaseKey: number;
    ts: number;
    periodSeconds: number;
    windowSeconds: number;
}): boolean {
    const hour = localHourOfDay(input.ts);
    if (hour < TRADING_OPEN_HOUR || hour >= TRADING_CLOSE_HOUR) return false;
    return cycleOffsetSeconds(input) < input.windowSeconds;
}

/** How far through its defrost a fixture is, 0..1, or undefined when it is not
 *  defrosting. */
function defrostProgress(
    unitSeed: number,
    setpointC: number,
    ts: number
): number | undefined {
    const windowSeconds = DEFROST_MINUTES * 60;
    const into = cycleOffsetSeconds({
        unitSeed,
        phaseKey: setpointC,
        ts,
        periodSeconds: DEFROST_INTERVAL_HOURS * 3600
    });
    return into < windowSeconds ? into / windowSeconds : undefined;
}

/** Hours since this fixture's fault began, or undefined while it is healthy. */
function faultElapsedHours(
    unitSeed: number,
    setpointC: number,
    ts: number
): number | undefined {
    if (unitSeed % FAULT_ONE_IN !== FAULT_SELECTOR) return undefined;
    const windowSeconds = FAULT_HOURS * 3600;
    const into = cycleOffsetSeconds({
        unitSeed,
        phaseKey: setpointC,
        ts,
        periodSeconds: FAULT_INTERVAL_HOURS * 3600
    });
    return into < windowSeconds ? into / 3600 : undefined;
}

export type RefrigerationState = 'holding' | 'defrost' | 'fault';

export interface RefrigerationReading {
    tC: number;
    state: RefrigerationState;
}

/** What a refrigerated fixture's probe reads at `ts`. A fault outranks a
 *  defrost: a fixture that cannot hold temperature does not stop climbing
 *  because its defrost timer came round. */
export function refrigerationReading(input: {
    setpointC: number;
    unitSeed: number;
    ts: number;
}): RefrigerationReading {
    const {setpointC, unitSeed, ts} = input;
    const faultHours = faultElapsedHours(unitSeed, setpointC, ts);
    if (faultHours !== undefined) {
        return {
            tC: round(setpointC + FAULT_RISE_C_PER_HOUR * faultHours, 1),
            state: 'fault'
        };
    }
    const defrost = defrostProgress(unitSeed, setpointC, ts);
    if (defrost !== undefined) {
        return {
            tC: round(
                setpointC + DEFROST_PEAK_RISE_C * Math.sin(defrost * Math.PI),
                1
            ),
            state: 'defrost'
        };
    }
    const periodSeconds = REFRIGERATION_CYCLE_MINUTES * 60;
    const cycle =
        cycleOffsetSeconds({
            unitSeed,
            phaseKey: setpointC,
            ts,
            periodSeconds
        }) / periodSeconds;
    return {
        tC: round(
            setpointC + REFRIGERATION_BAND_C * Math.sin(cycle * 2 * Math.PI),
            1
        ),
        state: 'holding'
    };
}

/** A customer opens a case door, reaches in, and it swings shut. Only while
 *  the store trades — overnight the doors stay closed. */
const DOOR_OPEN_INTERVAL_MINUTES = 12;
const DOOR_OPEN_SECONDS = 45;

export function caseDoorOpen(input: {
    unitSeed: number;
    setpointC: number;
    ts: number;
}): boolean {
    return tradingHoursWindow({
        unitSeed: input.unitSeed,
        phaseKey: input.setpointC,
        ts: input.ts,
        periodSeconds: DOOR_OPEN_INTERVAL_MINUTES * 60,
        windowSeconds: DOOR_OPEN_SECONDS
    });
}

/** Air temperature the walk-in cooler behind the sales floor holds. Australian
 *  retail practice runs a cold room a degree colder than the cases it stocks,
 *  so product is at temperature before it reaches the floor. */
export const WALK_IN_COOLER_SETPOINT_C = 2;

/** A ceiling smoke head over a bakery oven or a hot-food cabinet nuisance-trips
 *  on cooking smoke. One store in five has one, and it trips for a quarter of an
 *  hour every few trading hours until someone re-sites it — rare enough that a
 *  fire alarm still means something, common enough that a 25-store fleet shows
 *  one from time to time instead of a tile that is always zero. */
const SMOKE_NUISANCE_ONE_IN = 5;
const SMOKE_NUISANCE_SELECTOR = 2;
const SMOKE_ALARM_INTERVAL_HOURS = 3;
const SMOKE_ALARM_MINUTES = 15;

export function smokeAlarmActive(input: {
    unitSeed: number;
    ts: number;
}): boolean {
    if (input.unitSeed % SMOKE_NUISANCE_ONE_IN !== SMOKE_NUISANCE_SELECTOR) {
        return false;
    }
    return tradingHoursWindow({
        unitSeed: input.unitSeed,
        phaseKey: SMOKE_PHASE_KEY,
        ts: input.ts,
        periodSeconds: SMOKE_ALARM_INTERVAL_HOURS * 3600,
        windowSeconds: SMOKE_ALARM_MINUTES * 60
    });
}

/** Customers in the aisle the sales-floor lighting covers. A shop that trades
 *  has someone in front of the sensor most of the time, and the BLU Motion's
 *  blind time holds the state up for a minute and a half after the last
 *  movement, so this is a long window on a short cycle rather than a blip. */
const AISLE_MOTION_INTERVAL_MINUTES = 4;
const AISLE_MOTION_SECONDS = 90;

export function aisleMotionActive(input: {
    unitSeed: number;
    ts: number;
}): boolean {
    return tradingHoursWindow({
        unitSeed: input.unitSeed,
        phaseKey: AISLE_MOTION_PHASE_KEY,
        ts: input.ts,
        periodSeconds: AISLE_MOTION_INTERVAL_MINUTES * 60,
        windowSeconds: AISLE_MOTION_SECONDS
    });
}

/** The loading-dock roller door. It opens for a delivery, stays open while the
 *  pallets come off, and is shut the rest of the day — nothing like the seconds
 *  a case door is open for. */
const DOCK_DOOR_INTERVAL_HOURS = 2;
const DOCK_DOOR_MINUTES = 8;

export function dockDoorOpen(input: {unitSeed: number; ts: number}): boolean {
    return tradingHoursWindow({
        unitSeed: input.unitSeed,
        phaseKey: DOCK_DOOR_PHASE_KEY,
        ts: input.ts,
        periodSeconds: DOCK_DOOR_INTERVAL_HOURS * 3600,
        windowSeconds: DOCK_DOOR_MINUTES * 60
    });
}

/** One store in six has a partly blocked case drain: its melt water backs up
 *  and reaches the leak sensor on the floor. Keyed to the display case's own
 *  defrost, so a wet floor can be traced to the appliance that caused it. */
const BLOCKED_DRAIN_ONE_IN = 6;
const BLOCKED_DRAIN_SELECTOR = 3;

/** Water only reaches the drain once the ice has actually melted. */
const LEAK_DEFROST_PROGRESS_FLOOR = 0.5;

export function leakActive(input: {unitSeed: number; ts: number}): boolean {
    if (input.unitSeed % BLOCKED_DRAIN_ONE_IN !== BLOCKED_DRAIN_SELECTOR) {
        return false;
    }
    const progress = defrostProgress(
        input.unitSeed,
        DISPLAY_CASE_SETPOINT_C,
        input.ts
    );
    return progress !== undefined && progress >= LEAK_DEFROST_PROGRESS_FLOOR;
}

/** Sales-floor humidity by climate: a tropical store sits high and barely
 *  moves, a cool-temperate one is drier and swings with the day. */
const CLIMATE_HUMIDITY: Readonly<
    Record<StoreClimate, {rh: number; swingRh: number}>
> = {
    'cool-temperate': {rh: 46, swingRh: 9},
    'humid-subtropical': {rh: 58, swingRh: 6},
    tropical: {rh: 72, swingRh: 3}
};

/** Dampest before dawn, driest through the afternoon. */
const HUMIDITY_PEAK_HOUR = 5;

export function storeHumidityRh(storeIndex: number, ts: number): number {
    const climate = CLIMATE_HUMIDITY[storeClimate(storeIndex)];
    const hour = localHourOfDay(ts);
    return round(
        climate.rh +
            climate.swingRh *
                Math.cos(((hour - HUMIDITY_PEAK_HOUR) / 24) * 2 * Math.PI),
        1
    );
}

// ── Cold-chain fitments ──────────────────────────────────────────────────
//
// Both fixture controllers are relays — a Shelly 1PM Gen4 on the display case,
// a Shelly Pro 1PM on the freezer island. Neither device page lists a
// Temperature component, because neither measures air, and an on-board Input is
// a mains-wired terminal inside the enclosure, not a contact on a case door.
// What both device pages DO list is BTHome components, so each controller is
// the BLU gateway for its own fixture and the store puts the sensors where the
// product is:
//
//   Shelly BLU H&T (SBHT-003C)         case air, BTHome object 0x45
//   Shelly BLU Door/Window (SBDW-002C) door state, BTHome object 0x2D
//
// Siting the gateway on the fixture rather than one per store is deliberate:
// the readings then arrive on the device the store already classifies as that
// fixture, which is what lets a cold-chain rule stay scoped to a catalog kind.
// A single central gateway would land every store's case air on one device that
// is not a fixture at all.
//
// BTHome component ids are firmware-assigned in [200..299], one block per
// paired child, so no cold-chain reading can ever collide with the [0..99]
// range a device's own peripherals use.

/** BLU models a store puts in a refrigerated fixture, and the one it puts in
 *  the aisle the sales-floor lighting covers. */
const CASE_AIR_BLU_MODEL = 'SBHT-003C';
const CASE_DOOR_BLU_MODEL = 'SBDW-002C';
const AISLE_MOTION_BLU_MODEL = 'SBMO-003Z';

/** BTHome objects each one broadcasts that this scenario reads: temperature
 *  (0x45) from the H&T, window open/closed (0x2D) from the Door/Window, motion
 *  (0x21) from the Motion. The rest — humidity, battery, illuminance, rotation,
 *  button — ride along. */
const BTHOME_TEMPERATURE_OBJECT_ID = 0x45;
const BTHOME_WINDOW_OBJECT_ID = 0x2d;
const BTHOME_MOTION_OBJECT_ID = 0x21;

/** Pairing order on the gateway, which is what decides each child's BTHome
 *  block. Air first so the case probe takes the first block on every fixture. */
const CASE_AIR_CHILD_INDEX = 0;
const CASE_DOOR_CHILD_INDEX = 1;

/** The lighting controller relays one child, so it takes the first block. */
const AISLE_MOTION_CHILD_INDEX = 0;

/** Both fixtures carry the same two BLU devices, so both read the same
 *  component keys; what separates a case from a freezer is the setpoint it
 *  holds and the catalog kind the store stamps on its controller. */
const FIXTURE_PROBE_COMPONENT = bthomeSensorKey({
    model: CASE_AIR_BLU_MODEL,
    index: CASE_AIR_CHILD_INDEX,
    objectId: BTHOME_TEMPERATURE_OBJECT_ID
});

const FIXTURE_DOOR_COMPONENT = bthomeSensorKey({
    model: CASE_DOOR_BLU_MODEL,
    index: CASE_DOOR_CHILD_INDEX,
    objectId: BTHOME_WINDOW_OBJECT_ID
});

/** Where the aisle's BLU Motion lands on the lighting controller that relays
 *  it. Read off the same catalog the child is built from, so re-ordering the
 *  model's BTHome objects moves the key with it. */
const AISLE_MOTION_COMPONENT = bthomeSensorKey({
    model: AISLE_MOTION_BLU_MODEL,
    index: AISLE_MOTION_CHILD_INDEX,
    objectId: BTHOME_MOTION_OBJECT_ID
});

/** A BTHome sensor reports one reading, in the object's own unit. */
const BTHOME_SENSOR_FIELD = 'value';

/** BTHome object 0x2D is uint8: "1 - open, 0 - closed". */
export const DOOR_OPEN = 1;
export const DOOR_CLOSED = 0;

/** BTHome object 0x21 is uint8: "1 - motion, 0 - no motion". */
export const MOTION_DETECTED = 1;
export const MOTION_CLEAR = 0;

function bluFixtureFitment(setpointC: number): ColdChainFitment {
    return {
        probeComponent: FIXTURE_PROBE_COMPONENT,
        probeField: BTHOME_SENSOR_FIELD,
        doorComponent: FIXTURE_DOOR_COMPONENT,
        doorField: BTHOME_SENSOR_FIELD,
        setpointC
    };
}

/** The cold room's probe is a DS18B20 on a Sensor Add-On, while its door uses
 * a BLU Door/Window relayed by the cooler controller. This matches the product
 * promise that the cold room records both temperature and door duration. */
const WALK_IN_COOLER_PROBE_COMPONENT = `temperature:${ADDON_COMPONENT_ID_BASE}`;
const WALK_IN_DOOR_CHILD_INDEX = 0;
const WALK_IN_COOLER_DOOR_COMPONENT = bthomeSensorKey({
    model: CASE_DOOR_BLU_MODEL,
    index: WALK_IN_DOOR_CHILD_INDEX,
    objectId: BTHOME_WINDOW_OBJECT_ID
});
const NATIVE_TEMPERATURE_FIELD = 'tC';

/** The dock door's contact is a dry contact on a Pro Sensor Add-On digital
 *  input, so it lands on an Input component in the same [100..199] range. */
const DOCK_DOOR_COMPONENT = `input:${ADDON_COMPONENT_ID_BASE}`;

// ── Live status shaping ──────────────────────────────────────────────────

function objectValue(value: unknown): JsonObject | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as JsonObject)
        : undefined;
}

function numberValue(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : fallback;
}

/** Metered single-channel components of a load device, in declaration order. */
function loadComponentKeys(
    status: Readonly<Record<string, JsonObject>>
): string[] {
    return Object.keys(status).filter(
        (key) =>
            /^(pm1|switch|light):\d+$/.test(key) &&
            typeof status[key]?.apower === 'number'
    );
}

function writeSingleChannelPower(
    component: JsonObject,
    watts: number,
    powerKey: 'apower' | 'act_power'
): void {
    const voltage = numberValue(component.voltage, NOMINAL_VOLTAGE_V);
    const reading = powerTriangle({
        actPower: watts,
        voltage,
        powerFactor: numberValue(component.pf, DEFAULT_POWER_FACTOR)
    });
    component[powerKey] = reading.actPower;
    component.current = reading.current;
    // Only write a field the component already reports: Light.GetStatus has no
    // `pf`, so stamping one would be a shape no light channel produces.
    if (typeof component.pf === 'number') {
        component.pf = reading.powerFactor;
    }
    if (typeof component.aprt_power === 'number') {
        component.aprt_power = reading.aprtPower;
    }
    if (typeof component.aprtpower === 'number') {
        component.aprtpower = reading.aprtPower;
    }
}

function writeMainMeterPower(
    component: JsonObject,
    phaseWatts: readonly [number, number, number]
): void {
    const readings: PhasorReading[] = [];
    for (const [index, phase] of EM_PHASES.entries()) {
        const voltage = numberValue(
            component[`${phase}_voltage`],
            NOMINAL_VOLTAGE_V
        );
        const reading = powerTriangle({
            actPower: phaseWatts[index],
            voltage,
            powerFactor: numberValue(
                component[`${phase}_pf`],
                DEFAULT_POWER_FACTOR
            )
        });
        component[`${phase}_act_power`] = reading.actPower;
        component[`${phase}_aprt_power`] = reading.aprtPower;
        component[`${phase}_current`] = reading.current;
        component[`${phase}_pf`] = reading.powerFactor;
        readings.push(reading);
    }
    component.total_act_power = round(
        readings.reduce((sum, reading) => sum + reading.actPower, 0)
    );
    component.total_aprt_power = round(
        readings.reduce((sum, reading) => sum + reading.aprtPower, 0)
    );
    component.total_current = round(
        readings.reduce((sum, reading) => sum + reading.current, 0),
        3
    );
    component.n_current = neutralCurrent(readings);
}

/** The two BLU sensors a store puts inside a refrigerated fixture, as the
 *  fixture's own controller relays them. Both children are built from the
 *  shared BLU catalog, so the protocol identity, the BTHome object ids and the
 *  per-model report cadence are the ones the catalog gateway already
 *  publishes — this only says which object is case air and which is the door,
 *  and holds the air at the setpoint the telemetry tick reads back. */
function fixtureComponents(
    profile: ExpandedDeviceProfile,
    fitment: ColdChainFitment
): ProfileComponents {
    const fitted = mergeComponents(
        bluChildComponents({
            model: CASE_AIR_BLU_MODEL,
            index: CASE_AIR_CHILD_INDEX,
            gatewayMac: profile.mac
        }),
        bluChildComponents({
            model: CASE_DOOR_BLU_MODEL,
            index: CASE_DOOR_CHILD_INDEX,
            gatewayMac: profile.mac
        })
    );
    const air = objectValue(fitted.status[fitment.probeComponent]);
    const door = fitment.doorComponent
        ? objectValue(fitted.status[fitment.doorComponent])
        : undefined;
    if (!air || !door) {
        throw new Error(
            `Aussie Grocers fixture is missing ${fitment.probeComponent} or ${fitment.doorComponent}`
        );
    }
    air[fitment.probeField] = fitment.setpointC;
    door[fitment.doorField ?? BTHOME_SENSOR_FIELD] = DOOR_CLOSED;
    return fitted;
}

/** The BLU Motion the store puts in the aisle its sales-floor lighting covers,
 *  relayed by that lighting controller's own BTHome gateway. Siting it on the
 *  controller rather than on a gateway of its own is what a real install does:
 *  the relay that switches the aisle is the device that hears the sensor. */
function aisleMotionComponents(
    profile: ExpandedDeviceProfile
): ProfileComponents {
    return bluChildComponents({
        model: AISLE_MOTION_BLU_MODEL,
        index: AISLE_MOTION_CHILD_INDEX,
        gatewayMac: profile.mac
    });
}

/** Declares the Sensor Add-On board on a device that carries one. Firmware only
 *  spawns add-on components while `device.addon_type` is set, so a profile with
 *  a `temperature:100` and no board would be a state no device reaches. The
 *  whole `sys` config is rebuilt because component merging replaces a key
 *  wholesale — a bare `{device:{addon_type}}` would drop the name and MAC. */
function sensorAddonBoard(profile: ExpandedDeviceProfile): ProfileComponents {
    const sys = profile.config.sys;
    const device = objectValue(sys?.device) ?? {};
    return {
        config: {
            sys: {...sys, device: {...device, addon_type: ADDON_TYPE_SENSOR}}
        },
        status: {}
    };
}

/** A DS18B20's ROM address: family code 40 (0x28), six serial bytes and a
 *  checksum, printed as the decimal octets `SensorAddon.OneWireScan` returns.
 *  Derived from the host MAC so each store's probe keeps one address. */
const DS18B20_FAMILY_CODE = 40;
const DS18B20_MAC_BYTE_OFFSETS = [0, 2, 4, 6, 8, 10] as const;

function ds18b20Address(mac: string): string {
    const serial = DS18B20_MAC_BYTE_OFFSETS.map((at) =>
        Number.parseInt(mac.slice(at, at + 2), 16)
    );
    const checksum =
        serial.reduce((sum, byte) => sum + byte, DS18B20_FAMILY_CODE) % 256;
    return [DS18B20_FAMILY_CODE, ...serial, checksum].join(':');
}

/** Extra hardware a store fits to a slot on top of its catalog profile, and
 *  what the telemetry tick must drive on it. Keeping both in one table is what
 *  stops a component being fitted that nothing ever updates, or a fitment
 *  naming a component no device carries. */
interface SlotHardware {
    components?: (profile: ExpandedDeviceProfile) => ProfileComponents;
    fixture?: ColdChainFitment;
    premises?: PremisesFitment;
}

const AUSSIE_HARDWARE: Readonly<Record<number, SlotHardware>> = {
    [AUSSIE_DISPLAY_CASE_SLOT]: {
        components: (profile) =>
            fixtureComponents(
                profile,
                bluFixtureFitment(DISPLAY_CASE_SETPOINT_C)
            ),
        fixture: bluFixtureFitment(DISPLAY_CASE_SETPOINT_C)
    },
    [AUSSIE_FREEZER_SLOT]: {
        components: (profile) =>
            fixtureComponents(profile, bluFixtureFitment(FREEZER_SETPOINT_C)),
        fixture: bluFixtureFitment(FREEZER_SETPOINT_C)
    },
    [AUSSIE_LIGHTING_SLOT]: {
        components: aisleMotionComponents,
        premises: {motionComponent: AISLE_MOTION_COMPONENT}
    },
    [AUSSIE_SMOKE_SLOT]: {
        // The Smoke component is the device's own; only the schedule is fitted.
        premises: {smokeComponent: 'smoke:0'}
    },
    [AUSSIE_DOCK_DOOR_SLOT]: {
        components: (profile) =>
            mergeComponents(
                sensorAddonBoard(profile),
                addonInputComponents({
                    name: 'Loading dock door',
                    state: false
                })
            ),
        premises: {contactComponent: DOCK_DOOR_COMPONENT}
    },
    [AUSSIE_WALK_IN_COOLER_SLOT]: {
        components: (profile) =>
            mergeComponents(
                mergeComponents(
                    sensorAddonBoard(profile),
                    addonTemperatureComponents({
                        name: 'Cold room air',
                        tC: WALK_IN_COOLER_SETPOINT_C,
                        oneWireAddress: ds18b20Address(profile.mac)
                    })
                ),
                bluChildComponents({
                    model: CASE_DOOR_BLU_MODEL,
                    index: WALK_IN_DOOR_CHILD_INDEX,
                    gatewayMac: profile.mac
                })
            ),
        fixture: {
            probeComponent: WALK_IN_COOLER_PROBE_COMPONENT,
            probeField: NATIVE_TEMPERATURE_FIELD,
            doorComponent: WALK_IN_COOLER_DOOR_COMPONENT,
            doorField: BTHOME_SENSOR_FIELD,
            setpointC: WALK_IN_COOLER_SETPOINT_C
        }
    }
};

/** The cold-chain hardware this store slot carries, if it carries any. */
export function aussieFitment(slot: number): ColdChainFitment | undefined {
    return AUSSIE_HARDWARE[slot]?.fixture;
}

/** The premises sensors this store slot carries, if it carries any. */
export function aussiePremises(slot: number): PremisesFitment | undefined {
    return AUSSIE_HARDWARE[slot]?.premises;
}

/** BTHome binary objects are uint8 on the wire; an Input's `state` is a real
 *  boolean and a Smoke component's `alarm` is too. Each writer below uses the
 *  type its own component defines. */
function shapePremisesStatus(input: {
    premises: PremisesFitment | undefined;
    shaped: Record<string, JsonObject>;
    slot: number;
    unitSeed: number;
    ts: number;
}): void {
    const {premises, shaped, slot, unitSeed, ts} = input;
    if (!premises) return;
    const read = (key: string): JsonObject => {
        const component = objectValue(shaped[key]);
        if (!component) {
            throw new Error(
                `Aussie Grocers slot ${slot} is missing ${key} — check the simulator profile order`
            );
        }
        return component;
    };
    if (premises.motionComponent) {
        const motion = read(premises.motionComponent);
        motion[BTHOME_SENSOR_FIELD] = aisleMotionActive({unitSeed, ts})
            ? MOTION_DETECTED
            : MOTION_CLEAR;
    }
    if (premises.contactComponent) {
        read(premises.contactComponent).state = dockDoorOpen({unitSeed, ts});
    }
    if (premises.smokeComponent) {
        read(premises.smokeComponent).alarm = smokeAlarmActive({unitSeed, ts});
    }
}

/** Rewrites one store device's status so the fleet is physically coherent the
 *  moment the simulator connects: the main meter reads the sum of its store's
 *  submeters, and the PV inverter generates only if the sun is up. */
function shapeAussieStatus(
    profile: ExpandedDeviceProfile,
    deviceIndex: number,
    ts: number
): Record<string, JsonObject> {
    const status = profile.status;
    const shaped = structuredClone(status) as Record<string, JsonObject>;
    const slot = aussieSlot(deviceIndex);
    const storeIndex = aussieStoreIndex(deviceIndex);
    const unitSeed = unitSeedFromMac(profile.mac);
    if (unitSeed === undefined) {
        throw new Error(
            `Aussie Grocers device ${profile.shellyID} has no ordinal in its MAC`
        );
    }

    if (slot === AUSSIE_MAIN_METER_SLOT) {
        const meter = objectValue(shaped['em:0']);
        if (!meter) {
            throw new Error(
                'Aussie Grocers main meter must expose em:0 — check the simulator profile order'
            );
        }
        writeMainMeterPower(meter, aussieMainMeterPhaseW(storeIndex, ts));
        return shaped;
    }

    if (slot === AUSSIE_SOLAR_SLOT) {
        const generation = objectValue(shaped['em1:0']);
        const unused = objectValue(shaped['em1:1']);
        if (!generation || !unused) {
            throw new Error(
                'Aussie Grocers PV inverter must expose em1:0 and em1:1 — check the simulator profile order'
            );
        }
        // Generation is delivered TO the site, so the meter sees it as export.
        writeSingleChannelPower(
            generation,
            -aussieSolarW(storeIndex, ts),
            'act_power'
        );
        // The second CT is spare in this scenario; a permanently exporting
        // channel would read as generation that no array produces.
        writeSingleChannelPower(unused, 0, 'act_power');
        const unusedEnergy = objectValue(shaped['em1data:1']);
        if (unusedEnergy) unusedEnergy.total_act_ret_energy = 0;
        return shaped;
    }

    if (slot === AUSSIE_CLIMATE_SLOT) {
        const humidity = objectValue(shaped['humidity:0']);
        if (!humidity) {
            throw new Error(
                'Aussie Grocers climate sensor must expose humidity:0 — check the simulator profile order'
            );
        }
        humidity.rh = storeHumidityRh(storeIndex, ts);
        return shaped;
    }

    if (slot === AUSSIE_LEAK_SLOT) {
        const flood = objectValue(shaped['flood:0']);
        if (!flood) {
            throw new Error(
                'Aussie Grocers leak sensor must expose flood:0 — check the simulator profile order'
            );
        }
        flood.alarm = leakActive({unitSeed, ts});
        return shaped;
    }

    const fitment = aussieFitment(slot);
    if (fitment?.doorComponent) {
        const door = objectValue(shaped[fitment.doorComponent]);
        if (!door) {
            throw new Error(
                `Aussie Grocers fixture slot ${slot} has no door sensor — check the simulator profile order`
            );
        }
        door[fitment.doorField ?? BTHOME_SENSOR_FIELD] = caseDoorOpen({
            unitSeed,
            setpointC: fitment.setpointC,
            ts
        })
            ? DOOR_OPEN
            : DOOR_CLOSED;
    }
    shapePremisesStatus({
        premises: aussiePremises(slot),
        shaped,
        slot,
        unitSeed,
        ts
    });

    const loadWatts = aussieLoadW(slot, storeIndex, ts);
    if (loadWatts === 0) return shaped;
    const keys = loadComponentKeys(shaped);
    if (keys.length === 0) {
        throw new Error(
            `Aussie Grocers load slot ${slot} has no metered component — check the simulator profile order`
        );
    }
    // One submetered load, one live channel. The seeded history writes this
    // slot's draw on channel 0, so a second energised channel would report
    // power the main meter never counted.
    writeSingleChannelPower(shaped[keys[0]] as JsonObject, loadWatts, 'apower');
    for (const spare of keys.slice(1)) {
        writeSingleChannelPower(shaped[spare] as JsonObject, 0, 'apower');
    }
    return shaped;
}

/** Fits the store's own hardware onto a stock catalog profile, then shapes it.
 *  The fitment travels with the profile so the telemetry tick drives the probe
 *  the install declares instead of inferring one from a reading. */
function shapeAussieProfile(
    profile: ExpandedDeviceProfile,
    deviceIndex: number,
    ts: number
): ExpandedDeviceProfile {
    const slot = aussieSlot(deviceIndex);
    const hardware = AUSSIE_HARDWARE[slot];
    const fitted = hardware?.components
        ? withComponents(profile, hardware.components(profile))
        : profile;
    return {
        ...fitted,
        ...(hardware?.fixture ? {fixture: hardware.fixture} : {}),
        ...(hardware?.premises ? {premises: hardware.premises} : {}),
        status: shapeAussieStatus(fitted, deviceIndex, ts)
    };
}

/** Apply the scenario to live telemetry. Historical generation reads the same
 *  model through `aussieLoadW` / `aussieSolarW`, so the seeded history and the
 *  connected fleet describe one store, not two. */
export function applyLiveSimulationScenario(
    profiles: readonly ExpandedDeviceProfile[],
    scenario?: SimulationScenario,
    nowMs: number = Date.now()
): ExpandedDeviceProfile[] {
    const ts = Math.floor(nowMs / 1000);
    if (scenario === 'aussie-grocers') {
        return profiles.map((profile, index) =>
            shapeAussieProfile(profile, index, ts)
        );
    }
    if (scenario === 'oasis') {
        return profiles.map((profile) => shapeOasisProfile(profile, ts));
    }
    if (scenario === 'berlin-vending') {
        return profiles.map((profile) => shapeBerlinProfile(profile, ts));
    }
    if (scenario === 'blu-alarms') {
        return profiles.map(shapeBluAlarmProfile);
    }
    return [...profiles];
}

// ── BLU alarms: readings past the built-in BLU alert limits ──────────────
//
// One BLU device in ten runs hot (above the 30 C template) and another one in
// ten has a low battery (below the 20 % template). The pick hashes the gateway
// and component, so a run is repeatable and spread over every gateway.
const BLU_ALARM_SHARE = 10;
const BLU_HOT_OFFSET_C = 9;
const BLU_LOW_BATTERY_PCT = 15;

function bluAlarmSlot(shellyID: string, key: string): number {
    return (
        createHash('sha256')
            .update(`${shellyID}\0${key}`)
            .digest()
            .readUInt32BE(0) % BLU_ALARM_SHARE
    );
}

function shapeBluAlarmProfile(
    profile: ExpandedDeviceProfile
): ExpandedDeviceProfile {
    const status = structuredClone(profile.status);
    for (const [key, component] of Object.entries(status)) {
        if (key.startsWith('bthomedevice:')) {
            if (bluAlarmSlot(profile.shellyID, key) === 0) {
                component.battery = BLU_LOW_BATTERY_PCT;
            }
            continue;
        }
        const objectId = profile.config[key]?.obj_id;
        if (
            key.startsWith('bthomesensor:') &&
            typeof objectId === 'number' &&
            bthomeObjectInfos[objectId]?.name === 'temperature' &&
            typeof component.value === 'number' &&
            bluAlarmSlot(profile.shellyID, key) === 1
        ) {
            component.value = round(component.value + BLU_HOT_OFFSET_C, 2);
        }
    }
    return {...profile, status};
}

// ── Oasis: a Dubai villa's rooftop array ─────────────────────────────────
//
// Keyed on the hardware a device IS, never on its position in the fleet. The
// seed deals devices from per-hardware pools (deploy/scripts/common/seed/
// _oasis.sh), so there is no stable slot to key on — and a slot-keyed model is
// what previously labelled a motion sensor a solar array.
//
// The EM Gen4 here is a meter clamped on the array's output, which is how a
// Shelly install measures PV. A generation meter reads negative: energy is
// arriving from the array, not being drawn.

/** Hardware that meters PV in the Oasis fleet. The seed gives exactly this
 *  prefix the solar_array kind, and Fleet Manager reads generation from it. */
export const OASIS_PV_ID_PREFIX = 'shellyemg4';

/** The three gateways are installed at the pump room, park and gatehouse in
 * fixture order. Each carries only the sensors that physically belong there;
 * the stock gateway profile's complete BLU product showroom is deliberately
 * replaced so promoted children never appear as duplicate, unclassified
 * equipment. */
export const OASIS_BLU_GATEWAY_ID_PREFIX = 'shellyblugwg3';
export const OASIS_BLU_KITS: readonly (readonly string[])[] = Object.freeze([
    Object.freeze(['SBDI-003E']),
    // Five probes cover the park's monitored irrigation areas. They share the
    // park gateway but are promoted as five independent devices, so the Oasis
    // Water page can show the local reading and estimate for every probe.
    Object.freeze([
        'SBMS-001A',
        'SBMS-001A',
        'SBMS-001A',
        'SBMS-001A',
        'SBMS-001A',
        'SBWS-90CM'
    ]),
    Object.freeze(['SBDW-002C'])
]);

/** Asia/Dubai. No daylight saving, so one offset holds all year. */
const OASIS_UTC_OFFSET_HOURS = 4;

/** A villa rooftop under the Shelly Solar Rooftop Programme. */
const OASIS_PV_PEAK_AC_W = 5_000;

function oasisLocalDate(ts: number): Date {
    return new Date((ts + OASIS_UTC_OFFSET_HOURS * 3600) * 1000);
}

function oasisLocalHour(ts: number): number {
    const date = oasisLocalDate(ts);
    return date.getUTCHours() + date.getUTCMinutes() / 60;
}

/** Recent-event rain amount reported by the park weather sensor. Dubai is dry
 * most days, with occasional short events. The deterministic 21-day cycle
 * includes both dry days and events above the tenant's 5 mm watering-skip
 * threshold, so the irrigation report demonstrates both decisions without
 * pretending that rain is constant. */
export function oasisPrecipitationMm(input: {ts: number}): number {
    const date = oasisLocalDate(input.ts);
    const day = Math.floor(date.getTime() / 86_400_000);
    const cycleDay = ((day % 21) + 21) % 21;
    if (cycleDay === 4) return 7.4;
    if (cycleDay === 13) return 12.8;
    if (cycleDay === 18) return 3.1;
    return 0;
}

/** 1 at the June solstice, 0 at the December one — northern hemisphere. */
function oasisSummerShare(ts: number): number {
    const date = oasisLocalDate(ts);
    const dayOfYear =
        (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000;
    const MIDSUMMER_DAY = 172;
    return (
        0.5 +
        0.5 * Math.cos(((dayOfYear - MIDSUMMER_DAY) / 365.25) * 2 * Math.PI)
    );
}

/**
 * What one array is producing at `ts`, in watts. Zero at night, never a
 * trickle.
 *
 * Two things separate a Dubai roof from a temperate one. The sky is close to
 * cloudless, so the seasonal swing is in day length and sun angle rather than
 * in cloud cover; and dust is the real loss, which is why PRODUCT.md §6 asks
 * for a check that spots the villa producing less than its neighbours. Each
 * array therefore carries its own soiling factor, held steady by its unit
 * seed so the same roof is the dusty one every day.
 */
export function oasisSolarW(input: {unitSeed: number; ts: number}): number {
    const summer = oasisSummerShare(input.ts);
    const dayLengthHours = 10.6 + 3.2 * summer;
    const sunrise = 12 - dayLengthHours / 2;
    const hour = oasisLocalHour(input.ts);
    if (hour <= sunrise || hour >= sunrise + dayLengthHours) return 0;
    const arc = Math.sin(((hour - sunrise) / dayLengthHours) * Math.PI);
    const clearness = 0.88 + 0.07 * summer;
    const soiling = 1 - 0.18 * ((input.unitSeed % 5) / 4);
    return Math.round(OASIS_PV_PEAK_AC_W * arc * clearness * soiling * 10) / 10;
}

/** Live telemetry for one Oasis device. Only the PV meters are shaped: every
 *  other device already models itself (the valve integrates its own flow, the
 *  controller runs its zones), and a second model here would contradict it.
 *
 *  The array is also FITTED here, not just posed once. Shaping alone runs at
 *  startup, so a fleet begun before dawn reported 0 W all day; the fitment is
 *  what lets the telemetry tick keep the meter following the sun. */
function shapeOasisProfile(
    profile: ExpandedDeviceProfile,
    ts: number
): ExpandedDeviceProfile {
    let fitted = profile;
    if (profile.shellyID.startsWith(`${OASIS_BLU_GATEWAY_ID_PREFIX}-`)) {
        const kit = OASIS_BLU_KITS[profile.ordinal];
        if (!kit) {
            throw new Error(
                `Oasis BLU gateway ${profile.shellyID} has no installation kit`
            );
        }
        const withoutCatalogChildren: ExpandedDeviceProfile = {
            ...profile,
            config: Object.fromEntries(
                Object.entries(profile.config).filter(
                    ([key]) =>
                        !key.startsWith('bthomedevice:') &&
                        !key.startsWith('bthomesensor:') &&
                        !key.startsWith('blutrv:')
                )
            ),
            status: Object.fromEntries(
                Object.entries(profile.status).filter(
                    ([key]) =>
                        !key.startsWith('bthomedevice:') &&
                        !key.startsWith('bthomesensor:') &&
                        !key.startsWith('blutrv:')
                )
            )
        };
        fitted = kit.reduce(
            (current, model, index) =>
                withComponents(
                    current,
                    bluChildComponents({
                        model,
                        index,
                        gatewayMac: profile.mac,
                        ...(model === 'SBMS-001A'
                            ? {displayName: `Park soil probe ${index + 1}`}
                            : {})
                    })
                ),
            withoutCatalogChildren
        );
    }

    if (!fitted.shellyID.startsWith(`${OASIS_PV_ID_PREFIX}-`)) return fitted;
    const unitSeed = unitSeedFromMac(fitted.mac);
    if (unitSeed === undefined) {
        throw new Error(
            `Oasis PV meter ${fitted.shellyID} has no ordinal in its MAC`
        );
    }
    const status = structuredClone(fitted.status) as Record<string, JsonObject>;
    const generation = objectValue(status[OASIS_PV_GENERATION_COMPONENT]);
    if (!generation) {
        throw new Error(
            `Oasis PV meter ${fitted.shellyID} must expose ${OASIS_PV_GENERATION_COMPONENT} — check the fixture profile`
        );
    }
    writeSingleChannelPower(
        generation,
        -oasisSolarW({unitSeed, ts}),
        'act_power'
    );
    for (const key of OASIS_PV_SPARE_COMPONENTS) {
        const spare = objectValue(status[key]);
        if (spare) writeSingleChannelPower(spare, 0, 'act_power');
    }
    return {
        ...fitted,
        status,
        solar: {
            unitSeed,
            generationComponent: OASIS_PV_GENERATION_COMPONENT,
            spareComponents: OASIS_PV_SPARE_COMPONENTS
        }
    };
}

/** The CT the array is clamped on, and the ones that measure nothing. */
const OASIS_PV_GENERATION_COMPONENT = 'em1:0';
const OASIS_PV_SPARE_COMPONENTS = ['em1:1'] as const;

// ── Irrigation: what a controller actually does overnight ─────────────────
//
// A watering is a real event, not a label. Zones run one after another so the
// mains is not asked for six zones at once, which is also why the real device
// carries `limit_zones`.
//
// These constants are the contract between the simulator and the seed: the
// seed writes Schedule.Create jobs at the same times, so the schedule Fleet
// Manager reads and the run the device performs describe one watering, not two
// unrelated ones. Change one, change the other
// (deploy/scripts/common/seed/bm-demo/_oasis.sh, _seed_oasis_watering_schedule).

/** First zone starts 02:00 UTC = 06:00 Dubai, the morning watering. */
export const IRRIGATION_START_UTC_HOUR = 2;
/** Each zone starts this many minutes after the one before it. */
export const IRRIGATION_ZONE_STAGGER_MIN = 10;
/** How long one zone waters. Shorter than the stagger, so runs never overlap. */
export const IRRIGATION_ZONE_RUN_MIN = 8;

const SECONDS_PER_DAY = 24 * 3600;

/** Seconds past midnight UTC for `ts`. */
function secondsIntoUtcDay(ts: number): number {
    return ((ts % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
}

/**
 * Is this zone watering right now, and when did the current or last run start?
 *
 * `startedAt` is a unix second, matching what the real device reports in
 * `zones_status`, and stays set after the run so "last ran 06:00" is readable
 * all day rather than only during the eight minutes the valve is open. Always
 * a number: a simulated controller has always watered at least yesterday, so
 * there is no "never run" state to represent.
 */
export function irrigationZoneRun(input: {zone: number; ts: number}): {
    running: boolean;
    startedAt: number;
} {
    const startSec =
        IRRIGATION_START_UTC_HOUR * 3600 +
        input.zone * IRRIGATION_ZONE_STAGGER_MIN * 60;
    const dayStart = Math.floor(input.ts / SECONDS_PER_DAY) * SECONDS_PER_DAY;
    const into = secondsIntoUtcDay(input.ts);
    // Before today's slot, the most recent run was yesterday's.
    const startedAt =
        into >= startSec
            ? dayStart + startSec
            : dayStart - SECONDS_PER_DAY + startSec;
    const running =
        into >= startSec && into < startSec + IRRIGATION_ZONE_RUN_MIN * 60;
    return {running, startedAt};
}

/**
 * Soil moisture under a watered zone, in percent.
 *
 * Wets sharply while a zone runs and dries through the day, because a probe
 * that never moves cannot answer the one question the Water page asks: was
 * this watering needed. The seed's skip rule fires below `soilSkipPercent`,
 * so the curve has to cross that line to be worth simulating at all.
 */
export const SOIL_DRY_PCT = 22;
export const SOIL_WET_PCT = 72;

export function soilMoisturePct(input: {ts: number; zone?: number}): number {
    const zone = input.zone ?? 0;
    const {startedAt} = irrigationZoneRun({zone, ts: input.ts});
    const sinceWatering = Math.max(0, input.ts - startedAt);
    // Exponential dry-down with a ~9h time constant: wet after the morning
    // run, back near the skip threshold by the next one.
    const dryConstantSec = 9 * 3600;
    const wetness = Math.exp(-sinceWatering / dryConstantSec);
    return round(SOIL_DRY_PCT + (SOIL_WET_PCT - SOIL_DRY_PCT) * wetness, 1);
}

// ── Berlin vending fleet ─────────────────────────────────────────────────
//
// Eighteen Shelly Plug M Gen3. Each plug meters one vending machine and is
// that machine's own BLE gateway, so it hears the cabinet door contact and the
// cabinet climate sensor standing beside it. Both children are declared by the
// catalog profile (profiles/gen3.ts), so this scenario fits no hardware — it
// only says what the machine on the socket is doing.
//
// Fixture order is the contract with deploy/seed/berlin-vending.json:
// venue = floor(index / 3), category = index % 3. The index is the plug's own
// MAC ordinal rather than its position in a profile array, so selecting part
// of the fleet can never relabel a machine.
//
// Every value below is the MEAN over the sample window the caller asks for. A
// vending machine is a duty-cycled load, so a 15-minute history bucket and a
// live tick a few seconds long are two questions about one on/off pattern;
// integrating that pattern answers both, and the seeded past therefore meets
// the connected present without a step at "now".

/** Europe/Berlin, daylight saving included. A vending machine sells at the
 *  local lunch hour in July as well as in January, so the fleet reads the wall
 *  clock the venue reads rather than a fixed winter offset. */
const BERLIN_TIME_ZONE = 'Europe/Berlin';

const BERLIN_WALL_CLOCK = new Intl.DateTimeFormat('en-GB', {
    timeZone: BERLIN_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
});

/** Berlin switches on the hour in UTC, so an hour is the finest key the offset
 *  can change on. Cached because a 60-day window asks for it millions of times
 *  and formatting a date is far dearer than the arithmetic around it. */
const BERLIN_OFFSET_BY_HOUR = new Map<number, number>();
const BERLIN_OFFSET_CACHE_LIMIT = 100_000;

function berlinWallClockSeconds(ts: number): number {
    const parts: Record<string, number> = {};
    for (const part of BERLIN_WALL_CLOCK.formatToParts(ts * 1000)) {
        if (part.type !== 'literal') parts[part.type] = Number(part.value);
    }
    return (
        Date.UTC(
            parts.year,
            parts.month - 1,
            parts.day,
            parts.hour,
            parts.minute,
            parts.second
        ) / 1000
    );
}

function berlinOffsetSeconds(ts: number): number {
    const hour = Math.floor(ts / 3600);
    const cached = BERLIN_OFFSET_BY_HOUR.get(hour);
    if (cached !== undefined) return cached;
    const offset = berlinWallClockSeconds(ts) - ts;
    if (BERLIN_OFFSET_BY_HOUR.size >= BERLIN_OFFSET_CACHE_LIMIT) {
        BERLIN_OFFSET_BY_HOUR.clear();
    }
    BERLIN_OFFSET_BY_HOUR.set(hour, offset);
    return offset;
}

type BerlinVenueKind = 'transit' | 'hospital' | 'campus' | 'mall';

/** Venue of each group of three machines, in fixture order: Berlin
 *  Hauptbahnhof, Charité Campus Mitte, TU Berlin, Mall of Berlin, Ostbahnhof,
 *  Sony Center. A university and an office building keep the same weekday-only
 *  rhythm, so both are 'campus'. */
const BERLIN_VENUE_KINDS: readonly BerlinVenueKind[] = Object.freeze([
    'transit',
    'hospital',
    'campus',
    'mall',
    'transit',
    'campus'
]);

const BERLIN_MACHINES_PER_VENUE = 3;

export type BerlinCategory = 'snack' | 'cooler' | 'coffee';

/** Machine at each position inside a venue, in fixture order: Snackautomat,
 *  Getränkekühler, Kaffeeautomat. */
const BERLIN_CATEGORIES: readonly BerlinCategory[] = Object.freeze([
    'snack',
    'cooler',
    'coffee'
]);

/** Where a plug sits in the vending fixture, from its own MAC ordinal. */
export function berlinDeviceIndex(mac: string): number {
    const unitSeed = unitSeedFromMac(mac);
    if (unitSeed === undefined || unitSeed < 1) {
        throw new Error(`Berlin vending plug ${mac} has no ordinal in its MAC`);
    }
    return unitSeed - 1;
}

function berlinVenueKind(deviceIndex: number): BerlinVenueKind {
    const venue =
        Math.floor(deviceIndex / BERLIN_MACHINES_PER_VENUE) %
        BERLIN_VENUE_KINDS.length;
    return BERLIN_VENUE_KINDS[venue];
}

export function berlinCategory(deviceIndex: number): BerlinCategory {
    return BERLIN_CATEGORIES[deviceIndex % BERLIN_CATEGORIES.length];
}

function berlinLocalDate(ts: number): Date {
    return new Date((ts + berlinOffsetSeconds(ts)) * 1000);
}

/** Local hour with its minutes and seconds as a fraction, so a bucket moves
 *  along the curve instead of stepping once an hour. */
export function berlinLocalHour(ts: number): number {
    const date = berlinLocalDate(ts);
    return (
        date.getUTCHours() +
        date.getUTCMinutes() / 60 +
        date.getUTCSeconds() / 3600
    );
}

function berlinIsWeekend(ts: number): boolean {
    const day = berlinLocalDate(ts).getUTCDay();
    return day === 0 || day === 6;
}

/** Unix second of the local midnight that starts the day `ts` falls in. */
function berlinLocalMidnight(ts: number): number {
    const offset = berlinOffsetSeconds(ts);
    const wallMidnight =
        Math.floor((ts + offset) / SECONDS_PER_DAY) * SECONDS_PER_DAY;
    // On the two days the clocks change, midnight stood at the other offset.
    const atMidnight = berlinOffsetSeconds(wallMidnight - offset);
    return wallMidnight - atMidnight;
}

/** Deterministic per-machine spread. Two identical cabinets in one station
 *  never draw the same, and a fleet where they do reads as fake. Integer
 *  arithmetic, so a re-run reproduces the same bytes on any platform. */
const BERLIN_SPREAD_SHARE = 0.15;
const BERLIN_NOISE_MODULUS = 1009;
const BERLIN_NOISE_INDEX_STRIDE = 131;
const BERLIN_NOISE_KEY_STRIDE = 977;

/** Distinct noise keys, so a machine's duty, its door and its battery do not
 *  all land on the same draw. */
const BERLIN_NOISE_DUTY = 1;
const BERLIN_NOISE_BREWS = 2;
const BERLIN_NOISE_DOOR = 3;
const BERLIN_NOISE_VOLTAGE = 4;
const BERLIN_NOISE_BATTERY = 5;
const BERLIN_NOISE_DEFROST = 6;
const BERLIN_NOISE_HUMIDITY = 7;

function berlinNoise(deviceIndex: number, key: number): number {
    const mixed =
        (deviceIndex + 1) * BERLIN_NOISE_INDEX_STRIDE +
        key * BERLIN_NOISE_KEY_STRIDE;
    const wrapped =
        ((mixed % BERLIN_NOISE_MODULUS) + BERLIN_NOISE_MODULUS) %
        BERLIN_NOISE_MODULUS;
    return wrapped / BERLIN_NOISE_MODULUS;
}

function berlinSpread(deviceIndex: number, key: number): number {
    return (
        1 -
        BERLIN_SPREAD_SHARE +
        berlinNoise(deviceIndex, key) * 2 * BERLIN_SPREAD_SHARE
    );
}

/** Phase keys for the vending schedules, distinct from the grocery ones and
 *  from every setpoint they share `fixturePhase` with. */
const BERLIN_SNACK_PHASE_KEY = 31;
const BERLIN_COOLER_PHASE_KEY = 41;
const BERLIN_COFFEE_PHASE_KEY = 43;
const BERLIN_DOOR_PHASE_KEY = 47;

/** One demand peak: 1 at its centre, fading over `widthHours` either side. */
function berlinPeak(
    hour: number,
    centreHour: number,
    widthHours: number
): number {
    const offset = (hour - centreHour) / widthHours;
    return Math.exp(-offset * offset);
}

/** Venue hours. A station concourse and a shopping centre trade every day; a
 *  hospital never shuts and only goes quiet overnight; a university and an
 *  office keep office hours on weekdays and empty at the weekend. */
const BERLIN_PUBLIC_OPEN_HOUR = 6;
const BERLIN_PUBLIC_CLOSE_HOUR = 22;
const BERLIN_CAMPUS_OPEN_HOUR = 7;
const BERLIN_CAMPUS_CLOSE_HOUR = 20;
const BERLIN_HOSPITAL_DAY_HOUR = 6;
const BERLIN_HOSPITAL_NIGHT_HOUR = 22;

const BERLIN_CLOSED_SHARE = 0.04;
const BERLIN_CAMPUS_WEEKEND_SHARE = 0.06;
const BERLIN_HOSPITAL_NIGHT_SHARE = 0.28;
const BERLIN_WEEKEND_LEISURE_GAIN = 1.15;
const BERLIN_WEEKEND_WORKPLACE_GAIN = 0.85;

/** How busy the venue around a machine is at `ts`, from about 0.04 when it is
 *  shut to about 1.15 on a mall's Saturday afternoon. Everything the machine
 *  does is scaled by this one number. */
function berlinVenueDemand(deviceIndex: number, ts: number): number {
    const kind = berlinVenueKind(deviceIndex);
    const hour = berlinLocalHour(ts);
    const weekend = berlinIsWeekend(ts);
    if (kind === 'campus') {
        if (weekend) return BERLIN_CAMPUS_WEEKEND_SHARE;
        if (
            hour < BERLIN_CAMPUS_OPEN_HOUR ||
            hour >= BERLIN_CAMPUS_CLOSE_HOUR
        ) {
            return BERLIN_CLOSED_SHARE;
        }
        return (
            0.35 +
            0.65 *
                (berlinPeak(hour, 10, 2.2) + 0.85 * berlinPeak(hour, 14.5, 2.2))
        );
    }
    if (kind === 'hospital') {
        const night =
            hour < BERLIN_HOSPITAL_DAY_HOUR ||
            hour >= BERLIN_HOSPITAL_NIGHT_HOUR;
        const day =
            0.55 +
            0.45 *
                (berlinPeak(hour, 9, 2.4) +
                    0.9 * berlinPeak(hour, 13, 2.2) +
                    0.7 * berlinPeak(hour, 18, 2));
        return (
            (night ? BERLIN_HOSPITAL_NIGHT_SHARE : day) *
            (weekend ? BERLIN_WEEKEND_WORKPLACE_GAIN : 1)
        );
    }
    if (hour < BERLIN_PUBLIC_OPEN_HOUR || hour >= BERLIN_PUBLIC_CLOSE_HOUR) {
        return BERLIN_CLOSED_SHARE;
    }
    if (weekend) {
        // No commuter peaks: a concourse and a mall fill up slowly through a
        // Saturday and stay full until closing.
        return (
            (0.35 +
                0.65 *
                    (0.8 * berlinPeak(hour, 12, 2.6) +
                        0.95 * berlinPeak(hour, 16, 2.6))) *
            BERLIN_WEEKEND_LEISURE_GAIN
        );
    }
    return (
        0.3 +
        0.7 *
            (0.95 * berlinPeak(hour, 8, 1.3) +
                berlinPeak(hour, 12.5, 1.6) +
                0.95 * berlinPeak(hour, 17.5, 1.4))
    );
}

/** Nobody buys at night whatever the venue's own hours are, so the doors stay
 *  shut between the last evening customer and the first morning one. */
const BERLIN_DOOR_FIRST_HOUR = 6;
const BERLIN_DOOR_LAST_HOUR = 22;
const BERLIN_DOOR_PEAK_PER_HOUR = 7;
const BERLIN_DOOR_SECONDS_MIN = 10;
const BERLIN_DOOR_SECONDS_SPAN = 20;

function berlinDoorOpeningsPerHour(deviceIndex: number, ts: number): number {
    const hour = berlinLocalHour(ts);
    if (hour < BERLIN_DOOR_FIRST_HOUR || hour >= BERLIN_DOOR_LAST_HOUR) {
        return 0;
    }
    return (
        BERLIN_DOOR_PEAK_PER_HOUR *
        berlinVenueDemand(deviceIndex, ts) *
        berlinSpread(deviceIndex, BERLIN_NOISE_DOOR)
    );
}

/** How long this machine's door swings for: a reach into a snack drawer is
 *  not a browse in front of a cooler. */
function berlinDoorSeconds(deviceIndex: number): number {
    return (
        BERLIN_DOOR_SECONDS_MIN +
        berlinNoise(deviceIndex, BERLIN_NOISE_DOOR) * BERLIN_DOOR_SECONDS_SPAN
    );
}

/** Is the cabinet door open at `ts`? */
export function berlinDoorOpen(input: {
    deviceIndex: number;
    ts: number;
}): boolean {
    const rate = berlinDoorOpeningsPerHour(input.deviceIndex, input.ts);
    if (rate <= 0) return false;
    const periodSeconds = 3600 / rate;
    const into = cycleOffsetSeconds({
        unitSeed: input.deviceIndex + 1,
        phaseKey: BERLIN_DOOR_PHASE_KEY,
        ts: input.ts,
        periodSeconds
    });
    return into < berlinDoorSeconds(input.deviceIndex);
}

/** Share of the time the cabinet is pulling back down after a door opening.
 *  Capped: a cooler whose door never shuts is a cooler running flat out. */
const BERLIN_DOOR_RECOVERY_MINUTES = 10;

function berlinDoorRecoveryShare(deviceIndex: number, ts: number): number {
    const rate = berlinDoorOpeningsPerHour(deviceIndex, ts);
    return Math.min(1, (rate * BERLIN_DOOR_RECOVERY_MINUTES) / 60);
}

/** Snackautomat: a lit cabinet that never switches off, plus a compressor that
 *  runs longer as the concourse warms up and as customers open the drawer. */
const BERLIN_SNACK_LIGHTING_W = 40;
const BERLIN_SNACK_COMPRESSOR_W = 220;
const BERLIN_SNACK_DUTY_MIN = 0.35;
const BERLIN_SNACK_DUTY_SPAN = 0.2;
const BERLIN_SNACK_CYCLE_SECONDS = 23 * 60;

/** Getränkekühler: a glass-door cooler. Its lit door and its two fans run all
 *  day beside the compressor — without them a cabinet at the duty a drinks
 *  cooler actually holds could not reach the consumption one measures. */
const BERLIN_COOLER_CABINET_W = 56;
const BERLIN_COOLER_COMPRESSOR_W = 200;
const BERLIN_COOLER_DUTY_MIN = 0.45;
const BERLIN_COOLER_DUTY_SPAN = 0.2;
const BERLIN_COOLER_DUTY_MAX = 0.65;
const BERLIN_COOLER_DOOR_DUTY = 0.06;
const BERLIN_COOLER_CYCLE_SECONDS = 19 * 60;

/** One defrost a night, in the quietest hour. The compressor stops and an
 *  element clears the evaporator. */
const BERLIN_DEFROST_HOUR = 3;
const BERLIN_DEFROST_MINUTES = 25;
const BERLIN_DEFROST_SPREAD_MINUTES = 40;
const BERLIN_DEFROST_HEATER_W = 150;

/** Kaffeeautomat: idle electronics and a boiler that draws its whole rating
 *  for the length of one cup. */
const BERLIN_COFFEE_STANDBY_W = 50;
const BERLIN_COFFEE_BREW_W = 1600;
const BERLIN_COFFEE_BREW_SECONDS = 45;
const BERLIN_COFFEE_PEAK_BREWS_PER_HOUR = 15;
const BERLIN_COFFEE_OPEN_HOUR = 7;
const BERLIN_COFFEE_CLOSE_HOUR = 18;

/** Warmest mid-afternoon, coolest before dawn: what makes a machine's day
 *  differ from its night. */
function berlinDiurnalWarmth(ts: number): number {
    return (
        0.5 + 0.5 * Math.cos(((berlinLocalHour(ts) - 15) / 24) * 2 * Math.PI)
    );
}

/** 1 at midsummer, 0 at midwinter, northern hemisphere. */
const BERLIN_MIDSUMMER_DAY = 172;

function berlinSummerShare(ts: number): number {
    const date = berlinLocalDate(ts);
    const dayOfYear =
        (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000;
    return (
        0.5 +
        0.5 *
            Math.cos(
                ((dayOfYear - BERLIN_MIDSUMMER_DAY) / 365.25) * 2 * Math.PI
            )
    );
}

/** Berlin's weather does not repeat weekly. A warm spell makes every
 *  compressor in the fleet work harder for days at a time, which is the honest
 *  reason one day's chart is not a copy of the day before. */
const BERLIN_WEATHER_PERIOD_DAYS = 9.4;
const BERLIN_WEATHER_SWING = 0.15;
const BERLIN_WINTER_AMBIENT_SHARE = 0.8;

/** Indoors, so the night never reaches the outdoor low: the diurnal swing
 *  rides on a floor a heated concourse holds. */
const BERLIN_AMBIENT_FLOOR = 0.3;

function berlinAmbient(ts: number): number {
    const indoor =
        BERLIN_AMBIENT_FLOOR +
        (1 - BERLIN_AMBIENT_FLOOR) * berlinDiurnalWarmth(ts);
    const seasonal =
        BERLIN_WINTER_AMBIENT_SHARE +
        (1 - BERLIN_WINTER_AMBIENT_SHARE) * berlinSummerShare(ts);
    const weather =
        1 +
        BERLIN_WEATHER_SWING *
            Math.sin(
                (ts / SECONDS_PER_DAY / BERLIN_WEATHER_PERIOD_DAYS) *
                    2 *
                    Math.PI
            );
    return Math.min(1, indoor * seasonal * weather);
}

function berlinSnackDuty(deviceIndex: number, ts: number): number {
    const hour = berlinLocalHour(ts);
    // Lunch and the late-afternoon break are when a snack machine actually
    // sells, and every sale is a warm drawer the compressor has to pull back.
    const sales = Math.min(
        1,
        berlinVenueDemand(deviceIndex, ts) *
            (1 +
                0.35 * berlinPeak(hour, 12.75, 1.2) +
                0.3 * berlinPeak(hour, 17, 1.1))
    );
    const shape = Math.min(
        1,
        (0.45 * berlinAmbient(ts) + 0.55 * sales) *
            berlinSpread(deviceIndex, BERLIN_NOISE_DUTY)
    );
    return BERLIN_SNACK_DUTY_MIN + BERLIN_SNACK_DUTY_SPAN * shape;
}

function berlinCoolerDuty(deviceIndex: number, ts: number): number {
    const traffic = Math.min(1, berlinVenueDemand(deviceIndex, ts));
    const shape = Math.min(
        1,
        (0.45 * berlinAmbient(ts) + 0.55 * traffic) *
            berlinSpread(deviceIndex, BERLIN_NOISE_DUTY)
    );
    return Math.min(
        BERLIN_COOLER_DUTY_MAX,
        BERLIN_COOLER_DUTY_MIN +
            BERLIN_COOLER_DUTY_SPAN * shape +
            BERLIN_COOLER_DOOR_DUTY * berlinDoorRecoveryShare(deviceIndex, ts)
    );
}

function berlinBrewsPerHour(deviceIndex: number, ts: number): number {
    const hour = berlinLocalHour(ts);
    if (hour < BERLIN_COFFEE_OPEN_HOUR || hour >= BERLIN_COFFEE_CLOSE_HOUR) {
        return 0;
    }
    return (
        BERLIN_COFFEE_PEAK_BREWS_PER_HOUR *
        berlinVenueDemand(deviceIndex, ts) *
        berlinSpread(deviceIndex, BERLIN_NOISE_BREWS)
    );
}

/** Seconds of [fromTs, toTs) a load is on when it runs `onSeconds` at the top
 *  of every `cycleSeconds`. Exact, which is what lets one function serve a
 *  15-minute bucket (it reads the average of the cycles inside it) and a live
 *  tick (it reads the cycle it is inside). */
function berlinOnSeconds(input: {
    fromTs: number;
    toTs: number;
    cycleSeconds: number;
    onSeconds: number;
    phaseSeconds: number;
}): number {
    const at = (ts: number): number => {
        const into = ts - input.phaseSeconds;
        const cycles = Math.floor(into / input.cycleSeconds);
        const rest = into - cycles * input.cycleSeconds;
        return cycles * input.onSeconds + Math.min(rest, input.onSeconds);
    };
    return at(input.toTs) - at(input.fromTs);
}

function berlinDutyShare(input: {
    deviceIndex: number;
    fromTs: number;
    toTs: number;
    cycleSeconds: number;
    duty: number;
    phaseKey: number;
}): number {
    const window = input.toTs - input.fromTs;
    if (window <= 0) return input.duty;
    return (
        berlinOnSeconds({
            fromTs: input.fromTs,
            toTs: input.toTs,
            cycleSeconds: input.cycleSeconds,
            onSeconds: input.cycleSeconds * input.duty,
            phaseSeconds:
                fixturePhase(input.deviceIndex + 1, input.phaseKey) *
                input.cycleSeconds
        }) / window
    );
}

/** Unix second this machine's defrost starts on the local day `ts` falls in. */
function berlinDefrostStart(deviceIndex: number, ts: number): number {
    const offsetMinutes =
        (berlinNoise(deviceIndex, BERLIN_NOISE_DEFROST) - 0.5) *
        BERLIN_DEFROST_SPREAD_MINUTES;
    return (
        berlinLocalMidnight(ts) +
        BERLIN_DEFROST_HOUR * 3600 +
        Math.round(offsetMinutes * 60)
    );
}

/** How far through its defrost a cooler is, 0..1, or undefined when it is
 *  holding temperature. */
function berlinDefrostProgress(
    deviceIndex: number,
    ts: number
): number | undefined {
    const start = berlinDefrostStart(deviceIndex, ts);
    const into = ts - start;
    const length = BERLIN_DEFROST_MINUTES * 60;
    return into >= 0 && into < length ? into / length : undefined;
}

function berlinDefrostShare(
    deviceIndex: number,
    fromTs: number,
    toTs: number
): number {
    const window = toTs - fromTs;
    if (window <= 0) return 0;
    const start = berlinDefrostStart(deviceIndex, fromTs);
    const overlap =
        Math.min(toTs, start + BERLIN_DEFROST_MINUTES * 60) -
        Math.max(fromTs, start);
    return overlap <= 0 ? 0 : overlap / window;
}

/** Mean active power one vending plug reads over (fromTs, toTs], W. */
export function berlinPlugW(input: {
    deviceIndex: number;
    fromTs: number;
    toTs: number;
}): number {
    const {deviceIndex, fromTs, toTs} = input;
    const midTs = (fromTs + toTs) / 2;
    const category = berlinCategory(deviceIndex);

    if (category === 'snack') {
        const share = berlinDutyShare({
            deviceIndex,
            fromTs,
            toTs,
            cycleSeconds: BERLIN_SNACK_CYCLE_SECONDS,
            duty: berlinSnackDuty(deviceIndex, midTs),
            phaseKey: BERLIN_SNACK_PHASE_KEY
        });
        return round(
            BERLIN_SNACK_LIGHTING_W + BERLIN_SNACK_COMPRESSOR_W * share
        );
    }

    if (category === 'cooler') {
        const defrost = berlinDefrostShare(deviceIndex, fromTs, toTs);
        const share =
            berlinDutyShare({
                deviceIndex,
                fromTs,
                toTs,
                cycleSeconds: BERLIN_COOLER_CYCLE_SECONDS,
                duty: berlinCoolerDuty(deviceIndex, midTs),
                phaseKey: BERLIN_COOLER_PHASE_KEY
            }) *
            (1 - defrost);
        return round(
            BERLIN_COOLER_CABINET_W +
                BERLIN_COOLER_COMPRESSOR_W * share +
                BERLIN_DEFROST_HEATER_W * defrost
        );
    }

    const brews = berlinBrewsPerHour(deviceIndex, midTs);
    if (brews <= 0) return BERLIN_COFFEE_STANDBY_W;
    const cycleSeconds = 3600 / brews;
    const share = berlinDutyShare({
        deviceIndex,
        fromTs,
        toTs,
        cycleSeconds,
        duty: Math.min(1, BERLIN_COFFEE_BREW_SECONDS / cycleSeconds),
        phaseKey: BERLIN_COFFEE_PHASE_KEY
    });
    return round(BERLIN_COFFEE_STANDBY_W + BERLIN_COFFEE_BREW_W * share);
}

/** Voltage at the socket: a slow daily sag under the city's own load, and no
 *  two streets in phase with each other. */
const BERLIN_VOLTAGE_CENTRE_V = 232;
const BERLIN_VOLTAGE_SWING_V = 2.5;

export function berlinVoltageV(input: {
    deviceIndex: number;
    ts: number;
}): number {
    const phase =
        berlinNoise(input.deviceIndex, BERLIN_NOISE_VOLTAGE) * 2 * Math.PI;
    return round(
        BERLIN_VOLTAGE_CENTRE_V +
            BERLIN_VOLTAGE_SWING_V *
                Math.cos(
                    (berlinLocalHour(input.ts) / 24) * 2 * Math.PI + phase
                ),
        1
    );
}

/** Cabinet air saws between the compressor cutting in and cutting out, and
 *  warms while the cooler defrosts. A coffee machine's sensor hangs in the
 *  room instead, so it reads room air. */
const BERLIN_CABINET_COLD_C = 3.4;
const BERLIN_CABINET_WARM_C = 7.2;
const BERLIN_DEFROST_PEAK_C = 7.9;
const BERLIN_ROOM_COOL_C = 20.5;
const BERLIN_ROOM_WARM_C = 25.5;

export function berlinProbeC(input: {deviceIndex: number; ts: number}): number {
    const {deviceIndex, ts} = input;
    const category = berlinCategory(deviceIndex);
    if (category === 'coffee') {
        // Room air, not cabinet air: a heated concourse holds the same band all
        // year, so this follows the hour and the crowd but not the season.
        const share = Math.min(
            1,
            0.6 * berlinDiurnalWarmth(ts) +
                0.4 * Math.min(1, berlinVenueDemand(deviceIndex, ts))
        );
        return round(
            BERLIN_ROOM_COOL_C +
                (BERLIN_ROOM_WARM_C - BERLIN_ROOM_COOL_C) * share,
            1
        );
    }
    const cooler = category === 'cooler';
    if (cooler) {
        const defrost = berlinDefrostProgress(deviceIndex, ts);
        if (defrost !== undefined) {
            return round(
                BERLIN_CABINET_WARM_C +
                    (BERLIN_DEFROST_PEAK_C - BERLIN_CABINET_WARM_C) *
                        Math.sin(defrost * Math.PI),
                1
            );
        }
    }
    const periodSeconds = cooler
        ? BERLIN_COOLER_CYCLE_SECONDS
        : BERLIN_SNACK_CYCLE_SECONDS;
    const duty = cooler
        ? berlinCoolerDuty(deviceIndex, ts)
        : berlinSnackDuty(deviceIndex, ts);
    const phase =
        cycleOffsetSeconds({
            unitSeed: deviceIndex + 1,
            phaseKey: cooler ? BERLIN_COOLER_PHASE_KEY : BERLIN_SNACK_PHASE_KEY,
            ts,
            periodSeconds
        }) / periodSeconds;
    // Falls while the compressor pulls the cabinet down and drifts back up
    // after it cuts out: a sawtooth, not a sine.
    const warmShare =
        phase < duty ? 1 - phase / duty : (phase - duty) / (1 - duty);
    return round(
        BERLIN_CABINET_COLD_C +
            (BERLIN_CABINET_WARM_C - BERLIN_CABINET_COLD_C) * warmShare,
        1
    );
}

/** Cabinet air is damp because it is cold; room air is not. Both drift with
 *  the same daily swing the temperature does. */
const BERLIN_CABINET_RH_MIN = 55;
const BERLIN_CABINET_RH_SPAN = 20;
const BERLIN_ROOM_RH_MIN = 35;
const BERLIN_ROOM_RH_SPAN = 20;

export function berlinHumidityRh(input: {
    deviceIndex: number;
    ts: number;
}): number {
    const {deviceIndex, ts} = input;
    const hour = berlinLocalHour(ts);
    const phase = berlinNoise(deviceIndex, BERLIN_NOISE_HUMIDITY) * 2 * Math.PI;
    // Dampest before dawn, driest through the afternoon.
    const share =
        0.5 + 0.5 * Math.cos(((hour - 5) / 24) * 2 * Math.PI + phase * 0.15);
    const cabinet = berlinCategory(deviceIndex) !== 'coffee';
    const floorRh = cabinet ? BERLIN_CABINET_RH_MIN : BERLIN_ROOM_RH_MIN;
    const span = cabinet ? BERLIN_CABINET_RH_SPAN : BERLIN_ROOM_RH_SPAN;
    return round(floorRh + span * share, 1);
}

/** A BLU child ships near full and loses a little each month; a replaced cell
 *  starts again at full, which is why this cycles rather than ending flat. */
const BERLIN_BATTERY_FULL_PCT = 100;
const BERLIN_BATTERY_LOW_PCT = 70;
const BERLIN_BATTERY_LIFE_DAYS = 540;
const BERLIN_CHILDREN_PER_PLUG = 2;

export function berlinChildBatteryPct(input: {
    deviceIndex: number;
    childIndex: number;
    ts: number;
}): number {
    const seed =
        input.deviceIndex * BERLIN_CHILDREN_PER_PLUG + input.childIndex;
    const fitted = berlinNoise(seed, BERLIN_NOISE_BATTERY);
    const days = input.ts / SECONDS_PER_DAY + fitted * BERLIN_BATTERY_LIFE_DAYS;
    const worn = (days % BERLIN_BATTERY_LIFE_DAYS) / BERLIN_BATTERY_LIFE_DAYS;
    return Math.round(
        BERLIN_BATTERY_FULL_PCT -
            (BERLIN_BATTERY_FULL_PCT - BERLIN_BATTERY_LOW_PCT) * worn
    );
}

// ── Berlin fitment ───────────────────────────────────────────────────────
//
// The plug pairs the door contact FIRST and the climate sensor SECOND, which
// is the opposite of the grocery fixture. Firmware hands each child a block of
// BTHome component ids, so the two fleets can never name the same pair of
// components, and that is what tells the telemetry tick which model a fitted
// device belongs to.

/** BTHome object 0x2E is relative humidity, in percent. */
const BTHOME_HUMIDITY_OBJECT_ID = 0x2e;

const BERLIN_DOOR_BLU_MODEL = 'SBDW-002C';
const BERLIN_CLIMATE_BLU_MODEL = 'SBHT-003C';
const BERLIN_DOOR_CHILD_INDEX = 0;
const BERLIN_CLIMATE_CHILD_INDEX = 1;

const BERLIN_DOOR_COMPONENT = bthomeSensorKey({
    model: BERLIN_DOOR_BLU_MODEL,
    index: BERLIN_DOOR_CHILD_INDEX,
    objectId: BTHOME_WINDOW_OBJECT_ID
});

const BERLIN_PROBE_COMPONENT = bthomeSensorKey({
    model: BERLIN_CLIMATE_BLU_MODEL,
    index: BERLIN_CLIMATE_CHILD_INDEX,
    objectId: BTHOME_TEMPERATURE_OBJECT_ID
});

const BERLIN_HUMIDITY_COMPONENT = bthomeSensorKey({
    model: BERLIN_CLIMATE_BLU_MODEL,
    index: BERLIN_CLIMATE_CHILD_INDEX,
    objectId: BTHOME_HUMIDITY_OBJECT_ID
});

/** The two children in pairing order, which is also the order their batteries
 *  are seeded in: door first, climate second. */
const BERLIN_CHILD_COMPONENTS: readonly string[] = Object.freeze([
    bthomeDeviceKey(BERLIN_DOOR_CHILD_INDEX),
    bthomeDeviceKey(BERLIN_CLIMATE_CHILD_INDEX)
]);

/** Air each machine holds. The coffee machine holds none — its sensor reads
 *  the room, so the figure is the room the fleet is installed in. */
const BERLIN_SETPOINT_C: Readonly<Record<BerlinCategory, number>> = {
    snack: 5,
    cooler: 4,
    coffee: 23
};

function berlinFitment(category: BerlinCategory): ColdChainFitment {
    return {
        probeComponent: BERLIN_PROBE_COMPONENT,
        probeField: BTHOME_SENSOR_FIELD,
        doorComponent: BERLIN_DOOR_COMPONENT,
        doorField: BTHOME_SENSOR_FIELD,
        setpointC: BERLIN_SETPOINT_C[category]
    };
}

const BERLIN_FITMENTS: Readonly<Record<BerlinCategory, ColdChainFitment>> = {
    snack: berlinFitment('snack'),
    cooler: berlinFitment('cooler'),
    coffee: berlinFitment('coffee')
};

function isBerlinFitment(fixture: ColdChainFitment): boolean {
    return (
        fixture.probeComponent === BERLIN_PROBE_COMPONENT &&
        fixture.doorComponent === BERLIN_DOOR_COMPONENT
    );
}

export interface BerlinMachineReading {
    watts: number;
    probeC: number;
    doorOpen: boolean;
    /** Cabinet humidity and the component it is broadcast on. */
    humidityComponent: string;
    humidityRh: number;
    /** Battery percent per BLU child component. */
    childBattery: Readonly<Record<string, number>>;
}

/** What a vending plug reads over one live tick, or undefined when the device
 *  is not one. The tick asks the model the seeded history was written from, so
 *  a live reading continues the chart instead of stepping off it. Humidity and
 *  the children's batteries are here for that same reason: shaped only at
 *  connect, they would freeze at the value the fleet started on. */
export function berlinMachineReading(input: {
    fixture?: ColdChainFitment;
    unitSeed?: number;
    ts: number;
    periodSeconds: number;
}): BerlinMachineReading | undefined {
    if (!input.fixture || !isBerlinFitment(input.fixture)) return undefined;
    if (input.unitSeed === undefined || input.unitSeed < 1) return undefined;
    const deviceIndex = input.unitSeed - 1;
    const childBattery: Record<string, number> = {};
    BERLIN_CHILD_COMPONENTS.forEach((component, childIndex) => {
        childBattery[component] = berlinChildBatteryPct({
            deviceIndex,
            childIndex,
            ts: input.ts
        });
    });
    return {
        watts: berlinPlugW({
            deviceIndex,
            fromTs: input.ts - input.periodSeconds,
            toTs: input.ts
        }),
        probeC: berlinProbeC({deviceIndex, ts: input.ts}),
        doorOpen: berlinDoorOpen({deviceIndex, ts: input.ts}),
        humidityComponent: BERLIN_HUMIDITY_COMPONENT,
        humidityRh: berlinHumidityRh({deviceIndex, ts: input.ts}),
        childBattery
    };
}

/** Window the connect-time reading is averaged over. Short, because the first
 *  status a plug sends is an instant, not a bucket. */
const BERLIN_LIVE_SAMPLE_SECONDS = 10;

/** Paired BLU children of a plug, in pairing order: door first, climate
 *  second, which is the order their BTHome id blocks are handed out in. */
function berlinChildKeys(
    status: Readonly<Record<string, JsonObject>>
): string[] {
    return Object.keys(status)
        .filter((key) => /^bthomedevice:\d+$/.test(key))
        .sort(
            (left, right) =>
                Number(left.split(':')[1]) - Number(right.split(':')[1])
        );
}

function shapeBerlinProfile(
    profile: ExpandedDeviceProfile,
    ts: number
): ExpandedDeviceProfile {
    const deviceIndex = berlinDeviceIndex(profile.mac);
    const fixture = BERLIN_FITMENTS[berlinCategory(deviceIndex)];
    const status = structuredClone(profile.status) as Record<
        string,
        JsonObject
    >;

    const meters = loadComponentKeys(status);
    if (meters.length === 0) {
        throw new Error(
            `Berlin vending plug ${profile.shellyID} has no metered component — check the simulator profile order`
        );
    }
    const socket = status[meters[0]] as JsonObject;
    socket.voltage = berlinVoltageV({deviceIndex, ts});
    writeSingleChannelPower(
        socket,
        berlinPlugW({
            deviceIndex,
            fromTs: ts - BERLIN_LIVE_SAMPLE_SECONDS,
            toTs: ts
        }),
        'apower'
    );
    for (const spare of meters.slice(1)) {
        writeSingleChannelPower(status[spare] as JsonObject, 0, 'apower');
    }

    const probe = objectValue(status[BERLIN_PROBE_COMPONENT]);
    const door = objectValue(status[BERLIN_DOOR_COMPONENT]);
    const humidity = objectValue(status[BERLIN_HUMIDITY_COMPONENT]);
    if (!probe || !door || !humidity) {
        throw new Error(
            `Berlin vending plug ${profile.shellyID} is missing its BLU cabinet sensors — check the simulator profile order`
        );
    }
    probe[BTHOME_SENSOR_FIELD] = berlinProbeC({deviceIndex, ts});
    probe.last_updated_ts = ts;
    door[BTHOME_SENSOR_FIELD] = berlinDoorOpen({deviceIndex, ts})
        ? DOOR_OPEN
        : DOOR_CLOSED;
    door.last_updated_ts = ts;
    humidity[BTHOME_SENSOR_FIELD] = berlinHumidityRh({deviceIndex, ts});
    humidity.last_updated_ts = ts;

    berlinChildKeys(status).forEach((key, childIndex) => {
        const child = objectValue(status[key]);
        if (!child) return;
        child.battery = berlinChildBatteryPct({deviceIndex, childIndex, ts});
        child.last_updated_ts = ts;
    });

    return {...profile, fixture, status};
}
