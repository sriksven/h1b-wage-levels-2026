/**
 * H1B Wage Levels 2026 - Main Application
 * Interactive US county map with real OFLC wage level visualization
 */

(function () {
    'use strict';

    // Configuration
    const CONFIG = {
        colors: {
            belowLevel1: '#e74c3c',  // Red - Can't work
            level1: '#e67e22',       // Orange
            level2: '#f1c40f',       // Yellow
            level3: '#2ecc71',       // Light Green  
            level4: '#27ae60',       // Green - Best chance
            noData: '#cccccc'        // Gray - No data available
        },
        topoJsonUrl: 'https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json',
        defaultSalary: 150000,
        defaultOccupation: '15-1252' // Software Developers
    };

    // Application state
    const state = {
        salary: CONFIG.defaultSalary,
        occupation: CONFIG.defaultOccupation,
        selectedState: '',
        selectedCounty: '',
        countyData: null,
        countyToArea: {},      // Map "CountyName|State" to OFLC area code
        stateCounties: {},     // Map state abbr to list of counties
        highlightedCounty: null,
        svg: null,
        tooltip: null,
        projection: null,
        path: null
    };

    /**
     * Initialize the application
     */
    async function init() {
        console.log('Initializing H1B Wage Levels Dashboard...');

        // Cache DOM elements
        state.tooltip = document.getElementById('tooltip');

        // Show loading state
        const mapContainer = document.getElementById('map');
        mapContainer.innerHTML = '<div class="loading">Loading wage data...</div>';

        try {
            // Load OFLC wage data first
            await WageData.loadData();

            // Build lookup tables
            buildLookupTables();

            // Initialize filters with real occupation data
            initFilters();

            // Set up county search
            initCountySearch();

            // Set up state/county dropdowns
            initStateCountyDropdowns();

            // Load and render map
            await loadMap();

            // Set up event listeners
            setupEventListeners();

            console.log('Dashboard ready!');
        } catch (error) {
            console.error('Failed to initialize:', error);
            mapContainer.innerHTML = `<div class="loading" style="color: #c41e3a;">
                Failed to load data. Please refresh the page.
            </div>`;
        }
    }

    /**
     * Build lookup tables for county → area mapping
     */
    function buildLookupTables() {
        state.countyToArea = {};
        state.stateCounties = {};

        if (!WageData.counties) return;

        for (const [key, data] of Object.entries(WageData.counties)) {
            // Map county+state to area code
            const mapKey = `${data.county}|${data.state}`;
            state.countyToArea[mapKey] = data.area;

            // Group counties by state
            if (!state.stateCounties[data.state]) {
                state.stateCounties[data.state] = [];
            }
            if (!state.stateCounties[data.state].some(c => c.county === data.county)) {
                state.stateCounties[data.state].push({
                    county: data.county,
                    area: data.area,
                    areaName: data.areaName
                });
            }
        }

        // Sort counties within each state
        for (const st in state.stateCounties) {
            state.stateCounties[st].sort((a, b) => a.county.localeCompare(b.county));
        }
    }

    /**
     * Initialize filter dropdowns with real OFLC occupation data
     */
    function initFilters() {
        const occupationSelect = document.getElementById('occupation');

        // Clear existing options
        occupationSelect.innerHTML = '<option value="">Select Occupation...</option>';

        // Add occupations from OFLC data
        WageData.occupations.forEach(occ => {
            const option = document.createElement('option');
            option.value = occ.code;
            option.textContent = `${occ.title} (${occ.code})`;
            occupationSelect.appendChild(option);
        });

        // Set default occupation
        occupationSelect.value = CONFIG.defaultOccupation;
        state.occupation = CONFIG.defaultOccupation;

        // Set default salary
        document.getElementById('salary').value = CONFIG.defaultSalary.toLocaleString();
    }

    /**
     * Initialize state and county dropdown hierarchy
     */
    function initStateCountyDropdowns() {
        const stateSelect = document.getElementById('state-filter');
        const countySelect = document.getElementById('county-filter');

        if (!stateSelect || !countySelect) return;

        // Populate state dropdown
        stateSelect.innerHTML = '<option value="">(All States)</option>';

        // Get unique states and sort them
        const states = Object.keys(state.stateCounties).sort();
        states.forEach(st => {
            const option = document.createElement('option');
            option.value = st;
            option.textContent = WageData.stateNames[st] || st;
            stateSelect.appendChild(option);
        });

        // State change handler
        stateSelect.addEventListener('change', (e) => {
            state.selectedState = e.target.value;
            updateCountyDropdown();
            updateCountyColors();
        });

        // County change handler
        countySelect.addEventListener('change', (e) => {
            const value = e.target.value;
            if (!value) {
                state.selectedCounty = '';
                clearHighlight();
                return;
            }

            // Value format: "CountyName|AreaCode"
            const [countyName, areaCode] = value.split('|');
            state.selectedCounty = countyName;

            // Highlight the county
            highlightCountyByArea(countyName, state.selectedState, areaCode);
        });
    }

    /**
     * Update county dropdown based on selected state
     */
    function updateCountyDropdown() {
        const countySelect = document.getElementById('county-filter');

        if (!state.selectedState) {
            countySelect.innerHTML = '<option value="">(Select State First)</option>';
            return;
        }

        const counties = state.stateCounties[state.selectedState] || [];

        countySelect.innerHTML = '<option value="">(All Counties)</option>';
        counties.forEach(c => {
            const option = document.createElement('option');
            option.value = `${c.county}|${c.area}`;
            option.textContent = c.county;
            countySelect.appendChild(option);
        });
    }

    /**
     * Initialize county search with autocomplete
     */
    function initCountySearch() {
        const searchInput = document.getElementById('county-search');
        const searchResults = document.getElementById('search-results');

        if (!searchInput || !searchResults) return;

        let debounceTimer;

        searchInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            const query = e.target.value.trim();

            if (query.length < 2) {
                searchResults.style.display = 'none';
                searchResults.innerHTML = '';
                return;
            }

            debounceTimer = setTimeout(() => {
                const results = WageData.searchCounties(query, 8);

                if (results.length === 0) {
                    searchResults.innerHTML = '<div class="search-result-item no-results">No counties found</div>';
                } else {
                    searchResults.innerHTML = results.map(r => `
                        <div class="search-result-item" data-area="${r.areaCode}" data-county="${r.county}" data-state="${r.state}">
                            <strong>${r.county}</strong>, ${r.state}
                            <br><small>${r.areaName}</small>
                        </div>
                    `).join('');
                }

                searchResults.style.display = 'block';
            }, 150);
        });

        // Handle result selection
        searchResults.addEventListener('click', (e) => {
            const item = e.target.closest('.search-result-item');
            if (!item || item.classList.contains('no-results')) return;

            const areaCode = item.dataset.area;
            const county = item.dataset.county;
            const stateAbbr = item.dataset.state;

            searchInput.value = `${county}, ${stateAbbr}`;
            searchResults.style.display = 'none';

            // Update dropdowns to match
            document.getElementById('state-filter').value = stateAbbr;
            state.selectedState = stateAbbr;
            updateCountyDropdown();

            // Set county dropdown
            const countySelect = document.getElementById('county-filter');
            countySelect.value = `${county}|${areaCode}`;

            // Highlight the county on the map
            highlightCountyByArea(county, stateAbbr, areaCode);
        });

        // Close results when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                searchResults.style.display = 'none';
            }
        });

        // Allow keyboard navigation
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                searchResults.style.display = 'none';
            }
        });
    }

    /**
     * Clear county highlight
     */
    function clearHighlight() {
        if (state.highlightedCounty) {
            state.highlightedCounty.classed('highlighted', false);
            state.highlightedCounty = null;
        }
        state.tooltip.classList.remove('visible');
    }

    /**
     * Highlight a county on the map by area code
     */
    function highlightCountyByArea(countyName, stateAbbr, areaCode) {
        clearHighlight();

        // Get wage data for this area
        const wages = WageData.getWages(areaCode, state.occupation);
        const level = wages ? WageData.calculateWageLevel(state.salary, areaCode, state.occupation) : -1;
        const areaInfo = WageData.getAreaInfo(areaCode);

        // Show details
        showCountyDetails(countyName, stateAbbr, areaCode, wages, level, areaInfo);

        // Find and highlight matching counties
        if (!state.svg) return;

        state.svg.selectAll('.county').each(function (d) {
            const fipsState = d.id.substring(0, 2);
            const fipsStateAbbr = WageData.fipsToState[fipsState];

            if (fipsStateAbbr === stateAbbr) {
                const cName = d.properties?.name;
                if (cName) {
                    const key1 = `${cName} County|${stateAbbr}`;
                    const key2 = `${cName}|${stateAbbr}`;
                    const countyArea = state.countyToArea[key1] || state.countyToArea[key2];

                    if (countyArea === areaCode) {
                        d3.select(this).classed('highlighted', true);
                        state.highlightedCounty = d3.select(this);
                    }
                }
            }
        });
    }

    /**
     * Show detailed info for a selected county
     */
    function showCountyDetails(countyName, stateAbbr, areaCode, wages, level, areaInfo) {
        const stateName = WageData.stateNames[stateAbbr] || stateAbbr;

        const levelLabels = ['Below Level 1', 'Level 1', 'Level 2', 'Level 3', 'Level 4'];
        const levelColors = [
            CONFIG.colors.belowLevel1,
            CONFIG.colors.level1,
            CONFIG.colors.level2,
            CONFIG.colors.level3,
            CONFIG.colors.level4
        ];
        const levelStatus = ['❌ Low priority', '⚠️ Low-Medium', '⚠️ Medium', '✅ Good chance', '✅ Best chance'];

        let content;
        if (wages && level >= 0) {
            content = `
                <div class="tooltip-title">${countyName}, ${stateName}</div>
                <div class="tooltip-content">
                    <strong>Area:</strong> ${areaInfo?.areaName || 'N/A'}<br>
                    <strong>Your Salary:</strong> $${state.salary.toLocaleString()}<br><br>
                    <strong>Wage Thresholds (Annual):</strong><br>
                    Level 1: $${wages.l1.toLocaleString()}<br>
                    Level 2: $${wages.l2.toLocaleString()}<br>
                    Level 3: $${wages.l3.toLocaleString()}<br>
                    Level 4: $${wages.l4.toLocaleString()}
                </div>
                <div class="tooltip-level" style="background-color: ${levelColors[level]}; color: ${level <= 1 ? '#fff' : '#333'};">
                    ${levelLabels[level]} - ${levelStatus[level]}
                </div>
            `;
        } else {
            content = `
                <div class="tooltip-title">${countyName}, ${stateName}</div>
                <div class="tooltip-content">
                    <strong>Area:</strong> ${areaInfo?.areaName || 'N/A'}<br><br>
                    ⚠️ No wage data available for the selected occupation in this area.
                </div>
            `;
        }

        // Position tooltip in a visible spot
        const mapContainer = document.getElementById('map');
        const rect = mapContainer.getBoundingClientRect();

        state.tooltip.innerHTML = content;
        state.tooltip.style.left = `${20}px`;
        state.tooltip.style.top = `${20}px`;
        state.tooltip.classList.add('visible');
    }

    /**
     * Load TopoJSON data and render map
     */
    async function loadMap() {
        const mapContainer = document.getElementById('map');
        mapContainer.innerHTML = '<div class="loading">Loading map...</div>';

        try {
            const response = await fetch(CONFIG.topoJsonUrl);
            if (!response.ok) throw new Error('Failed to load map data');

            const us = await response.json();
            state.countyData = us;

            // Clear loading state
            mapContainer.innerHTML = '';

            // Render the map
            renderMap(us);
        } catch (error) {
            console.error('Error loading map:', error);
            mapContainer.innerHTML = `<div class="loading" style="color: #c41e3a;">
                Failed to load map. Please refresh the page.
            </div>`;
        }
    }

    /**
     * Render the US county map
     */
    function renderMap(us) {
        const mapContainer = document.getElementById('map');
        const width = mapContainer.clientWidth;
        const height = mapContainer.clientHeight || 500;

        // Create SVG
        state.svg = d3.select('#map')
            .append('svg')
            .attr('viewBox', `0 0 ${width} ${height}`)
            .attr('preserveAspectRatio', 'xMidYMid meet');

        // Create projection
        state.projection = d3.geoAlbersUsa()
            .scale(width * 1.1)
            .translate([width / 2, height / 2]);

        state.path = d3.geoPath().projection(state.projection);

        // Get features
        const counties = topojson.feature(us, us.objects.counties);

        // Draw counties
        state.svg.append('g')
            .attr('class', 'counties')
            .selectAll('path')
            .data(counties.features)
            .enter()
            .append('path')
            .attr('class', 'county')
            .attr('d', state.path)
            .attr('fill', d => getCountyColor(d))
            .attr('data-fips', d => d.id)
            .on('mouseover', handleMouseOver)
            .on('mousemove', handleMouseMove)
            .on('mouseout', handleMouseOut)
            .on('click', handleCountyClick);

        // Draw state borders
        state.svg.append('path')
            .datum(topojson.mesh(us, us.objects.states, (a, b) => a !== b))
            .attr('class', 'state-border')
            .attr('d', state.path);
    }

    /**
     * Get color for a county based on wage level
     */
    function getCountyColor(county) {
        const fips = county.id;
        const fipsState = fips.substring(0, 2);
        const stateAbbr = WageData.fipsToState[fipsState];

        if (!stateAbbr) return CONFIG.colors.noData;

        // Filter by selected state if set
        if (state.selectedState && stateAbbr !== state.selectedState) {
            return '#e8e8e8'; // Muted color for non-selected states
        }

        // Get county name from properties
        const countyName = county.properties?.name;
        if (!countyName) return CONFIG.colors.noData;

        // Find the OFLC area for this county
        const key1 = `${countyName} County|${stateAbbr}`;
        const key2 = `${countyName}|${stateAbbr}`;
        const areaCode = state.countyToArea[key1] || state.countyToArea[key2];

        if (!areaCode) return CONFIG.colors.noData;

        // Get wage level
        const level = WageData.calculateWageLevel(state.salary, areaCode, state.occupation);

        switch (level) {
            case 0: return CONFIG.colors.belowLevel1;
            case 1: return CONFIG.colors.level1;
            case 2: return CONFIG.colors.level2;
            case 3: return CONFIG.colors.level3;
            case 4: return CONFIG.colors.level4;
            default: return CONFIG.colors.noData;
        }
    }

    /**
     * Update all county colors
     */
    function updateCountyColors() {
        if (!state.svg) return;

        state.svg.selectAll('.county')
            .transition()
            .duration(300)
            .attr('fill', d => getCountyColor(d));
    }

    /**
     * Handle mouse over county
     */
    function handleMouseOver(event, d) {
        const tooltip = state.tooltip;
        const fips = d.id;
        const fipsState = fips.substring(0, 2);
        const stateAbbr = WageData.fipsToState[fipsState];
        const stateName = WageData.stateNames[stateAbbr] || 'Unknown';
        const countyName = d.properties?.name || `County ${fips}`;

        // Find OFLC area
        const key1 = `${countyName} County|${stateAbbr}`;
        const key2 = `${countyName}|${stateAbbr}`;
        const areaCode = state.countyToArea[key1] || state.countyToArea[key2];

        const wages = areaCode ? WageData.getWages(areaCode, state.occupation) : null;
        const level = wages ? WageData.calculateWageLevel(state.salary, areaCode, state.occupation) : -1;
        const areaInfo = areaCode ? WageData.getAreaInfo(areaCode) : null;

        const levelLabels = ['Below Level 1', 'Level 1', 'Level 2', 'Level 3', 'Level 4'];
        const levelColors = [
            CONFIG.colors.belowLevel1,
            CONFIG.colors.level1,
            CONFIG.colors.level2,
            CONFIG.colors.level3,
            CONFIG.colors.level4
        ];
        const levelStatus = ['❌ Low priority', '⚠️ Low-Medium', '⚠️ Medium', '✅ Good chance', '✅ Best chance'];

        let content;
        if (wages && level >= 0) {
            content = `
                <div class="tooltip-title">${countyName}, ${stateName}</div>
                <div class="tooltip-content">
                    <strong>Area:</strong> ${areaInfo?.areaName || 'N/A'}<br>
                    <strong>Wage Thresholds:</strong><br>
                    L1: $${wages.l1.toLocaleString()} | L2: $${wages.l2.toLocaleString()}<br>
                    L3: $${wages.l3.toLocaleString()} | L4: $${wages.l4.toLocaleString()}
                </div>
                <div class="tooltip-level" style="background-color: ${levelColors[level]}; color: ${level <= 1 ? '#fff' : '#333'}; padding: 4px 8px; border-radius: 4px; margin-top: 8px;">
                    ${levelLabels[level]} - ${levelStatus[level]}
                </div>
            `;
        } else {
            content = `
                <div class="tooltip-title">${countyName}, ${stateName}</div>
                <div class="tooltip-content">
                    No wage data for this occupation in this area.
                </div>
            `;
        }

        tooltip.innerHTML = content;
        tooltip.classList.add('visible');
    }

    /**
     * Handle mouse move
     */
    function handleMouseMove(event) {
        const tooltip = state.tooltip;
        const mapContainer = document.getElementById('map');
        const rect = mapContainer.getBoundingClientRect();

        let x = event.clientX - rect.left + 15;
        let y = event.clientY - rect.top + 15;

        // Prevent tooltip from going outside container
        const tooltipRect = tooltip.getBoundingClientRect();
        if (x + tooltipRect.width > rect.width) {
            x = event.clientX - rect.left - tooltipRect.width - 15;
        }
        if (y + tooltipRect.height > rect.height) {
            y = event.clientY - rect.top - tooltipRect.height - 15;
        }

        tooltip.style.left = `${x}px`;
        tooltip.style.top = `${y}px`;
    }

    /**
     * Handle mouse out
     */
    function handleMouseOut() {
        // Only hide if not a selected county
        if (!state.highlightedCounty) {
            state.tooltip.classList.remove('visible');
        }
    }

    /**
     * Handle county click
     */
    function handleCountyClick(event, d) {
        const fips = d.id;
        const fipsState = fips.substring(0, 2);
        const stateAbbr = WageData.fipsToState[fipsState];
        const countyName = d.properties?.name || `County ${fips}`;

        const key1 = `${countyName} County|${stateAbbr}`;
        const key2 = `${countyName}|${stateAbbr}`;
        const areaCode = state.countyToArea[key1] || state.countyToArea[key2];

        if (areaCode) {
            // Update dropdowns
            document.getElementById('state-filter').value = stateAbbr;
            state.selectedState = stateAbbr;
            updateCountyDropdown();

            const countySelect = document.getElementById('county-filter');
            countySelect.value = `${countyName} County|${areaCode}`;

            highlightCountyByArea(countyName, stateAbbr, areaCode);
        }
    }

    /**
     * Set up event listeners for filters
     */
    function setupEventListeners() {
        // Salary input
        const salaryInput = document.getElementById('salary');
        salaryInput.addEventListener('input', debounce((e) => {
            const value = parseSalary(e.target.value);
            if (value > 0) {
                state.salary = value;
                updateCountyColors();
            }
        }, 300));

        salaryInput.addEventListener('blur', (e) => {
            const value = parseSalary(e.target.value);
            if (value > 0) {
                e.target.value = value.toLocaleString();
            }
        });

        // Occupation select
        document.getElementById('occupation').addEventListener('change', (e) => {
            state.occupation = e.target.value;
            updateCountyColors();

            // Update tooltip if a county is selected
            if (state.highlightedCounty && state.selectedCounty) {
                const countySelect = document.getElementById('county-filter');
                const value = countySelect.value;
                if (value) {
                    const [countyName, areaCode] = value.split('|');
                    const wages = WageData.getWages(areaCode, state.occupation);
                    const level = wages ? WageData.calculateWageLevel(state.salary, areaCode, state.occupation) : -1;
                    const areaInfo = WageData.getAreaInfo(areaCode);
                    showCountyDetails(countyName, state.selectedState, areaCode, wages, level, areaInfo);
                }
            }
        });

        // Handle window resize
        window.addEventListener('resize', debounce(() => {
            if (state.countyData) {
                document.getElementById('map').innerHTML = '';
                renderMap(state.countyData);
            }
        }, 250));
    }

    /**
     * Parse salary string to number
     */
    function parseSalary(str) {
        if (!str) return 0;
        const cleaned = str.replace(/[$,\s]/g, '');
        return parseInt(cleaned, 10) || 0;
    }

    /**
     * Debounce function
     */
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
