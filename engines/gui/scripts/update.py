#!/usr/bin/env python3
"""Refresh GUI Guard's private image library and official Windows measurement CLI."""
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import venv
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime'


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'gui-guard-maintenance'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def update_pillow():
    latest = json.loads(fetch('https://pypi.org/pypi/Pillow/json'))['info']['version']
    environment = RUNTIME / ('python-' + str(sys.version_info.major) + '.' + str(sys.version_info.minor))
    python = environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not python.exists():
        venv.EnvBuilder(with_pip=True).create(environment)
    subprocess.run([str(python), '-m', 'pip', 'install', '--upgrade', 'pip'], check=True)
    # 指定なしのupgradeで古い互換版に留まることを避け、正式版を明示する。
    subprocess.run([str(python), '-m', 'pip', 'install', '--upgrade', '--only-binary=:all:', 'Pillow==' + latest], check=True)
    actual = subprocess.check_output([str(python), '-c', "import importlib.metadata; print(importlib.metadata.version('Pillow'))"], text=True).strip()
    if actual != latest:
        raise ValueError('Pillow installed version differs from the checked stable release: ' + actual)
    subprocess.run([str(python), str(ROOT / 'scripts/test_gui_guard.py')], check=True)
    return latest


def update_winapp():
    if os.name != 'nt' and not Path('/mnt/c/Windows').exists():
        return {'available': False, 'reason': 'Outside Windows/WSL; use the project platform measurement provider'}
    release = json.loads(fetch('https://api.github.com/repos/microsoft/winappCli/releases/latest'))
    if release['prerelease'] or release['draft']:
        raise ValueError('Cannot verify the stable WinApp CLI release')
    arch = 'arm64' if platform.machine().lower() in ('arm64', 'aarch64') else 'x64'
    asset = next(a for a in release['assets'] if a['name'] == 'winappcli-' + arch + '.zip')
    base = RUNTIME / 'winapp'
    if os.name != 'nt':
        # WSL共有上で.NETを毎回起動する遅延を避け、Windowsの利用者専用領域に置く。
        local_appdata = subprocess.check_output(['powershell.exe', '-NoProfile', '-Command', '$env:LOCALAPPDATA'], text=True).strip()
        windows_base = subprocess.check_output(['wslpath', '-u', local_appdata], text=True).strip()
        base = Path(windows_base) / 'gui-guard' / 'winapp'
    target = base / release['tag_name']
    executable = target / 'winapp.exe'
    previous_target = RUNTIME / 'winapp' / release['tag_name']
    if not executable.exists() and (previous_target / 'winapp.exe').exists():
        shutil.copytree(previous_target, target)
    if not executable.exists():
        data = fetch(asset['browser_download_url'])
        if asset.get('digest') != 'sha256:' + hashlib.sha256(data).hexdigest():
            raise ValueError('Official download checksum mismatch')
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=target.parent) as temporary:
            stage = Path(temporary) / 'unpacked'
            stage.mkdir()
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                for name in archive.namelist():
                    if not (stage / name).resolve().is_relative_to(stage.resolve()):
                        raise ValueError('Archive path escapes the destination')
                archive.extractall(stage)
            if not (stage / 'winapp.exe').exists():
                raise ValueError('Archive does not contain winapp.exe')
            try:
                stage.rename(target)
            except OSError:
                # A concurrent checkout can finish the same official download.
                if not executable.exists() or hashlib.sha256(executable.read_bytes()).digest() != hashlib.sha256((stage / 'winapp.exe').read_bytes()).digest():
                    raise
    # Windows側にも明示して利用統計の外部送信を無効化する。
    if os.name == 'nt':
        command = [str(executable), '--version']
        env = dict(os.environ, WINAPP_CLI_TELEMETRY_OPTOUT='1')
    else:
        windows_path = subprocess.check_output(['wslpath', '-w', str(executable)], text=True).strip()
        literal = windows_path.replace("'", "''")
        command = ['powershell.exe', '-NoProfile', '-Command', "$env:WINAPP_CLI_TELEMETRY_OPTOUT='1'; & '" + literal + "' --version; exit $LASTEXITCODE"]
        env = os.environ.copy()
    result = subprocess.check_output(command, env=env, text=True, timeout=60).strip()
    if release['tag_name'].lstrip('v') not in result:
        raise ValueError('WinApp CLI running version mismatch: ' + result)
    pointer = RUNTIME / 'winapp-current.json'
    executable_path = str(executable) if os.name == 'nt' else subprocess.check_output(['wslpath', '-w', str(executable)], text=True).strip()
    old_pointer = pointer.read_bytes() if pointer.exists() else None
    pointer.write_text(json.dumps({'version': release['tag_name'], 'executable': executable_path}), encoding='utf-8')
    tested = RUNTIME / 'winapp-tested.json'
    fingerprint = {'binary': hashlib.sha256(executable.read_bytes()).hexdigest(),
                   'scripts': {name: hashlib.sha256((ROOT / 'scripts' / name).read_bytes()).hexdigest()
                               for name in ['Measure-WindowsControls.ps1', 'test_windows_measurement.ps1']}}
    previous = json.loads(tested.read_text()) if tested.exists() else None
    if previous != fingerprint:
        script = str(ROOT / 'scripts/test_windows_measurement.ps1')
        measurement = str(ROOT / 'scripts/Measure-WindowsControls.ps1')
        if os.name != 'nt':
            script, measurement = [subprocess.check_output(['wslpath', '-w', p], text=True).strip() for p in [script, measurement]]
        try:
            subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
                            '-MeasurementScript', measurement], check=True, timeout=180)
        except Exception:
            if old_pointer is None:
                pointer.unlink(missing_ok=True)
            else:
                pointer.write_bytes(old_pointer)
            raise
        tested.write_text(json.dumps(fingerprint), encoding='utf-8')
    return {'available': True, 'version': release['tag_name'], 'executable': str(executable)}


def update():
    RUNTIME.mkdir(parents=True, exist_ok=True)
    receipt = RUNTIME / 'update.json'
    receipt.unlink(missing_ok=True)
    pillow = update_pillow()
    winapp = update_winapp()
    result = {'Pillow': pillow, 'WinAppCLI': winapp}
    receipt.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    update()
