// Canonical standards — ISO 3166-1 alpha-2 countries, ISO 4217 currencies,
// IANA time zones. Timezone + currency lists come from the Node Intl API
// (no new dep). Country codes are hardcoded because Intl has no such set.

/** ISO 3166-1 alpha-2 country codes. Stable 2-letter identifiers. */
export const ISO_COUNTRY_CODES: readonly string[] = Object.freeze([
    'AD',
    'AE',
    'AF',
    'AG',
    'AI',
    'AL',
    'AM',
    'AO',
    'AQ',
    'AR',
    'AS',
    'AT',
    'AU',
    'AW',
    'AX',
    'AZ',
    'BA',
    'BB',
    'BD',
    'BE',
    'BF',
    'BG',
    'BH',
    'BI',
    'BJ',
    'BL',
    'BM',
    'BN',
    'BO',
    'BQ',
    'BR',
    'BS',
    'BT',
    'BV',
    'BW',
    'BY',
    'BZ',
    'CA',
    'CC',
    'CD',
    'CF',
    'CG',
    'CH',
    'CI',
    'CK',
    'CL',
    'CM',
    'CN',
    'CO',
    'CR',
    'CU',
    'CV',
    'CW',
    'CX',
    'CY',
    'CZ',
    'DE',
    'DJ',
    'DK',
    'DM',
    'DO',
    'DZ',
    'EC',
    'EE',
    'EG',
    'EH',
    'ER',
    'ES',
    'ET',
    'FI',
    'FJ',
    'FK',
    'FM',
    'FO',
    'FR',
    'GA',
    'GB',
    'GD',
    'GE',
    'GF',
    'GG',
    'GH',
    'GI',
    'GL',
    'GM',
    'GN',
    'GP',
    'GQ',
    'GR',
    'GS',
    'GT',
    'GU',
    'GW',
    'GY',
    'HK',
    'HM',
    'HN',
    'HR',
    'HT',
    'HU',
    'ID',
    'IE',
    'IL',
    'IM',
    'IN',
    'IO',
    'IQ',
    'IR',
    'IS',
    'IT',
    'JE',
    'JM',
    'JO',
    'JP',
    'KE',
    'KG',
    'KH',
    'KI',
    'KM',
    'KN',
    'KP',
    'KR',
    'KW',
    'KY',
    'KZ',
    'LA',
    'LB',
    'LC',
    'LI',
    'LK',
    'LR',
    'LS',
    'LT',
    'LU',
    'LV',
    'LY',
    'MA',
    'MC',
    'MD',
    'ME',
    'MF',
    'MG',
    'MH',
    'MK',
    'ML',
    'MM',
    'MN',
    'MO',
    'MP',
    'MQ',
    'MR',
    'MS',
    'MT',
    'MU',
    'MV',
    'MW',
    'MX',
    'MY',
    'MZ',
    'NA',
    'NC',
    'NE',
    'NF',
    'NG',
    'NI',
    'NL',
    'NO',
    'NP',
    'NR',
    'NU',
    'NZ',
    'OM',
    'PA',
    'PE',
    'PF',
    'PG',
    'PH',
    'PK',
    'PL',
    'PM',
    'PN',
    'PR',
    'PS',
    'PT',
    'PW',
    'PY',
    'QA',
    'RE',
    'RO',
    'RS',
    'RU',
    'RW',
    'SA',
    'SB',
    'SC',
    'SD',
    'SE',
    'SG',
    'SH',
    'SI',
    'SJ',
    'SK',
    'SL',
    'SM',
    'SN',
    'SO',
    'SR',
    'SS',
    'ST',
    'SV',
    'SX',
    'SY',
    'SZ',
    'TC',
    'TD',
    'TF',
    'TG',
    'TH',
    'TJ',
    'TK',
    'TL',
    'TM',
    'TN',
    'TO',
    'TR',
    'TT',
    'TV',
    'TW',
    'TZ',
    'UA',
    'UG',
    'UM',
    'US',
    'UY',
    'UZ',
    'VA',
    'VC',
    'VE',
    'VG',
    'VI',
    'VN',
    'VU',
    'WF',
    'WS',
    'YE',
    'YT',
    'ZA',
    'ZM',
    'ZW'
]);

const COUNTRY_SET = new Set(ISO_COUNTRY_CODES);

export function isValidCountryCode(value: string): boolean {
    return COUNTRY_SET.has(value);
}

/** ISO 4217 currency codes via Node Intl API. Cached at module load. */
export const ISO_CURRENCY_CODES: readonly string[] = Object.freeze(
    Intl.supportedValuesOf('currency')
);

const CURRENCY_SET = new Set(ISO_CURRENCY_CODES);

export function isValidCurrency(value: string): boolean {
    return CURRENCY_SET.has(value);
}

/** Canonical IANA zone names for pickers. Excludes aliases like UTC and
 *  Asia/Kolkata — do NOT use for validation (see isValidTimezone). */
export const IANA_TIMEZONES: readonly string[] = Object.freeze(
    Intl.supportedValuesOf('timeZone')
);

// Accept any zone the runtime can actually use — supportedValuesOf omits live
// aliases (UTC, Asia/Kolkata, Europe/Kyiv) that DateTimeFormat handles fine, so
// validate by constructing rather than by list membership.
export function isValidTimezone(value: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', {timeZone: value});
        return true;
    } catch {
        return false;
    }
}

/** ISO 3166-2 region code — structural check only (parent country prefix
 *  + 1-3 alphanum segment). Avoids shipping the 5000-entry full list. */
const REGION_CODE_RE = /^([A-Z]{2})-([A-Z0-9]{1,3})$/;

export function isValidRegionCode(
    value: string,
    parentCountryCode?: string
): boolean {
    const match = REGION_CODE_RE.exec(value);
    if (!match) return false;
    if (parentCountryCode && match[1] !== parentCountryCode) return false;
    return COUNTRY_SET.has(match[1] ?? '');
}

/** IATA-style 3-letter code (kept for org-specific use via customFields;
 *  not part of the required field set — field-service dispatch is a niche). */
const IATA_RE = /^[A-Z]{3}$/;

export function isValidIataCode(value: string): boolean {
    return IATA_RE.test(value);
}
