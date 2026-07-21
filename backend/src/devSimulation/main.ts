import {once} from 'node:events';
import {energyHistoryRows, energyRowTsv} from './energyHistory';
import {FleetSimulator} from './FleetSimulator';
import {
    bluChildDeviceIds,
    DEFAULT_PROFILE_KEYS,
    expandDeviceProfiles,
    PROFILE_CATALOG
} from './profiles';

const DEFAULT_WS_URL = 'ws://127.0.0.1:7011/shelly';

export interface SimulatorCliOptions {
    wsUrl: string;
    count?: number;
    profiles?: string[];
    deviceIds?: string[];
    printIds: boolean;
    printBluIds: boolean;
    printEnergyHistory: boolean;
    historyDays: number;
    historyPeriodSeconds: number;
    help: boolean;
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
        printEnergyHistory: false,
        historyDays: 30,
        historyPeriodSeconds: 3600,
        help: false
    };
    const profiles: string[] = [];

    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (argument === '--print-ids') {
            options.printIds = true;
            continue;
        }
        if (argument === '--print-blu-ids') {
            options.printBluIds = true;
            continue;
        }
        if (argument === '--print-energy-history') {
            options.printEnergyHistory = true;
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
        if (argument === '--profile' || argument === '--profiles') {
            appendProfiles(profiles, optionValue(args, index++));
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
        '  --print-ids          Print deterministic IDs and exit',
        '  --print-blu-ids      Print deterministic BLU child IDs and exit',
        '  --print-energy-history  Print deterministic meter history as TSV',
        '  --history-days <n>   History window (default: 30)',
        '  --history-period-seconds <n>  Sample period (default: 3600)',
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

async function printEnergyHistory(input: {
    profiles: ReturnType<typeof expandDeviceProfiles>;
    days: number;
    periodSeconds: number;
}): Promise<void> {
    const toTs =
        Math.floor(Date.now() / 1000 / input.periodSeconds) *
            input.periodSeconds -
        input.periodSeconds;
    const fromTs = toTs - input.days * 24 * 60 * 60;
    let output = '';
    for (const row of energyHistoryRows({
        profiles: input.profiles,
        fromTs,
        toTs,
        periodSeconds: input.periodSeconds
    })) {
        output += `${energyRowTsv(row)}\n`;
        if (output.length < 64 * 1024) continue;
        if (!process.stdout.write(output)) await once(process.stdout, 'drain');
        output = '';
    }
    if (output && !process.stdout.write(output)) {
        await once(process.stdout, 'drain');
    }
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
    let profiles = expandDeviceProfiles({
        profiles: options.profiles,
        count: options.count
    });
    if (options.deviceIds) {
        profiles = selectProfilesByDeviceIds(profiles, options.deviceIds);
    }
    if (options.printIds) {
        console.log(profiles.map((profile) => profile.shellyID).join('\n'));
        return;
    }
    if (options.printBluIds) {
        console.log(bluChildDeviceIds(profiles).join('\n'));
        return;
    }
    if (options.printEnergyHistory) {
        await printEnergyHistory({
            profiles,
            days: options.historyDays,
            periodSeconds: options.historyPeriodSeconds
        });
        return;
    }

    validateWsUrl(options.wsUrl);
    const simulator = new FleetSimulator({wsUrl: options.wsUrl, profiles});
    simulator.start();
    await waitForShutdown(simulator);
}

if (typeof require !== 'undefined' && require.main === module) {
    runSimulatorCli().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
