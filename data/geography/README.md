# Bundled location reference data

Retrieved 2026-09-19. These datasets are not covered by the code's Unlicense.

- Toronto Centreline, City of Toronto: https://open.toronto.ca/dataset/toronto-centreline-tcl/
  Open Government Licence – Toronto: https://www.toronto.ca/city-government/data-research-maps/open-data/open-data-licence/
  Source resource: https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/1d079757-377b-4564-82df-eb5638583bfb/resource/7bc94ccf-7bcf-4a7d-88b1-bdfc8ec5aaf1/download/centreline-version-2-4326.geojson
  Derived index retains street names, intersection IDs and rounded endpoint coordinates.
- GeoNames postal data: https://download.geonames.org/export/zip/CA.zip
  Attribution: https://www.geonames.org/
  CC BY 4.0: https://creativecommons.org/licenses/by/4.0/
  Toronto postal prefixes only; representative coordinates and supplied area labels.
  Postal areas are approximate and may span police divisions.

Rebuild after downloading the two sources:

    python3 scripts/build-location-index.py /path/to/centreline.geojson /path/to/CA.zip

Then update the source version in scripts/tfs-etl.js to invalidate cached matches.
TPS boundaries are in ../police-divisions.geojson; see the main README for their attribution.
