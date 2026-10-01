"""One latest-version check per local calendar day, shared by skill commands and hooks."""
from concurrent.futures import ThreadPoolExecutor
import datetime
import hashlib
import importlib.metadata
import json
import os
import sys
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def record_path(session, home=None):
    base = Path(home or os.environ.get('GUI_GUARD_HOME', str(Path.home() / '.cache/gui-guard')))
    return base / 'maintenance' / (hashlib.sha256(str(session).encode()).hexdigest() + '.json')


def save(path, value):
    temp = path.with_name(path.name + '.' + str(os.getpid()) + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    temp.replace(path)


def latest_versions():
    windows = os.name == 'nt' or Path('/mnt/c/Windows').exists()
    requests = {'Pillow': 'https://pypi.org/pypi/Pillow/json'}
    if windows:
        requests['WinAppCLI'] = 'https://api.github.com/repos/microsoft/winappCli/releases/latest'
    def fetch(item):
        name, url = item
        request = urllib.request.Request(url, headers={'User-Agent': 'gui-guard-maintenance'})
        with urllib.request.urlopen(request, timeout=3) as response:
            data = json.load(response)
        return name, data['info']['version'] if name == 'Pillow' else data['tag_name']
    with ThreadPoolExecutor(max_workers=2) as pool:
        return dict(pool.map(fetch, requests.items()))


def installed_versions():
    # Read private distributions directly, including a runtime created by a child updater.
    environments = [ROOT / '.runtime' / f'python-{sys.version_info.major}.{sys.version_info.minor}']
    sites = [site for environment in environments for pattern in ['lib/python*/site-packages', 'Lib/site-packages'] for site in environment.glob(pattern)]
    private = [d.version for d in importlib.metadata.distributions(path=[str(p) for p in sites]) if d.metadata['Name'].lower() == 'pillow']
    if private:
        pillow = private[0]
    else:
        try:
            pillow = importlib.metadata.version('Pillow')
        except importlib.metadata.PackageNotFoundError:
            pillow = None
    value = {'Pillow': pillow}
    if os.name == 'nt' or Path('/mnt/c/Windows').exists():
        pointer = ROOT / '.runtime/winapp-current.json'
        value['WinAppCLI'] = json.loads(pointer.read_text())['version'] if pointer.exists() else None
    return value


def check_session(session, home=None, latest=latest_versions, installed=installed_versions):
    if not session:
        return {'status': 'unidentified'}
    path = record_path(session, home)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return json.loads(path.read_text())
    lock = path.with_suffix('.lock')
    try:
        lock.mkdir()
    except FileExistsError:
        return {'status': 'checking'}
    try:
        if path.exists():
            return json.loads(path.read_text())
        save(path, {'status': 'checking'})
        try:
            available, current = latest(), installed()
            result = {'status': 'current' if all(current.get(k) == v for k, v in available.items()) else 'needs-update',
                      'versions': current, 'latest': available}
        except Exception as error:
            result = {'status': 'failed', 'error': str(error)}
        save(path, result)
        return result
    finally:
        lock.rmdir()


def update_session(session, update, home=None, **options):
    if not session:
        raise ValueError('Missing cache key; use the daily entry point')
    result = check_session(session, home=home, **options)
    if result['status'] in ['current', 'updated']:
        return dict(result, skipped=True)
    if result['status'] != 'needs-update':
        raise ValueError('The daily check failed or is in progress; it will not automatically retry')
    lock = record_path(session, home).with_suffix('.updating')
    try:
        lock.mkdir()
    except FileExistsError:
        raise ValueError('The daily update is in progress')
    try:
        save(record_path(session, home), {'status': 'updating'})
        update()
        versions = options.get('installed', installed_versions)()
        if not all(versions.get(k) == v for k, v in result['latest'].items()):
            raise ValueError('Installed versions do not match the checked stable releases')
        result = {'status': 'updated', 'versions': versions, 'latest': result['latest']}
        save(record_path(session, home), result)
        return result
    except Exception as error:
        save(record_path(session, home), {'status': 'failed', 'error': str(error)})
        raise
    finally:
        lock.rmdir()


def day_id(now=None):
    return 'day:' + (now or datetime.date.today()).isoformat()[:10]


def check_day(now=None, **options):
    return check_session(day_id(now), **options)


def update_day(update, now=None, **options):
    return update_session(day_id(now), update, **options)
