export const NOTIFICATION_BRAND = {
    shellyBlue: '#4495D1',
    mediumBlue: '#003C82',
    darkBlue: '#122A4F',
    lightBlue: '#AAE1FA',
    gray: '#A0A0A0',
    darkGray: '#6E6E6E',
    lightGray: '#E6E6E6',
    frost: '#ECEFF4',
    frostBlue: '#637993',
    white: '#FFFFFF',
    resolvedGreen: '#48D7A0'
} as const;

export const NOTIFICATION_GRADIENT = {
    primary: `linear-gradient(90deg,${NOTIFICATION_BRAND.shellyBlue},${NOTIFICATION_BRAND.mediumBlue})`,
    neutral: `linear-gradient(90deg,${NOTIFICATION_BRAND.darkGray},${NOTIFICATION_BRAND.lightGray})`,
    frost: `linear-gradient(90deg,${NOTIFICATION_BRAND.frost},${NOTIFICATION_BRAND.frostBlue})`
} as const;
