/**
 * Does this install have Node-RED at all?
 *
 * Its own file so the answer is one line in one place. Every caller has to
 * distinguish "there are no automations" from "there is no Node-RED here",
 * because to an operator the first sentence reads as "your automations have
 * vanished".
 */

import {tuning} from '../../config/tuning';

export function nodeRedAvailable(): boolean {
    return tuning.nodeRed.enabled;
}
