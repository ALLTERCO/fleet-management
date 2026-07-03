export interface PluginWorkerLimitConfig {
    workerMaxOldGenerationSizeMb: number;
    workerMaxYoungGenerationSizeMb: number;
    workerStackSizeMb: number;
}

export function pluginWorkerResourceLimits(config: PluginWorkerLimitConfig) {
    return {
        maxOldGenerationSizeMb: config.workerMaxOldGenerationSizeMb,
        maxYoungGenerationSizeMb: config.workerMaxYoungGenerationSizeMb,
        stackSizeMb: config.workerStackSizeMb
    };
}

export function hasPluginWorkerCapacity(
    activeWorkers: number,
    startingWorkers: number,
    maxWorkers: number
): boolean {
    return activeWorkers + startingWorkers < maxWorkers;
}
