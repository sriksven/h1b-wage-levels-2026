/**
 * Multi-Location Comparison Module
 * Handles comparing multiple cities side-by-side with rankings
 */

const MultiCompare = (function () {
    'use strict';

    const MAX_LOCATIONS = 5;
    let comparedLocations = []; // Array of { areaCode, areaName, state }

    /**
     * Add location to comparison
     */
    function addLocation(areaCode, areaName, stateAbbr, salary, occupation) {
        if (comparedLocations.length >= MAX_LOCATIONS) {
            alert(`Maximum ${MAX_LOCATIONS} locations allowed`);
            return false;
        }

        // Check if already added
        if (comparedLocations.some(loc => loc.areaCode === areaCode)) {
            alert('Location already in comparison');
            return false;
        }

        comparedLocations.push({ areaCode, areaName, state: stateAbbr });
        updateComparisonTable(salary, occupation);
        return true;
    }

    /**
     * Remove location from comparison
     */
    function removeLocation(areaCode) {
        comparedLocations = comparedLocations.filter(loc => loc.areaCode !== areaCode);

        // Get current values
        const salary = parseInt(document.getElementById('multi-salary')?.value) || 150000;
        const occupation = document.getElementById('multi-occupation')?.value || '15-1252';
        updateComparisonTable(salary, occupation);
    }

    /**
     * Clear all locations
     */
    function clearAll() {
        comparedLocations = [];
        const salary = parseInt(document.getElementById('multi-salary')?.value) || 150000;
        const occupation = document.getElementById('multi-occupation')?.value || '15-1252';
        updateComparisonTable(salary, occupation);
    }

    /**
     * Update all comparisons (when salary or occupation changes)
     */
    function updateAll() {
        const salary = parseInt(document.getElementById('multi-salary')?.value) || 150000;
        const occupation = document.getElementById('multi-occupation')?.value || '15-1252';
        updateComparisonTable(salary, occupation);
    }

    /**
     * Get current level for a location
     */
    function getWageLevel(salary, areaCode, occupation) {
        const wages = WageData.getWages(areaCode, occupation);
        if (!wages) return -1;

        if (salary >= wages.l4) return 4;
        if (salary >= wages.l3) return 3;
        if (salary >= wages.l2) return 2;
        if (salary >= wages.l1) return 1;
        return 0;
    }

    /**
     * Calculate gap to next level
     */
    function getGapToNextLevel(salary, areaCode, occupation) {
        const wages = WageData.getWages(areaCode, occupation);
        if (!wages) return null;

        const currentLevel = getWageLevel(salary, areaCode, occupation);

        if (currentLevel === 4) return 0; // Already at max
        if (currentLevel === 3) return wages.l4 - salary;
        if (currentLevel === 2) return wages.l3 - salary;
        if (currentLevel === 1) return wages.l2 - salary;
        return wages.l1 - salary; // Below level 1
    }

    /**
     * Rank locations by wage level achieved
     */
    function rankByLevel(salary, occupation) {
        return comparedLocations
            .map(loc => ({
                ...loc,
                level: getWageLevel(salary, loc.areaCode, occupation),
                gap: getGapToNextLevel(salary, loc.areaCode, occupation),
                wages: WageData.getWages(loc.areaCode, occupation)
            }))
            .sort((a, b) => {
                // Sort by level (descending), then by gap (ascending)
                if (b.level !== a.level) return b.level - a.level;
                return (a.gap || 0) - (b.gap || 0);
            });
    }

    /**
     * Update the comparison table
     */
    function updateComparisonTable(salary, occupation) {
        const container = document.getElementById('comparison-table-container');
        if (!container) return;

        if (comparedLocations.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #9ca3af; padding: 2rem;">Add locations to compare</p>';
            return;
        }

        // Use provided salary and occupation (from multi-compare inputs)
        const ranked = rankByLevel(salary, occupation);

        const levelColors = ['#dc2626', '#f97316', '#facc15', '#22c55e', '#15803d'];
        const levelLabels = ['Below L1', 'Level 1', 'Level 2', 'Level 3', 'Level 4'];

        let html = `
            <div class="comparison-header">
                <h3>Comparing ${comparedLocations.length} Location${comparedLocations.length > 1 ? 's' : ''} (Salary: $${salary.toLocaleString()})</h3>
                <button onclick="MultiCompare.clearAll()" class="clear-btn">Clear All</button>
            </div>
            <div class="comparison-table-wrapper">
                <table class="comparison-table">
                    <thead>
                        <tr>
                            <th>Rank</th>
                            <th>Location</th>
                            <th>Your Level</th>
                            <th>Level 1</th>
                            <th>Level 2</th>
                            <th>Level 3</th>
                            <th>Level 4</th>
                            <th>Gap to Next</th>
                            <th>COL Index</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        ranked.forEach((loc, index) => {
            const colIndex = SalaryCalculator.getCOLIndex(loc.areaCode);
            const levelColor = levelColors[loc.level] || '#d1d5db';
            const levelLabel = levelLabels[loc.level] || 'No Data';

            html += `
                <tr class="comparison-row ${index === 0 ? 'best-option' : ''}">
                    <td class="rank-cell">${index + 1}${index === 0 ? ' 🏆' : ''}</td>
                    <td class="location-cell">
                        <strong>${loc.areaName}</strong><br>
                        <small>${loc.state}</small>
                    </td>
                    <td class="level-cell">
                        <span class="level-badge" style="background-color: ${levelColor}; color: ${loc.level <= 1 ? '#fff' : '#333'};">
                            ${levelLabel}
                        </span>
                    </td>
                    <td>$${loc.wages?.l1?.toLocaleString() || 'N/A'}</td>
                    <td>$${loc.wages?.l2?.toLocaleString() || 'N/A'}</td>
                    <td>$${loc.wages?.l3?.toLocaleString() || 'N/A'}</td>
                    <td>$${loc.wages?.l4?.toLocaleString() || 'N/A'}</td>
                    <td class="gap-cell">
                        ${loc.gap > 0 ? `+$${loc.gap.toLocaleString()}` : loc.level === 4 ? '✅ Max' : 'N/A'}
                    </td>
                    <td>${colIndex}</td>
                    <td>
                        <button onclick="MultiCompare.removeLocation('${loc.areaCode}')" class="remove-btn" title="Remove">✕</button>
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;
    }

    /**
     * Initialize the comparison feature
     */
    function init() {
        console.log('Multi-location comparison initialized');
        const salary = parseInt(document.getElementById('multi-salary')?.value) || 150000;
        const occupation = document.getElementById('multi-occupation')?.value || '15-1252';
        updateComparisonTable(salary, occupation);
    }

    // Public API
    return {
        init,
        addLocation,
        removeLocation,
        clearAll,
        updateAll,
        getLocations: () => comparedLocations,
        updateTable: updateComparisonTable
    };
})();

// Expose to window for onclick handlers
window.MultiCompare = MultiCompare;
