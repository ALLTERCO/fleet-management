// Per-channel quiet hours form state. Channels are the single source of truth.

import type {Channel} from '@api/channel';
import {ref} from 'vue';
import {useChannelsStore} from '@/stores/channels';

export interface QuietHoursPatch {
    startHour: number;
    endHour: number;
    timezone: string;
}

export interface QuietHoursForm {
    start: string;
    end: string;
    timezone: string;
}

export function useChannelQuietHours() {
    const channels = useChannelsStore();
    const form = ref<QuietHoursForm>({start: '', end: '', timezone: ''});

    async function load(channel: Channel | null): Promise<void> {
        clear();
        if (!channel?.id) return;
        const loaded = await channels.fetchChannel(channel.id);
        if (!loaded?.quietHours) return;
        form.value = {
            start: String(loaded.quietHours.startHour),
            end: String(loaded.quietHours.endHour),
            timezone: loaded.quietHours.timezone ?? ''
        };
    }

    function clear(): void {
        form.value = {start: '', end: '', timezone: ''};
    }

    function buildPatch(): QuietHoursPatch | null {
        const startRaw = form.value.start.trim();
        const endRaw = form.value.end.trim();
        const tz = form.value.timezone.trim();
        if (!startRaw && !endRaw && !tz) return null;
        const start = Number(startRaw);
        const end = Number(endRaw);
        if (
            !Number.isInteger(start) ||
            !Number.isInteger(end) ||
            start < 0 ||
            start > 23 ||
            end < 0 ||
            end > 23
        ) {
            return null;
        }
        return {
            startHour: start,
            endHour: end,
            timezone: tz || 'UTC'
        };
    }

    return {form, load, clear, buildPatch};
}
