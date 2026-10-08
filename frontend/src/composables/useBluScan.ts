import {type Ref, ref} from 'vue';
import {
    type BTHomeDiscoveryEvent,
    onBTHomeDiscovery,
    onBTHomeDone,
    sendRPC
} from '@/tools/websocket';

/** A gateway's discovery_done and its last device_discovered reach the browser
 *  as separate un-awaited events, so the final find can land just after the
 *  "done". Keep listening briefly instead of dropping it. */
const LATE_RESULT_GRACE_MS = 2000;

/** Only used if the gateway answers without saying how long it will scan. */
const FALLBACK_WINDOW_SEC = 30;

function macKey(mac: string): string {
    return mac.toUpperCase();
}

/**
 * One BLU discovery session against one gateway.
 *
 * The scan length is the backend's to decide: this asks for a scan and follows
 * the window the backend reports, so the value has a single home in tuning.
 */
export function useBluScan(
    gatewayId: Ref<string>,
    isPaired: (mac: string) => boolean
) {
    const scanning = ref(false);
    const found = ref<BTHomeDiscoveryEvent[]>([]);
    const secondsLeft = ref(0);
    /** Devices the gateway reported that are already paired here. Without this
     *  the gateway's count reads as a lie when fewer rows show. */
    const alreadyPairedCount = ref(0);

    let stopDiscovery: (() => void) | null = null;
    let stopDone: (() => void) | null = null;
    let tickTimer: ReturnType<typeof setInterval> | undefined;
    let windowTimer: ReturnType<typeof setTimeout> | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    function remember(event: BTHomeDiscoveryEvent): void {
        const key = macKey(event.mac);
        const at = found.value.findIndex((d) => macKey(d.mac) === key);
        if (at === -1) {
            found.value.push(event);
            return;
        }
        found.value[at] = {...found.value[at], ...event};
    }

    function onSighting(event: BTHomeDiscoveryEvent): void {
        if (event.shellyID !== gatewayId.value) return;
        if (!event.mac) return;
        if (isPaired(macKey(event.mac))) {
            alreadyPairedCount.value += 1;
            return;
        }
        remember(event);
    }

    function clearTimers(): void {
        if (tickTimer) clearInterval(tickTimer);
        if (windowTimer) clearTimeout(windowTimer);
        if (graceTimer) clearTimeout(graceTimer);
        tickTimer = undefined;
        windowTimer = undefined;
        graceTimer = undefined;
    }

    function stop(): void {
        clearTimers();
        stopDiscovery?.();
        stopDone?.();
        stopDiscovery = null;
        stopDone = null;
        scanning.value = false;
        secondsLeft.value = 0;
    }

    /** Close the session, but only after late results have had their chance. */
    function finishAfterGrace(): void {
        if (graceTimer) return;
        if (tickTimer) clearInterval(tickTimer);
        tickTimer = undefined;
        secondsLeft.value = 0;
        graceTimer = setTimeout(stop, LATE_RESULT_GRACE_MS);
    }

    function listen(): void {
        stopDiscovery = onBTHomeDiscovery(onSighting);
        stopDone = onBTHomeDone((event) => {
            if (event.shellyID !== gatewayId.value) return;
            finishAfterGrace();
        });
    }

    function countDown(windowSec: number): void {
        secondsLeft.value = windowSec;
        tickTimer = setInterval(() => {
            secondsLeft.value = Math.max(0, secondsLeft.value - 1);
        }, 1000);
        windowTimer = setTimeout(finishAfterGrace, windowSec * 1000);
    }

    async function start(): Promise<void> {
        stop();
        found.value = [];
        alreadyPairedCount.value = 0;
        scanning.value = true;
        // Listen before asking, so a gateway that answers fast loses nothing.
        listen();
        try {
            const started = await sendRPC(
                'FLEET_MANAGER',
                'BTHome.StartDiscovery',
                {shellyID: gatewayId.value}
            );
            countDown(started?.duration ?? FALLBACK_WINDOW_SEC);
        } catch (err) {
            stop();
            throw err;
        }
    }

    return {scanning, found, secondsLeft, alreadyPairedCount, start, stop};
}
