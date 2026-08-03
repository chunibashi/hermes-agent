# Changelog

## v0.20.0 — 2026-08-04 (78 upstream commits)

### 🌟 Highlights
- perf(moa): cache resolved preset + per-slot runtime to cut cold-start latency (#66793)
- perf(cold-start): mitigate ~14s GIL stall during backend init (#60800)
- fix(state): CJK trigger migration fail-closed + quarantine
- fix(backup): serialize and atomically publish snapshots
- feat(image): parallelize image_generate batches

### feat
- c0b0cc392 feat(image): parallelize image_generate batches

### fix
- 0845232d7 fix: prefer explicit anthropic api key
- aad8f7412 fix(backup): serialize and atomically publish snapshots
- efbfe0842 fix(prompt_size): search volatile tier for skills block
- 9b9cbdd7e fix(system_prompt): move skills index to the volatile band
- 7eefb0931 fix(nix): tie devShell HERMES_PYTHON to venv on PATH
- ddae511ab fix: thread extra_headers through the call_llm split
- 23f8ae32c fix(agent): cap auxiliary LLM concurrency per task
- 00475e1b2 fix(catalog): validate http+api_key manifests
- 861ca18c6 fix(catalog): wire api_key auth headers for http MCP servers
- df9dbba2b fix(backoff): keep 60s first-hit cooldown
- 9267c7823 fix: exponential backoff for rate-limit fallback cooldown
- a7ad713f4 fix(tool-executor): unpack 5-tuple runnable_calls
- 952d86b79 fix(file-sync): serialize concurrent sync cycles
- e6f1d613b fix(discord): leave voice channels before cancelling bot task
- 1f8acb340 fix(agent): stop re-probing blackhole TCP endpoints
- 2f09df561 fix(relay): route Discord tool-progress into auto-thread
- 733e7d26c fix(model_metadata): guard _localhost_to_ipv4
- fc32a38c3 fix(model_metadata): rewrite localhost->IPv4 for remaining probes
- 67d4bbb81 fix(state): route session-resume through WAL read-only
- 5bff3984b fix(tests): update append_message assertions
- 5bbd0dbd8 fix(context): dedupe subdirectory hints by content digest
- 58286878e fix(tui): avoid writable Kanban opens on empty polls
- 7d066c3c5 fix(state): deduplicate session system prompts
- 41cc4a13f fix(openviking): catch endpoint errors
- a49a9e5e3 fix(openviking): verify servers before sending credentials
- e43bc0b7a fix(openviking): reliability and configuration hardening
- 4ebe9904f fix(openviking): read recall settings from config.yaml
- 5396dd8f0 fix(memory): read non-secret provider config from config.yaml
- f0cb219e5 fix(openviking): re-arm commit guard after compression
- 9014aa026 fix(openviking): drop stale disabled warnings
- a3f6953f1 fix(openviking): don't spawn second server onto live port
- 65bcca650 fix(openviking): fail closed on blocked endpoints
- c7fd21add fix(security): reject always-blocked OpenViking endpoints
- b66111fc5 fix(state): quarantine CJK when ensure soft-fails
- a5ce909bb fix(state): fail closed on CJK trigger migration
- dab7c8860 fix(state): narrow FTS UPDATE triggers
- 9d76d48d0 fix(lint): import sort + eslint-disable
- 416b56b7e fix(desktop): flush queued deltas on window focus
- 3ac71680a fix(pr): remove remnant local PRAGMAs

### perf
- f8f475569 perf(compressor): release allocator pages after compaction
- d1c6c6b58 perf(moa): cache resolved preset + per-slot runtime
- 003b4c889 perf(gateway): per-platform skip_context_files
- 25a9c2c24 perf(cold-start): mitigate ~14s GIL stall
- 128ca2efd perf(tui): memoize useSessionLifecycle
- b58b3adb9 perf(tui-gateway): batch branch-seed history copies
- 06ae5b6fa perf(state): batch turn flush into one SQLite transaction
- 52fb96de4 perf(desktop): pause hidden-pane timers
- 7700597a1 perf(desktop): stop scroll and status loops
- eaf4d5184 perf(session): route SQLite PRAGMAs through central apply

### refactor
- da6d9604d refactor(state): fold simplify findings
- ae17163e9 refactor(state): drop unreachable regex guard
- aecec98c5f refactor(desktop): shared pulse beat + cron peek

### test
- 0bb14627b test: harden cold-start regression tests
- 84146fb9c test(run-agent): update flush-path assertions
- e443d3271 test(retaindb): guard scoped secret config
- 4b5794320 test(openviking): config.yaml recall settings
- f94914f77 test(openviking): cover compression lifecycle
- 7026177b3 test(session): guard config-gated performance PRAGMAs

### ci
- 177002838 ci: retry uv python install

### docs
- a991dfc25 docs: /personality none|default|neutral
- 9555525a7 docs(system_prompt): fix stale docstring

### style
- e2a2149df style(desktop): restore alphabetical import order

### chore
- 3c27eb623 chore: release v0.20.0 (2026.8.3)

- 376370691 chore: contributor mapping Ahmett101
- d48a78a29 chore: contributor mapping ArcherQAQ
- 8fb9c3b3e chore(contributors): map OpenViking source authors
- f1133c9b6 chore: map bot@bkstock.dev
- dae5df22e chore(contributors): map marzukia
- 26133b534 chore: map cicav legacy noreply
- f40d63d5d chore: contributor mapping HAOWANG116
- 164c3d60b chore: contributor mapping zabih-sudo

