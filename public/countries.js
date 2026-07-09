// ISO 3166-1 alpha-2 country code -> English name. Flag emoji is auto-generated from the code.
// Sorted alphabetically by English name (the dropdown renders in array order).
// Trimmed to a core list of higher-traffic countries per user request.
const COUNTRIES = [
  ['DZ', 'Algeria'], ['AM', 'Armenia'], ['AU', 'Australia'], ['AT', 'Austria'],
  ['AZ', 'Azerbaijan'], ['BE', 'Belgium'], ['BR', 'Brazil'], ['BG', 'Bulgaria'],
  ['CA', 'Canada'], ['CL', 'Chile'], ['CN', 'China'], ['HR', 'Croatia'],
  ['CZ', 'Czechia'], ['DK', 'Denmark'], ['EG', 'Egypt'], ['FI', 'Finland'],
  ['FR', 'France'], ['DE', 'Germany'], ['GR', 'Greece'], ['HU', 'Hungary'],
  ['IN', 'India'], ['ID', 'Indonesia'], ['IR', 'Iran'], ['IQ', 'Iraq'],
  ['IE', 'Ireland'], ['IT', 'Italy'], ['JP', 'Japan'], ['JO', 'Jordan'],
  ['KZ', 'Kazakhstan'], ['KG', 'Kyrgyzstan'], ['LB', 'Lebanon'], ['MY', 'Malaysia'],
  ['MX', 'Mexico'], ['MA', 'Morocco'], ['NL', 'Netherlands'], ['NZ', 'New Zealand'],
  ['NO', 'Norway'], ['PK', 'Pakistan'], ['PE', 'Peru'], ['PH', 'Philippines'],
  ['PL', 'Poland'], ['PT', 'Portugal'], ['QA', 'Qatar'], ['RO', 'Romania'],
  ['RU', 'Russia'], ['SA', 'Saudi Arabia'], ['RS', 'Serbia'], ['SG', 'Singapore'],
  ['SK', 'Slovakia'], ['ZA', 'South Africa'], ['KR', 'South Korea'], ['ES', 'Spain'],
  ['SE', 'Sweden'], ['CH', 'Switzerland'], ['TH', 'Thailand'], ['TR', 'Turkey'],
  ['UA', 'Ukraine'], ['AE', 'United Arab Emirates'], ['GB', 'United Kingdom'],
  ['US', 'United States'],
];

function flagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '🏳️';
  const codePoints = [...countryCode.toUpperCase()].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// Also loadable with require() on the server (country-code validation);
// in the browser `module` doesn't exist and this is skipped.
if (typeof module !== 'undefined') {
  module.exports = { COUNTRIES };
}
