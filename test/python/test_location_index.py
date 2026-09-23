"""Offline CLI contract tests for the open-data location index builder."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/build-location-index.py'


def feature(name, start, end, coordinates, kind='LineString'):
    return {'properties': {'LINEAR_NAME_FULL': name, 'FROM_INTERSECTION_ID': start,
                           'TO_INTERSECTION_ID': end},
            'geometry': {'type': kind, 'coordinates': coordinates}}


def postal_row(prefix, name, lat='43.65', lon='-79.4'):
    return '\t'.join(['CA', prefix, name, '', '', '', '', '', '', lat, lon, '6'])


class LocationIndexTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / 'data').mkdir()
        self.geo = self.root / 'streets.json'
        self.archive = self.root / 'CA.zip'
        self.output = self.root / 'data/geography/toronto-locations.json'

    def run_builder(self, features, rows=(), member='CA.txt'):
        self.geo.write_text(json.dumps({'features': features}))
        with zipfile.ZipFile(self.archive, 'w') as archive:
            archive.writestr(member, '\n'.join(rows))
        return subprocess.run([sys.executable, str(SCRIPT), str(self.geo), str(self.archive)],
                              cwd=self.root, capture_output=True, text=True, timeout=10)

    def read_result(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(self.output.read_text())

    def test_street_endpoints_coordinates_and_deduplication(self):
        features = [
            feature('King Street', 2, 1, [[-79.123456789, 43.123456789], [-79.4, 43.7]]),
            feature('King Street', 1, 2, [[-79.4, 43.7], [-79.123456789, 43.123456789]]),
            feature('Bay Street', 1, 3, [[[-79.4, 43.7], [-79.3, 43.6]],
                                      [[-79.3, 43.6], [-79.2, 43.5]]], 'MultiLineString'),
        ]
        data = self.read_result(self.run_builder(features))
        self.assertEqual(data['streets'], {'King Street': ['1', '2'], 'Bay Street': ['1', '3']})
        self.assertEqual(data['nodes'], {'1': [43.7, -79.4], '2': [43.1234568, -79.1234568],
                                       '3': [43.5, -79.2]})
        self.assertEqual(data['postal'], {})
        original = self.output.read_bytes()
        self.read_result(self.run_builder(features))
        self.assertEqual(self.output.read_bytes(), original)
        self.assertTrue(original.endswith(b'\n'))

    def test_ignores_empty_geometry_names_and_missing_nodes(self):
        data = self.read_result(self.run_builder([
            feature('Empty', 1, 2, []), feature('Empty multi', 1, 2, [], 'MultiLineString'),
            feature('', 1, 2, [[-79, 43], [-78, 44]]),
            feature('One endpoint', None, 7, [[-79, 43], [-78, 44]]),
        ]))
        self.assertEqual(data['streets'], {'One endpoint': ['7']})
        self.assertEqual(data['nodes'], {'7': [44, -78]})

    def test_postal_filtering_neighbourhood_labels_and_numeric_coordinates(self):
        data = self.read_result(self.run_builder([], [
            postal_row('M4L', 'Toronto (Beaches / Woodbine)'),
            postal_row('M6K', 'Parkdale'), postal_row('K1A', 'Ottawa'),
            postal_row('M0A', 'Invalid'), postal_row('M4L 1A1', 'Full postcode'),
        ]))
        self.assertEqual(data['postal'], {
            'M4L': {'name': 'Beaches / Woodbine', 'coordinates': [43.65, -79.4]},
            'M6K': {'name': 'Parkdale', 'coordinates': [43.65, -79.4]},
        })

    def test_invalid_archive_or_coordinates_preserve_existing_index(self):
        self.read_result(self.run_builder([]))
        original = self.output.read_bytes()
        for rows, member in [([], 'wrong.txt'), ([postal_row('M4L', 'Toronto', 'bad')], 'CA.txt')]:
            with self.subTest(member=member, rows=rows):
                self.assertNotEqual(self.run_builder([], rows, member).returncode, 0)
                self.assertEqual(self.output.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
