import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {tuning} from '../config/tuning';
import {
    EnergyHistoryManifestBuilder,
    energyHistoryRows,
    energyRowTsv
} from './energyHistory';
import {FleetSimulator, simulatorInstanceSeed} from './FleetSimulator';
import {
    applyDeviceNames,
    bluChildDeviceIds,
    DEFAULT_PROFILE_KEYS,
    expandDeviceProfiles,
    PROFILE_CATALOG
} from './profiles';
import {
    applyLiveSimulationScenario,
    SIMULATION_SCENARIOS,
    type SimulationScenario
} from './scenarios';
import {
    SensorHistoryManifestBuilder,
    sensorHistoryRows,
    sensorRowTsv
} from './sensorHistory';
import {wateringHistoryRows, wateringRowTsv} from './wateringHistory';

const DEFAULT_WS_URL = 'ws://127.0.0.1:7011/shelly';

export interface SimulatorCliOptions {
    wsUrl: string;
    count?: number;
    profiles?: string[];
    deviceIds?: string[];
    printIds: boolean;
    printBluIds: boolean;
    printBluOwners: boolean;
    printEnergyHistory: boolean;
    printSensorHistory: boolean;
    printWateringHistory: boolean;
    historyDays: number;
    historyPeriodSeconds: number;
    historyFromTs?: number;
    historyToTs?: number;
    scenario?: SimulationScenario;
    emHistorySeconds?: number;
    emPushDropShare?: number;
    namesFile?: string;
    names?: Record<string, string>;
    bluBunched?: boolean;
    help: boolean;
}

export function parseDeviceNames(
    option: string,
    value: string
): Record<string, string> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error(`${option} must be valid JSON`);
    }
    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
    ) {
        throw new Error(`${option} must be a JSON object of id -> name`);
    }
    const names: Record<string, string> = {};
    for (const [id, name] of Object.entries(parsed)) {
        if (!id || typeof name !== 'string' || name.length === 0) {
            throw new Error(
                `${option} maps every non-empty id to a non-empty name`
            );
        }
        names[id] = name;
    }
    return names;
}

function parseDeviceIds(value: string): string[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error('--device-ids-json must be valid JSON');
    }
    if (
        !Array.isArray(parsed) ||
        parsed.length === 0 ||
        !parsed.every((id) => typeof id === 'string' && id.length > 0) ||
        new Set(parsed).size !== parsed.length
    ) {
        throw new Error(
            '--device-ids-json must be an array of unique, non-empty strings'
        );
    }
    return parsed;
}

function optionValue(args: readonly string[], index: number): string {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`missing value for ${args[index]}`);
    }
    return value;
}

function parseCount(value: string): number {
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 1) {
        throw new Error('--count must be a positive integer');
    }
    return count;
}

function parseShare(option: string, value: string): number {
    const share = Number(value);
    if (!Number.isFinite(share) || share < 0 || share > 1) {
        throw new Error(`${option} must be a number between 0 and 1`);
    }
    return share;
}

function parsePositiveInteger(option: string, value: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new Error(`${option} must be a positive integer`);
    }
    return parsed;
}

function appendProfiles(target: string[], value: string): void {
    const keys = value
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
    if (keys.length === 0) throw new Error('profile list must not be empty');
    target.push(...keys);
}

export function parseSimulatorCliArgs(
    args: readonly string[]
): SimulatorCliOptions {
    const options: SimulatorCliOptions = {
        wsUrl: DEFAULT_WS_URL,
        printIds: false,
        printBluIds: false,
        printBluOwners: false,
        printEnergyHistory: false,
        printSensorHistory: false,
        printWateringHistory: false,
        historyDays: 60,
        historyPeriodSeconds: 60,
        help: false
    };
    const profiles: string[] = [];

    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (argument === '--print-ids') {
            options.printIds = true;
            continue;
        }
        if (argument === '--print-blu-owners') {
            options.printBluOwners = true;
            continue;
        }
        if (argument === '--print-blu-ids') {
            options.printBluIds = true;
            continue;
        }
        if (argument === '--print-watering-history') {
            options.printWateringHistory = true;
            continue;
        }
        if (argument === '--print-energy-history') {
            options.printEnergyHistory = true;
            continue;
        }
        if (argument === '--print-sensor-history') {
            options.printSensorHistory = true;
            continue;
        }
        if (argument === '--blu-bunched') {
            options.bluBunched = true;
            continue;
        }
        if (argument === '--help') {
            options.help = true;
            continue;
        }
        if (argument === '--ws-url') {
            options.wsUrl = optionValue(args, index++);
            continue;
        }
        if (argument.startsWith('--ws-url=')) {
            options.wsUrl = argument.slice('--ws-url='.length);
            continue;
        }
        if (argument === '--count') {
            options.count = parseCount(optionValue(args, index++));
            continue;
        }
        if (argument.startsWith('--count=')) {
            options.count = parseCount(argument.slice('--count='.length));
            continue;
        }
        if (argument === '--device-ids-json') {
            options.deviceIds = parseDeviceIds(optionValue(args, index++));
            continue;
        }
        if (argument.startsWith('--device-ids-json=')) {
            options.deviceIds = parseDeviceIds(
                argument.slice('--device-ids-json='.length)
            );
            continue;
        }
        if (argument === '--history-days') {
            options.historyDays = parsePositiveInteger(
                argument,
                optionValue(args, index++)
            );
            continue;
        }
        if (argument.startsWith('--history-days=')) {
            options.historyDays = parsePositiveInteger(
                '--history-days',
                argument.slice('--history-days='.length)
            );
            continue;
        }
        if (argument === '--history-period-seconds') {
            options.historyPeriodSeconds = parsePositiveInteger(
                argument,
                optionValue(args, index++)
            );
            continue;
        }
        if (argument.startsWith('--history-period-seconds=')) {
            options.historyPeriodSeconds = parsePositiveInteger(
                '--history-period-seconds',
                argument.slice('--history-period-seconds='.length)
            );
            continue;
        }
        if (argument === '--history-to-ts') {
            options.historyToTs = parsePositiveInteger(
                argument,
                optionValue(args, index++)
            );
            continue;
        }
        if (argument === '--history-from-ts') {
            options.historyFromTs = parsePositiveInteger(
                argument,
                optionValue(args, index++)
            );
            continue;
        }
        if (argument.startsWith('--history-from-ts=')) {
            options.historyFromTs = parsePositiveInteger(
                '--history-from-ts',
                argument.slice('--history-from-ts='.length)
            );
            continue;
        }
        if (argument.startsWith('--history-to-ts=')) {
            options.historyToTs = parsePositiveInteger(
                '--history-to-ts',
                argument.slice('--history-to-ts='.length)
            );
            continue;
        }
        if (argument === '--em-history-seconds') {
            options.emHistorySeconds = parsePositiveInteger(
                argument,
                optionValue(args, index++)
            );
            continue;
        }
        if (argument.startsWith('--em-history-seconds=')) {
            options.emHistorySeconds = parsePositiveInteger(
                '--em-history-seconds',
                argument.slice('--em-history-seconds='.length)
            );
            continue;
        }
        if (argument === '--em-push-drop-share') {
            options.emPushDropShare = parseShare(
                argument,
                optionValue(args, index++)
            );
            continue;
        }
        if (argument === '--names-file') {
            options.namesFile = optionValue(args, index++);
            continue;
        }
        if (argument.startsWith('--names-file=')) {
            options.namesFile = argument.slice('--names-file='.length);
            continue;
        }
        if (argument === '--names-json') {
            options.names = parseDeviceNames(
                '--names-json',
                optionValue(args, index++)
            );
            continue;
        }
        if (argument.startsWith('--names-json=')) {
            options.names = parseDeviceNames(
                '--names-json',
                argument.slice('--names-json='.length)
            );
            continue;
        }
        if (argument === '--profile' || argument === '--profiles') {
            appendProfiles(profiles, optionValue(args, index++));
            continue;
        }
        if (argument === '--scenario') {
            const scenario = optionValue(args, index++);
            if (
                !SIMULATION_SCENARIOS.includes(scenario as SimulationScenario)
            ) {
                throw new Error(`unknown simulator scenario: ${scenario}`);
            }
            options.scenario = scenario as SimulationScenario;
            continue;
        }
        if (argument.startsWith('--scenario=')) {
            const scenario = argument.slice('--scenario='.length);
            if (
                !SIMULATION_SCENARIOS.includes(scenario as SimulationScenario)
            ) {
                throw new Error(`unknown simulator scenario: ${scenario}`);
            }
            options.scenario = scenario as SimulationScenario;
            continue;
        }
        if (argument.startsWith('--profile=')) {
            appendProfiles(profiles, argument.slice('--profile='.length));
            continue;
        }
        if (argument.startsWith('--profiles=')) {
            appendProfiles(profiles, argument.slice('--profiles='.length));
            continue;
        }
        throw new Error(`unknown option: ${argument}`);
    }

    if (profiles.length > 0) options.profiles = profiles;
    return options;
}

export function simulatorHelp(): string {
    return [
        'Usage: node --import tsx src/devSimulation/main.ts [options]',
        '',
        'Options:',
        `  --ws-url <url>       Fleet socket (default: ${DEFAULT_WS_URL})`,
        '  --count <number>     Total devices; profiles repeat round-robin',
        '  --device-ids-json <json>  Require and select this exact ID inventory',
        '  --profile <key>      Select a profile; repeat this flag as needed',
        '  --profiles <keys>    Select comma-separated profiles',
        `  --scenario <name>    Apply a business scenario (${SIMULATION_SCENARIOS.join(', ')})`,
        '  --blu-bunched        Send every BLU child on the same tick (stress shape)',
        '  --print-ids          Print deterministic IDs and exit',
        '  --print-blu-ids      Print deterministic BLU child IDs and exit',
        '  --print-energy-history  Print deterministic meter history as TSV',
        '  --print-sensor-history  Print deterministic sensor history as TSV',
        '  --print-watering-history Print deterministic zone runs as TSV',
        '  --history-days <n>   History window (default: 60)',
        '  --history-period-seconds <n>  Sample period (default: 60)',
        '  --history-from-ts <unix>  Fixed inclusive history start',
        '  --history-to-ts <unix>  Fixed history end for reproducible output',
        '  --em-history-seconds <n>  On-device meter retention (default: 60 days)',
        '  --em-push-drop-share <0..1>  Share of minute record pushes not sent (default: 0)',
        '  --names-file <path>  JSON object of external id -> display name',
        '  --names-json <json>  The same mapping given inline',
        '  --help               Show this help',
        '',
        `Profiles: ${DEFAULT_PROFILE_KEYS.join(', ')}`
    ].join('\n');
}

export function selectProfilesByDeviceIds(
    profiles: ReturnType<typeof expandDeviceProfiles>,
    deviceIds: readonly string[]
): ReturnType<typeof expandDeviceProfiles> {
    const byId = new Map(
        profiles.map((profile) => [profile.shellyID, profile])
    );
    const selected = deviceIds.map((id) => byId.get(id));
    if (
        deviceIds.length !== profiles.length ||
        selected.some((profile) => profile === undefined)
    ) {
        throw new Error(
            '--device-ids-json does not match the generated simulator inventory'
        );
    }
    return selected as ReturnType<typeof expandDeviceProfiles>;
}

export function rekeyProfilesForEnergyHistory(
    profiles: ReturnType<typeof expandDeviceProfiles>,
    deviceIds: readonly string[]
): ReturnType<typeof expandDeviceProfiles> {
    if (deviceIds.length !== profiles.length) {
        throw new Error(
            '--device-ids-json count does not match the generated history inventory'
        );
    }
    return profiles.map((profile, index) => ({
        ...profile,
        shellyID: deviceIds[index]
    }));
}

/** Zone runs for the seeded window, so the Water page opens with a record of
 *  the waterings the controller performed rather than a wall of "did not run". */
function printWateringHistory(input: {
    profiles: ReturnType<typeof expandDeviceProfiles>;
    days: number;
    fromTs?: number;
    toTs?: number;
}): void {
    const toTs = input.toTs ?? Math.floor(Date.now() / 1000);
    const fromTs = input.fromTs ?? toTs - input.days * 24 * 60 * 60;
    let rows = 0;
    let output = '';
    for (const row of wateringHistoryRows({
        profiles: input.profiles,
        fromTs,
        toTs
    })) {
        rows += 1;
        output += `${wateringRowTsv(row)}\n`;
    }
    if (output) process.stdout.write(output);
    process.stderr.write(
        `SIMULATOR_WATERING_MANIFEST ${JSON.stringify({rows, fromTs, toTs})}\n`
    );
}

async function printEnergyHistory(input: {
    profiles: ReturnType<typeof expandDeviceProfiles>;
    days: number;
    periodSeconds: number;
    fromTs?: number;
    toTs?: number;
    scenario?: SimulationScenario;
}): Promise<void> {
    const toTs =
        input.toTs ??
        Math.floor(Date.now() / 1000 / input.periodSeconds) *
            input.periodSeconds -
            input.periodSeconds;
    const fromTs = input.fromTs ?? toTs - input.days * 24 * 60 * 60;
    if (fromTs > toTs) {
        throw new Error(
            '--history-from-ts must be less than or equal to --history-to-ts'
        );
    }
    const manifest = new EnergyHistoryManifestBuilder();
    let output = '';
    for (const row of energyHistoryRows({
        profiles: input.profiles,
        fromTs,
        toTs,
        periodSeconds: input.periodSeconds,
        scenario: input.scenario
    })) {
        manifest.add(row);
        output += `${energyRowTsv(row)}\n`;
        if (output.length < 64 * 1024) continue;
        if (!process.stdout.write(output)) await once(process.stdout, 'drain');
        output = '';
    }
    if (output && !process.stdout.write(output)) {
        await once(process.stdout, 'drain');
    }
    process.stderr.write(
        `SIMULATOR_ENERGY_MANIFEST ${JSON.stringify(manifest.finish())}\n`
    );
}

/** Names the seeder chose, from a file, from the inline flag, or both. An
 *  unreadable file is fatal: a demo that silently opens with factory names is
 *  harder to notice than a run that refuses to start. */
export function loadDeviceNames(
    options: SimulatorCliOptions
): Record<string, string> | undefined {
    if (options.namesFile === undefined) return options.names;
    let raw: string;
    try {
        raw = readFileSync(options.namesFile, 'utf8');
    } catch (error) {
        throw new Error(
            `--names-file cannot be read: ${options.namesFile} (${error instanceof Error ? error.message : String(error)})`
        );
    }
    return {
        ...parseDeviceNames('--names-file', raw),
        ...options.names
    };
}

async function printSensorHistory(input: {
    profiles: ReturnType<typeof expandDeviceProfiles>;
    days: number;
    periodSeconds: number;
    fromTs?: number;
    toTs?: number;
    scenario?: SimulationScenario;
}): Promise<void> {
    const toTs =
        input.toTs ??
        Math.floor(Date.now() / 1000 / input.periodSeconds) *
            input.periodSeconds -
            input.periodSeconds;
    const fromTs = input.fromTs ?? toTs - input.days * 24 * 60 * 60;
    if (fromTs > toTs) {
        throw new Error(
            '--history-from-ts must be less than or equal to --history-to-ts'
        );
    }
    const manifest = new SensorHistoryManifestBuilder();
    let output = '';
    for (const row of sensorHistoryRows({
        profiles: input.profiles,
        fromTs,
        toTs,
        periodSeconds: input.periodSeconds,
        scenario: input.scenario
    })) {
        manifest.add(row);
        output += `${sensorRowTsv(row)}\n`;
        if (output.length < 64 * 1024) continue;
        if (!process.stdout.write(output)) await once(process.stdout, 'drain');
        output = '';
    }
    if (output && !process.stdout.write(output)) {
        await once(process.stdout, 'drain');
    }
    process.stderr.write(
        `SIMULATOR_SENSOR_MANIFEST ${JSON.stringify(manifest.finish())}\n`
    );
}

function validateWsUrl(value: string): void {
    const url = new URL(value);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        throw new Error('--ws-url must use ws: or wss:');
    }
}

function validateProfileKeys(keys: readonly string[] | undefined): void {
    for (const key of keys ?? []) {
        if (!PROFILE_CATALOG[key]) throw new Error(`unknown profile: ${key}`);
    }
}

async function waitForShutdown(simulator: FleetSimulator): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        let closing = false;
        const shutdown = async (): Promise<void> => {
            if (closing) return;
            closing = true;
            process.off('SIGINT', onSignal);
            process.off('SIGTERM', onSignal);
            try {
                await simulator.close();
                resolve();
            } catch (error) {
                reject(error);
            }
        };
        const onSignal = (): void => {
            void shutdown();
        };
        process.once('SIGINT', onSignal);
        process.once('SIGTERM', onSignal);
    });
}

export async function runSimulatorCli(
    args: readonly string[] = process.argv.slice(2)
): Promise<void> {
    const options = parseSimulatorCliArgs(args);
    if (options.help) {
        console.log(simulatorHelp());
        return;
    }
    validateProfileKeys(options.profiles);
    const names = loadDeviceNames(options);
    let profiles = expandDeviceProfiles({
        profiles: options.profiles,
        count: options.count
    });
    if (options.deviceIds) {
        profiles =
            options.printEnergyHistory || options.printSensorHistory
                ? rekeyProfilesForEnergyHistory(profiles, options.deviceIds)
                : selectProfilesByDeviceIds(profiles, options.deviceIds);
    }
    if (options.printIds) {
        console.log(profiles.map((profile) => profile.shellyID).join('\n'));
        return;
    }
    if (options.printBluIds) {
        // A scenario can pair a BLU sensor to a device the catalog ships
        // without one — the fixture probes do exactly that — so the children
        // the seeder has to admit exist only on the shaped fleet.
        console.log(
            bluChildDeviceIds(
                applyLiveSimulationScenario(profiles, options.scenario)
            ).join('\n')
        );
        return;
    }
    if (options.printWateringHistory) {
        printWateringHistory({
            profiles,
            days: options.historyDays,
            fromTs: options.historyFromTs,
            toTs: options.historyToTs
        });
        return;
    }
    if (options.printBluOwners) {
        // Which gateway hears which child. A community with two gateways has
        // one in each place, and their children are in those places too — a
        // flat list cannot say that, so every child landed in one building.
        const shaped = applyLiveSimulationScenario(profiles, options.scenario);
        console.log(
            shaped
                .flatMap((profile) =>
                    bluChildDeviceIds([profile]).map(
                        (child) => `${profile.shellyID}\t${child}`
                    )
                )
                .join('\n')
        );
        return;
    }
    if (options.printSensorHistory) {
        await printSensorHistory({
            profiles,
            days: options.historyDays,
            periodSeconds: options.historyPeriodSeconds,
            fromTs: options.historyFromTs,
            toTs: options.historyToTs,
            scenario: options.scenario
        });
        return;
    }
    if (options.printEnergyHistory) {
        await printEnergyHistory({
            profiles,
            days: options.historyDays,
            periodSeconds: options.historyPeriodSeconds,
            fromTs: options.historyFromTs,
            toTs: options.historyToTs,
            scenario: options.scenario
        });
        return;
    }

    validateWsUrl(options.wsUrl);
    profiles = applyLiveSimulationScenario(profiles, options.scenario);
    if (names) {
        const named = applyDeviceNames(profiles, names);
        profiles = named.profiles;
        if (named.unknownIds.length > 0) {
            process.stderr.write(
                `simulator: ignoring ${named.unknownIds.length} unknown name id(s): ${named.unknownIds.join(', ')}\n`
            );
        }
    }
    const simulator = new FleetSimulator({
        wsUrl: options.wsUrl,
        profiles,
        instanceSeed: simulatorInstanceSeed(
            options.wsUrl,
            tuning.devSimulation.instanceSeed
        ),
        energyHistorySeconds: options.emHistorySeconds,
        recordPushDropShare: options.emPushDropShare,
        bluBunched: options.bluBunched
    });
    simulator.start();
    await waitForShutdown(simulator);
}

if (typeof require !== 'undefined' && require.main === module) {
    runSimulatorCli().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
