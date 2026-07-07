// ISO 3166-1 alpha-2 country code -> English name. Flag emoji is auto-generated from the code.
const COUNTRIES = [
  ['TR', 'Turkey'], ['US', 'United States'], ['DE', 'Germany'], ['FR', 'France'],
  ['GB', 'United Kingdom'], ['IT', 'Italy'], ['ES', 'Spain'], ['NL', 'Netherlands'],
  ['BE', 'Belgium'], ['CH', 'Switzerland'], ['AT', 'Austria'], ['SE', 'Sweden'],
  ['NO', 'Norway'], ['DK', 'Denmark'], ['FI', 'Finland'], ['PL', 'Poland'],
  ['PT', 'Portugal'], ['GR', 'Greece'], ['IE', 'Ireland'], ['CZ', 'Czechia'],
  ['RO', 'Romania'], ['HU', 'Hungary'], ['BG', 'Bulgaria'], ['UA', 'Ukraine'],
  ['RU', 'Russia'], ['RS', 'Serbia'], ['HR', 'Croatia'], ['SK', 'Slovakia'],
  ['AZ', 'Azerbaijan'], ['GE', 'Georgia'], ['AM', 'Armenia'], ['KZ', 'Kazakhstan'],
  ['UZ', 'Uzbekistan'], ['TM', 'Turkmenistan'], ['KG', 'Kyrgyzstan'], ['TJ', 'Tajikistan'],
  ['CN', 'China'], ['JP', 'Japan'], ['KR', 'South Korea'], ['IN', 'India'],
  ['PK', 'Pakistan'], ['BD', 'Bangladesh'], ['ID', 'Indonesia'], ['MY', 'Malaysia'],
  ['SG', 'Singapore'], ['TH', 'Thailand'], ['VN', 'Vietnam'], ['PH', 'Philippines'],
  ['SA', 'Saudi Arabia'], ['AE', 'United Arab Emirates'], ['QA', 'Qatar'], ['KW', 'Kuwait'],
  ['IQ', 'Iraq'], ['IR', 'Iran'], ['IL', 'Israel'], ['JO', 'Jordan'],
  ['LB', 'Lebanon'], ['SY', 'Syria'], ['EG', 'Egypt'], ['MA', 'Morocco'],
  ['DZ', 'Algeria'], ['TN', 'Tunisia'], ['LY', 'Libya'], ['NG', 'Nigeria'],
  ['ZA', 'South Africa'], ['KE', 'Kenya'], ['ET', 'Ethiopia'], ['GH', 'Ghana'],
  ['CA', 'Canada'], ['MX', 'Mexico'], ['BR', 'Brazil'], ['AR', 'Argentina'],
  ['CL', 'Chile'], ['CO', 'Colombia'], ['PE', 'Peru'], ['VE', 'Venezuela'],
  ['AU', 'Australia'], ['NZ', 'New Zealand'],
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
