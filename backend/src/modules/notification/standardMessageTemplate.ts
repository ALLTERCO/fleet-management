import type {MessageTemplate} from '../../types/api/notification';
import type {ResolvedMessageTemplate} from '../delivery/types';

export const STANDARD_MESSAGE_TEMPLATE_ID = 0;
export const STANDARD_MESSAGE_TEMPLATE_NAME = 'Standard alert';

const STANDARD_BODIES = Object.freeze({
    email: {
        subject: '{{display.severityLabel}}: {{alert.title}}',
        html: '<div style="font-family:Arial,sans-serif;border-left:4px solid {{display.severityColor}};padding-left:16px"><h2>{{display.severityEmoji}} {{alert.title}}</h2><p>{{alert.message}}</p><p><strong>Severity:</strong> {{display.severityLabel}}<br><strong>State:</strong> {{display.stateLabel}}<br><strong>Rule:</strong> {{rule.name}}<br><strong>Source:</strong> {{alert.source.type}}/{{alert.source.id}}<br><strong>Time:</strong> {{alert.firedAt}}</p></div>',
        text: '{{display.severityEmoji}} {{display.severityLabel}}: {{alert.title}}\n{{alert.message}}\n\nState: {{display.stateLabel}}\nRule: {{rule.name}}\nSource: {{alert.source.type}}/{{alert.source.id}}\nTime: {{alert.firedAt}}'
    },
    slack: {
        blocks: JSON.stringify([
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: '{{display.slackSeverityEmoji}} *{{display.severityLabel}}: {{alert.title}}*\n{{alert.message}}'
                }
            },
            {
                type: 'context',
                elements: [
                    {type: 'mrkdwn', text: 'State: {{display.stateLabel}}'},
                    {type: 'mrkdwn', text: 'Rule: {{rule.name}}'},
                    {
                        type: 'mrkdwn',
                        text: 'Source: {{alert.source.type}}/{{alert.source.id}}'
                    }
                ]
            }
        ])
    },
    teams: {
        card: JSON.stringify({
            type: 'AdaptiveCard',
            version: '1.4',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            body: [
                {
                    type: 'TextBlock',
                    size: 'Medium',
                    weight: 'Bolder',
                    wrap: true,
                    color: '{{#is_critical}}Attention{{/is_critical}}{{#is_warning}}Warning{{/is_warning}}{{#is_info}}Accent{{/is_info}}',
                    text: '{{display.severityEmoji}} {{display.severityLabel}}: {{alert.title}}'
                },
                {type: 'TextBlock', wrap: true, text: '{{alert.message}}'},
                {
                    type: 'FactSet',
                    facts: [
                        {title: 'State', value: '{{display.stateLabel}}'},
                        {title: 'Rule', value: '{{rule.name}}'},
                        {
                            title: 'Source',
                            value: '{{alert.source.type}}/{{alert.source.id}}'
                        },
                        {title: 'Time', value: '{{alert.firedAt}}'}
                    ]
                }
            ]
        })
    }
});

const STANDARD_FALLBACK =
    '{{display.severityEmoji}} {{display.severityLabel}}: {{alert.title}}\n{{alert.message}}\n\nState: {{display.stateLabel}}\nRule: {{rule.name}}\nSource: {{alert.source.type}}/{{alert.source.id}}\nTime: {{alert.firedAt}}';

export function isStandardMessageTemplateId(id: number | null): boolean {
    return id === STANDARD_MESSAGE_TEMPLATE_ID;
}

export function standardMessageTemplate(
    organizationId: string
): MessageTemplate {
    return {
        id: STANDARD_MESSAGE_TEMPLATE_ID,
        organizationId,
        name: STANDARD_MESSAGE_TEMPLATE_NAME,
        description:
            'Built-in reusable alert message for email, Slack, Teams, Telegram, and plain-text channels.',
        bodies: STANDARD_BODIES,
        fallbackText: STANDARD_FALLBACK,
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: null
    };
}

export function standardResolvedMessageTemplate(): ResolvedMessageTemplate {
    return {
        bodies: STANDARD_BODIES,
        fallbackText: STANDARD_FALLBACK
    };
}
