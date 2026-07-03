/** device_back_online — informational on Shelly.Connect (spec §8.3). */
import {fingerprintV2, timestampedDiscriminator} from '../fingerprint';
import type {Evaluator, MatchResult} from '../types';

const KIND = 'device_back_online';

function buildMatch(
    ruleId: number,
    ruleName: string,
    shellyID: string,
    deviceName: string | undefined
): MatchResult {
    const display = deviceName || shellyID;
    return {
        fingerprintV2: fingerprintV2({
            ruleId,
            subjectType: 'device',
            subjectId: shellyID,
            discriminator: timestampedDiscriminator(Date.now())
        }),
        title: `${display} is back online`,
        message: `Device ${display} (${shellyID}) reconnected. Rule: ${ruleName}.`,
        subject: {type: 'device', id: shellyID},
        context: {shellyID}
    };
}

export const deviceBackOnlineEvaluator: Evaluator = {
    triggerKinds: ['device_online'],

    match(event, rule) {
        if (rule.kind !== KIND) return null;
        if (event.kind !== 'device_online') return null;
        return buildMatch(
            rule.id,
            rule.name,
            event.shellyID,
            event.device?.info?.name as string | undefined
        );
    }
};
