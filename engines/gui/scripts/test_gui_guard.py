"""Protocol and CLI regression tests. Synthetic screens do not prove real GUI appearance."""
import datetime
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
from PIL import Image

SCRIPT = Path(__file__).with_name('gui-guard.py')
spec = importlib.util.spec_from_file_location('guard', SCRIPT)
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

ADAPTER = '''import datetime,hashlib,json,sys
from pathlib import Path
from PIL import Image
root=Path.cwd(); label,nonce=sys.argv[1:]; behaviour=json.loads((root/'behaviour.json').read_text())
def bounds(x,y,w,h):return dict(left=x,top=y,right=x+w,bottom=y+h,width=w,height=h,centerX=x+w/2,centerY=y+h/2)
data=dict(measurementId=nonce,measuredAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),executable=str(root/'App.exe'),binarySha256=hashlib.sha256((root/'App.exe').read_bytes()).hexdigest(),runtimeVerified=True,dpiX=96,dpiY=96,displayState='normal',window=bounds(10,20,80,60),controls=[dict(name='target',fontFamily='Test',fontPoints=11,**bounds(20,30,20,10)),dict(name='compare',fontFamily='Test',fontPoints=11,**bounds(50,30,20,10))])
if behaviour.get('reuse'):sys.exit(0)
if behaviour.get('old'):data['measuredAt']='2000-01-01T00:00:00Z'
if behaviour.get('nonce'):data['measurementId']='old'
if behaviour.get('binary'):data['binarySha256']='wrong'
if behaviour.get('runtime'):data['runtimeVerified']=False
if behaviour.get('missing'):data['controls'].pop()
if behaviour.get('duplicate'):data['controls'][1]['name']='target'
if behaviour.get('bounds'):data['controls'][0].pop('centerY')
if behaviour.get('width'):data['window']=bounds(10,20,81,60)
if behaviour.get('height'):data['window']=bounds(10,20,80,61)
if behaviour.get('dpi'):data['dpiX']=120
if behaviour.get('state'):data['displayState']='other'
if behaviour.get('font'):data['controls'][0]['fontFamily']=None
if behaviour.get('loaded'):data['loadedSources']={'View.cs':'wrong'}
else:data['loadedSources']={p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in ['View.cs','Other.cs']}
data['measurementTool']={'version':behaviour.get('measurementVersion','1')}
out=root/'measurements';out.mkdir(exist_ok=True)
(out/(label+'.json')).write_text(json.dumps(data))
im=Image.new('RGB',(data['window']['width'],data['window']['height']),(255,255,255))
if behaviour.get('pixel'):im.putpixel((1,1),(0,0,0))
if behaviour.get('allowedPixel'):im.putpixel((11,11),(0,0,0))
im.save(out/(label+'.png'))
'''


class GuardTest(unittest.TestCase):
    def test_first_hook_uses_one_check_shared_with_skill_command(self):
        from session_maintenance import check_session, update_session
        calls = []
        g.record_path(g.day_id(), self.home).unlink(missing_ok=True)
        def latest():
            calls.append('check')
            return {'Pillow': '12.3.0'}
        options = dict(home=str(self.home), latest=latest, installed=lambda: {'Pillow': '12.3.0'})
        payload = {'session_id': 'first-use', 'cwd': str(self.root), 'tool_name': 'Edit',
                   'tool_input': {'file_path': str(self.root / 'View.cs'), 'old_string': 'source', 'new_string': 'changed'}}
        for _ in range(3):
            with patch.object(g, 'check_day', side_effect=lambda: check_session(g.day_id(), **options)), patch('sys.stdin', io.StringIO(json.dumps(payload))), redirect_stdout(io.StringIO()):
                g.hook('pre')
        self.assertTrue(update_session(g.day_id(), lambda: self.fail('再更新は禁止'), **options)['skipped'])
        self.assertEqual(calls, ['check'])

    def test_measurement_tool_update_during_comparison_is_rejected(self):
        self.begin()
        self.edit()
        self.cli('build')
        self.behaviour['measurementVersion'] = '2'
        self.save_behaviour()
        self.assertNotEqual(self.cli('after', ok=False).returncode, 0)
        self.assertNotEqual(self.cli('verify', ok=False).returncode, 0)

    def test_explicit_window_size_change_requires_approval_and_exact_sizes(self):
        self.cfg['windowSizeChange'] = {'before': [80, 60], 'after': [80, 61]}
        self.save_config()
        self.begin()
        self.edit()
        self.cli('build')
        self.behaviour['height'] = True
        self.save_behaviour()
        self.assertNotEqual(self.cli('after', ok=False).returncode, 0)
        self.assertNotEqual(self.cli('approve', 'window-size:80x60->80x62', ok=False).returncode, 0)
        self.cli('approve', 'window-size:80x60->80x61')
        self.cli('after')
        self.cli('verify')
        self.behaviour['height'] = False
        self.behaviour['width'] = True
        self.save_behaviour()
        self.assertNotEqual(self.cli('after', ok=False).returncode, 0)

    def test_explicit_window_size_change_never_allows_dpi_change(self):
        self.cfg['windowSizeChange'] = {'before': [80, 60], 'after': [80, 61]}
        self.save_config()
        self.begin()
        self.edit()
        self.cli('build')
        self.cli('approve', 'window-size:80x60->80x61')
        self.behaviour.update(height=True, dpi=True)
        self.save_behaviour()
        self.assertNotEqual(self.cli('after', ok=False).returncode, 0)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.home = self.root / 'cache'
        self.env = dict(os.environ, GUI_GUARD_HOME=str(self.home), CODEX_SESSION_ID='test-session', PYTHONDONTWRITEBYTECODE='1')
        self.env.pop('CODEX_THREAD_ID', None)
        self.env.pop('CLAUDE_CODE_SESSION_ID', None)
        for session in ['test-session', 'parallel-test']:
            path = g.record_path(g.day_id(), self.home)
            path.parent.mkdir(parents=True, exist_ok=True)
            g.save(path, {'status': 'current'})
        self.env['CSS_GUARD_HOME'] = str(self.home / 'web')
        for session in ['test-session', 'parallel-test']:
            path = self.home / 'web/maintenance' / (hashlib.sha256(g.day_id().encode()).hexdigest() + '.json')
            path.parent.mkdir(parents=True, exist_ok=True)
            g.save(path, {'status': 'current'})
        (self.root / 'copy').mkdir()
        for name in ['View.cs', 'Other.cs']:
            (self.root / name).write_text('source')
            (self.root / 'copy' / name).write_text('source')
        (self.root / 'App.exe').write_bytes(b'binary')
        (self.root / 'adapter.py').write_text(ADAPTER)
        (self.root / 'check.py').write_text("print('screen check passed')")
        (self.root / 'build.py').write_text("from pathlib import Path; Path('App.exe').write_bytes(b'built fixture')")
        self.behaviour = {}
        self.cfg = {'files': ['View.cs', 'Other.cs'], 'copyRoot': str(self.root / 'copy'), 'binary': str(self.root / 'App.exe'),
                    'build': {'command': [sys.executable, 'build.py']},
                    'measurement': {'command': [sys.executable, 'adapter.py', '{label}', '{nonce}'], 'targets': ['target', 'compare'],
                                    'fontTargets': ['target'], 'outputDirectory': 'measurements', 'expectedExecutable': str(self.root / 'App.exe')},
                    'checks': [[sys.executable, 'check.py']]}
        self.save_config()
        self.save_behaviour()

    def save_config(self):
        g.write(self.root / 'gui-guard.json', self.cfg)

    def save_behaviour(self):
        g.write(self.root / 'behaviour.json', self.behaviour)

    def cli(self, *args, stdin='', cwd=None, ok=True, env=None):
        if os.environ.get('RENDER_GUARD_FORWARD_TEST'):
            prefix = ['node', str(SCRIPT.parents[3] / 'bin/render-guard.mjs')]
            if not args[0].startswith('hook-'):
                prefix.append('gui')
        else:
            prefix = [sys.executable, str(SCRIPT)]
        result = subprocess.run([*prefix, *args], cwd=cwd or self.root, env=env or self.env,
                                input=stdin, text=True, capture_output=True, timeout=15)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def test_profile_limits_checks_and_preserves_source_boundary(self):
        (self.root / 'check.py').write_text("raise RuntimeError('unrelated check must not run')")
        (self.root / 'focused.py').write_text("print('focused screen check passed')")
        self.cfg['profiles'] = {'phone': {
            'scopeFiles': ['View.cs'], 'checks': [[sys.executable, 'focused.py']],
            'evidence': [], 'validationFiles': [], 'regression': []}}
        self.save_config()
        self.cli('begin', '--scope', 'View.cs')
        self.assertEqual(g.read(g.state_path(self.root))['profile'], 'phone')
        self.assertNotEqual(self.cli('scope', '--scope', 'Other.cs', ok=False).returncode, 0)
        self.assertNotEqual(self.cli('after', '--profile', 'phone', ok=False).returncode, 0)
        self.edit()
        self.complete()
        (self.root / 'Other.cs').write_text('unexpected change')
        (self.root / 'copy/Other.cs').write_text('unexpected change')
        self.cli('build')
        self.assertIn('outside', self.cli('after', ok=False).stderr)

    def test_profile_cannot_weaken_protection_or_change_mid_comparison(self):
        self.cfg['profiles'] = {'phone': {'scopeFiles': ['View.cs'], 'protectedFiles': []}}
        self.save_config()
        self.assertNotEqual(self.cli('begin', '--scope', 'View.cs', ok=False).returncode, 0)
        del self.cfg['profiles']['phone']['protectedFiles']
        self.save_config()
        self.cli('begin', '--scope', 'View.cs')
        self.cfg['profiles']['phone']['checks'] = [[sys.executable, '-c', "print('weaker check')"]]
        self.save_config()
        self.assertIn('after begin', self.cli('after', ok=False).stderr)

    def test_ambiguous_profile_falls_back_to_all_checks(self):
        self.cfg['profiles'] = {
            'phone': {'scopeFiles': ['View.cs'], 'checks': [[sys.executable, '-c', 'print(1)']]},
            'easy': {'scopeFiles': ['View.cs'], 'checks': [[sys.executable, '-c', 'print(2)']]}}
        (self.root / 'check.py').write_text("raise RuntimeError('full checks were retained')")
        self.save_config()
        self.begin()
        self.assertIsNone(g.read(g.state_path(self.root))['profile'])
        self.edit()
        self.cli('build')
        self.assertIn('full checks were retained', self.cli('after', ok=False).stderr)

    def test_unmatched_profile_and_manual_selection_cannot_skip_checks(self):
        self.cfg['profiles'] = {'phone': {'scopeFiles': ['Other.cs'],
            'checks': [[sys.executable, '-c', 'print(1)']]}}
        (self.root / 'check.py').write_text("raise RuntimeError('full checks were retained')")
        self.save_config()
        self.assertNotEqual(self.cli('begin', '--scope', 'View.cs', '--profile', 'phone', ok=False).returncode, 0)
        self.begin()
        self.edit()
        self.cli('build')
        self.assertIn('full checks were retained', self.cli('after', ok=False).stderr)

    def setup_retry(self, snapshot_checks=1):
        (self.root / 'first.py').write_text(
            "from pathlib import Path; p=Path('count'); "
            "p.write_text(str(int(p.read_text())+1) if p.exists() else '1'); "
            "Path('evidence.txt').write_text('current screen evidence')")
        (self.root / 'last.py').write_text(
            "from pathlib import Path; assert Path('ready').exists(), 'temporary failure'")
        self.cfg['checks'] = [[sys.executable, 'first.py'], [sys.executable, 'last.py']]
        self.cfg['evidence'] = ['evidence.txt']
        self.cfg['snapshotChecks'] = snapshot_checks
        self.save_config()
        self.begin()
        self.edit()
        self.cli('build')
        self.cli('after', ok=False)
        self.assertNotEqual(self.cli('verify', ok=False).returncode, 0)
        self.assertEqual((self.root / 'count').read_text(), '1')
        (self.root / 'ready').touch()

    def test_resume_reuses_only_completed_current_build_stages(self):
        self.setup_retry()
        old_nonce = g.read(self.root / 'measurements/guard-after.json')['measurementId']
        result = self.cli('after')
        self.cli('verify')
        self.assertEqual((self.root / 'count').read_text(), '1')
        self.assertNotEqual(g.read(self.root / 'measurements/guard-after.json')['measurementId'], old_nonce)
        self.assertIn('already complete', result.stdout)

    def test_default_retry_reuses_checks_but_changed_live_image_forces_all_checks(self):
        self.setup_retry()
        self.cli('after')
        self.assertEqual((self.root / 'count').read_text(), '1')
        self.behaviour['pixel'] = True
        self.save_behaviour()
        self.cli('after')
        self.assertEqual((self.root / 'count').read_text(), '2')
        self.cli('verify')

    def test_regression_screens_disable_check_reuse(self):
        self.cfg['regression'] = [{'measurement': self.cfg['measurement'], 'allowedTargets': ['target']}]
        self.setup_retry()
        self.cli('after')
        self.assertEqual((self.root / 'count').read_text(), '2')
        self.cli('verify')

    def test_configuration_change_during_baseline_is_rejected(self):
        with (self.root / 'adapter.py').open('a') as handle:
            handle.write("\np=root/'gui-guard.json'; cfg=json.loads(p.read_text()); cfg['checks']=[[sys.executable,'-c','print(1)']]; p.write_text(json.dumps(cfg))")
        self.assertIn('validation configuration', self.cli('begin', '--scope', 'View.cs', ok=False).stderr)

    def test_checker_change_during_capture_is_rejected_by_whole_operation(self):
        with (self.root / 'adapter.py').open('a') as handle:
            handle.write("\nif label=='guard-after': (root/'check.py').write_text(\"print('replaced check')\")")
        self.begin()
        self.cli('build')
        self.assertIn('validation configuration', self.cli('after', ok=False).stderr)
        self.assertNotEqual(self.cli('verify', ok=False).returncode, 0)

    def test_legacy_pending_plan_cannot_be_backfilled_or_erase_completed_receipt(self):
        self.begin()
        self.complete()
        state = g.read(g.state_path(self.root))
        del state['configHashAtStart']
        del state['validationAtStart']
        g.write(g.state_path(self.root), state)
        self.assertIn('legacy comparison', self.cli('after', ok=False).stderr)
        self.assertEqual(g.read(g.state_path(self.root))['receipt'], state['receipt'])
        self.cli('verify')
        del state['receipt']
        g.write(g.state_path(self.root), state)
        self.denied(self.hook('pre'))
        self.assertNotEqual(self.cli('after', ok=False).returncode, 0)
        self.assertEqual(g.read(g.state_path(self.root))['before'], state['before'])

    def test_full_check_configuration_is_frozen_after_begin(self):
        self.begin()
        self.cfg['checks'] = [[sys.executable, '-c', "print('skip the real check')"]]
        self.save_config()
        self.assertIn('validation configuration', self.cli('after', ok=False).stderr)
        self.assertNotEqual(self.cli('verify', ok=False).returncode, 0)

    def test_repeated_resume_failure_keeps_completed_stages(self):
        self.setup_retry()
        (self.root / 'ready').unlink()
        self.cli('after', ok=False)
        self.cli('after', ok=False)
        self.assertEqual((self.root / 'count').read_text(), '1')
        (self.root / 'ready').touch()
        self.cli('after')
        self.cli('verify')
        self.assertEqual((self.root / 'count').read_text(), '1')

    def test_fresh_measurement_failure_discards_previous_progress(self):
        self.setup_retry()
        self.behaviour['state'] = True
        self.save_behaviour()
        self.cli('after', ok=False)
        self.assertNotEqual(self.cli('after', ok=False).returncode, 0)
        self.assertNotEqual(self.cli('verify', ok=False).returncode, 0)

    def test_retry_rechecks_changed_source_and_rejects_changed_checker(self):
        for changed in ['View.cs', 'first.py']:
            with self.subTest(changed=changed):
                if (self.root / 'count').exists():
                    self.cli('begin', '--scope', 'View.cs')
                    self.cli('build')
                    (self.root / 'ready').unlink()
                    self.cli('after', ok=False)
                    (self.root / 'ready').touch()
                else:
                    self.setup_retry()
                count = int((self.root / 'count').read_text())
                path = self.root / changed
                path.write_text(path.read_text() + (' updated' if changed.endswith('.cs') else "\nprint('updated checker')"))
                if changed.endswith('.cs'):
                    (self.root / 'copy' / changed).write_text(path.read_text())
                    self.cli('build')
                if changed.endswith('.cs'):
                    self.cli('after')
                    self.assertEqual(int((self.root / 'count').read_text()), count + 1)
                    self.cli('verify')
                else:
                    self.assertIn('validation code', self.cli('after', ok=False).stderr)
                    self.assertEqual(int((self.root / 'count').read_text()), count)
                    self.assertNotEqual(self.cli('verify', ok=False).returncode, 0)

    def test_resume_rejects_tampered_or_expired_evidence(self):
        self.setup_retry()
        (self.root / 'evidence.txt').write_text('tampered')
        self.cli('after')
        self.assertEqual((self.root / 'count').read_text(), '2')
        state = g.read(g.state_path(self.root))
        state['progress']['startedAt'] = 0
        g.write(g.state_path(self.root), state)
        self.cli('after')
        self.assertEqual((self.root / 'count').read_text(), '3')
        self.cli('verify')

    def test_legacy_live_checks_are_never_reused(self):
        # Same main window does not establish the state of a different dialog.
        self.setup_retry(snapshot_checks=0)
        self.assertNotIn('progress', g.read(g.state_path(self.root)))
        self.cli('after')
        self.assertEqual((self.root / 'count').read_text(), '2')
        self.cli('verify')

    def test_live_stage_reruns_after_a_later_failure(self):
        self.setup_retry()
        self.cli('after')
        self.cli('begin', '--scope', 'View.cs')
        (self.root / 'live.py').write_text(
            "from pathlib import Path; p=Path('live-count'); "
            "p.write_text(str(int(p.read_text())+1) if p.exists() else '1')")
        self.cfg['checks'].insert(1, [sys.executable, 'live.py'])
        self.save_config()
        self.cli('refresh', '--scope', 'View.cs')
        (self.root / 'ready').unlink()
        self.cli('build')
        self.cli('after', ok=False)
        (self.root / 'ready').touch()
        self.cli('after')
        self.assertEqual((self.root / 'live-count').read_text(), '2')
        self.cli('verify')

    def test_profile_preserves_shared_dependencies_and_rejects_common_source_changes(self):
        for path in [self.root / 'Shared.cs', self.root / 'copy/Shared.cs']:
            path.write_text('shared source')
        (self.root / 'helper.json').write_text('{}')
        self.cfg['build']['sourceFiles'] = ['View.cs', 'Other.cs', 'Shared.cs']
        self.cfg['validationFiles'] = ['helper.json']
        self.cfg['profiles'] = {'phone': {'scopeFiles': ['View.cs'], 'validationFiles': []}}
        self.save_config()
        self.begin()
        self.assertIn(str(self.root / 'helper.json'), g.validation_inputs(self.root, g.config(self.root)))
        self.edit()
        for path in [self.root / 'Shared.cs', self.root / 'copy/Shared.cs']:
            path.write_text('shared change')
        self.assertNotEqual(self.cli('refresh', '--scope', 'View.cs', ok=False).returncode, 0)
        self.cli('build')
        self.assertIn('outside', self.cli('after', ok=False).stderr)
        self.assertNotEqual(self.cli('verify', ok=False).returncode, 0)

    def test_checker_changes_block_before_edit_and_refresh_keeps_baseline_safe(self):
        self.begin()
        original = (self.root / 'check.py').read_text()
        (self.root / 'check.py').write_text("print('weaker check')")
        self.denied(self.hook('pre'))
        self.assertIn('validation code', self.cli('after', ok=False).stderr)
        self.cli('refresh', '--scope', 'View.cs')
        self.assertIsNone(self.hook('pre'))
        self.edit()
        (self.root / 'check.py').write_text(original)
        self.assertNotEqual(self.cli('refresh', '--scope', 'View.cs', ok=False).returncode, 0)
        self.assertNotEqual(self.cli('after', ok=False).returncode, 0)

    def test_profile_cannot_inherit_snapshot_permission_for_new_checks(self):
        self.cfg['snapshotChecks'] = 1
        self.cfg['profiles'] = {'phone': {'scopeFiles': ['View.cs']}}
        self.save_config()
        self.begin()
        self.assertEqual(g.config(self.root)['snapshotChecks'], 0)

    def test_snapshot_count_must_be_valid(self):
        for invalid in [-1, 2, True, '1']:
            self.cfg['snapshotChecks'] = invalid
            self.save_config()
            self.assertNotEqual(self.cli('begin', '--scope', 'View.cs', ok=False).returncode, 0)

    def test_completed_snapshot_cannot_rewrite_the_measured_screen(self):
        (self.root / 'check.py').write_text(
            "from pathlib import Path; p=Path('measurements/guard-after.json'); "
            "p.write_text(p.read_text()+' ')")
        self.begin()
        self.cli('build')
        self.assertIn('artifacts were changed', self.cli('after', ok=False).stderr)
        self.assertNotEqual(self.cli('verify', ok=False).returncode, 0)

    def test_dependency_resolution_keeps_extensionless_symlinks_and_rechecks_targets(self):
        alias = self.root / 'checker'
        alias.symlink_to('check.py')
        self.cfg['checks'] = [[sys.executable, 'checker']]
        self.save_config()
        self.begin()
        self.assertIn(str(self.root / 'check.py'), g.input_files(self.root, g.config(self.root)))
        (self.root / 'other-check.py').write_text("print('different check')")
        alias.unlink()
        alias.symlink_to('other-check.py')
        self.assertIn('validation code', self.cli('after', ok=False).stderr)
        self.denied(self.hook('pre'))

    def test_fresh_forces_snapshot_prefix_to_run_again(self):
        self.setup_retry()
        self.cli('after', '--fresh')
        self.assertEqual((self.root / 'count').read_text(), '2')
        self.cli('verify')

    def test_unified_config_preserves_version_and_after_verification(self):
        g.write(self.root / 'render-guard.json', {'gui': self.cfg})
        (self.root / 'gui-guard.json').unlink()
        self.begin()
        self.edit()
        self.assertNotEqual(self.cli('verify', ok=False).returncode, 0)
        self.complete()
        self.assertEqual(g.find_root(self.root / 'View.cs'), self.root)

    def begin(self):
        self.cli('begin', '--scope', 'View.cs')

    def complete(self):
        self.cli('build')
        self.cli('after')
        self.cli('verify')

    def edit(self):
        (self.root / 'View.cs').write_text('changed')
        (self.root / 'copy' / 'View.cs').write_text('changed')

    def hook(self, kind, tool='apply_patch', path='View.cs', data=None, cwd=None, session='test-session'):
        payload = {'session_id': session, 'cwd': str(cwd or self.root), 'tool_name': tool}
        payload['tool_input'] = data if data is not None else {'command': '*** Begin Patch\n*** Update File: ' + str(self.root / path) + '\n@@\n-source\n+changed\n*** End Patch'}
        result = self.cli('hook-' + kind, stdin=json.dumps(payload))
        return json.loads(result.stdout) if result.stdout.strip() else None

    def denied(self, output):
        self.assertEqual(output['hookSpecificOutput']['permissionDecision'], 'deny')

    def test_official_codex_without_measurement_denied(self):
        self.denied(self.hook('pre'))

    def test_claude_edit_and_write_without_measurement_denied(self):
        for tool in ['Edit', 'Write', 'MultiEdit']:
            self.denied(self.hook('pre', tool=tool, data={'file_path': str(self.root / 'View.cs'), 'old_string': 'source', 'new_string': 'changed', 'content': 'changed'}))

    def test_outside_cwd_official_input_detects_project(self):
        self.denied(self.hook('pre', cwd=self.root / 'copy'))

    def test_full_lifecycle_both_agents(self):
        for tool in ['apply_patch', 'Edit']:
            self.begin()
            data = None if tool == 'apply_patch' else {'file_path': str(self.root / 'View.cs'), 'old_string': 'source', 'new_string': 'changed'}
            self.assertIsNone(self.hook('pre', tool=tool, data=data))
            self.edit()
            self.assertIsNone(self.hook('post', tool=tool, data=data))
            self.assertEqual(self.hook('stop')['decision'], 'block')
            self.complete()
            self.assertIsNone(self.hook('stop'))

    def test_scope_denies_other_gui_file(self):
        self.begin()
        self.denied(self.hook('pre', path='Other.cs'))

    def test_comparator_and_numeric_bounds_required(self):
        for field in ['missing', 'duplicate', 'bounds', 'font']:
            self.behaviour = {field: True}
            self.save_behaviour()
            result = self.cli('begin', '--scope', 'View.cs', ok=False)
            self.assertNotEqual(result.returncode, 0, field)

    def test_empty_checks_and_nonce_absence_denied(self):
        self.cfg['checks'] = []
        self.save_config()
        self.assertNotEqual(self.cli('begin', '--scope', 'View.cs', ok=False).returncode, 0)
        self.cfg['checks'] = [[sys.executable, 'check.py']]
        self.cfg['measurement']['command'].pop()
        self.save_config()
        self.assertNotEqual(self.cli('begin', '--scope', 'View.cs', ok=False).returncode, 0)

    def test_old_or_wrong_runtime_measurement_denied(self):
        for field in ['old', 'nonce', 'binary', 'runtime']:
            self.behaviour = {field: True}
            self.save_behaviour()
            self.assertNotEqual(self.cli('begin', '--scope', 'View.cs', ok=False).returncode, 0, field)

    def test_reused_measurement_denied_even_if_touched(self):
        self.begin()
        for path in (self.root / 'measurements').iterdir():
            shutil.copy2(path, path.with_name(path.name.replace('before', 'after')))
        self.behaviour = {'reuse': True}
        self.save_behaviour()
        for path in (self.root / 'measurements').iterdir():
            os.utime(path, None)
        self.cli('build')
        self.assertNotEqual(self.cli('after', ok=False).returncode, 0)

    def test_screen_width_dpi_state_must_match(self):
        for field in ['width', 'dpi', 'state']:
            with self.subTest(field=field):
                if g.state_path(self.root).exists():
                    g.state_path(self.root).unlink()
                self.behaviour = {}
                self.save_behaviour()
                self.begin()
                self.cli('build')
                self.behaviour = {field: True}
                self.save_behaviour()
                self.assertNotEqual(self.cli('after', ok=False).returncode, 0)

    def test_no_build_or_old_build_denied(self):
        self.begin()
        self.assertNotEqual(self.cli('after', ok=False).returncode, 0)
        self.cli('build')
        self.edit()
        self.assertNotEqual(self.cli('after', ok=False).returncode, 0)

    def test_changed_sources_copy_binary_artifacts_validator_config_denied(self):
        self.begin()
        self.complete()
        for path in [self.root / 'View.cs', self.root / 'copy/View.cs', self.root / 'App.exe', self.root / 'measurements/guard-after.png', self.root / 'check.py', self.root / 'adapter.py', self.root / 'gui-guard.json']:
            old = path.read_bytes()
            path.write_bytes(old + b'changed')
            self.assertNotEqual(self.cli('verify', ok=False).returncode, 0, str(path))
            path.write_bytes(old)

    def test_failed_recheck_invalidates_previous_pass(self):
        self.begin()
        self.complete()
        (self.root / 'check.py').write_text('raise SystemExit(1)')
        self.assertNotEqual(self.cli('after', ok=False).returncode, 0)
        self.assertNotEqual(self.cli('verify', ok=False).returncode, 0)

    def test_unrelated_docs_and_fresh_stop_pass(self):
        self.assertIsNone(self.hook('pre', path='README.md'))
        self.assertIsNone(self.hook('stop'))

    def test_unknown_project_passes(self):
        (self.root / 'gui-guard.json').unlink()
        self.assertIsNone(self.hook('pre'))
        self.assertIsNone(self.hook('stop'))

    def test_shell_edit_is_caught_at_stop(self):
        self.begin()
        self.complete()
        self.edit()
        self.assertEqual(self.hook('stop')['decision'], 'block')

    def test_new_operation_cannot_reuse_old_before(self):
        self.begin()
        self.complete()
        self.denied(self.hook('pre'))
        self.begin()
        self.assertIsNone(self.hook('pre'))

    def test_begin_cannot_discard_pending_edits(self):
        self.begin()
        self.edit()
        self.assertNotEqual(self.cli('begin', '--scope', 'View.cs', ok=False).returncode, 0)

    def test_claude_session_variable_tracks_begin(self):
        env = dict(self.env)
        env.pop('CODEX_SESSION_ID')
        env['CLAUDE_CODE_SESSION_ID'] = 'claude-session'
        self.cli('begin', '--scope', 'View.cs', env=env)
        self.assertTrue((self.home / 'sessions/claude-session.json').exists())

    def test_multiple_projects_and_outside_stop(self):
        other = GuardTest()
        other.setUp()
        self.addCleanup(other.doCleanups)
        other.env['GUI_GUARD_HOME'] = str(self.home)
        self.begin()
        other.begin()
        other.complete()
        self.edit()
        index = g.read(self.home / 'sessions/test-session.json')
        self.assertEqual(len(index['projects']), 2)
        with tempfile.TemporaryDirectory() as outside:
            self.assertEqual(self.hook('stop', cwd=outside)['decision'], 'block')

    def test_parent_cwd_discovers_child_pending_project(self):
        self.begin()
        self.edit()
        self.assertEqual(self.hook('stop', cwd=self.root.parent, session='fresh-session')['decision'], 'block')

    def test_whole_write_delete_move_denied(self):
        self.begin()
        self.denied(self.hook('pre', tool='Write', data={'file_path': str(self.root / 'View.cs'), 'content': 'changed'}))
        for command in ['*** Delete File: ' + str(self.root / 'View.cs'), '*** Update File: ' + str(self.root / 'View.cs') + '\n*** Move to: ' + str(self.root / 'Else.cs')]:
            self.denied(self.hook('pre', data={'command': command}))

    def test_protected_files_and_shared_patterns(self):
        self.cfg.update(protectedFiles=['View.cs'], protectedPatterns=['GlobalFont'])
        self.save_config()
        self.begin()
        self.denied(self.hook('pre'))
        self.cli('approve', 'file:View.cs')
        self.assertIsNone(self.hook('pre'))
        self.denied(self.hook('pre', data={'command': '*** Update File: ' + str(self.root / 'View.cs') + '\n+GlobalFont'}))
        self.cli('approve', 'pattern:GlobalFont')
        self.assertIsNone(self.hook('pre', data={'command': '*** Update File: ' + str(self.root / 'View.cs') + '\n+GlobalFont'}))

    def test_ui_patterns_catch_new_unlisted_files(self):
        self.cfg['uiFiles'] = ['**/*.xaml']
        self.save_config()
        self.begin()
        self.denied(self.hook('pre', path='New.xaml'))

    def test_expired_before_and_scope_denied(self):
        self.begin()
        state = g.read(g.state_path(self.root))
        state['before']['measuredAt'] -= 3600
        g.write(g.state_path(self.root), state)
        self.denied(self.hook('pre'))
        state['before']['measuredAt'] = time.time()
        state['startedAt'] -= 7 * 3600
        g.write(g.state_path(self.root), state)
        self.denied(self.hook('pre'))

    def test_source_runtime_requires_loaded_source_hashes(self):
        self.cfg['runtime'] = 'source'
        self.save_config()
        self.begin()
        self.edit()
        self.cli('after')
        self.behaviour = {'loaded': True}
        self.save_behaviour()
        self.assertNotEqual(self.cli('after', ok=False).returncode, 0)

    def test_full_screen_comparison_and_allowed_targets(self):
        self.cfg['regression'] = [{'name': 'main', 'measurement': self.cfg['measurement'], 'allowedTargets': ['target']}]
        self.save_config()
        self.begin()
        self.cli('build')
        self.behaviour = {'pixel': True}
        self.save_behaviour()
        self.assertNotEqual(self.cli('after', ok=False).returncode, 0)
        self.behaviour = {'allowedPixel': True}
        self.save_behaviour()
        self.cli('after')
        self.cli('verify')

    def test_delegate_requires_packet_and_matching_root(self):
        command = 'codex exec --sandbox workspace-write --cd ' + str(self.root) + " 'fix GUI'"
        self.denied(self.hook('bash', tool='Bash', data={'command': command}))
        packet = self.cli('packet').stdout
        instructions = packet.strip().splitlines()[-1].split(': ', 1)[1]
        self.assertTrue(Path(instructions).is_file(), instructions)
        import shlex
        self.assertIsNone(self.hook('bash', tool='Bash', data={'command': 'codex exec --sandbox workspace-write --cd ' + str(self.root) + ' ' + shlex.quote(packet)}))
        self.denied(self.hook('bash', tool='Bash', data={'command': command.replace('fix GUI', '<!-- gui-guard packet v1 root=/wrong -->')}))
        self.assertIsNone(self.hook('bash', tool='Bash', data={'command': command.replace('workspace-write', 'read-only')}))
        self.assertIsNone(self.hook('bash', tool='Bash', data={'command': command.replace('fix GUI', '<!-- gui-guard: none -->')}))

    def test_malformed_hook_fails_closed(self):
        for body in ['broken', '[]', '{"tool_input": 3}']:
            output = self.cli('hook-pre', stdin=body).stdout
            self.denied(json.loads(output))
        for data in ['', {}, {'command': None}, {'command': []}]:
            self.denied(self.hook('bash', tool='Bash', data=data))

    def test_build_does_not_accept_stale_binary_or_copy(self):
        self.begin()
        os.utime(self.root / 'App.exe', (time.time()-10, time.time()-10))
        (self.root / 'build.py').write_text("print('no build occurred')")
        self.assertNotEqual(self.cli('build', ok=False).returncode, 0)
        (self.root / 'copy/View.cs').write_text('stale source')
        self.assertNotEqual(self.cli('build', ok=False).returncode, 0)

    def test_measurement_definition_cannot_switch_comparator(self):
        self.begin()
        self.cfg['measurement']['fontTargets'] = []
        self.save_config()
        self.cli('build')
        self.assertNotEqual(self.cli('after', ok=False).returncode, 0)

    def test_alignment_preserves_half_pixel_and_rejects_invalid_values(self):
        tool = Path(__file__).with_name('check_alignment.py')
        measure = self.root / 'centers.json'
        g.write(measure, {'controls': [{'name': 'a', 'centerY': 10}, {'name': 'b', 'centerY': 10.5}]})
        def call(tolerance):
            return subprocess.run([sys.executable, str(tool), str(measure), 'a', 'b', '--tolerance', tolerance], capture_output=True)
        self.assertNotEqual(call('0').returncode, 0)
        self.assertEqual(call('0.5').returncode, 0)
        for invalid in ['inf', 'nan', '-1']:
            self.assertNotEqual(call(invalid).returncode, 0)

    def test_concurrent_projects_do_not_replace_each_other(self):
        cases, processes = [], []
        for _ in range(4):
            case = GuardTest()
            case.setUp()
            self.addCleanup(case.doCleanups)
            cases.append(case)
            data = json.dumps({'cwd': str(case.root), 'session_id': 'parallel-test', 'tool_name': 'Bash', 'tool_input': {'command': 'true'}})
            process = subprocess.Popen([sys.executable, str(SCRIPT), 'hook-bash'], env=self.env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            process.stdin.write(data)
            process.stdin.close()
            processes.append(process)
        for process in processes:
            self.assertEqual(process.wait(timeout=10), 0)
            self.assertEqual(process.stdout.read(), '')
            process.stdout.close()
            process.stderr.close()
        self.assertEqual(len(g.read(self.home / 'sessions/parallel-test.json')['projects']), len(cases))

    def test_scope_update_keeps_baseline(self):
        self.begin()
        before = g.read(g.state_path(self.root))['before']
        self.cli('scope', '--scope', 'View.cs', 'Other.cs')
        self.assertEqual(g.read(g.state_path(self.root))['before'], before)
        self.assertIsNone(self.hook('pre', path='Other.cs'))

    def test_refresh_only_before_gui_changes(self):
        self.begin()
        before = g.read(g.state_path(self.root))['before']['measuredAt']
        self.cli('refresh', '--scope', 'View.cs')
        self.assertGreaterEqual(g.read(g.state_path(self.root))['before']['measuredAt'], before)
        self.edit()
        self.assertNotEqual(self.cli('refresh', '--scope', 'View.cs', ok=False).returncode, 0)

    def test_begin_without_edits_still_requires_after(self):
        self.begin()
        self.assertEqual(self.hook('stop')['decision'], 'block')

    def test_stop_checks_binary_and_evidence_after_completed_work(self):
        self.begin()
        self.complete()
        for path in [self.root / 'App.exe', self.root / 'measurements/guard-after.png', self.root / 'check.py']:
            original = path.read_bytes()
            path.write_bytes(original + b'changed')
            self.assertEqual(self.hook('stop')['decision'], 'block')
            path.write_bytes(original)

    def test_build_dependencies_are_automatically_tracked(self):
        for path in [self.root / 'Dependency.cs', self.root / 'copy/Dependency.cs']:
            path.write_text('dependency')
        self.cfg['build']['sourceFiles'] = ['Dependency.cs']
        self.save_config()
        self.begin()
        self.complete()
        (self.root / 'Dependency.cs').write_text('changed dependency')
        self.assertNotEqual(self.cli('verify', ok=False).returncode, 0)

    def test_unrelated_docs_not_blocked_by_incomplete_setup(self):
        self.cfg.pop('build')
        self.save_config()
        self.assertIsNone(self.hook('pre', path='README.md'))
        self.assertIsNone(self.hook('stop'))

    def test_delegate_stdin_heredoc_and_relative_cd(self):
        packet = self.cli('packet').stdout
        (self.root / 'task.txt').write_text(packet)
        for command in ['codex exec --sandbox workspace-write < task.txt', 'codex exec --sandbox workspace-write - <<\'TASK\'\n' + packet + 'TASK\n', 'cd ' + str(self.root) + ' && codex exec --sandbox workspace-write < task.txt']:
            self.assertIsNone(self.hook('bash', tool='Bash', data={'command': command}))

    def test_install_both_agents_preserves_settings_and_rerun(self):
        for directory in ['ordinary', "GUI guard team's folder $literal"]:
            home = self.root / directory
            (home / '.claude').mkdir(parents=True)
            keep = {'env': {'KEEP': 'yes'}, 'hooks': {'Stop': [{'hooks': [{'type': 'command', 'command': 'true'}]}]}}
            g.write(home / '.claude/settings.json', keep)
            install = Path(__file__).with_name('install.py')
            subprocess.run([sys.executable, str(install), '--home', str(home)], check=True, capture_output=True)
            first = (home / '.claude/settings.json').read_text()
            subprocess.run([sys.executable, str(install), '--home', str(home)], check=True, capture_output=True)
            self.assertEqual(first, (home / '.claude/settings.json').read_text())
            settings = g.read(home / '.claude/settings.json')
            self.assertEqual(settings['env'], keep['env'])
            self.assertTrue((home / '.claude/skills/design-guard').is_symlink())
            self.assertEqual(len(settings['hooks']['PreToolUse']), 2)
            self.assertEqual(settings['hooks']['Stop'][0], keep['hooks']['Stop'][0])
            for event, groups in settings['hooks'].items():
                for group in groups:
                    for handler in group['hooks']:
                        if 'render-guard.mjs' in handler['command']:
                            data = json.dumps({'cwd': str(home), 'tool_name': 'Bash', 'tool_input': {'command': 'true'}})
                            result = subprocess.run(handler['command'], shell=True, input=data, text=True, capture_output=True, env=self.env)
                            self.assertEqual(result.returncode, 0, result.stderr)
                            self.assertEqual(result.stdout, '')


if __name__ == '__main__':
    unittest.main()
