#!/usr/bin/env python3
"""Audit current recorder contracts in temporary workspaces; never runs an agent."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'core/skills/poteto-mode/scripts/run-record.py'
ROUTES = json.loads(SCRIPT.with_name('routes.json').read_text())
ENV = {**os.environ, 'GIT_AUTHOR_NAME': 'Audit', 'GIT_AUTHOR_EMAIL': 'audit@localhost',
       'GIT_COMMITTER_NAME': 'Audit', 'GIT_COMMITTER_EMAIL': 'audit@localhost',
       'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1'}


def rr(cwd, *args, expect=0):
    r = subprocess.run([sys.executable, str(SCRIPT), *args], cwd=cwd, env=ENV,
                       capture_output=True, text=True, timeout=20)
    if expect is not None and r.returncode != expect:
        raise RuntimeError(f'{args}: {r.returncode}: {r.stdout}{r.stderr}')
    return {'exit': r.returncode, 'stdout': r.stdout.strip(), 'stderr': r.stderr.strip()}


def record(cwd):
    return json.loads(next((cwd / '.pstack/runs').glob('*.json')).read_text())


def model_profile_probe():
    sys.path.insert(0, str(ROOT / 'packaging/src'))
    from pstack_cli.profile import Report, check_model
    report = Report()
    model = 'gpt-imaginary-audit-only'
    check_model('codex', model, 'audit fixture', report)
    return {'host': 'codex', 'model': model, 'errors': report.errors, 'warnings': report.warnings,
            'scope': 'Local profile validation only; no model request was made.'}


def bugfix_probe(cwd, failed_review=False):
    cwd.mkdir()
    def git(*args):
        subprocess.run(['git', *args], cwd=cwd, env=ENV, capture_output=True, check=True)
    git('init', '-q')
    (cwd / 'app.py').write_text('value = 0\n')
    (cwd / 'test_app.py').write_text('from app import value\nassert value == 1, value\n')
    git('add', 'app.py', 'test_app.py')
    git('commit', '-qm', 'test: failing baseline')
    rr(cwd, 'init', '--route', 'bug-fix', '--task', 'Audit completion gate behavior')
    failing = subprocess.run([sys.executable, '-B', 'test_app.py'], cwd=cwd, capture_output=True, text=True)
    assert failing.returncode != 0 and 'AssertionError' in failing.stderr
    out = cwd / '.pstack/repro.txt'
    out.write_text(failing.stdout + failing.stderr)
    rr(cwd, 'baseline', '--harness', 'test_app.py', '--command', f'{sys.executable} -B test_app.py', '--output', str(out))
    rr(cwd, 'evidence', '--kind', 'repro', '--result', 'fail', '--output', str(out))
    rr(cwd, 'phase', 'reproduce', '--done')
    rr(cwd, 'phase', 'root-cause', '--done')
    rr(cwd, 'phase', 'plan', '--skip', 'The fixture changes one constant')
    (cwd / 'app.py').write_text('value = 1\n')
    rr(cwd, 'phase', 'implement', '--done', '--note', 'Audit fixture written inline, no delegate run')
    rr(cwd, 'phase', 'cleanup', '--done')
    if failed_review:
        out = cwd / '.pstack/review.txt'
        out.write_text('FAIL: blocking review verdict remains unresolved\n')
        rr(cwd, 'evidence', '--kind', 'review', '--result', 'fail', '--output', str(out))
        rr(cwd, 'phase', 'review', '--done')
        passing = subprocess.run([sys.executable, '-B', 'test_app.py'], cwd=cwd, capture_output=True, text=True)
        assert passing.returncode == 0
        out = cwd / '.pstack/verify.txt'
        out.write_text(f'{sys.executable} -B test_app.py exited 0\n' + passing.stdout + passing.stderr)
        rr(cwd, 'evidence', '--kind', 'verify', '--result', 'pass', '--output', str(out), '--command', f'{sys.executable} -B test_app.py')
        rr(cwd, 'phase', 'verify', '--done')
    else:
        rr(cwd, 'phase', 'review', '--skip', 'Audit isolates the verification gate')
        rr(cwd, 'phase', 'verify', '--skip', 'Audit: no verification executed')
    git('add', 'app.py')
    git('commit', '-qm', 'fix: fixture constant')
    rr(cwd, 'phase', 'commits', '--done')
    rr(cwd, 'phase', 'open-pr', '--skip', 'Local audit fixture has no remote')
    return rr(cwd, 'check', expect=None)


def main():
    result = {'recorder_sha256': hashlib.sha256(SCRIPT.read_bytes()).hexdigest(),
              'routes_sha256': hashlib.sha256(SCRIPT.with_name('routes.json').read_bytes()).hexdigest(),
              'empty_routes': []}
    with tempfile.TemporaryDirectory(prefix='pstack-contract-audit-') as temp:
        base = Path(temp)
        for name, definition in ROUTES.items():
            cwd = base / name
            cwd.mkdir()
            rr(cwd, 'init', '--route', name, '--task', 'Audit: no engineering work performed')
            for phase in definition['phases']:
                rr(cwd, 'phase', phase['id'], '--done')
            rec = record(cwd)
            result['empty_routes'].append({'route': name, 'phases': rec['phases_required'],
                'evidence': len(rec['evidence']), 'delegates': len(rec['delegates']),
                'check': rr(cwd, 'check', expect=None)})
        for name, mode in [('feature-reversed', 'reverse'), ('feature-skipped', 'skip')]:
            cwd = base / name
            cwd.mkdir()
            rr(cwd, 'init', '--route', 'feature', '--task', 'Audit invalid phase execution')
            phases = record(cwd)['phases_required']
            for phase in reversed(phases) if mode == 'reverse' else phases:
                if mode == 'reverse':
                    rr(cwd, 'phase', phase, '--start')
                    rr(cwd, 'phase', phase, '--done')
                else:
                    rr(cwd, 'phase', phase, '--skip', 'Audit: skipping every mandatory operation')
            result[name] = rr(cwd, 'check', expect=None)
        cwd = base / 'narrowed-bug-fix'
        cwd.mkdir()
        rr(cwd, 'init', '--route', 'bug-fix', '--phases', 'plan', '--task', 'Audit narrowed built-in contract')
        rr(cwd, 'phase', 'plan', '--done')
        result['narrowed-bug-fix'] = rr(cwd, 'check', expect=None)
        cwd = base / 'named-pr'
        cwd.mkdir()
        rr(cwd, 'init', '--route', 'opening-a-pr', '--task', 'Audit generic step naming')
        result['opening-pr-step-1'] = rr(cwd, 'phase', 'step-1', '--start', expect=None)
        cwd = base / 'failed-review'
        cwd.mkdir()
        rr(cwd, 'init', '--route', 'custom', '--phases', 'review', '--task', 'Audit review verdict validation')
        verdict = cwd / '.pstack/review.txt'
        verdict.write_text('FAIL: blocking review finding\n')
        rr(cwd, 'phase', 'review', '--start')
        rr(cwd, 'evidence', '--kind', 'review', '--result', 'fail', '--output', str(verdict), '--phase', 'review')
        rr(cwd, 'phase', 'review', '--done')
        result['failed-review'] = rr(cwd, 'check', expect=None)
        cwd = base / 'missing-verify-control'
        cwd.mkdir()
        rr(cwd, 'init', '--route', 'custom', '--phases', 'verify', '--task', 'Control: named verification is checked')
        rr(cwd, 'phase', 'verify', '--done')
        result['missing-verify-control'] = rr(cwd, 'check', expect=None)
        result['bugfix-skipped-verification'] = bugfix_probe(base / 'bugfix-skip-verify')
        result['bugfix-failed-review'] = bugfix_probe(base / 'bugfix-fail-review', failed_review=True)
    result['empty_routes_accepted'] = sum(r['check']['exit'] == 0 for r in result['empty_routes'])
    result['imaginary-model-profile'] = model_profile_probe()
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
