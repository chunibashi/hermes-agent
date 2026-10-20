"""Detect when the gateway is running stale code after a hot ``git pull``.

The gateway's ``sys.modules`` is frozen at boot.  If the checkout is updated
underneath it, a first-time lazy import can resolve a freshly-pulled module
against a stale cached dependency -> ImportError.  We snapshot the revision at
startup so risky callers (e.g. ``/model`` switching) can refuse with a clear
"restart the gateway" message.  If the revision can't be read (non-git install,
IO error) the boot snapshot stays ``None`` and detection no-ops — never a false positive.
"""

from __future__ import annotations

from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_boot_fingerprint: str | None = None


def _fingerprint() -> str | None:
    """Current checkout fingerprint via the CLI's worktree-aware git-rev reader
    (``hermes_cli.main`` is always already imported in a gateway process)."""
    try:
        from hermes_cli.main import _read_git_revision_fingerprint

        return _read_git_revision_fingerprint(_PROJECT_ROOT)
    except Exception:
        return None


def record_boot_fingerprint() -> None:
    """Snapshot the checkout revision at gateway startup (idempotent)."""
    global _boot_fingerprint
    if _boot_fingerprint is None:
        _boot_fingerprint = _fingerprint()


def _short(fingerprint: str) -> str:
    """Render a ``git:<ref>:<sha>`` fingerprint as a compact label."""
    sha = fingerprint.rsplit(":", 1)[-1]
    return sha[:10] if sha and sha != "unresolved" and len(sha) > 10 else (sha or fingerprint)


def current_code_sha() -> str | None:
    """Full SHA for the checkout currently on disk, or None when unresolved."""
    fingerprint = _fingerprint()
    if fingerprint is None:
        return None
    sha = fingerprint.rsplit(":", 1)[-1]
    return sha if sha and sha != "unresolved" else None


def detect_code_skew() -> tuple[str, str] | None:
    """``(boot_rev, disk_rev)`` short labels if the checkout drifted since boot, else ``None``."""
    current = _fingerprint() if _boot_fingerprint is not None else None
    if current is None or current == _boot_fingerprint:
        return None
    return _short(_boot_fingerprint), _short(current)


# Files whose change means a RUNNING backend must restart to see them (local fold, mirrored by
# ``hermes_cli/gateway_runtime_cli.py::_runtime_files_changed`` — keep the two in sync). A commit
# that only touches frontend/packaging/docs/tests moves HEAD without changing any runtime
# behaviour, and a restart cannot load new TS anyway: it must not retire a live backend. Python
# sources outside the frontend/tooling trees and the dependency manifests are the runtime surface.
_RUNTIME_SUFFIX = (".py",)
_RUNTIME_MANIFESTS = ("pyproject.toml", "uv.lock", "requirements.txt", "setup.py", "setup.cfg")
_RUNTIME_EXCLUDE_PREFIXES = (
    "apps/", "ui-tui/", "web/", "website/", "docs/", "scripts/", "tests/", "plugin-catalog/",
    "assets/", "skills/", "optional-skills/", "examples/", ".github/",
)


def runtime_files_changed(repo_dir, old_sha: str, new_sha: str) -> bool:
    """True when the ``old_sha..new_sha`` rev range touches files a running backend imports.

    ``repo_dir`` is the checkout root; None (non-git install) means the caller treats the
    drift as unknown and keeps the backend running (never a false retirement).
    """
    if repo_dir is None:
        return False
    import subprocess

    try:
        out = subprocess.run(
            ["git", "-C", str(repo_dir), "diff", "--name-only", "--no-renames", f"{old_sha}..{new_sha}"],
            capture_output=True, text=True, timeout=15, check=False)
    except Exception:
        return False
    if out.returncode != 0:
        return False
    for line in out.stdout.splitlines():
        name = line.strip().replace("\\", "/")
        if not name:
            continue
        if name in _RUNTIME_MANIFESTS:
            return True
        if name.endswith(_RUNTIME_SUFFIX) and not name.startswith(_RUNTIME_EXCLUDE_PREFIXES):
            return True
    return False


def detect_runtime_skew() -> tuple[str, str] | None:
    """``detect_code_skew()`` folded to runtime-only drift (local: serve retirement watchdog).

    The desktop-owned serve backend retires itself when this reports drift, so a commit that
    only moves frontend files must read as "no skew" — otherwise every agent commit kills the
    live WebSocket ("request timed out after 30s: session.control.read"). Only drifts whose
    diff touches worker-imported files (Python + manifests) justify a retirement.
    """
    drift = detect_code_skew()
    if drift is None:
        return None
    boot_full = _fingerprint_sha(_boot_fingerprint)
    disk_full = _fingerprint_sha(_fingerprint())
    if not (boot_full and disk_full and boot_full != disk_full):
        return None
    if not runtime_files_changed(_PROJECT_ROOT, boot_full, disk_full):
        return None
    return drift


def _fingerprint_sha(fingerprint: str | None) -> str | None:
    """The full sha segment of a ``git:<ref>:<sha>`` fingerprint, or None when unresolved."""
    if not fingerprint:
        return None
    sha = fingerprint.rsplit(":", 1)[-1]
    return sha if sha and sha != "unresolved" else None
