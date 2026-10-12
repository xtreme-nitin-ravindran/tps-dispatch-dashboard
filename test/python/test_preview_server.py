"""Contract tests for the local preview server's feed proxy."""
import importlib.util
from pathlib import Path
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import urlopen

spec = importlib.util.spec_from_file_location(
    'preview_server', Path(__file__).resolve().parents[2] / 'scripts/preview-server.py')
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class RewriteTests(unittest.TestCase):
    def test_rewrites_the_single_snapshot_url(self):
        source = b'const CONFIG = { snapshotUrl: "https://data-sirento.nitin.run/data/current.json" };'
        rewritten = preview.rewrite_app_module(source)
        self.assertIn(b'"/__local_feed/current.json"', rewritten)
        self.assertNotIn(preview.SNAPSHOT_URL, rewritten)

    def test_rejects_a_missing_or_duplicated_snapshot_url(self):
        for source in [b'const CONFIG = {};', preview.SNAPSHOT_URL * 2]:
            with self.subTest(source=source), self.assertRaises(ValueError):
                preview.rewrite_app_module(source)


class ProxyNameTests(unittest.TestCase):
    def test_allow_lists_only_the_public_feeds(self):
        self.assertEqual(preview.proxy_name('/__local_feed/current.json'), 'current.json')
        self.assertEqual(preview.proxy_name('/__local_feed/ttc-diversions.json'), 'ttc-diversions.json')

    def test_rejects_unknown_and_non_proxy_paths(self):
        for path in ['/__local_feed/secret.json', '/__local_feed/', '/index.html', '/__local_feed']:
            with self.subTest(path=path):
                self.assertIsNone(preview.proxy_name(path))


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), preview.PreviewHandler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.shutdown)
        self.addCleanup(self.server.server_close)

    def get(self, path):
        return urlopen(f'http://127.0.0.1:{self.port}{path}', timeout=5)

    def test_serves_the_rewritten_app_module(self):
        body = self.get('/src/app/app.js').read()
        self.assertIn(b'"/__local_feed/current.json"', body)
        self.assertNotIn(preview.SNAPSHOT_URL, body)

    def test_proxies_an_allow_listed_feed(self):
        original = preview.fetch_public
        preview.fetch_public = lambda name: b'{"status": "ok"}'
        self.addCleanup(setattr, preview, 'fetch_public', original)
        response = self.get('/__local_feed/current.json?ts=1')
        self.assertEqual(response.headers['Content-Type'], 'application/json')
        self.assertEqual(response.read(), b'{"status": "ok"}')

    def test_unknown_feed_is_not_found(self):
        with self.assertRaises(HTTPError) as error:
            self.get('/__local_feed/secret.json')
        self.assertEqual(error.exception.code, 404)

    def test_upstream_failure_is_reported(self):
        original = preview.fetch_public

        def fail(name):
            raise RuntimeError('Public feed could not be fetched')

        preview.fetch_public = fail
        self.addCleanup(setattr, preview, 'fetch_public', original)
        with self.assertRaises(HTTPError) as error:
            self.get('/__local_feed/current.json')
        self.assertEqual(error.exception.code, 502)

    def test_static_paths_fall_through(self):
        response = self.get('/index.html')
        self.assertEqual(response.status, 200)
        self.assertIn(b'<html', response.read().lower())


if __name__ == '__main__':
    unittest.main()
