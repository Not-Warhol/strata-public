/* STRATA. Store — what an address needs in each country: the name of the postcode (ZIP code, Postal code, CEP…), whether it has a
 * state or province and what it is called, the list to choose from when there is a fixed one, and a pattern to catch typos.
 * Used by the page (to change the form when the country changes) and by the server (to check the order). Exposes globalThis.StrataAddr. */
(function (root) {
  const US = [['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming']];
  const CA = [['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'], ['NB', 'New Brunswick'], ['NL', 'Newfoundland and Labrador'], ['NS', 'Nova Scotia'], ['NT', 'Northwest Territories'], ['NU', 'Nunavut'], ['ON', 'Ontario'], ['PE', 'Prince Edward Island'], ['QC', 'Quebec'], ['SK', 'Saskatchewan'], ['YT', 'Yukon']];
  const AU = [['ACT', 'Australian Capital Territory'], ['NSW', 'New South Wales'], ['NT', 'Northern Territory'], ['QLD', 'Queensland'], ['SA', 'South Australia'], ['TAS', 'Tasmania'], ['VIC', 'Victoria'], ['WA', 'Western Australia']];
  const BR = [['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'], ['BA', 'Bahia'], ['CE', 'Ceará'], ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'], ['GO', 'Goiás'], ['MA', 'Maranhão'], ['MT', 'Mato Grosso'], ['MS', 'Mato Grosso do Sul'], ['MG', 'Minas Gerais'], ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'], ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'], ['RS', 'Rio Grande do Sul'], ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'], ['SP', 'São Paulo'], ['SE', 'Sergipe'], ['TO', 'Tocantins']];

  const R = {
    US: { post: 'ZIP code', re: /^\d{5}(-\d{4})?$/, hint: '90210', state: { label: 'State', options: US, required: true } },
    CA: { post: 'Postal code', re: /^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/, hint: 'K1A 0B1', state: { label: 'Province or territory', options: CA, required: true } },
    AU: { post: 'Postcode', re: /^\d{4}$/, hint: '2000', state: { label: 'State or territory', options: AU, required: true } },
    BR: { post: 'CEP', re: /^\d{5}-?\d{3}$/, hint: '01310-100', state: { label: 'State', options: BR, required: true } },
    MX: { post: 'Postal code', re: /^\d{5}$/, state: { label: 'State', required: true } },
    IN: { post: 'PIN code', re: /^\d{6}$/, state: { label: 'State', required: true } },
    JP: { post: 'Postal code', re: /^\d{3}-?\d{4}$/, hint: '100-0001', state: { label: 'Prefecture', required: true } },
    CN: { post: 'Postal code', re: /^\d{6}$/, state: { label: 'Province', required: true } },
    KR: { post: 'Postal code', state: { label: 'Province or city', required: false } },
    IE: { post: 'Eircode', state: { label: 'County', required: false } },
    IT: { post: 'Postcode (CAP)', re: /^\d{5}$/, state: { label: 'Province (e.g. MI)', required: false } },
    ES: { post: 'Postcode', re: /^\d{5}$/, state: { label: 'Province', required: false } },
    PT: { post: 'Postcode', re: /^\d{4}-?\d{3}$/, hint: '1000-001' },
    FR: { post: 'Postcode', re: /^\d{5}$/ },
    DE: { post: 'Postcode', re: /^\d{5}$/ },
    NL: { post: 'Postcode', re: /^\d{4} ?[A-Za-z]{2}$/ },
    GB: { post: 'Postcode', hint: 'SW1A 1AA' },
    ZA: { post: 'Postal code', re: /^\d{4}$/, state: { label: 'Province', required: false } },
    AR: { post: 'Postal code', state: { label: 'Province', required: false } },
    CL: { post: 'Postal code', state: { label: 'Region', required: false } },
    CO: { post: 'Postal code', state: { label: 'Department', required: false } },
    MY: { post: 'Postcode', state: { label: 'State', required: false } },
    AE: { post: 'Postal code (if you have one)', state: { label: 'Emirate', required: false } },
  };
  // countries where many places have no postcode
  const NO_POST = new Set(['AE', 'AG', 'AW', 'BS', 'BZ', 'BW', 'GH', 'HK', 'JM', 'KE', 'KI', 'KM', 'NR', 'QA', 'SC', 'TL', 'TO', 'TV', 'UG', 'VU', 'ZW', 'AO', 'BF', 'BI', 'BJ', 'CD', 'CF', 'CG', 'CI', 'DJ', 'ER', 'FJ', 'GM', 'GQ', 'GY', 'ML', 'MR', 'MW', 'NA', 'RW', 'SL', 'SR', 'ST', 'TG', 'TD', 'ZM']);

  /** { post: label of the postcode, postRequired, re, hint, state: { label, options?, required } | null } */
  function rules(country) {
    const r = R[country] || {};
    return { post: r.post || 'Postcode', postRequired: !NO_POST.has(country), re: r.re || null, hint: r.hint || '', state: r.state || null };
  }

  /** Returns an error text, or null when the address has everything its country needs. */
  function check(ship) {
    const r = rules(ship.country);
    if (r.postRequired && String(ship.postcode || '').trim().length < 2) return `Fill in the ${r.post.toLowerCase().replace(' (if you have one)', '')}.`;
    if (ship.postcode && r.re && !r.re.test(String(ship.postcode).trim())) return `That ${r.post.toLowerCase()} does not look right${r.hint ? ` (for example ${r.hint})` : ''}.`;
    if (r.state) {
      const v = String(ship.state || '').trim();
      if (r.state.required && !v) return `Choose your ${r.state.label.toLowerCase()}.`;
      if (v && r.state.options && !r.state.options.some(([code]) => code === v)) return `Choose your ${r.state.label.toLowerCase()} from the list.`;
    }
    return null;
  }

  root.StrataAddr = { rules, check };
})(typeof globalThis !== 'undefined' ? globalThis : this);
