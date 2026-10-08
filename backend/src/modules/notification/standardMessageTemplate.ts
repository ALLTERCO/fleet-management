import type {
    MessageTemplate,
    MessageTemplateBodies
} from '../../types/api/notification';
import {alertLinkBase} from '../delivery/alertLink';
import type {ResolvedMessageTemplate} from '../delivery/types';
import {NOTIFICATION_BRAND, NOTIFICATION_GRADIENT} from './brand';

export const STANDARD_MESSAGE_TEMPLATE_ID = 0;
export const STANDARD_MESSAGE_TEMPLATE_NAME = 'Standard alert';
const SHELLY_EMAIL_LOGO_URL =
    'https://control.shelly.cloud/images/shelly-logo.svg';
const SHELLY_TEAMS_LOGO_URL =
    'data:image/png;base64,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';
const DEVICE_IMAGE_TOKEN = '{{device.imageUrl}}';
const TEAMS_SURFACE_IMAGE_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUSKk8x0NrtAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==';

function alertUrlTemplate(): string {
    const base = alertLinkBase().replace(/\/+$/, '');
    if (!base) return '';
    return `${base}${base.includes('?') ? '&' : '?'}instance={{alert.id}}`;
}

function alertsUrlTemplate(): string {
    return alertLinkBase().replace(/\/+$/, '');
}

function escapeHtmlAttribute(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function actionUrl(
    alertUrl: string,
    action: 'acknowledge' | 'silence'
): string {
    return `${alertUrl}${alertUrl.includes('?') ? '&' : '?'}action=${action}`;
}

function outlineIcon(
    kind: 'info' | 'active' | 'resolved' | 'rule' | 'device' | 'time',
    color: string
): string {
    const common = `display:inline-block;width:24px;height:24px;color:${color};vertical-align:middle`;
    const paths: Record<typeof kind, string> = {
        info: '<circle cx="16" cy="16" r="13"/><path d="M16 14v9M16 9h.01"/>',
        active: '<circle cx="16" cy="16" r="13"/><circle cx="16" cy="16" r="3" fill="currentColor" stroke="none"/>',
        resolved:
            '<circle cx="16" cy="16" r="13"/><path d="m10.5 16.5 3.6 3.6 7.4-8"/>',
        rule: '<circle cx="16" cy="16" r="13"/><path d="m18 6-9 12h7l-2 8 9-13h-7z"/>',
        device: '<path d="M1.2 5.6Q1.2 2 4.8 2h22.4q3.6 0 3.6 3.6v14.7l-9.2 9.2H10.4l-9.2-9.2Z"/><path stroke-width="2.4" d="M6.6 6.6h.01m4.8 0h.01m6.1 0h.01m3.8 0h.01m4.2 0h.01"/>',
        time: '<circle cx="16" cy="16" r="13"/><path d="M16 8v8h7"/>'
    };
    return `<svg role="img" aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="${common}">${paths[kind]}</svg>`;
}

function emailHtml(
    alertUrl: string,
    alertsUrl: string,
    logoUrl: string
): string {
    const brand = NOTIFICATION_BRAND;
    const singleAction = alertUrl
        ? `{{#is_single}}{{#is_active}}<tr><td style="padding:8px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="49%"><a href="${escapeHtmlAttribute(actionUrl(alertUrl, 'acknowledge'))}" style="display:block;padding:8px 8px;border:1px solid ${brand.shellyBlue};border-radius:10px;background:${brand.white};color:${brand.mediumBlue};text-align:center;text-decoration:none;font-size:14px;line-height:20px;font-weight:700">Acknowledge</a></td><td width="2%"></td><td width="49%"><a href="${escapeHtmlAttribute(actionUrl(alertUrl, 'silence'))}" style="display:block;padding:8px 8px;border:1px solid ${brand.shellyBlue};border-radius:10px;background:${brand.white};color:${brand.mediumBlue};text-align:center;text-decoration:none;font-size:14px;line-height:20px;font-weight:700">Silence</a></td></tr></table></td></tr>{{/is_active}}<tr><td style="padding:8px 0 0"><a href="${escapeHtmlAttribute(alertUrl)}" style="display:block;padding:10px 18px;border-radius:10px;background:${brand.mediumBlue};background-image:${NOTIFICATION_GRADIENT.primary};color:${brand.white};text-align:center;text-decoration:none;font-size:17px;line-height:22px;font-weight:750">View alert</a></td></tr>{{/is_single}}`
        : '';
    const groupedAction = alertsUrl
        ? `{{#is_grouped}}<tr><td style="padding:8px 0 0"><a href="${escapeHtmlAttribute(alertsUrl)}" style="display:block;padding:10px 18px;border-radius:10px;background:${brand.mediumBlue};background-image:${NOTIFICATION_GRADIENT.primary};color:${brand.white};text-align:center;text-decoration:none;font-size:17px;line-height:22px;font-weight:750">View alerts</a></td></tr>{{/is_grouped}}`
        : '';
    return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media(max-width:520px){.canvas{padding:10px!important}.logo-row{padding:14px 16px 4px!important}.hero{padding:0 16px 16px!important}.device-cell,.title-cell{display:block!important;width:100%!important;text-align:center!important}.hero-gap{display:none!important}.device-image{width:180px!important;max-width:62%!important;margin:0 auto!important}.title{margin-top:4px!important;font-size:24px!important;line-height:29px!important}.lower{padding:12px 16px 14px!important}.status-cell{font-size:14px!important}.detail-text{font-size:14px!important;line-height:19px!important}}</style></head>
<body style="margin:0;padding:0;background:${brand.frost};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${brand.white}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:${brand.frost}">
  <tr><td class="canvas" align="center" style="padding:16px 8px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:${brand.darkBlue};border:1px solid ${brand.gray};border-radius:16px;border-collapse:separate;overflow:hidden">
      <tr><td class="logo-row" style="padding:15px 18px 4px;border-radius:16px 16px 0 0"><img src="${escapeHtmlAttribute(logoUrl)}" width="96" alt="Shelly" style="display:block;width:96px;height:auto;border:0"></td></tr>
      {{#is_single}}<tr><td class="hero" style="padding:2px 18px 15px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>{{#is_has_device_image}}<td class="device-cell" width="38%" align="center" valign="middle"><img class="device-image" src="{{device.imageUrl}}" width="170" alt="Device" style="display:block;width:170px;max-width:100%;height:auto;border:0"></td><td class="hero-gap" width="4%"></td>{{/is_has_device_image}}<td class="title-cell" valign="middle"><h1 class="title" style="margin:0;color:${brand.white};font-size:28px;line-height:34px;font-weight:800;letter-spacing:-.02em;word-break:normal;overflow-wrap:break-word">{{alert.title}}</h1></td></tr></table></td></tr>{{/is_single}}
      {{#is_grouped}}<tr><td class="hero" align="center" style="padding:18px 18px 20px"><h1 class="title" style="margin:0;color:${brand.white};font-size:28px;line-height:34px;font-weight:800;letter-spacing:-.02em;word-break:normal;overflow-wrap:break-word">{{group.heading}}</h1><p style="margin:6px 0 0;color:${brand.lightBlue};font-size:15px;line-height:20px;font-weight:600;word-break:normal;overflow-wrap:break-word">{{rule.name}}</p></td></tr>{{/is_grouped}}
      <tr><td class="lower" style="padding:12px 18px 16px;background:${brand.frost};color:${brand.darkBlue};border-radius:0 0 16px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td class="status-cell" width="49%" align="center" style="padding:7px 5px;color:${brand.mediumBlue};font-size:15px;line-height:20px">${outlineIcon('info', brand.mediumBlue)}&nbsp;&nbsp;{{display.severityLabel}}</td><td width="2%" style="border-left:1px solid ${brand.gray}"></td>
          <td class="status-cell" width="49%" align="center" style="padding:7px 5px;color:{{display.stateColor}};font-size:15px;line-height:20px">{{#is_active}}${outlineIcon('active', '{{display.stateColor}}')}{{/is_active}}{{#is_acknowledged}}${outlineIcon('resolved', '{{display.stateColor}}')}{{/is_acknowledged}}{{#is_resolved}}${outlineIcon('resolved', '{{display.stateColor}}')}{{/is_resolved}}&nbsp;&nbsp;{{display.stateLabel}}</td>
        </tr></table></td></tr>
        {{#is_single}}<tr><td style="padding:6px 0 0;border-bottom:1px solid ${brand.frostBlue}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="40" align="center" style="padding:6px 4px;color:${brand.shellyBlue}">${outlineIcon('rule', brand.shellyBlue)}</td><td class="detail-text" align="center" style="padding:6px 8px 6px 0;color:${brand.darkBlue};font-size:15px;line-height:20px;word-break:normal;overflow-wrap:break-word">{{alert.message}}</td></tr></table></td></tr><tr><td style="border-bottom:1px solid ${brand.frostBlue}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="40" align="center" style="padding:6px 4px;color:${brand.shellyBlue}">${outlineIcon('device', brand.shellyBlue)}</td><td class="detail-text" align="center" style="padding:6px 8px 6px 0;color:${brand.darkBlue};font-size:15px;line-height:20px;word-break:normal;overflow-wrap:break-word">{{display.sourceLabel}}</td></tr></table></td></tr><tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="40" align="center" style="padding:6px 4px;color:${brand.shellyBlue}">${outlineIcon('time', brand.shellyBlue)}</td><td class="detail-text" align="center" style="padding:6px 8px 6px 0;color:${brand.darkBlue};font-size:15px;line-height:20px;word-break:normal;overflow-wrap:break-word">{{display.timeLabel}}</td></tr></table></td></tr>{{/is_single}}
        {{#is_grouped}}<tr><td style="padding:6px 0 0;border-bottom:1px solid ${brand.frostBlue}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="40" align="center" style="padding:6px 4px;color:${brand.shellyBlue}">${outlineIcon('device', brand.shellyBlue)}</td><td class="detail-text" align="left" style="padding:8px 12px 8px 4px;color:${brand.darkBlue};font-size:15px;line-height:21px;white-space:pre-line;word-break:normal;overflow-wrap:break-word">{{group.compactPreview}}</td></tr></table></td></tr><tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="40" align="center" style="padding:6px 4px;color:${brand.shellyBlue}">${outlineIcon('time', brand.shellyBlue)}</td><td class="detail-text" align="center" style="padding:8px 8px 8px 0;color:${brand.darkBlue};font-size:15px;line-height:20px;word-break:normal;overflow-wrap:break-word">{{group.compactTimeLabel}}</td></tr></table></td></tr>{{/is_grouped}}
        ${singleAction}${groupedAction}
      </table></td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
        .replace(/>\s+</g, '><')
        .trim();
}

function slackSingleBody(alertUrl: string): string {
    const childBlocks: Array<Record<string, unknown>> = [
        {
            type: 'context',
            block_id: 'standard_alert_status',
            elements: [
                {
                    type: 'plain_text',
                    text: '{{display.severityEmoji}} {{display.severityLabel}}  │  {{#is_active}}🚨{{/is_active}}{{#is_acknowledged}}✓{{/is_acknowledged}}{{#is_resolved}}✓{{/is_resolved}} {{display.stateLabel}}',
                    emoji: false
                }
            ]
        },
        {
            type: 'divider',
            block_id: 'standard_alert_divider'
        },
        {
            type: 'section',
            block_id: 'standard_alert_summary',
            expand: true,
            text: {
                type: 'mrkdwn',
                text: '{{alert.message}}\n\n*Source*  {{display.sourceLabel}}\n\n*Time*  {{display.timeLabel}}',
                verbatim: false
            },
            accessory: {
                type: 'image',
                image_url: DEVICE_IMAGE_TOKEN,
                alt_text: '{{display.sourceLabel}} device'
            }
        }
    ];
    if (alertUrl)
        childBlocks.push({
            type: 'actions',
            block_id: 'standard_alert_actions',
            elements: [{__actions__: true}]
        });
    const body = JSON.stringify({
        text: '{{display.severityLabel}}: {{alert.title}} — {{display.stateLabel}}. {{alert.message}}. {{display.sourceLabel}}. {{display.timeLabel}}.',
        unfurl_links: false,
        unfurl_media: false,
        blocks: [
            {
                type: 'container',
                block_id: 'standard_alert',
                width: 'standard',
                title: {
                    type: 'plain_text',
                    text: '{{alert.title}}',
                    emoji: false
                },
                child_blocks: childBlocks
            }
        ]
    });
    if (!alertUrl) return body;
    const view = {
        type: 'button',
        text: {type: 'plain_text', text: 'View alert'},
        url: alertUrl,
        action_id: 'view_alert',
        accessibility_label: 'View this alert in Shelly Fleet Manager'
    };
    const acknowledge = {
        type: 'button',
        text: {type: 'plain_text', text: 'Acknowledge'},
        url: actionUrl(alertUrl, 'acknowledge'),
        action_id: 'acknowledge',
        accessibility_label: 'Open this alert and acknowledge it'
    };
    const silence = {
        type: 'button',
        text: {type: 'plain_text', text: 'Silence'},
        url: actionUrl(alertUrl, 'silence'),
        action_id: 'silence',
        accessibility_label: 'Open this alert and silence it'
    };
    const actions = `${JSON.stringify(view)}{{#is_active}},${JSON.stringify(acknowledge)},${JSON.stringify(silence)}{{/is_active}}`;
    return body.replace('{"__actions__":true}', actions);
}

function slackGroupedBody(alertsUrl: string): string {
    const childBlocks: Array<Record<string, unknown>> = [
        {
            type: 'context',
            block_id: 'standard_alert_group_status',
            elements: [
                {
                    type: 'plain_text',
                    text: '{{display.severityEmoji}} {{display.severityLabel}}  │  {{#is_active}}🚨{{/is_active}}{{#is_acknowledged}}✓{{/is_acknowledged}}{{#is_resolved}}✓{{/is_resolved}} {{display.stateLabel}}',
                    emoji: false
                }
            ]
        },
        {
            type: 'divider',
            block_id: 'standard_alert_group_divider'
        },
        {
            type: 'section',
            block_id: 'standard_alert_group_preview',
            expand: true,
            text: {
                type: 'mrkdwn',
                text: '{{group.preview}}\n\n*Time*  {{group.timeLabel}}',
                verbatim: false
            }
        }
    ];
    if (alertsUrl) {
        childBlocks.push({
            type: 'actions',
            block_id: 'standard_alert_group_actions',
            elements: [
                {
                    type: 'button',
                    text: {type: 'plain_text', text: 'View alerts'},
                    url: alertsUrl,
                    action_id: 'view_alerts',
                    accessibility_label:
                        'View grouped alerts in Shelly Fleet Manager'
                }
            ]
        });
    }
    return JSON.stringify({
        text: '{{group.deviceTitle}} — {{group.preview}}',
        unfurl_links: false,
        unfurl_media: false,
        blocks: [
            {
                type: 'container',
                block_id: 'standard_alert_group',
                width: 'standard',
                title: {
                    type: 'plain_text',
                    text: '{{group.deviceTitle}}',
                    emoji: false
                },
                child_blocks: childBlocks
            }
        ]
    });
}

function slackBody(alertUrl: string, alertsUrl: string): string {
    return `{{#is_single}}${slackSingleBody(alertUrl)}{{/is_single}}{{#is_grouped}}${slackGroupedBody(alertsUrl)}{{/is_grouped}}`;
}

function teamsSingleBody(alertUrl: string): string {
    const items: Array<Record<string, unknown>> = [
        {
            type: 'Image',
            url: SHELLY_TEAMS_LOGO_URL,
            altText: 'Shelly',
            width: '96px',
            spacing: 'None'
        },
        {
            type: 'Container',
            targetWidth: 'atMost:narrow',
            spacing: 'Small',
            items: [
                {
                    type: 'Image',
                    url: DEVICE_IMAGE_TOKEN,
                    altText: 'Device',
                    height: '96px',
                    horizontalAlignment: 'Center'
                },
                {
                    type: 'TextBlock',
                    text: '{{alert.title}}',
                    size: 'Large',
                    weight: 'Bolder',
                    color: 'Light',
                    horizontalAlignment: 'Center',
                    spacing: 'Small',
                    wrap: true
                },
                teamsStatusRow(true)
            ]
        },
        {
            type: 'ColumnSet',
            spacing: 'Medium',
            targetWidth: 'atLeast:standard',
            columns: [
                {
                    type: 'Column',
                    width: 'auto',
                    verticalContentAlignment: 'Center',
                    items: [
                        {
                            type: 'Image',
                            url: DEVICE_IMAGE_TOKEN,
                            altText: 'Device',
                            height: '128px',
                            horizontalAlignment: 'Center'
                        }
                    ]
                },
                {
                    type: 'Column',
                    width: 'stretch',
                    verticalContentAlignment: 'Center',
                    items: [
                        {
                            type: 'TextBlock',
                            text: '{{alert.title}}',
                            size: 'Large',
                            weight: 'Bolder',
                            color: 'Light',
                            wrap: true
                        },
                        teamsStatusRow()
                    ]
                }
            ]
        },
        {
            type: 'Container',
            separator: true,
            spacing: 'Medium',
            items: [
                teamsFactRow('Rule', '{{alert.message}}'),
                teamsFactRow('Source', '{{display.sourceLabel}}'),
                teamsFactRow('Time', '{{display.timeLabel}}')
            ]
        }
    ];
    const body: Array<Record<string, unknown>> = [
        {
            type: 'Container',
            bleed: true,
            spacing: 'None',
            backgroundImage: {
                url: TEAMS_SURFACE_IMAGE_URL,
                fillMode: 'Repeat'
            },
            items
        }
    ];
    const card: Record<string, unknown> = {
        type: 'AdaptiveCard',
        version: '1.5',
        msteams: {width: 'Full'},
        fallbackText:
            '{{display.severityLabel}}: {{alert.title}} — {{display.stateLabel}}',
        body
    };
    if (!alertUrl) return JSON.stringify(card);
    const view = {
        type: 'Action.OpenUrl',
        title: 'View alert',
        style: 'positive',
        url: alertUrl
    };
    const acknowledge = {
        type: 'Action.OpenUrl',
        title: 'Acknowledge',
        style: 'positive',
        url: actionUrl(alertUrl, 'acknowledge')
    };
    const silence = {
        type: 'Action.OpenUrl',
        title: 'Silence',
        style: 'positive',
        url: actionUrl(alertUrl, 'silence')
    };
    items.push(
        {
            type: 'ActionSet',
            targetWidth: 'atMost:narrow',
            spacing: 'Large',
            actions: [{__actions__: true}]
        },
        {
            type: 'ActionSet',
            targetWidth: 'atLeast:standard',
            spacing: 'Large',
            actions: [{__actions__: true}]
        }
    );
    const actions = `${JSON.stringify(view)}{{#is_active}},${JSON.stringify(acknowledge)},${JSON.stringify(silence)}{{/is_active}}`;
    return JSON.stringify(card)
        .replace('{"__actions__":true}', actions)
        .replace('{"__actions__":true}', actions);
}

function teamsGroupedBody(alertsUrl: string): string {
    const items: Array<Record<string, unknown>> = [
        {
            type: 'Image',
            url: SHELLY_TEAMS_LOGO_URL,
            altText: 'Shelly',
            width: '96px',
            spacing: 'None'
        },
        {
            type: 'Container',
            spacing: 'Large',
            horizontalAlignment: 'Center',
            items: [
                {
                    type: 'TextBlock',
                    text: '{{group.heading}}',
                    size: 'Large',
                    weight: 'Bolder',
                    color: 'Light',
                    horizontalAlignment: 'Center',
                    spacing: 'Small',
                    wrap: true
                },
                {
                    type: 'TextBlock',
                    text: '{{rule.name}}',
                    color: 'Light',
                    isSubtle: true,
                    horizontalAlignment: 'Center',
                    spacing: 'Small',
                    wrap: true
                },
                teamsStatusRow(true)
            ]
        },
        {
            type: 'Container',
            spacing: 'Medium',
            separator: true,
            targetWidth: 'atMost:narrow',
            items: [
                {
                    type: 'TextBlock',
                    text: 'Affected devices',
                    color: 'Light',
                    isSubtle: true,
                    weight: 'Bolder',
                    spacing: 'None'
                },
                {
                    type: 'TextBlock',
                    text: '{{group.compactPreview}}',
                    color: 'Light',
                    spacing: 'Small',
                    wrap: true
                },
                {
                    type: 'TextBlock',
                    text: 'Alert window',
                    color: 'Light',
                    isSubtle: true,
                    weight: 'Bolder',
                    spacing: 'Medium'
                },
                {
                    type: 'TextBlock',
                    text: '{{group.compactTimeLabel}}',
                    color: 'Light',
                    spacing: 'Small',
                    wrap: true
                }
            ]
        },
        {
            type: 'ColumnSet',
            spacing: 'Medium',
            separator: true,
            targetWidth: 'atLeast:standard',
            columns: [
                {
                    type: 'Column',
                    width: 3,
                    items: [
                        {
                            type: 'TextBlock',
                            text: 'Affected devices',
                            color: 'Light',
                            isSubtle: true,
                            weight: 'Bolder',
                            spacing: 'None'
                        },
                        {
                            type: 'TextBlock',
                            text: '{{group.compactPreview}}',
                            color: 'Light',
                            spacing: 'Small',
                            wrap: true
                        }
                    ]
                },
                {
                    type: 'Column',
                    width: 2,
                    items: [
                        {
                            type: 'TextBlock',
                            text: 'Alert window',
                            color: 'Light',
                            isSubtle: true,
                            weight: 'Bolder',
                            spacing: 'None'
                        },
                        {
                            type: 'TextBlock',
                            text: '{{group.compactTimeLabel}}',
                            color: 'Light',
                            spacing: 'Small',
                            wrap: true
                        }
                    ]
                }
            ]
        }
    ];
    if (alertsUrl) {
        items.push({
            type: 'ActionSet',
            spacing: 'Large',
            actions: [
                {
                    type: 'Action.OpenUrl',
                    title: 'View alerts',
                    style: 'positive',
                    url: alertsUrl
                }
            ]
        });
    }
    return JSON.stringify({
        type: 'AdaptiveCard',
        version: '1.5',
        msteams: {width: 'Full'},
        fallbackText: '{{group.title}} — {{group.summary}}',
        body: [
            {
                type: 'Container',
                bleed: true,
                spacing: 'None',
                backgroundImage: {
                    url: TEAMS_SURFACE_IMAGE_URL,
                    fillMode: 'Repeat'
                },
                items
            }
        ]
    });
}

function teamsBody(alertUrl: string, alertsUrl: string): string {
    return `{{#is_single}}${teamsSingleBody(alertUrl)}{{/is_single}}{{#is_grouped}}${teamsGroupedBody(alertsUrl)}{{/is_grouped}}`;
}

function teamsFactRow(title: string, value: string): Record<string, unknown> {
    return {
        type: 'ColumnSet',
        spacing: 'Small',
        columns: [
            {
                type: 'Column',
                width: 1,
                items: [
                    {
                        type: 'TextBlock',
                        text: title,
                        color: 'Light',
                        weight: 'Bolder',
                        wrap: true
                    }
                ]
            },
            {
                type: 'Column',
                width: 3,
                items: [
                    {
                        type: 'TextBlock',
                        text: value,
                        color: 'Light',
                        wrap: true
                    }
                ]
            }
        ]
    };
}

function teamsStatusRow(centered = false): Record<string, unknown> {
    const columns: Array<Record<string, unknown>> = [
        {
            type: 'Column',
            width: 'auto',
            items: [
                {
                    type: 'Icon',
                    name: 'Info',
                    size: 'Small',
                    color: 'Light',
                    altText: 'Information'
                }
            ]
        },
        {
            type: 'Column',
            width: 'auto',
            items: [
                {
                    type: 'TextBlock',
                    text: '{{display.severityLabel}}',
                    color: 'Light',
                    weight: 'Bolder'
                }
            ]
        },
        {
            type: 'Column',
            width: 'auto',
            items: [
                {
                    type: 'TextBlock',
                    text: '│',
                    color: 'Light',
                    isSubtle: true
                }
            ]
        },
        {
            type: 'Column',
            width: 'auto',
            items: [
                {
                    type: 'Icon',
                    name: '{{#is_active}}AlertUrgent{{/is_active}}{{#is_acknowledged}}CheckmarkCircle{{/is_acknowledged}}{{#is_resolved}}CheckmarkCircle{{/is_resolved}}',
                    size: 'Small',
                    color: '{{#is_active}}Attention{{/is_active}}{{#is_acknowledged}}Good{{/is_acknowledged}}{{#is_resolved}}Good{{/is_resolved}}',
                    altText: '{{display.stateLabel}}'
                }
            ]
        },
        {
            type: 'Column',
            width: 'auto',
            items: [
                {
                    type: 'TextBlock',
                    text: '{{display.stateLabel}}',
                    color: '{{#is_active}}Light{{/is_active}}{{#is_acknowledged}}Good{{/is_acknowledged}}{{#is_resolved}}Good{{/is_resolved}}',
                    weight: 'Bolder'
                }
            ]
        }
    ];
    if (centered) {
        columns.unshift({type: 'Column', width: 'stretch'});
        columns.push({type: 'Column', width: 'stretch'});
    }
    return {
        type: 'ColumnSet',
        spacing: 'Small',
        columns
    };
}

function standardBodies(): MessageTemplateBodies {
    const alertUrl = alertUrlTemplate();
    const alertsUrl = alertsUrlTemplate();
    const logoUrl = SHELLY_EMAIL_LOGO_URL;
    return {
        email: {
            subject:
                '{{#is_single}}[{{display.severityLabel}}] {{alert.title}}{{/is_single}}{{#is_grouped}}[{{display.severityLabel}}] {{group.title}}{{/is_grouped}}',
            html: emailHtml(alertUrl, alertsUrl, logoUrl),
            text: '{{#is_single}}{{display.severityEmoji}} {{display.severityLabel}} · {{display.stateLabel}}\n{{alert.title}}\n\n{{alert.message}}\n\nRule: {{rule.name}}\nSource: {{display.sourceLabel}}\nTime: {{display.timeLabel}}{{/is_single}}{{#is_grouped}}{{display.severityEmoji}} {{display.severityLabel}} · {{display.stateLabel}}\n{{group.title}}\n{{group.summary}}\n\n{{group.preview}}\n\nRule: {{rule.name}}\nTime: {{group.timeLabel}}{{/is_grouped}}'
        },
        slack: {blocks: slackBody(alertUrl, alertsUrl)},
        teams: {card: teamsBody(alertUrl, alertsUrl)}
    };
}

const STANDARD_FALLBACK =
    '{{#is_single}}{{display.severityEmoji}} {{display.severityLabel}} · {{display.stateLabel}}\n{{alert.title}}\n\n{{alert.message}}\n\nRule: {{rule.name}}\nSource: {{display.sourceLabel}}\nTime: {{display.timeLabel}}{{/is_single}}{{#is_grouped}}{{display.severityEmoji}} {{display.severityLabel}} · {{display.stateLabel}}\n{{group.title}}\n{{group.summary}}\n\n{{group.preview}}\n\nRule: {{rule.name}}\nTime: {{group.timeLabel}}{{/is_grouped}}';

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
            'Built-in reusable alert message for email, Slack, Teams, Telegram, and push notifications.',
        bodies: standardBodies(),
        fallbackText: STANDARD_FALLBACK,
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: null
    };
}

export function standardResolvedMessageTemplate(): ResolvedMessageTemplate {
    return {
        bodies: standardBodies(),
        fallbackText: STANDARD_FALLBACK,
        isSystemDefault: true
    };
}
