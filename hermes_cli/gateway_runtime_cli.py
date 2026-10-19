"""Machine-readable ensure boundary. No bootstrap credentials leave this command."""
from dataclasses import asdict
import json
import sys
from contextlib import redirect_stdout


def ensure_exit_code(result) -> int:
    if result.reason_code == "deadline":
        return 5
    if result.reason_code in {"authorization", "profile_mismatch", "gateway_elevated", "gateway_other_session"}:
        return 4
    return {"ready": 0, "incompatible": 3, "draining": 6,
            "inaccessible": 7, "conflict": 7, "starting": 5, "absent": 5}[result.state]


# Files whose change means a RUNNING gateway must restart to see them (local fold, see
# cmd_gateway_ensure). Frontend/packaging/docs/test-only commits move HEAD without changing any
# runtime behaviour, so they must not force a gateway restart (the desktop would restart it on
# every such commit, and a restart cannot load new TS anyway). Python sources outside the
# frontend/tooling trees and the dependency manifests are the runtime surface.
_RUNTIME_SUFFIX = (".py",)
_RUNTIME_MANIFESTS = ("pyproject.toml", "uv.lock", "requirements.txt", "setup.py", "setup.cfg")
_RUNTIME_EXCLUDE_PREFIXES = (
    "apps/", "ui-tui/", "web/", "website/", "docs/", "scripts/", "tests/", "plugin-catalog/",
    "assets/", "skills/", "optional-skills/", "examples/", ".github/",
)


def _runtime_files_changed(repo_dir, old_sha: str, new_sha: str) -> bool:
    """True when the ``old_sha..new_sha`` rev range touches files a running gateway imports.

    ``repo_dir`` is the resolved checkout (from :func:`hermes_cli.version_info._resolve_repo_dir`);
    None (non-git install) means the caller treats the drift as unknown and keeps the owner running.
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


def cmd_gateway_ensure(args) -> None:
    from hermes_constants import get_hermes_home
    from hermes_cli.gateway_runtime import ensure_gateway_runtime

    try:
        # Legacy imported utilities can print; protocol stdout belongs only to us.
        with redirect_stdout(sys.stderr):
            result = ensure_gateway_runtime(get_hermes_home(), timeout=float(args.timeout))
        payload = asdict(result)
        if result.endpoint:
            payload["endpoint"]["capabilities"] = sorted(result.endpoint.capabilities)
        # LOCAL: fold the stale-owner check down to RUNTIME changes only. Desktop restarts the
        # gateway whenever ``client_code_sha`` != ``endpoint.code_sha`` (staleGatewayCode +
        # createStaleGatewayRestarter, apps/desktop/electron/local-gateway.ts). On a dev checkout
        # that other agent sessions commit to, every commit — including frontend-only ones that a
        # gateway restart cannot even load — moved HEAD and forced a restart, tearing down every
        # in-flight WebSocket ("request timed out after 30s: session.resume / session.create").
        # So we resolve the fingerprint only when the diff between the owner's sha and this
        # checkout's touches files the gateway actually runs (Python + dependency manifests);
        # a frontend/packaging/docs/test-only drift is reported as equal, which the desktop's
        # documented "not stale" path accepts without any rebuild.
        from hermes_cli.version_info import _resolve_repo_dir, get_code_identity
        client_sha = get_code_identity().get("sha")
        gateway_sha = (payload.get("endpoint") or {}).get("code_sha")
        if (isinstance(client_sha, str) and client_sha and isinstance(gateway_sha, str) and gateway_sha
                and client_sha != gateway_sha):
            repo = _resolve_repo_dir()
            changed = _runtime_files_changed(repo, gateway_sha, client_sha) if repo is not None else None
            if changed is False or (changed is None and repo is not None):
                # Frontend-only drift, or a diff we cannot read (sha not in history): keep the owner
                # running. A gateway restart would not load new TS anyway; only a rebuild would.
                client_sha = gateway_sha
        payload["client_code_sha"] = client_sha
        code = ensure_exit_code(result)
    except (ValueError, TypeError):
        payload, code = {"state": "inaccessible", "reason_code": "invalid_invocation", "endpoint": None}, 2
    print(json.dumps(payload, separators=(",", ":"), sort_keys=True))
    raise SystemExit(code)
