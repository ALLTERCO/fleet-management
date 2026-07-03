import {describe, expect, it} from 'vitest';

import {
    entityCommandFeedbackMode,
    predictedStatusPatchFor
} from '../src/helpers/entityCommandCatalog';

// Regression guard for the dimmer/bulb flicker bug. Predictions must include
// ONLY the fields the action directly sets — never derived state like `output`
// from `brightness`. Intermediate firmware ramp values won't echoConfirm
// against derived predictions, so the overlay would stick and the UI flicks.
describe('entityCommandCatalog — prediction contract', () => {
    describe('light.setBrightness predicts only brightness', () => {
        it('positive brightness has no output field', () => {
            const patch = predictedStatusPatchFor(
                'light',
                'setBrightness',
                {brightness: 50},
                {output: false, brightness: 10}
            );
            expect(patch).toEqual({brightness: 50});
            expect(patch).not.toHaveProperty('output');
        });

        it('brightness=0 still has no output field', () => {
            const patch = predictedStatusPatchFor(
                'light',
                'setBrightness',
                {brightness: 0},
                {output: true, brightness: 80}
            );
            expect(patch).toEqual({brightness: 0});
            expect(patch).not.toHaveProperty('output');
        });
    });

    describe('bulb variants — setBrightness/setColor have no derived output', () => {
        const profiles = ['cct', 'rgb', 'rgbw', 'rgbcct'] as const;

        for (const profile of profiles) {
            it(`${profile}.setBrightness predicts only brightness`, () => {
                const patch = predictedStatusPatchFor(
                    profile,
                    'setBrightness',
                    {brightness: 60},
                    {output: false}
                );
                expect(patch).toEqual({brightness: 60});
            });

            it(`${profile}.setColor predicts only rgb`, () => {
                const patch = predictedStatusPatchFor(
                    profile,
                    'setColor',
                    {rgb: [255, 100, 0]},
                    {output: false}
                );
                expect(patch).toEqual({rgb: [255, 100, 0]});
                expect(patch).not.toHaveProperty('output');
            });
        }
    });

    describe('media play actions do not predict media_type', () => {
        const actions = [
            'playFavourite',
            'playNextFavourite',
            'playPreviousFavourite'
        ];

        for (const action of actions) {
            it(`media.${action} predicts only playback.enable`, () => {
                const patch = predictedStatusPatchFor(
                    'media',
                    action,
                    {favouriteId: 0},
                    {playback: {enable: false}}
                );
                expect(patch).toEqual({playback: {enable: true}});
                expect(patch?.playback).not.toHaveProperty('media_type');
            });
        }
    });

    describe('toggle and explicit setters still predict the toggled/set field', () => {
        it('light.toggle flips output', () => {
            expect(
                predictedStatusPatchFor('light', 'toggle', undefined, {
                    output: true
                })
            ).toEqual({output: false});
        });

        it('light.setOutput predicts explicit output', () => {
            expect(
                predictedStatusPatchFor(
                    'light',
                    'setOutput',
                    {on: true},
                    undefined
                )
            ).toEqual({output: true});
        });

        it('switch.toggle flips output', () => {
            expect(
                predictedStatusPatchFor('switch', 'toggle', undefined, {
                    output: false
                })
            ).toEqual({output: true});
        });
    });

    describe('feedback mode is unchanged', () => {
        it('light.setBrightness remains instant', () => {
            expect(entityCommandFeedbackMode('light', 'setBrightness')).toBe(
                'instant'
            );
        });

        it('cover.open remains pending', () => {
            expect(entityCommandFeedbackMode('cover', 'open')).toBe('pending');
        });
    });
});
