import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {eventListenerExcess} from '../src/helpers/eventListenerHealth.ts';

test('zero-client baseline keeps backend listeners visible to the threshold', () => {
    assert.equal(
        eventListenerExcess({eventsListeners: 547, eventsTypes: 90, wsClients: 0}),
        547
    );
});

test('normal browser fan-out does not look like a listener leak', () => {
    // Live v1.91 observations follow the same 90-listener/client slope.
    assert.equal(
        eventListenerExcess({eventsListeners: 276, eventsTypes: 90, wsClients: 3}),
        6
    );
    assert.equal(
        eventListenerExcess({eventsListeners: 366, eventsTypes: 90, wsClients: 4}),
        6
    );
    // v1.91: 90 static subscriptions/client + six fixed internal listeners +
    // one scoped dashboard STATUS subscription = the observed healthy 547.
    assert.equal(
        eventListenerExcess({eventsListeners: 547, eventsTypes: 90, wsClients: 6}),
        7
    );
    // v1.92 adds two static subscribed event names; the same shape stays safe.
    assert.equal(
        eventListenerExcess({eventsListeners: 559, eventsTypes: 92, wsClients: 6}),
        7
    );
});

test('subscriptions beyond client fan-out remain actionable', () => {
    assert.equal(
        eventListenerExcess({eventsListeners: 1101, eventsTypes: 90, wsClients: 6}),
        561
    );
});

test('monitoring health and bottleneck UI use normalized excess', () => {
    const store = readFileSync(
        new URL('../src/stores/monitoring.ts', import.meta.url),
        'utf8'
    );
    const bottlenecks = readFileSync(
        new URL('../src/composables/useBottleneckAnalysis.ts', import.meta.url),
        'utf8'
    );
    const eventsPage = readFileSync(
        new URL('../src/pages/settings/monitoring/events.vue', import.meta.url),
        'utf8'
    );

    assert.match(store, /const excess = eventListenerExcess\(snap\)/);
    assert.doesNotMatch(store, /snap\.eventsListeners > EVENT_LISTENERS_WARN/);
    assert.match(bottlenecks, /const excess = eventListenerExcess\(s\)/);
    assert.match(bottlenecks, /name: 'Event Subscription Excess'/);
    assert.match(eventsPage, /listenerExcess > EVENT_LISTENERS_WARN/);
    assert.doesNotMatch(eventsPage, /eventsListeners > 500/);
});
