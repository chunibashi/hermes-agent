# Upstream Changelog 2026-08-04

Behind origin/main: 59 commits

## 🌟 Highlights

- **xAI**: native web_search honor configured backend on Responses path
- **File-ops**: eliminate redundant subprocess calls in write_file/V4A patch (perf)
- **Gateway**: replace SSE poll loop with call_soon_threadsafe-fed asyncio.Queue (perf)
- **Gateway**: prewarm /model picker cache on TUI startup (perf)
- **Dashboard/TUI**: fix stale-session-token reload loop, spinner perf
- **Models**: add qwen3.8-max to Nous portal + OpenRouter, replacing qwen3.7-max
- **CLI**: add 'sessions clean-markers' to purge stale tool-call markers
- **Agent**: fix output-cap retry path, compress messages on retry

## Commits by Type

### feat
- feat(cli): add sessions clean-markers to permanently purge stale tool-call markers
- feat(models): add qwen3.8-max to Nous portal + OpenRouter catalogs

### fix
- fix(xai): honor configured web search backend on Responses path
- fix: wire HermesConsoleModal WS into stale-token reload guard
- fix: update ChatPage test import for react-router v7
- fix(dashboard): reload loopback tabs after stale session-token closes
- fix(telegram+sqlite): resolve polling conflict loop + misleading WAL warning
- fix(file-ops): surrogatepass in bytes_written encode
- fix(file-ops): decouple BOM detection from pre_content, add V4A backward compat
- fix(credential-pool): lock the quarantine read-modify-write of _entries
- fix(credential-pool): re-select in acquire_lease after a deferred refresh
- fix(test): feed the SSE writers an asyncio queue, not queue.Queue
- fix: reconstruct fused test after conflict resolution
- fix(conversation_loop): prune dead vision-strip fallback; harden output-cap retry
- fix(conversation_loop): compress messages on output-cap retry path
- fix(agent): repair sessions already contaminated with stale tool-call markers
- fix(agent): discard bare tool-call marker before fallback/persistence
- fix: close the Codex app-server session on agent teardown
- fix(gateway): bound go_dormant ws.close with teardown timeout
- fix(gateway): keep event loop alive during /compress and Relay drain
- fix(model_metadata): read llama.cpp context from meta.n_ctx + accept sole model
- fix(agent): keep context_length pin for named custom providers

### perf
- perf(file-ops): eliminate redundant subprocess calls in write_file and V4A patch path
- perf(tui): bound reasoning-clean input to the displayed tail
- perf(gateway): replace SSE poll loop with call_soon_threadsafe-fed asyncio.Queue
- perf(desktop): keep spinner frames out of React commits
- perf(cli): check local auth.json/config before slow provider registry sweep
- perf(gateway): prewarm /model picker cache on TUI startup
- perf: reuse request_input_estimate instead of recomputing estimate_request_tokens_rough

### refactor
- refactor(xai): simplify _xai_prefers_native_web_search to use registry
- refactor(file-ops): fold simplify-pass findings
- refactor(gateway): route session event stream through _sse_frame (ensure_ascii=False)
- refactor(gateway): route all three SSE writers through _sse_frame()
- refactor(gateway): extract _sse_frame() helper, dedup 5 inline SSE encode call sites
- refactor: dedup stale-marker regex — use compiled _STALE_MARKER_RE in conversation_loop

### test
- test(xai): cover Firecrawl vs native web_search on Responses
- test: exercise the production _loop_ref path in put_threadsafe tests
- test: add cross-thread put_threadsafe + long-reasoning tail tests
- test(desktop): cover minimized/hidden window-state + visibilitychange pause
- test(cli): regression tests pinning auth-first ordering skips registry sweep
- test(tui): pin picker-cache prewarm wiring in entry.main()
- test(gateway): cover named-custom context pin on session-info banner
- test: swap context-switch-guard fixture off qwen3.8-max-preview

### chore
- chore: map jun@junho.co to junhohong
- chore: remove dead tomli dependency declaration
- chore: update uv.lock for tomli dependency (rebase fix)
- chore: AUTHOR_MAP — add BobClawblaw for PR #77870 salvage
- chore: drop CHANGELOG.md and docs/reports/ — not shipped with salvage PRs
- chore: add contributor email mapping for johnrazmus
- chore: add contributor email mapping for ElSnacko
- chore: sync uv.lock with nemo-relay android marker
- chore: exempt android installs from nemo-relay

### other
- fmt(js): npm run fix on merge
- fix comment about relay workaround

---
Generated: 2026年 8月  4日 火曜日 22:17:13    

