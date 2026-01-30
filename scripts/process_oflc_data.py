#!/usr/bin/env python3
"""
Process OFLC wage data and create JSON files for the H1B Wage Levels app.
Data source: https://flag.dol.gov/wage-data/wage-data-downloads
"""

import csv
import json
import os
from collections import defaultdict

# Paths
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'OFLC_Wages_2025-26_Updated')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')

# Hours per year (2080 = 40 hours/week * 52 weeks)
HOURS_PER_YEAR = 2080


def load_geography():
    """Load geography data mapping Area codes to county names."""
    geography = {}
    county_to_area = defaultdict(list)
    
    with open(os.path.join(DATA_DIR, 'Geography.csv'), 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            area = row['Area']
            area_name = row['AreaName']
            state = row['StateAb']
            county = row['CountyTownName']
            
            if area not in geography:
                geography[area] = {
                    'areaName': area_name,
                    'state': state,
                    'counties': []
                }
            geography[area]['counties'].append(county)
            
            # Map county+state to area code
            key = f"{county}|{state}"
            if area not in county_to_area[key]:
                county_to_area[key].append(area)
    
    return geography, county_to_area


def load_occupations():
    """Load occupation codes and titles."""
    occupations = {}
    
    with open(os.path.join(DATA_DIR, 'oes_soc_occs.csv'), 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            code = row['soccode']
            title = row['Title']
            occupations[code] = title
    
    return occupations


def load_wages():
    """Load wage data from ALC_Export.csv."""
    wages = defaultdict(dict)
    
    with open(os.path.join(DATA_DIR, 'ALC_Export.csv'), 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            area = row['Area']
            soc = row['SocCode']
            
            # Convert hourly to annual
            try:
                level1 = round(float(row['Level1']) * HOURS_PER_YEAR)
                level2 = round(float(row['Level2']) * HOURS_PER_YEAR)
                level3 = round(float(row['Level3']) * HOURS_PER_YEAR)
                level4 = round(float(row['Level4']) * HOURS_PER_YEAR)
            except (ValueError, KeyError):
                continue
            
            wages[area][soc] = {
                'l1': level1,
                'l2': level2,
                'l3': level3,
                'l4': level4
            }
    
    return wages


def get_common_occupations(wages):
    """Get the most common SOC codes that appear in many areas."""
    soc_counts = defaultdict(int)
    
    for area, soc_data in wages.items():
        for soc in soc_data.keys():
            soc_counts[soc] += 1
    
    # Sort by count and return top occupations
    sorted_socs = sorted(soc_counts.items(), key=lambda x: -x[1])
    return [soc for soc, count in sorted_socs[:100]]  # Top 100 occupations


def create_wage_lookup_file(wages, geography, occupations, selected_socs):
    """
    Create a compact wage lookup file.
    Structure: { areaCode: { socCode: [l1, l2, l3, l4] } }
    """
    output = {}
    
    for area, soc_data in wages.items():
        area_wages = {}
        for soc, levels in soc_data.items():
            if soc in selected_socs:
                # Store as array for compactness
                area_wages[soc] = [levels['l1'], levels['l2'], levels['l3'], levels['l4']]
        
        if area_wages:
            output[area] = area_wages
    
    return output


def create_county_search_index(geography):
    """
    Create a searchable county index.
    Structure: { "county name, state": areaCode }
    """
    index = {}
    
    for area, data in geography.items():
        state = data['state']
        for county in data['counties']:
            # Create searchable key
            key = f"{county}, {state}"
            index[key] = {
                'area': area,
                'areaName': data['areaName'],
                'state': state,
                'county': county
            }
    
    return index


def main():
    print("Loading OFLC wage data...")
    
    # Load data
    print("  Loading geography...")
    geography, county_to_area = load_geography()
    print(f"    Found {len(geography)} areas, {sum(len(g['counties']) for g in geography.values())} county mappings")
    
    print("  Loading occupations...")
    occupations = load_occupations()
    print(f"    Found {len(occupations)} occupations")
    
    print("  Loading wages...")
    wages = load_wages()
    print(f"    Found {len(wages)} areas with wage data")
    
    # Get common occupations
    common_socs = get_common_occupations(wages)
    print(f"  Selected top {len(common_socs)} occupations")
    
    # Create output files
    print("\nCreating output files...")
    
    # 1. Wage lookup (main data file)
    wage_lookup = create_wage_lookup_file(wages, geography, occupations, set(common_socs))
    wage_file = os.path.join(OUTPUT_DIR, 'wages.json')
    with open(wage_file, 'w') as f:
        json.dump(wage_lookup, f, separators=(',', ':'))  # Compact JSON
    print(f"  Created {wage_file} ({os.path.getsize(wage_file) / 1024 / 1024:.1f} MB)")
    
    # 2. Geography/Area lookup
    geo_file = os.path.join(OUTPUT_DIR, 'geography.json')
    with open(geo_file, 'w') as f:
        json.dump(geography, f, separators=(',', ':'))
    print(f"  Created {geo_file} ({os.path.getsize(geo_file) / 1024:.0f} KB)")
    
    # 3. County search index
    county_index = create_county_search_index(geography)
    county_file = os.path.join(OUTPUT_DIR, 'counties.json')
    with open(county_file, 'w') as f:
        json.dump(county_index, f, separators=(',', ':'))
    print(f"  Created {county_file} ({os.path.getsize(county_file) / 1024:.0f} KB)")
    
    # 4. Occupations list (filtered to common ones)
    occ_list = [{'code': soc, 'title': occupations.get(soc, soc)} for soc in common_socs if soc in occupations]
    occ_file = os.path.join(OUTPUT_DIR, 'occupations.json')
    with open(occ_file, 'w') as f:
        json.dump(occ_list, f, indent=2)
    print(f"  Created {occ_file} ({os.path.getsize(occ_file) / 1024:.0f} KB)")
    
    print("\n✅ Done! Data files ready for the app.")
    
    # Sample verification
    print("\n📊 Sample verification (Software Developers in San Jose):")
    san_jose_area = '41940'
    soc = '15-1252'
    if san_jose_area in wage_lookup and soc in wage_lookup[san_jose_area]:
        levels = wage_lookup[san_jose_area][soc]
        print(f"   Level 1: ${levels[0]:,}/year")
        print(f"   Level 2: ${levels[1]:,}/year")
        print(f"   Level 3: ${levels[2]:,}/year")
        print(f"   Level 4: ${levels[3]:,}/year")


if __name__ == '__main__':
    main()
