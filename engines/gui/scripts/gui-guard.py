#!/usr/bin/env python3
"""Native GUI gate for Codex and Claude; project commands never use a shell."""
import argparse
from contextlib import contextmanager
import datetime as dt
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import shlex
import struct
import subprocess
import sys
import time
import uuid
import zlib
sys.path.insert(0, str(Path(__file__).resolve().parent))
from session_maintenance import check_day, update_day, day_id, record_path, save, installed_versions

# OSのPythonとPillowを変更せず、ガード専用の最新版を使う。
runtime = Path(__file__).resolve().parents[1] / '.runtime' / ('python-' + str(sys.version_info.major) + '.' + str(sys.version_info.minor))
private_packages = runtime / ('Lib/site-packages' if os.name == 'nt' else 'lib/python' + str(sys.version_info.major) + '.' + str(sys.version_info.minor) + '/site-packages')
if private_packages.is_dir():
    sys.path.insert(0, str(private_packages))

VERSION = 2
ERRORS = (OSError, KeyError, ValueError, TypeError, IndexError, subprocess.SubprocessError)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(path)


def local_path(value, root=None):
    if os.name != 'nt' and re.match(r'^[A-Za-z]:[\\/]', str(value)):
        value = '/mnt/' + value[0].lower() + '/' + value[3:].replace('\\', '/')
    path = Path(value).expanduser()
    return (path if path.is_absolute() else (root or Path.cwd()) / path).resolve()


def command_valid(command):
    return isinstance(command, list) and bool(command) and all(isinstance(x, str) and x for x in command)


def config(root):
    cfg = read(config_path(root))
    if config_path(root).name == 'render-guard.json':
        cfg = cfg['gui']
    if not isinstance(cfg, dict):
        raise ValueError('GUI configuration must be a JSON object.')
    files = cfg.get('files')
    if not isinstance(files, list) or not files or not all(isinstance(x, str) for x in files) or len(files) != len(set(files)):
        raise ValueError('List distinct GUI source files in files.')
    for name in files:
        if Path(name).is_absolute() or '..' in Path(name).parts or not local_path(name, root).is_relative_to(root):
            raise ValueError('files must contain paths relative to the source project.')
    cfg.setdefault('uiFiles', ['**/*' + extension for extension in sorted({Path(name).suffix for name in files if Path(name).suffix})])
    measurement = cfg.get('measurement', {})
    if not isinstance(measurement, dict):
        raise ValueError('Invalid measurement configuration.')
    if not command_valid(measurement.get('command')) or not any('{nonce}' in x for x in measurement['command']):
        raise ValueError('measurement.command must be an argument array containing {nonce}.')
    targets = measurement.get('targets')
    if not isinstance(targets, list) or not all(isinstance(x, str) and x for x in targets) or len(targets) < 2 or len(targets) != len(set(targets)):
        raise ValueError('List the requested and comparison controls, at least two distinct targets.')
    if not cfg.get('checks') or not all(command_valid(c) for c in cfg['checks']):
        raise ValueError('Configure at least one actual-screen validation command in checks.')
    for key in ['binary', 'copyRoot']:
        if not cfg.get(key):
            raise ValueError(key + ' is not configured')
    for key in ['outputDirectory', 'expectedExecutable']:
        if not measurement.get(key):
            raise ValueError('measurement.' + key + ' is not configured')
    if cfg.get('runtime', 'compiled') not in ['compiled', 'source']:
        raise ValueError('runtime must be compiled or source.')
    if cfg.get('runtime', 'compiled') == 'compiled' and not command_valid(cfg.get('build', {}).get('command')):
        raise ValueError('Compiled applications require build.command.')
    for pattern in cfg.get('protectedPatterns', []):
        re.compile(pattern)
    return cfg


def config_path(root):
    unified = root / 'render-guard.json'
    if unified.is_file() and isinstance(read(unified).get('gui'), dict):
        return unified
    return root / 'gui-guard.json'


def state_path(root):
    return root / '.gui-guard' / 'state.json'


def sources(root, cfg):
    return {name: digest(root / name) if (root / name).is_file() else None for name in cfg['files']}


def copy_names(cfg):
    return set(cfg['files'] + cfg.get('build', {}).get('sourceFiles', []))


def artifacts(paths):
    return {str(local_path(p)): digest(p) for p in paths}


def input_files(root, cfg):
    paths = {local_path(p, root) for p in cfg.get('validationFiles', [])}
    paths.update(local_path(p, root) for p in cfg.get('build', {}).get('sourceFiles', []))
    commands = [cfg['measurement']['command'], *cfg['checks']]
    if cfg.get('build'):
        commands.append(cfg['build']['command'])
    generated = {local_path(p, root) for p in cfg.get('evidence', [])}
    for command in commands:
        for arg in command:
            if '{' not in arg and not arg.startswith('-'):
                path = local_path(arg, root)
                if path in generated or re.match(r'^guard-(?:before|after)(?:-\d+)?\.(?:json|png)$', path.name):
                    continue
                if path.is_file() and path.suffix.lower() in ['.py', '.ps1', '.sh', '.js', '.mjs', '.json', '.cs', '.dll']:
                    paths.add(path)
    for screen in cfg.get('regression', []):
        paths.update(Path(p) for p in input_files(root, {'measurement': screen['measurement'], 'checks': []}))
    return artifacts(paths)


def run(command, root, timeout=120):
    result = subprocess.run(command, cwd=root, capture_output=True, text=True, errors='replace', timeout=timeout)
    if result.returncode:
        raise ValueError('Command failed: ' + result.stderr[-1200:] + result.stdout[-1200:])
    return result.stdout + result.stderr


def timestamp(value):
    date = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if date.tzinfo is None:
        raise ValueError('measuredAt requires a time zone.')
    return date.timestamp()


def png_size(path):
    data = Path(path).read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('The actual screen image is not PNG.')
    offset, dimensions, ended = 8, None, False
    while offset + 12 <= len(data):
        size = struct.unpack('>I', data[offset:offset+4])[0]
        tag = data[offset+4:offset+8]
        payload = data[offset+8:offset+8+size]
        end = offset + 12 + size
        if end > len(data) or zlib.crc32(tag + payload) & 0xffffffff != struct.unpack('>I', data[end-4:end])[0]:
            raise ValueError('PNG data is corrupt.')
        if tag == b'IHDR':
            dimensions = struct.unpack('>II', payload[:8])
        if tag == b'IEND':
            ended = True
            break
        offset = end
    if not dimensions or not ended:
        raise ValueError('PNG dimensions or end marker are missing.')
    return dimensions


def validate_bounds(row):
    keys = ['left', 'top', 'right', 'bottom', 'width', 'height', 'centerX', 'centerY']
    if any(not isinstance(row.get(k), (float, int)) or not math.isfinite(row[k]) for k in keys):
        raise ValueError('Measured bounds or centers are missing.')
    if row['width'] <= 0 or row['height'] <= 0:
        raise ValueError('Measured target is not visible.')
    values = [row['right']-row['left'], row['bottom']-row['top'], (row['left']+row['right'])/2, (row['top']+row['bottom'])/2]
    if any(abs(row[k]-v) > 0.000001 for k, v in zip(keys[4:], values)):
        raise ValueError('Measured edges, dimensions and centers are inconsistent.')


def measure(root, cfg, label):
    directory = local_path(cfg['measurement']['outputDirectory'], root)
    paths = [directory / (label + '.json'), directory / (label + '.png')]
    nonce, start, inputs = uuid.uuid4().hex, time.time(), input_files(root, cfg)
    command = [p.replace('{label}', label).replace('{nonce}', nonce) for p in cfg['measurement']['command']]
    run(command, root, cfg.get('commandTimeoutSeconds', 120))
    data = read(paths[0])
    if data.get('measurementId') != nonce or not start - 1 <= timestamp(data['measuredAt']) <= time.time() + 1:
        raise ValueError('Measurement is not from this run. Stale records cannot be reused.')
    if local_path(data['executable']) != local_path(cfg['measurement']['expectedExecutable']):
        raise ValueError('Measured executable differs from the configured executable.')
    if data.get('binarySha256') != digest(local_path(cfg['binary'], root)) or data.get('runtimeVerified') is not True:
        raise ValueError('The running application version differs or is unverified.')
    if cfg.get('runtime', 'compiled') == 'source' and data.get('loadedSources') != sources(root, cfg):
        raise ValueError('Running source differs from the source project.')
    if any(not isinstance(data.get(k), (float, int)) or not math.isfinite(data[k]) or data[k] <= 0 for k in ['dpiX', 'dpiY']):
        raise ValueError('Actual screen DPI is missing.')
    validate_bounds(data['window'])
    controls = data.get('controls', [])
    names = [c['name'] for c in controls]
    if len(names) != len(set(names)) or set(names) != set(cfg['measurement']['targets']):
        raise ValueError('The requested or comparison controls have not all been measured.')
    for control in controls:
        validate_bounds(control)
        if control['name'] in cfg['measurement'].get('fontTargets', []):
            if not control.get('fontFamily') or not isinstance(control.get('fontPoints'), (int, float)) or control['fontPoints'] <= 0:
                raise ValueError('Applied font is unverified: ' + control['name'])
    if png_size(paths[1]) != (data['window']['width'], data['window']['height']):
        raise ValueError('Measured window and screenshot dimensions differ.')
    if any(p.stat().st_mtime < start - 1 for p in paths):
        raise ValueError('Image or measurement predates this measurement run.')
    if inputs != input_files(root, cfg):
        raise ValueError('Measurement or validation code changed during measurement.')
    return {'label': label, 'files': artifacts(paths), 'targets': sorted(names),
            'screen': {k: data[k] for k in ['dpiX', 'dpiY']} | {k: data['window'][k] for k in ['width', 'height']},
            'state': data.get('displayState', 'default'), 'measuredAt': timestamp(data['measuredAt']),
            'identity': {'executable': str(local_path(data['executable'])),
                         'provider': data.get('provider'), 'measurementTool': data.get('measurementTool'),
                         'imageComparator': importlib.metadata.version('Pillow') if cfg.get('regression') else None,
                         'definition': hashlib.sha256(json.dumps(cfg['measurement'], sort_keys=True).encode()).hexdigest(),
                         'inputs': input_files(root, {'measurement': cfg['measurement'], 'checks': []})}}


def active_path(session):
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', session):
        raise ValueError('Invalid session id')
    home = Path(os.environ.get('GUI_GUARD_HOME', str(Path.home() / '.cache' / 'gui-guard')))
    return home / 'sessions' / (session + '.json')


def session_id(value=None):
    return (value or {}).get('session_id') or os.environ.get('CODEX_SESSION_ID') or os.environ.get('CODEX_THREAD_ID') or os.environ.get('CLAUDE_CODE_SESSION_ID')


@contextmanager
def locked(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_suffix('.lock').open('a+b') as lock:
        if os.name == 'nt':
            import msvcrt
            if lock.tell() == 0:
                lock.write(b'0')
                lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == 'nt':
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def link(root, session, cfg, touched=False):
    if not session:
        return
    path = active_path(session)
    with locked(path):
        value = read(path) if path.exists() else {'projects': {}}
        if 'project' in value:
            value = {'projects': {value['project']: {'touched': True}}}
        entry = value['projects'].setdefault(str(root), {'sources': sources(root, cfg), 'touched': False})
        entry['touched'] = entry.get('touched', False) or touched
        write(path, value)


def check_hashes(section):
    for path, expected in section.items():
        if digest(path) != expected:
            raise ValueError('Measurement or validation artifacts were changed or deleted: ' + path)


def verify(root):
    cfg, state = config(root), read(state_path(root))
    if state.get('version') != VERSION:
        raise ValueError("An earlier guard version's pass cannot be reused. Start a new measured task with begin.")
    receipt = state.get('receipt')
    if not receipt:
        raise ValueError('GUI changes have not been remeasured and checked. Run render-guard gui after.')
    if receipt['configHash'] != digest(config_path(root)):
        raise ValueError('GUI configuration changed after verification.')
    if receipt['sources'] != sources(root, cfg):
        raise ValueError('GUI source changed after verification. Remeasure the latest version.')
    if receipt['binary'] != digest(local_path(cfg['binary'], root)):
        raise ValueError('Executable changed after verification. Remeasure the latest version.')
    if receipt['validation'] != input_files(root, cfg):
        raise ValueError('Measurement or validation code changed. Validate the latest version again.')
    for name in copy_names(cfg):
        if digest(root / name) != digest(local_path(cfg['copyRoot'], root) / name):
            raise ValueError('Source and runtime copy differ: ' + name)
    for section in [state['before']['files'], receipt['artifacts'], receipt['checks']]:
        check_hashes(section)
    for record in state.get('regression', {}).values():
        check_hashes(record['files'])
    return state


def build(root, cfg):
    initial, inputs = sources(root, cfg), input_files(root, cfg)
    if None in initial.values():
        raise ValueError('Build source is missing.')
    build_sources = {name: digest(root / name) for name in copy_names(cfg)}
    for name, expected in build_sources.items():
        if digest(local_path(cfg['copyRoot'], root) / name) != expected:
            raise ValueError('Source and runtime copy differ before build: ' + name)
    started_ns = time.time_ns()
    run(cfg['build']['command'], root, cfg.get('commandTimeoutSeconds', 120))
    if initial != sources(root, cfg) or inputs != input_files(root, cfg):
        raise ValueError('Source or validation code changed during build.')
    for name, expected in build_sources.items():
        if digest(root / name) != expected or digest(local_path(cfg['copyRoot'], root) / name) != expected:
            raise ValueError('Source version changed during build: ' + name)
    output = local_path(cfg['build'].get('output', cfg['binary']), root)
    if output.stat().st_mtime_ns < started_ns:
        raise ValueError('No executable was produced by this build. An old build cannot be reused.')
    write(root / '.gui-guard' / 'build.json', {'sources': initial, 'buildSources': build_sources, 'binary': digest(output), 'builtAt': time.time()})
    print('Latest build recorded. Apply it to the authorized runtime copy and verify the running version with after.')


def regression_measure(root, cfg, label):
    records = {}
    for index, screen in enumerate(cfg.get('regression', [])):
        variant = dict(cfg, measurement=screen['measurement'])
        records[str(index)] = measure(root, variant, label + '-' + str(index))
    return records


def regression_compare(root, cfg, before, current):
    if not cfg.get('regression'):
        return {}
    from PIL import Image, ImageChops, ImageDraw
    files, results = {}, {}
    for index, screen in enumerate(cfg['regression']):
        old, new = before[str(index)], current[str(index)]
        if old['screen'] != new['screen'] or old['targets'] != new['targets'] or old['state'] != new['state'] or old['identity'] != new['identity']:
            raise ValueError('Regression screen dimensions, DPI, state or targets differ.')
        paths = [next(p for p in r['files'] if p.endswith('.png')) for r in [old, new]]
        with Image.open(paths[0]) as a, Image.open(paths[1]) as b:
            delta = ImageChops.difference(a.convert('RGB'), b.convert('RGB'))
            allowed = Image.new('1', delta.size, 0)
            draw = ImageDraw.Draw(allowed)
            for record in [old, new]:
                data = read(next(p for p in record['files'] if p.endswith('.json')))
                for control in data['controls']:
                    if control['name'] in screen.get('allowedTargets', []):
                        left, top = control['left'] - data['window']['left'], control['top'] - data['window']['top']
                        draw.rectangle((math.floor(left), math.floor(top), math.ceil(left + control['width'])-1, math.ceil(top + control['height'])-1), fill=1)
            count = sum(pixel != (0, 0, 0) and not excluded for pixel, excluded in zip(delta.getdata(), allowed.getdata()))
            threshold = screen.get('thresholdPixels', 0)
            results[str(index)] = {'changedOutsideTargets': count, 'thresholdPixels': threshold}
            if count > threshold:
                raise ValueError('Unexpected screen change: %s (%s pixels)' % (screen.get('name', index), count))
        files.update(new['files'])
    report = root / '.gui-guard' / 'regression.json'
    write(report, results)
    return files | artifacts([report])


def after(root):
    cfg, state = config(root), read(state_path(root))
    if state.get('version') != VERSION:
        raise ValueError('Old records cannot be reused. Start a measured task with begin.')
    state.pop('receipt', None)
    write(state_path(root), state)
    initial, binary = sources(root, cfg), digest(local_path(cfg['binary'], root))
    inputs, cfg_hash = input_files(root, cfg), digest(config_path(root))
    if cfg.get('runtime', 'compiled') == 'compiled':
        built = read(root / '.gui-guard' / 'build.json')
        if built['sources'] != initial or built['binary'] != binary:
            raise ValueError('Latest sources have not been built. Run render-guard gui build.')
        if built['buildSources'] != {name: digest(root / name) for name in copy_names(cfg)}:
            raise ValueError('Build inputs changed.')
    measured = measure(root, cfg, 'guard-after')
    if not screen_matches(state['before']['screen'], measured['screen'], cfg, state) or measured['state'] != state['before']['state']:
        raise ValueError('Window width, height, DPI or state changed between measurements.')
    if measured['targets'] != state['before']['targets']:
        raise ValueError('Comparison targets changed between measurements.')
    before_identity = dict(state['before']['identity'])
    # Earlier v2 records kept provider/tool in the hashed measurement JSON only.
    # Read those original fields instead of invalidating a completed baseline.
    baseline_json = next(p for p in state['before']['files'] if p.endswith('.json'))
    baseline_data = read(baseline_json)
    for key, value in [('provider', baseline_data.get('provider')),
                       ('measurementTool', baseline_data.get('measurementTool')),
                       ('imageComparator', None)]:
        if key not in before_identity:
            before_identity[key] = value
    if measured['identity'] != before_identity:
        raise ValueError('Application, measurement tool or target definitions changed between measurements.')
    regression = regression_compare(root, cfg, state.get('regression', {}), regression_measure(root, cfg, 'guard-after'))
    checks, evidence = {}, [local_path(p, root) for p in cfg.get('evidence', [])]
    started = time.time()
    for index, command in enumerate(cfg['checks']):
        log = root / '.gui-guard' / ('check-%d.log' % index)
        log.write_text(run(command, root, cfg.get('commandTimeoutSeconds', 120)), encoding='utf-8')
        checks[str(log)] = digest(log)
    if initial != sources(root, cfg) or binary != digest(local_path(cfg['binary'], root)) or inputs != input_files(root, cfg) or cfg_hash != digest(config_path(root)):
        raise ValueError('Source, executable or validation settings changed during measurement or checks.')
    for path in evidence:
        if path.stat().st_mtime < started - 1:
            raise ValueError('Evidence was not produced by the current check: ' + str(path))
    for name in copy_names(cfg):
        if digest(root / name) != digest(local_path(cfg['copyRoot'], root) / name):
            raise ValueError('Runtime copy is stale: ' + name)
    before_data = read(next(p for p in state['before']['files'] if p.endswith('.json')))
    after_data = read(next(p for p in measured['files'] if p.endswith('.json')))
    before_rows = {r['name']: r for r in before_data['controls']}
    differences = {r['name']: {k: {'before': before_rows[r['name']].get(k), 'after': v}
                   for k, v in r.items() if k != 'handle' and before_rows[r['name']].get(k) != v}
                   for r in after_data['controls']}
    report = root / '.gui-guard' / 'comparison.json'
    write(report, differences)
    state['receipt'] = {'sources': initial, 'binary': binary, 'configHash': cfg_hash, 'validation': inputs,
                        'artifacts': artifacts([*measured['files'], *evidence, report]) | regression, 'checks': checks, 'verifiedAt': time.time()}
    write(state_path(root), state)
    verify(root)
    link(root, session_id(), cfg, touched=True)
    print('RenderGuard GUI verification passed. Before/after comparison: ' + str(report))
    print('Open the actual image with view_image or Read; inspect text, spacing and colors.')


def find_root(path):
    path = local_path(path)
    for candidate in [path, *path.parents]:
        if (candidate / 'gui-guard.json').is_file() or ((candidate / 'render-guard.json').is_file() and isinstance(read(candidate / 'render-guard.json').get('gui'), dict)):
            return candidate
    return None


def edits(value):
    cwd = Path(value.get('cwd', os.getcwd()))
    data, tool = value.get('tool_input', {}), value.get('tool_name', '')
    if tool in ['Edit', 'Write', 'MultiEdit'] and isinstance(data, dict):
        chunks = data.get('edits', [data]) if tool == 'MultiEdit' else [data]
        return [{'path': local_path(data['file_path'], cwd), 'kind': 'write' if tool == 'Write' else 'update',
                 'text': '\n'.join(c.get('old_string', '') + '\n' + c.get('new_string', c.get('content', '')) for c in chunks)}]
    patch = data.get('command', data.get('input', data.get('patch', ''))) if isinstance(data, dict) else data
    if not isinstance(patch, str):
        return []
    result = []
    for match in re.finditer(r'^\*\*\* (Update|Add|Delete) File: (.+)$', patch, re.M):
        end = re.search(r'^\*\*\* (?:Update|Add|Delete) File: ', patch[match.end():], re.M)
        text = patch[match.end():match.end()+end.start()] if end else patch[match.end():]
        result.append({'path': local_path(match[2], cwd), 'kind': match[1].lower(), 'text': text})
        moved = re.search(r'^\*\*\* Move to: (.+)$', text, re.M)
        if moved:
            result[-1]['kind'] = 'move'
            result.append({'path': local_path(moved[1], cwd), 'kind': 'move', 'text': text})
    return result


def matches(name, patterns):
    for pattern in patterns:
        expression, i = '', 0
        while i < len(pattern):
            if pattern[i:i+3] == '**/':
                expression += '(?:.*/)?'
                i += 3
            elif pattern[i:i+2] == '**':
                expression += '.*'
                i += 2
            elif pattern[i] == '*':
                expression += '[^/]*'
                i += 1
            elif pattern[i] == '?':
                expression += '[^/]'
                i += 1
            else:
                expression += re.escape(pattern[i])
                i += 1
        if re.fullmatch(expression, name):
            return True
    return False


def relevant(entry, root, cfg):
    if not entry['path'].is_relative_to(root):
        return False
    name = entry['path'].relative_to(root).as_posix()
    return name in cfg['files'] or matches(name, cfg.get('uiFiles', [])) or matches(name, cfg.get('protectedFiles', []))


def approved(state, token):
    return any(a['token'] == token and a['until'] >= time.time() for a in state.get('approvals', []))


def window_size_change_token(cfg):
    change = cfg.get('windowSizeChange')
    if change is None:
        return None
    if not isinstance(change, dict) or set(change) != {'before', 'after'}:
        raise ValueError('Declare only before/after width and height for a window size change.')
    for dimensions in change.values():
        if not isinstance(dimensions, list) or len(dimensions) != 2 or any(type(n) is not int or n <= 0 for n in dimensions):
            raise ValueError('Window size changes require positive integer [width, height] pairs.')
    before, after = change['before'], change['after']
    return 'window-size:%sx%s->%sx%s' % (*before, *after)


def screen_matches(before, after, cfg, state):
    if before == after:
        return True
    token = window_size_change_token(cfg)
    if token is None or not approved(state, token):
        return False
    change = cfg['windowSizeChange']
    return (before['dpiX'] == after['dpiX'] and before['dpiY'] == after['dpiY']
            and [before['width'], before['height']] == change['before']
            and [after['width'], after['height']] == change['after'])


def pre(root, cfg, entries):
    state = read(state_path(root))
    if state.get('version') != VERSION:
        raise ValueError('Old measurement format. Start a measured task with begin.')
    for entry in entries:
        name = entry['path'].relative_to(root).as_posix()
        if name not in state['scope']:
            raise ValueError('GUI edit outside the declared scope: ' + name)
        if entry['kind'] in ['delete', 'move'] or entry['kind'] in ['write', 'add'] and entry['path'].exists():
            raise ValueError('Do not replace, delete or move an entire existing GUI source file. Apply focused patches.')
        for pattern in cfg.get('protectedFiles', []):
            if matches(name, [pattern]) and not approved(state, 'file:' + pattern):
                raise ValueError('Unapproved protected-file edit: ' + name)
        for pattern in cfg.get('protectedPatterns', []):
            if re.search(pattern, entry['text']) and not approved(state, 'pattern:' + pattern):
                raise ValueError('Unapproved shared-design edit: ' + pattern)
    check_hashes(state['before']['files'])
    if time.time() - state['startedAt'] > cfg.get('scopeMaxAgeHours', 6) * 3600:
        raise ValueError('The GUI scope declaration has expired.')
    if not state.get('editedAt') and time.time() - state['before']['measuredAt'] > cfg.get('measureMaxAgeMin', 20) * 60:
        raise ValueError('The before measurement has expired.')
    if state.get('receipt'):
        raise ValueError("Edits started after the previous completed task. Use a new begin to measure this task's baseline.")


def block(kind, reason):
    if kind in ['pre', 'bash']:
        return {'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'permissionDecision': 'deny', 'permissionDecisionReason': reason}}
    return {'decision': 'block', 'reason': reason}


def delegate(value):
    data = value.get('tool_input', {})
    if not isinstance(data, dict) or not isinstance(data.get('command'), str):
        raise ValueError('The Bash hook requires a command string.')
    command = data['command']
    if not re.search(r'\bcodex\s+exec\b', command):
        return
    bodies = []
    def strip_doc(m):
        bodies.append(m[3])
        return m[0].split('\n', 1)[0]
    stripped = re.sub(r'<<-?\s*([\'\"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n(.*?)\n\s*\2(?=\n|$)', strip_doc, command, flags=re.S)
    base = local_path(value.get('cwd', os.getcwd()))
    lexer = shlex.shlex(stripped, posix=True, punctuation_chars=';&|\n')
    lexer.whitespace = ' \t\r'
    lexer.whitespace_split = True
    lexer.commenters = ''
    segments = [[]]
    for word in lexer:
        if word and all(c in ';&|\n' for c in word):
            segments.append([])
        else:
            segments[-1].append(word)
    for words in segments:
        if not words:
            continue
        if words[0] == 'cd' and len(words) > 1:
            base = local_path(words[1], base)
            continue
        at = next((i for i, word in enumerate(words[:-1]) if Path(word).name == 'codex' and words[i+1] == 'exec'), None)
        if at is None:
            continue
        target, sandbox, prompts, i = base, None, list(bodies), at + 2
        while i < len(words):
            flag, _, inline = words[i].partition('=')
            if flag in ['--cd', '-C', '--sandbox', '-s']:
                if not inline:
                    i += 1
                    inline = words[i]
                if flag in ['--cd', '-C']:
                    target = local_path(inline, base)
                else:
                    sandbox = inline
            elif words[i] == '<' or words[i].startswith('<') and not words[i].startswith(('<<', '<!')):
                file = words[i][1:]
                if not file:
                    i += 1
                    file = words[i]
                prompts.append(local_path(file, base).read_text(encoding='utf-8'))
            else:
                prompts.append(words[i])
            i += 1
        root = find_root(target)
        if not root or sandbox == 'read-only':
            continue
        text = '\n'.join(prompts)
        marker = re.search(r'<!--\s*gui-guard packet v1 root=(.+?)\s*-->', text)
        if not marker:
            if re.search(r'<!--\s*gui-guard:\s*none\s*-->', text):
                continue
            raise ValueError('Attach render-guard gui packet when delegating GUI edits. For non-visual work, use <!-- gui-guard: none -->.')
        if local_path(marker[1]) != root:
            raise ValueError('Delegation destination differs from the measured source project.')


def hook(kind):
    try:
        value = json.load(sys.stdin)
        if not isinstance(value, dict) or not isinstance(value.get('cwd', ''), str):
            raise ValueError('Invalid hook input.')
        if kind in ['pre', 'post', 'bash'] and not isinstance(value.get('tool_input', {}), (dict, str)):
            raise ValueError('Invalid edit input.')
        session, cwd = session_id(value), local_path(value.get('cwd', os.getcwd()))
        if kind == 'bash':
            delegate(value)
            root = find_root(cwd)
            if root:
                check_day()
                link(root, session, config(root))
            return
        entries = edits(value) if kind in ['pre', 'post'] else []
        roots = {r for e in entries if (r := find_root(e['path']))}
        linked = active_path(session) if session else None
        index = read(linked) if linked and linked.exists() else {'projects': {}}
        if 'project' in index:
            index = {'projects': {index['project']: {'touched': True}}}
        if kind == 'stop':
            roots.update(Path(r) for r in index['projects'])
            if (root := find_root(cwd)):
                roots.add(root)
            for directory, children, files in os.walk(cwd):
                children[:] = [c for c in children if c not in ['.git', 'node_modules', '.gui-guard', '.render-guard', '.runtime', '.venv']]
                if len(Path(directory).relative_to(cwd).parts) >= 4:
                    children[:] = []
                if 'gui-guard.json' in files or ('render-guard.json' in files and isinstance(read(Path(directory) / 'render-guard.json').get('gui'), dict)):
                    roots.add(Path(directory))
        for root in sorted(roots):
            cfg = read(config_path(root))
            if config_path(root).name == 'render-guard.json':
                cfg = cfg['gui']
            if not isinstance(cfg, dict):
                raise ValueError('GUI configuration must be a JSON object.')
            cfg.setdefault('uiFiles', ['**/*' + extension for extension in {Path(name).suffix for name in cfg['files'] if Path(name).suffix}])
            selected = [e for e in entries if relevant(e, root, cfg)]
            if kind in ['pre', 'post'] and not selected:
                continue
            if kind == 'pre':
                maintenance = check_day()
                if maintenance['status'] in ['needs-update', 'checking', 'failed', 'updating']:
                    raise ValueError('Daily dependency check: ' + maintenance['status'] + '. Run render-guard update before measurement. Do not repeat checks or tests for each task.')
                cfg = config(root)
                pre(root, cfg, selected)
                link(root, session, cfg)
            elif kind == 'post':
                cfg = config(root)
                state = read(state_path(root))
                state['editedAt'] = time.time()
                state.pop('receipt', None)
                write(state_path(root), state)
                link(root, session, cfg, touched=True)
            else:
                tracked = index['projects'].get(str(root), {})
                state = read(state_path(root)) if state_path(root).exists() else None
                baseline = tracked.get('sources')
                changed = baseline is not None and baseline != sources(root, cfg)
                if state:
                    last = state.get('receipt', {}).get('sources', state.get('sources'))
                    changed = changed or last is not None and last != sources(root, cfg)
                if not changed and not tracked.get('touched') and not (state and state.get('version') == VERSION and not state.get('receipt')):
                    continue
                verify(root)
    except ERRORS as error:
        print(json.dumps(block(kind, str(error)), ensure_ascii=False))


def add_ignore(root):
    result = subprocess.run(['git', 'rev-parse', '--git-path', 'info/exclude'], cwd=root, capture_output=True, text=True)
    if result.returncode == 0:
        path = local_path(result.stdout.strip(), root)
        current = path.read_text(encoding='utf-8') if path.exists() else ''
        if '/.gui-guard/' not in current.splitlines():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(current + ('\n' if current and not current.endswith('\n') else '') + '/.gui-guard/\n', encoding='utf-8')


def begin(root, cfg, scope, refresh=False):
    if not scope or not set(scope).issubset(cfg['files']):
        raise ValueError('Declare all requested files from the configured GUI sources with --scope.')
    if state_path(root).exists():
        previous = read(state_path(root))
        if refresh:
            if previous.get('sources') != sources(root, cfg) or previous.get('binaryAtStart') != digest(local_path(cfg['binary'], root)):
                raise ValueError('Cannot replace the before measurement after edits. Use after to check the changes.')
        elif previous.get('version') == VERSION:
            verify(root)
        else:
            receipt = previous.get('receipt', {})
            if receipt.get('sources') != sources(root, cfg) or receipt.get('binary') != digest(local_path(cfg['binary'], root)):
                raise ValueError('The previous version has unchecked edits. Do not clear records and restart begin.')
            for section in [previous['before']['files'], receipt['artifacts'], receipt['checks']]:
                check_hashes(section)
    initial = sources(root, cfg)
    for name in copy_names(cfg):
        expected = digest(root / name) if (root / name).is_file() else None
        if expected is not None and digest(local_path(cfg['copyRoot'], root) / name) != expected:
            raise ValueError('Source and runtime copy differ before measurement: ' + name)
    before = measure(root, cfg, 'guard-before')
    regression = regression_measure(root, cfg, 'guard-before')
    if initial != sources(root, cfg):
        raise ValueError('Source changed during the before measurement.')
    write(state_path(root), {'version': VERSION, 'scope': scope, 'before': before, 'regression': regression, 'startedAt': time.time(), 'sources': initial,
                            'binaryAtStart': digest(local_path(cfg['binary'], root))})
    link(root, session_id(), cfg)
    add_ignore(root)
    print('GUI scope and before measurement recorded. Open the actual images for inspection.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['maintenance-check', 'update', 'begin', 'refresh', 'scope', 'build', 'after', 'verify', 'status', 'doctor', 'packet', 'approve', 'hook-pre', 'hook-post', 'hook-stop', 'hook-bash'])
    parser.add_argument('token', nargs='?')
    parser.add_argument('--project', default='.')
    parser.add_argument('--scope', nargs='+')
    parser.add_argument('--minutes', type=float, default=120)
    parser.add_argument('--session')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    if args.command.startswith('hook-'):
        hook(args.command[5:])
        return
    root = local_path(args.project)
    if args.command == 'maintenance-check':
        print(json.dumps(check_day(), ensure_ascii=False))
        return
    if args.command == 'update':
        def perform_update():
            if state_path(root).exists():
                verify(root)
            subprocess.run([sys.executable, str(Path(__file__).resolve().with_name('update.py'))], check=True)
        if args.force:
            perform_update()
            path = record_path(day_id())
            path.parent.mkdir(parents=True, exist_ok=True)
            save(path, {'status': 'updated', 'versions': installed_versions()})
        else:
            result = update_day(perform_update)
            print(json.dumps(result, ensure_ascii=False))
        return
    cfg = config(root)
    if args.command in ['begin', 'refresh']:
        begin(root, cfg, args.scope, refresh=args.command == 'refresh')
    elif args.command in ['scope', 'approve']:
        state = read(state_path(root))
        if args.command == 'scope':
            if not args.scope or not set(args.scope).issubset(cfg['files']):
                raise ValueError('Specify the GUI files to include in scope.')
            state['scope'] = args.scope
        else:
            permitted = ['file:' + p for p in cfg.get('protectedFiles', [])] + ['pattern:' + p for p in cfg.get('protectedPatterns', [])]
            size_token = window_size_change_token(cfg)
            if size_token is not None:
                permitted.append(size_token)
            if args.token not in permitted or not math.isfinite(args.minutes) or args.minutes <= 0:
                raise ValueError('Specify a configured protected target and a positive approval duration.')
            state.setdefault('approvals', []).append({'token': args.token, 'until': time.time() + args.minutes * 60})
        write(state_path(root), state)
    elif args.command == 'build':
        build(root, cfg)
    elif args.command == 'after':
        after(root)
    elif args.command == 'verify':
        verify(root)
        print('RenderGuard GUI verification passed.')
    elif args.command == 'packet':
        print('<!-- gui-guard packet v1 root=' + str(root) + ' -->')
        print('At the first applicable skill or hook use each day: render-guard update --project ' + shlex.quote(str(root)) + '. Reuse the daily result across sessions and projects; do not update during a before/after comparison.')
        print('Source project: ' + str(root) + '. gui-guard begin --project ' + shlex.quote(str(root)) + ' --scope ' + ' '.join(shlex.quote(p) for p in (args.scope or cfg['files'])))
        print('Requested and comparison targets: ' + ', '.join(cfg['measurement']['targets']))
        print('Measure the actual screen and text before and after; open the PNGs. Batch related edits, build, deploy the authorized runtime copy, run after, then verify. Preserve scope and report unverified work.')
        installation = Path(__file__).resolve().parents[3]
        skill = installation / 'skills/design-guard' if (installation / 'skills/design-guard').is_dir() else installation / 'skill'
        print('Instructions: ' + str(skill / 'references/gui.md'))
    elif args.command == 'doctor':
        print('Configuration checked: ' + str(root))
        print('Tracked measurement and validation files: ' + json.dumps(list(input_files(root, cfg)), ensure_ascii=False))
        print('Check hook registration, trust and actual invocation separately. doctor does not prove screen correctness.')
    else:
        print(json.dumps(read(state_path(root)) if state_path(root).exists() else {'status': 'Not started'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except ERRORS as error:
        print('RenderGuard GUI: ' + str(error), file=sys.stderr)
        sys.exit(1)
