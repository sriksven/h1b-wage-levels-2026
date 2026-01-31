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
        tooltipLocked: false,  // Whether tooltip is locked (requires X to dismiss)
        svg: null,
        tooltip: null,
        projection: null,
        path: null,
        zoom: null,            // D3 zoom behavior
        currentTransform: null // Current zoom transform
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

            // Set up map container mouse leave
            setupMapMouseLeave();

            // Set up zoom control buttons
            setupZoomControls();

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
            // Map county+state to area code - Standard Match
            const mapKey = `${data.county}|${data.state}`;
            state.countyToArea[mapKey] = data.area;

            // Normalized Match (lowercase, no punctuation, no common suffixes)
            // This handles mismatches like "St." vs "Saint", "O'Brien" vs "Obrien", etc.
            const cleanCounty = data.county.toLowerCase()
                .replace(' county', '')
                .replace(' parish', '')
                .replace(' borough', '')
                .replace(' census area', '')
                .replace(' city', '') // Handle independent cities
                .replace(/\./g, '')
                .replace(/'/g, '')
                .trim();

            const mapKeyNorm = `${cleanCounty}|${data.state}`;
            if (!state.countyToArea[mapKeyNorm]) {
                state.countyToArea[mapKeyNorm] = data.area;
            }

            // Also handle "Saint" <-> "St" conversion
            if (cleanCounty.includes('st ')) {
                const saintCounty = cleanCounty.replace('st ', 'saint ');
                const mapKeySaint = `${saintCounty}|${data.state}`;
                state.countyToArea[mapKeySaint] = data.area;
            } else if (cleanCounty.includes('saint ')) {
                const stCounty = cleanCounty.replace('saint ', 'st ');
                const mapKeySt = `${stCounty}|${data.state}`;
                state.countyToArea[mapKeySt] = data.area;
            }

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
        const occupationInput = document.getElementById('occupation');
        const occupationValue = document.getElementById('occupation-value');
        const occupationResults = document.getElementById('occupation-results');

        // Build occupation list for searching
        const occupationsList = WageData.occupations.map(occ => ({
            code: occ.code,
            title: occ.title,
            display: `${occ.title} (${occ.code})`
        }));

        // Set default occupation
        const defaultOcc = occupationsList.find(o => o.code === CONFIG.defaultOccupation);
        if (defaultOcc) {
            occupationInput.value = defaultOcc.display;
            occupationValue.value = defaultOcc.code;
        }
        state.occupation = CONFIG.defaultOccupation;

        // Set default salary
        document.getElementById('salary').value = CONFIG.defaultSalary.toLocaleString();

        let debounceTimer;

        // Occupation search input handler
        occupationInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            const query = e.target.value.trim().toLowerCase();

            if (query.length === 0) {
                // Show all occupations when cleared
                occupationResults.innerHTML = occupationsList.map(o => `
                    <div class="search-result-item" data-code="${o.code}" data-display="${o.display}">
                        <strong>${o.title}</strong> <small>(${o.code})</small>
                    </div>
                `).join('');
                occupationResults.style.display = 'block';
                return;
            }

            debounceTimer = setTimeout(() => {
                // Filter occupations by title or code
                const results = occupationsList.filter(o =>
                    o.title.toLowerCase().includes(query) ||
                    o.code.toLowerCase().includes(query)
                );

                if (results.length === 0) {
                    occupationResults.innerHTML = '<div class="search-result-item no-results">No occupations found</div>';
                } else {
                    occupationResults.innerHTML = results.map(o => `
                        <div class="search-result-item" data-code="${o.code}" data-display="${o.display}">
                            <strong>${o.title}</strong> <small>(${o.code})</small>
                        </div>
                    `).join('');
                }

                occupationResults.style.display = 'block';
            }, 100);
        });

        // Handle occupation result selection
        occupationResults.addEventListener('click', (e) => {
            const item = e.target.closest('.search-result-item');
            if (!item || item.classList.contains('no-results')) return;

            const code = item.dataset.code;
            const display = item.dataset.display;

            occupationInput.value = display;
            occupationValue.value = code;
            occupationResults.style.display = 'none';

            // Update state and refresh map
            state.occupation = code;
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
                    showCountyDetails(countyName, state.selectedState, areaCode, wages, level, areaInfo, state.tooltipLocked);
                }
            }
        });

        // Close results when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#occupation') && !e.target.closest('#occupation-results')) {
                occupationResults.style.display = 'none';
            }
        });

        // Allow keyboard navigation
        occupationInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                occupationResults.style.display = 'none';
            }
        });

        // Show all occupations on focus
        occupationInput.addEventListener('focus', (e) => {
            occupationResults.innerHTML = occupationsList.map(o => `
                <div class="search-result-item" data-code="${o.code}" data-display="${o.display}">
                    <strong>${o.title}</strong> <small>(${o.code})</small>
                </div>
            `).join('');
            occupationResults.style.display = 'block';
        });
    }

    /**
     * Initialize state and county dropdown hierarchy
     */
    function initStateCountyDropdowns() {
        const stateInput = document.getElementById('state-filter');
        const stateValue = document.getElementById('state-filter-value');
        const stateResults = document.getElementById('state-results');
        const stateClearBtn = document.getElementById('state-clear');
        const countySelect = document.getElementById('county-filter');
        const countyClearBtn = document.getElementById('county-clear');

        if (!stateInput || !countySelect) return;

        // Build state list for searching
        const statesList = Object.keys(state.stateCounties).sort().map(abbr => ({
            abbr: abbr,
            name: WageData.stateNames[abbr] || abbr
        }));

        // State clear button handler - clears state and returns to full country view
        if (stateClearBtn) {
            stateClearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                stateInput.value = '';
                stateValue.value = '';
                state.selectedState = '';
                state.selectedCounty = '';
                unlockTooltip();
                clearHighlight();
                updateCountyDropdown();
                updateCountyColors();
                resetZoom();

                // Clear county search too
                const countySearch = document.getElementById('county-search');
                if (countySearch) countySearch.value = '';
            });
        }

        // County clear button handler - clears county and returns to state view
        if (countyClearBtn) {
            countyClearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                countySelect.value = '';
                state.selectedCounty = '';
                unlockTooltip();
                clearHighlight();

                // Clear county search too
                const countySearch = document.getElementById('county-search');
                if (countySearch) countySearch.value = '';
            });
        }

        let debounceTimer;

        // State search input handler
        stateInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            const query = e.target.value.trim().toLowerCase();

            if (query.length === 0) {
                stateResults.style.display = 'none';
                stateResults.innerHTML = '';
                // Clear state selection
                stateValue.value = '';
                state.selectedState = '';
                state.selectedCounty = '';
                unlockTooltip();
                updateCountyDropdown();
                updateCountyColors();
                resetZoom();
                return;
            }

            debounceTimer = setTimeout(() => {
                // Filter states by name or abbreviation
                const results = statesList.filter(s =>
                    s.name.toLowerCase().includes(query) ||
                    s.abbr.toLowerCase().includes(query)
                ).slice(0, 10);

                if (results.length === 0) {
                    stateResults.innerHTML = '<div class="search-result-item no-results">No states found</div>';
                } else {
                    stateResults.innerHTML = results.map(s => `
                        <div class="search-result-item" data-abbr="${s.abbr}" data-name="${s.name}">
                            <strong>${s.name}</strong> <small>(${s.abbr})</small>
                        </div>
                    `).join('');
                }

                stateResults.style.display = 'block';
            }, 100);
        });

        // Handle state result selection
        stateResults.addEventListener('click', (e) => {
            const item = e.target.closest('.search-result-item');
            if (!item || item.classList.contains('no-results')) return;

            const abbr = item.dataset.abbr;
            const name = item.dataset.name;

            stateInput.value = name;
            stateValue.value = abbr;
            stateResults.style.display = 'none';

            // Update state
            state.selectedState = abbr;
            state.selectedCounty = '';
            unlockTooltip();
            updateCountyDropdown();
            updateCountyColors();
            zoomToState(abbr);
        });

        // Close results when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.filter-group.search-container') ||
                (e.target.closest('.filter-group.search-container') &&
                    !e.target.closest('#state-filter') &&
                    !e.target.closest('#state-results'))) {
                if (!e.target.closest('.filter-group.search-container') ||
                    e.target.id === 'county-search') {
                    stateResults.style.display = 'none';
                }
            }
        });

        // Allow keyboard navigation
        stateInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                stateResults.style.display = 'none';
            }
        });

        // Show all states on focus if empty
        stateInput.addEventListener('focus', (e) => {
            if (e.target.value.trim() === '') {
                stateResults.innerHTML = statesList.map(s => `
                    <div class="search-result-item" data-abbr="${s.abbr}" data-name="${s.name}">
                        <strong>${s.name}</strong> <small>(${s.abbr})</small>
                    </div>
                `).join('');
                stateResults.style.display = 'block';
            }
        });

        // County change handler
        countySelect.addEventListener('change', (e) => {
            const value = e.target.value;
            if (!value) {
                state.selectedCounty = '';
                unlockTooltip();
                clearHighlight();
                return;
            }

            // Value format: "CountyName|AreaCode"
            const [countyName, areaCode] = value.split('|');
            state.selectedCounty = countyName;

            // Highlight the county and lock tooltip
            highlightCountyByArea(countyName, state.selectedState, areaCode, true);
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

            // Update state search input to match
            document.getElementById('state-filter').value = WageData.stateNames[stateAbbr] || stateAbbr;
            document.getElementById('state-filter-value').value = stateAbbr;
            state.selectedState = stateAbbr;
            updateCountyDropdown();

            // Set county dropdown
            const countySelect = document.getElementById('county-filter');
            countySelect.value = `${county}|${areaCode}`;

            // Zoom to state and highlight the county with locked tooltip
            zoomToState(stateAbbr);
            highlightCountyByArea(county, stateAbbr, areaCode, true);
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
     * Unlock tooltip (allow hover again)
     */
    function unlockTooltip() {
        state.tooltipLocked = false;
        state.tooltip.classList.remove('locked');
    }

    /**
     * Clear county highlight
     */
    function clearHighlight() {
        // Clear ALL highlighted counties, not just the one in state
        if (state.svg) {
            state.svg.selectAll('.county.highlighted').classed('highlighted', false);
        }
        state.highlightedCounty = null;
        state.tooltip.classList.remove('visible');
        unlockTooltip();
    }

    /**
     * Highlight a county on the map by area code
     */
    function highlightCountyByArea(countyName, stateAbbr, areaCode, lockTooltip = false) {
        clearHighlight();

        // Get wage data for this area
        const wages = WageData.getWages(areaCode, state.occupation);
        const level = wages ? WageData.calculateWageLevel(state.salary, areaCode, state.occupation) : -1;
        const areaInfo = WageData.getAreaInfo(areaCode);

        // Show details with lock if specified
        showCountyDetails(countyName, stateAbbr, areaCode, wages, level, areaInfo, lockTooltip);

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
    function showCountyDetails(countyName, stateAbbr, areaCode, wages, level, areaInfo, lockTooltip = false) {
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

        // Add close button if locked
        const closeButton = lockTooltip ?
            '<button class="tooltip-close" onclick="window.closeLockedTooltip()" title="Close">✕</button>' : '';

        let content;
        if (wages && level >= 0) {
            content = `
                ${closeButton}
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
                ${closeButton}
                <div class="tooltip-title">${countyName}, ${stateName}</div>
                <div class="tooltip-content">
                    <strong>Area:</strong> ${areaInfo?.areaName || 'N/A'}<br><br>
                    ⚠️ No wage data available for the selected occupation in this area.
                </div>
            `;
        }

        // Position tooltip in a visible spot
        const mapContainer = document.getElementById('map');

        state.tooltip.innerHTML = content;
        state.tooltip.style.left = `20px`;
        state.tooltip.style.top = `20px`;
        state.tooltip.classList.add('visible');

        if (lockTooltip) {
            state.tooltipLocked = true;
            state.tooltip.classList.add('locked');
        }
    }

    // Global function to close locked tooltip
    window.closeLockedTooltip = function () {
        state.selectedCounty = '';

        // Reset county dropdown
        const countySelect = document.getElementById('county-filter');
        if (countySelect) countySelect.value = '';

        // Clear search input
        const searchInput = document.getElementById('county-search');
        if (searchInput) searchInput.value = '';

        clearHighlight();
    };

    /**
     * Set up map container mouse leave handler
     */
    function setupMapMouseLeave() {
        const mapContainer = document.getElementById('map');

        mapContainer.addEventListener('mouseleave', () => {
            // Only hide tooltip if not locked
            if (!state.tooltipLocked) {
                state.tooltip.classList.remove('visible');
            }
        });
    }

    /**
     * Zoom to fit a specific state
     */
    function zoomToState(stateAbbr) {
        if (!state.svg || !state.countyData) return;

        const stateFips = Object.entries(WageData.fipsToState).find(([fips, abbr]) => abbr === stateAbbr)?.[0];
        if (!stateFips) return;

        // Get all counties in this state
        const counties = topojson.feature(state.countyData, state.countyData.objects.counties);
        const stateCounties = counties.features.filter(d => d.id.substring(0, 2) === stateFips);

        if (stateCounties.length === 0) return;

        // Calculate bounds
        const bounds = state.path.bounds({
            type: 'FeatureCollection',
            features: stateCounties
        });

        const mapContainer = document.getElementById('map');
        const width = mapContainer.clientWidth;
        const height = mapContainer.clientHeight || 500;

        const [[x0, y0], [x1, y1]] = bounds;
        const dx = x1 - x0;
        const dy = y1 - y0;
        const x = (x0 + x1) / 2;
        const y = (y0 + y1) / 2;

        // Calculate scale with padding
        const scale = Math.min(8, 0.85 / Math.max(dx / width, dy / height));
        const translate = [width / 2 - scale * x, height / 2 - scale * y];

        // Apply zoom transform
        const transform = d3.zoomIdentity
            .translate(translate[0], translate[1])
            .scale(scale);

        state.svg.transition()
            .duration(750)
            .call(state.zoom.transform, transform);

        state.currentTransform = transform;

        // Add county labels after zoom
        setTimeout(() => {
            addCountyLabels(stateAbbr, stateCounties, scale);
        }, 800);
    }

    /**
     * Add county name labels for a zoomed state
     * NOTE: Disabled as per user request - labels were cluttering the view
     */
    function addCountyLabels(stateAbbr, stateCounties, scale) {
        // Labels disabled - just remove any existing labels
        if (state.svg) {
            state.svg.selectAll('.county-label').remove();
            state.svg.selectAll('.county-labels').remove();
        }
        return;
    }

    /**
     * Reset zoom to initial view
     */
    function resetZoom() {
        if (!state.svg) return;

        // Remove county labels
        state.svg.selectAll('.county-label').remove();
        state.svg.selectAll('.county-labels').remove();

        state.svg.transition()
            .duration(750)
            .call(state.zoom.transform, d3.zoomIdentity);

        state.currentTransform = null;
    }

    /**
     * Zoom in by a fixed factor
     */
    function zoomIn() {
        if (!state.svg || !state.zoom) return;
        state.svg.transition()
            .duration(300)
            .call(state.zoom.scaleBy, 1.5);
    }

    /**
     * Zoom out by a fixed factor
     */
    function zoomOut() {
        if (!state.svg || !state.zoom) return;
        state.svg.transition()
            .duration(300)
            .call(state.zoom.scaleBy, 0.67);
    }

    /**
     * Set up zoom control buttons
     */
    function setupZoomControls() {
        const zoomInBtn = document.getElementById('zoom-in');
        const zoomOutBtn = document.getElementById('zoom-out');
        const zoomResetBtn = document.getElementById('zoom-reset');

        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', zoomIn);
        }
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', zoomOut);
        }
        if (zoomResetBtn) {
            zoomResetBtn.addEventListener('click', resetZoom);
        }
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

        // Create main group for zooming
        const g = state.svg.append('g').attr('class', 'map-group');

        // Create projection
        state.projection = d3.geoAlbersUsa()
            .scale(width * 1.1)
            .translate([width / 2, height / 2]);

        state.path = d3.geoPath().projection(state.projection);

        // Set up zoom behavior
        state.zoom = d3.zoom()
            .scaleExtent([1, 12])
            .on('zoom', (event) => {
                g.attr('transform', event.transform);
                state.currentTransform = event.transform;

                // Adjust stroke width based on zoom
                const strokeWidth = 0.3 / event.transform.k;
                g.selectAll('.county').style('stroke-width', `${strokeWidth}px`);

                // Adjust state border stroke
                g.selectAll('.state-border').style('stroke-width', `${1 / event.transform.k}px`);
            });

        state.svg.call(state.zoom);

        // Get features
        const counties = topojson.feature(us, us.objects.counties);

        // Draw counties
        g.append('g')
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
        g.append('path')
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
        let areaCode = state.countyToArea[key1] || state.countyToArea[key2];

        // If not found, try normalized lookup
        if (!areaCode) {
            const cleanName = countyName.toLowerCase()
                .replace(/\./g, '')
                .replace(/'/g, '')
                .trim();
            const keyNorm = `${cleanName}|${stateAbbr}`;
            areaCode = state.countyToArea[keyNorm];
        }

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
        // Don't show hover tooltip if tooltip is locked
        if (state.tooltipLocked) return;

        const fips = d.id;
        const fipsState = fips.substring(0, 2);
        const stateAbbr = WageData.fipsToState[fipsState];

        // Don't show tooltip for counties outside selected state
        if (state.selectedState && stateAbbr !== state.selectedState) {
            return;
        }

        const tooltip = state.tooltip;
        const stateName = WageData.stateNames[stateAbbr] || 'Unknown';
        const countyName = d.properties?.name || `County ${fips}`;

        // Find OFLC area
        const key1 = `${countyName} County|${stateAbbr}`;
        const key2 = `${countyName}|${stateAbbr}`;
        let areaCode = state.countyToArea[key1] || state.countyToArea[key2];

        // If not found, try normalized lookup
        if (!areaCode) {
            const cleanName = countyName.toLowerCase()
                .replace(/\./g, '')
                .replace(/'/g, '')
                .trim();
            const keyNorm = `${cleanName}|${stateAbbr}`;
            areaCode = state.countyToArea[keyNorm];
        }

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
        const levelStatus = ['Low priority', 'Low-Medium', 'Medium', 'Good chance', 'Best chance'];

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
        // Don't move tooltip if locked
        if (state.tooltipLocked) return;

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
        // Only hide if not locked
        if (!state.tooltipLocked && !state.highlightedCounty) {
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
            // Update state search input
            document.getElementById('state-filter').value = WageData.stateNames[stateAbbr] || stateAbbr;
            document.getElementById('state-filter-value').value = stateAbbr;
            state.selectedState = stateAbbr;
            updateCountyDropdown();

            const countySelect = document.getElementById('county-filter');
            countySelect.value = `${countyName} County|${areaCode}`;

            // Zoom to state if not already
            zoomToState(stateAbbr);

            // Highlight with locked tooltip
            highlightCountyByArea(countyName, stateAbbr, areaCode, true);
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

        // Note: Occupation input is handled in initFilters()

        // Handle window resize
        window.addEventListener('resize', debounce(() => {
            if (state.countyData) {
                document.getElementById('map').innerHTML = '';
                renderMap(state.countyData);

                // Re-apply state zoom if selected
                if (state.selectedState) {
                    setTimeout(() => zoomToState(state.selectedState), 100);
                }
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
