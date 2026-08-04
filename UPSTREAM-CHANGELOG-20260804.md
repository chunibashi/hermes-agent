f5be9236e refactor(xai): simplify _xai_prefers_native_web_search to use registry
29eba9cb0 test(xai): cover Firecrawl vs native web_search on Responses
d2772b420 fix(xai): honor configured web search backend on Responses path
b8b17b8ce fix: wire HermesConsoleModal WS into stale-token reload guard
19e697d9c fix: update ChatPage test import for react-router v7
cab8673ea fix(dashboard): reload loopback tabs after stale session-token closes
e9a8b70fc chore: map jun@junho.co to junhohong
e05eba26a fix(telegram+sqlite): resolve polling conflict loop + misleading WAL warning
1709f82c1 chore: remove dead tomli dependency declaration
622b9a9f9 chore: update uv.lock for tomli dependency (rebase fix)
8c19e2925 refactor(file-ops): fold simplify-pass findings
fcae5ad49 fix(file-ops): surrogatepass in bytes_written encode (review finding)
eb78ab235 fix(file-ops): decouple BOM detection from pre_content, add V4A backward compat
cb3e8e9fb perf(file-ops): eliminate redundant subprocess calls in write_file and V4A patch path
4075c8fd5 fix(credential-pool): lock the quarantine read-modify-write of _entries
db0bd4211 fix(credential-pool): re-select in acquire_lease after a deferred refresh
fb4e17b1e fix(test): feed the SSE writers an asyncio queue, not queue.Queue
7e344dc0d test: exercise the production _loop_ref path in put_threadsafe tests
64882bc68 perf(tui): bound reasoning-clean input to the displayed tail
98165daac fix: reconstruct fused test after conflict resolution
fc8e3936a test: add cross-thread put_threadsafe + long-reasoning tail tests
221afc0cb refactor(gateway): route session event stream through _sse_frame (ensure_ascii=False)
1a09b0725 refactor(gateway): route all three SSE writers through _sse_frame()
7a1f2e3a6 refactor(gateway): extract _sse_frame() helper, dedup 5 inline SSE encode call sites
7098862de perf(gateway): replace SSE poll loop with call_soon_threadsafe-fed asyncio.Queue
9076adaca fmt(js): `npm run fix` on merge (#78271)
be54f28b1 test(desktop): cover minimized/hidden window-state + visibilitychange pause for GlyphSpinner
9a20d7f68 perf(desktop): keep spinner frames out of React commits
8f52040dd test(cli): regression tests pinning auth-first ordering skips registry sweep
dbafb5922 perf(cli): check local auth.json/config before slow provider registry sweep
5c078b987 test(tui): pin picker-cache prewarm wiring in entry.main()
bdc82e39e perf(gateway): prewarm /model picker cache on TUI startup
743dc94ab chore: AUTHOR_MAP — add BobClawblaw for PR #77870 salvage
9fc892697 perf: reuse request_input_estimate instead of recomputing estimate_request_tokens_rough
78c8bcd12 chore: drop CHANGELOG.md and docs/reports/ — not shipped with salvage PRs
04098e2b5 fix(conversation_loop): prune dead vision-strip fallback; harden output-cap retry tests
9938d2050 fix(conversation_loop): compress messages on output-cap retry path (#55546)
15d51bb88 refactor: dedup stale-marker regex — use compiled _STALE_MARKER_RE in conversation_loop
e18c040c3 fix(cli): back up state.db before clean-markers writes by default
e1a273969 feat(cli): add sessions clean-markers to permanently purge stale tool-call markers (#78148)
70d7e4cbd fix(agent): repair sessions already contaminated with stale tool-call markers (#78148)
ba9068c8b fix(agent): discard bare tool-call marker before fallback/persistence (#78148)
e623432b8 fix: close the Codex app-server session on agent teardown
9c88625e2 fix(gateway): bound go_dormant ws.close with teardown timeout
3b0bb3b8b fix(gateway): keep event loop alive during /compress and Relay drain
f66d62582 chore: add contributor email mapping for johnrazmus
60c721ada fix(model_metadata): read llama.cpp context from meta.n_ctx + accept sole model
942ff91f2 test(gateway): cover named-custom context pin on session-info banner
3a0a29510 fix(agent): keep context_length pin for named custom providers
91937a6dc test: swap context-switch-guard fixture off qwen3.8-max-preview
3c3ae7428 feat(models): add qwen3.8-max to Nous portal + OpenRouter catalogs, replacing qwen3.7-max
dac4bbea0 fix comment about relay workaround
827bb0dd1 chore: add contributor email mapping for ElSnacko
55b3e1ee5 chore: sync uv.lock with nemo-relay android marker
3b767d890 exempt android installs from nemo-relay
