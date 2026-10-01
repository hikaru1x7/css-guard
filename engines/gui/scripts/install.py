#!/usr/bin/env python3
"""Compatibility entry: register only the unified RenderGuard skill and hooks."""
import argparse
from pathlib import Path
import subprocess


def install(home, skill=None):
    root = Path(__file__).resolve().parents[3]
    subprocess.run(['bash', str(root / 'install.sh'), '--skip-update', '--home', str(home)], check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--home', type=Path, default=Path.home())
    parser.add_argument('--skill', type=Path, help='Legacy argument; the common installation owns the skill')
    args = parser.parse_args()
    install(args.home.resolve(), args.skill)
