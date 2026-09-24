"""Generate README badges from Node's measured coverage report."""
import re
from pathlib import Path
import sys


def coverage_values(report):
    matches = re.findall(r'^# all files\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|', report, re.M)
    if len(matches) != 1:
        raise ValueError('Expected one complete Node coverage summary')
    values = tuple(float(value) for value in matches[0])
    if any(not 0 <= value <= 100 for value in values):
        raise ValueError('Invalid coverage percentage')
    return matches[0], values


def require_full_coverage(report):
    _, values = coverage_values(report)
    if any(value != 100 for value in values):
        raise ValueError('JavaScript line, branch, and function coverage must all be 100%')


def generate(report, destination):
    displayed_values, _ = coverage_values(report)
    destination.mkdir(parents=True, exist_ok=True)
    for name, value in zip(('lines', 'branches', 'functions'), displayed_values):
        label = f'JS {name}'
        color = '#4c1' if float(value) >= 90 else '#dfb317'
        svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="190" height="20" role="img" aria-label="{label}: {value}%">
<title>{label}: {value}%</title>
<rect width="120" height="20" fill="#555"/><rect x="120" width="70" height="20" fill="{color}"/>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Arial,sans-serif" font-size="11">
<text x="60" y="14">{label}</text><text x="155" y="14">{value}%</text></g></svg>'''
        (destination / f'{name}.svg').write_text(svg + '\n')


if __name__ == '__main__':
    coverage_report = Path(sys.argv[1]).read_text()
    require_full_coverage(coverage_report)
    generate(coverage_report, Path(sys.argv[2]))
