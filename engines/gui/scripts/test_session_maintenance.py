import datetime
import tempfile
import unittest
from session_maintenance import check_day, update_day


class SessionTest(unittest.TestCase):
    def test_first_hook_and_repeated_skill_use_share_one_check(self):
        with tempfile.TemporaryDirectory() as home:
            calls, updates = [], []
            def latest():
                calls.append('check')
                return {'Pillow': '12.3.0'}
            options = dict(home=home, now=datetime.date(2026, 10, 2), latest=latest, installed=lambda: {'Pillow': '12.3.0'})
            check_day( **options)
            for _ in range(20):
                self.assertTrue(update_day(lambda: updates.append('update'), **options)['skipped'])
                self.assertEqual(check_day( **options)['status'], 'current')
            self.assertEqual(len(calls), 1)
            self.assertEqual(updates, [])
            check_day(**dict(options, now=datetime.date(2026, 10, 3)))
            self.assertEqual(len(calls), 2)

    def test_new_version_is_updated_only_once(self):
        with tempfile.TemporaryDirectory() as home:
            calls, updates = [], []
            def latest():
                calls.append('check')
                return {'Pillow': 'new'}
            options = dict(home=home, latest=latest, installed=lambda: {'Pillow': 'new' if updates else 'old'})
            self.assertEqual(check_day( **options)['status'], 'needs-update')
            update_day(lambda: updates.append('update'), **options)
            update_day(lambda: updates.append('update'), **options)
            self.assertEqual(len(calls), 1)
            self.assertEqual(len(updates), 1)

    def test_successful_process_with_old_installed_version_is_rejected(self):
        with tempfile.TemporaryDirectory() as home:
            options = dict(home=home, latest=lambda: {'Pillow': 'new'}, installed=lambda: {'Pillow': 'old'})
            with self.assertRaises(ValueError):
                update_day(lambda: None, **options)
            self.assertEqual(check_day(**options)['status'], 'failed')

    def test_failed_check_is_not_repeated(self):
        with tempfile.TemporaryDirectory() as home:
            calls = []
            def latest():
                calls.append('check')
                raise OSError('offline')
            for _ in range(5):
                self.assertEqual(check_day( home=home, latest=latest)['status'], 'failed')
            self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
