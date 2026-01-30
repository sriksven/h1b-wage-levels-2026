/**
 * H1B Wage Levels 2026 - Data Module
 * Loads real OFLC wage data from the U.S. Department of Labor
 */

const WageData = {
  // Data will be loaded asynchronously
  wages: null,       // { areaCode: { socCode: [l1, l2, l3, l4] } }
  geography: null,   // { areaCode: { areaName, state, counties } }
  counties: null,    // { "County Name, ST": { area, areaName, state, county } }
  occupations: [],   // [{ code, title }]

  // Loading state
  loaded: false,
  loading: false,

  /**
   * Load all data files
   */
  async loadData() {
    if (this.loaded || this.loading) return;
    this.loading = true;

    try {
      console.log('Loading OFLC wage data...');

      const [wagesRes, geoRes, countiesRes, occupationsRes] = await Promise.all([
        fetch('data/wages.json'),
        fetch('data/geography.json'),
        fetch('data/counties.json'),
        fetch('data/occupations.json')
      ]);

      if (!wagesRes.ok || !geoRes.ok || !countiesRes.ok || !occupationsRes.ok) {
        throw new Error('Failed to load one or more data files');
      }

      this.wages = await wagesRes.json();
      this.geography = await geoRes.json();
      this.counties = await countiesRes.json();
      this.occupations = await occupationsRes.json();

      this.loaded = true;
      console.log('OFLC wage data loaded successfully');
      console.log(`  ${Object.keys(this.wages).length} areas`);
      console.log(`  ${Object.keys(this.counties).length} counties`);
      console.log(`  ${this.occupations.length} occupations`);

    } catch (error) {
      console.error('Error loading wage data:', error);
      throw error;
    } finally {
      this.loading = false;
    }
  },

  /**
   * Get wage thresholds for a specific area and occupation
   * @param {string} areaCode - OFLC area code
   * @param {string} socCode - SOC occupation code
   * @returns {object|null} Wage thresholds { l1, l2, l3, l4 }
   */
  getWages(areaCode, socCode) {
    if (!this.wages || !areaCode || !socCode) return null;

    const areaData = this.wages[areaCode];
    if (!areaData) return null;

    const levels = areaData[socCode];
    if (!levels) return null;

    return {
      l1: levels[0],
      l2: levels[1],
      l3: levels[2],
      l4: levels[3]
    };
  },

  /**
   * Calculate wage level for a given salary
   * @param {number} salary - Annual salary in USD
   * @param {string} areaCode - OFLC area code
   * @param {string} socCode - SOC occupation code
   * @returns {number} Wage level (0 = below L1, 1, 2, 3, or 4)
   */
  calculateWageLevel(salary, areaCode, socCode) {
    const wages = this.getWages(areaCode, socCode);
    if (!wages) return -1; // No data available

    if (salary >= wages.l4) return 4;
    if (salary >= wages.l3) return 3;
    if (salary >= wages.l2) return 2;
    if (salary >= wages.l1) return 1;
    return 0;
  },

  /**
   * Get area code for a county
   * @param {string} countyKey - "County Name, ST" format
   * @returns {string|null} Area code
   */
  getAreaForCounty(countyKey) {
    if (!this.counties) return null;
    const data = this.counties[countyKey];
    return data ? data.area : null;
  },

  /**
   * Search counties by name (for autocomplete)
   * @param {string} query - Search query
   * @param {number} limit - Maximum results
   * @returns {Array} Matching counties
   */
  searchCounties(query, limit = 10) {
    if (!this.counties || !query || query.length < 2) return [];

    const lowerQuery = query.toLowerCase();
    const results = [];

    for (const [key, data] of Object.entries(this.counties)) {
      if (key.toLowerCase().includes(lowerQuery)) {
        results.push({
          key,
          county: data.county,
          state: data.state,
          areaCode: data.area,
          areaName: data.areaName
        });

        if (results.length >= limit) break;
      }
    }

    return results;
  },

  /**
   * Get all counties in the dataset
   * @returns {Array} List of county keys
   */
  getAllCounties() {
    if (!this.counties) return [];
    return Object.keys(this.counties);
  },

  /**
   * Get area info by code
   * @param {string} areaCode 
   * @returns {object|null}
   */
  getAreaInfo(areaCode) {
    if (!this.geography) return null;
    return this.geography[areaCode] || null;
  },

  // FIPS state codes to abbreviations (for map integration)
  fipsToState: {
    '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
    '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
    '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
    '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
    '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
    '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
    '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
    '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
    '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
    '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
    '56': 'WY'
  },

  // State abbreviations to names
  stateNames: {
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
    'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
    'DC': 'District of Columbia', 'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii',
    'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
    'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine',
    'MD': 'Maryland', 'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota',
    'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska',
    'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico',
    'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
    'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island',
    'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas',
    'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington',
    'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming'
  }
};

// Export for use in app.js
window.WageData = WageData;
