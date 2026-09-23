import importlib.util
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('badges', Path(__file__).resolve().parents[2] / 'scripts/coverage-badges.py')
badges = importlib.util.module_from_spec(spec)
spec.loader.exec_module(badges)


class CoverageBadgesTests(unittest.TestCase):
    def test_summary_generates_three_valid_badges(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            badges.generate('# all files | 99.71 | 97.41 | 96.59 |\n', output)
            for name, value in [('lines', '99.71'), ('branches', '97.41'), ('functions', '96.59')]:
                root = ET.parse(output / f'{name}.svg').getroot()
                self.assertEqual(root.attrib['aria-label'], f'JS {name}: {value}%')

    def test_missing_or_invalid_summary_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            for report in ['', '# all files | 101 | 20 | 30 |', '# all files | 1 | 2 | 3 |\n' * 2]:
                with self.subTest(report=report), self.assertRaises(ValueError):
                    badges.generate(report, Path(directory))
