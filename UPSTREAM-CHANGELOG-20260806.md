# Upstream Changelog — 2026-08-06

**76 commits** merged from origin/main

## 🌟 Features

- feat(skills): actual-setup optional skill + provider docs
- feat(providers): env-var metadata, config-driven local no-auth, reasoning-effort clamp for Actual
- feat(providers): add Actual Computer inference provider
- feat(scripts): reproducible core-toolset A/B eval harness (toolperf_abeval)
- feat(update): emit an action-scoped terminal receipt from hermes update
- feat(wake): client-capture wake word for remote desktop
- feat(nix): desktop app icon
- feat(desktop): register a Linux launcher entry for `hermes desktop`
- feat(desktop): let convert-a-branch reach remote branches too
- feat(observability): add Relay active install metrics
- feat(observability): add Relay client resource metrics
- feat(observability): add Relay skill metrics

## 🐛 Bug Fixes

- fix(gateway): finish the split-delivery bug class so the fix cannot duplicate or still swallow
- fix(gateway): stop payload-less split delivery from swallowing finals
- fix: adapt Actual provider salvage to current main
- fix(compression): durable-sync the prune runway on model switch + fast no-op for incapable stores
- fix(cache): make proactive pruning durable and cache-aware
- fix(dashboard): auto-reconnect the events WebSocket with backoff (supersedes #47876, #47921, #24315) (#79524)
- fix(desktop): make remote backend updates terminal-state driven
- fix(desktop): render remote PDFs in preview rail
- fix(desktop): open remote file rows in the in-app preview
- fix(desktop): preview remote HTML over SSH (#76008)
- fix(wake): auto capture keeps the backend mic when one exists
- fix(wake): address review on client-capture re-arm and feed queue
- fix: correct cron mid-run restart claim in salvaged docs
- fix(nix): fix electron headers sha
- fix(desktop): worktree dialog names the project, not the branch
- fix(desktop): mount one worktree dialog instead of one per composer
- fix(desktop): stop dialogs clipping popovers opened inside them
- fix(ci): follow artifact download redirect without auth
- fix(terminal): skip binary content on the referenced-script remote-read fallback (#77703)
- fix: join heartbeat thread in finally + add error-path test
- fix(delegation): keep subagents alive during slow model waits
- fix(state): stop delegate/tool children corrupting compression lineage
- fix(agent): prevent historical steer replay
- fix(cache): scope prompt_cache_key by session to stop cross-session bucket sharing
- fix(desktop): scope restored navigation by profile (#67709)
- fix(cli): correct the skin_cmd fallback comment to match the actual read path
- fix(cli): make profile.yaml and skin writes atomic to stop silent field loss
- fix(console): handle string SystemExit code in _capture_output
- fix(git): kill the whole probe process tree on timeout (port of openai/codex#36793)
- fix(install): resolve 8.3 profile aliases so a built desktop app stops reporting failure

## ⚡ Performance

- perf(desktop): coalesce wake.feed frames

## 🔧 Refactoring

- refactor(state): extract shared model_config merge helper
- refactor: trim verbose comments + drop redundant default_flow_style kwarg

## 🧪 Tests

- test(gateway): cover payload-less split-delivery final-send swallow
- test(desktop): expect client_capture in wake.start/status params
- test(observability): exercise the active worktree in metrics smoke
- test(install): exercise 8.3 normalization by running install.ps1, not by parsing it
- test(observability): assert strict client resources

## 📖 Docs

- docs(config): document wake_word.capture in cli-config.yaml.example
- docs: fix stale PATH location in windows-native common pitfalls
- docs: explain the slow silent first turn (prefill) on local hardware
- docs: warn against pointing two agents at one Hermes home (memory, profiles, FAQ)
- docs: add troubleshooting checklist for perceived agent-quality regressions
- docs: add security-posture guide for running Hermes on a personal or work machine
- docs: surface existing answers users can't find (migration, prompt-size, tool-call parsing, Desktop label)
- docs: four small accuracy fixes
- docs: add per-plan subscription billing table to providers page
- docs: add 'Which File Does What?' - one-page map of SOUL/USER/MEMORY/AGENTS
- docs: state the /goal vs Kanban boundary on both pages
- docs(delegation): note in-flight model waits count as progress
- docs(observability): clarify active profile identity

## 🔨 Chore

- chore: map justin@actual.computer to somewheresy for #26491 salvage
- chore: fix import order, map contributor email
- chore: add contributor mapping for burak33bb
- chore: suppress windows-footgun false positive on gated killpg

## 🤖 CI

- ci: poll review statuses from artifacts every cycle
- ci: add detailed logging to live comment poller
- ci(install): actually run the PowerShell installer tests

## 📦 Other

- fmt(js): `npm run fix` on merge (#79521)
- Hermes can read the in-app browser (#79482)
- fmt(js): `npm run fix` on merge (#79505)
- In-app browser and previews are real layout-tree tabs (#77705)
- fmt(js): `npm run fix` on merge (#79496)
- fmt(js): `npm run fix` on merge (#79155)

