b3aa561fa add Hermes headers to Fireworks provider (#81321)
a8c50eb1d fix: relax start_new_session assertion for systemd scope path
b5c211678 fix: defer O(n) fallback_data construction to failure path in _save_entry
c5e032c80 fix(gateway): close ambiguous recovery cleanup gaps
46b531422 fix(terminal): harden scope fallback and memory override
5ff328cc7 fix(gateway): make active turn markers failure-atomic
b0346ba42 fix(terminal): align worker limit with local guard
5f9308322 fix(terminal): bound isolated worker memory
0690fd77c fix(terminal): make systemd cleanup gateway-safe
69397937d fix(terminal): serialize systemd scope capability probe
59a128c6f fix(gateway): harden active turn marker lifecycle
6774760b6 fix(gateway): recover exact turns after unclean exits
21de22a4e fix(terminal): fully-qualified .scope unit name, exit-code check, already_exited cleanup (#70716)
7cfa90d90 fix(terminal): address review gaps — PTY isolation, unit-name kill, --quiet (#70716)
099eb7373 fix(terminal): isolate local background executors in their own systemd cgroup (#70716)
005421d88 fmt(js): `npm run fix` on merge (#81276)
7307f8899 fix: follow-up for salvaged PR #18255
15927c1d2 feat(cron): add usage_audit.jsonl logger for cron token leak instrumentation
d3e3c6234 feat(cron): set skip_background_review=True; doc title-generation non-presence
eaeba6474 feat(agent): add skip_background_review flag to AIAgent constructor
8370141f1 fmt(js): `npm run fix` on merge (#81259)
37aaecf48 test(desktop): cover the stale-session recovery bug class
c1305b645 fix(desktop): recover checkpoint restore and tile actions after a stale session drop
3c4f5c521 fix(desktop): recover image/file attach and /compress after a stale session drop
fab99e828 refactor(desktop): one resolver for stale runtime-session recovery
cdc10cd78 test(desktop): cover the Files-pane cwd desync bug class
6ff052479 fix(tui_gateway): report a lazy session's own cwd, not the launch dir
9cdbeceda fix(desktop): don't let a named session.info rehome a fresh draft
416e025c4 fix(desktop): rebind the Files pane cwd when switching sessions
ae6eb578b fix(desktop): add workspace-cwd ownership so switches are atomic
690dc87a8 chore: map contributor email
4cefba3ec fix(desktop): stop rendering a repo's main checkout as a duplicate sidebar lane
aaa4299a2 fix(gateway): normalize common repo root separators in the git probe
78bc9acdf chore(skills/document-to-action-items): promote to bundled tier
7b8d0d800 chore(skills/document-to-action-items): tighten to hardline standards, move to optional
ff2fa40b1 feat(skills): add document-to-action-items
c015663b2 fix(models): corrupt-at cache rows degrade to live fetch in cached_provider_model_ids
24b7ca725 fix(desktop): preserve root recovery through StrictMode replay
bb9434d30 fix(desktop): match current assistant-ui lookup errors
0405c2664 fix(desktop): recover root boundary from tapClientLookup races
a62eaaf31 fix(desktop): self-retry transient boundary errors, reactive edit composer context
fa1a5c048 Integrate verify subsystem with the existing verification stack
cc1acfb22 fix: Windows-safe process-group teardown in verify runner (footgun CI)
47a35d63c Port from superagent-ai/grok-cli: verify subsystem (run-recipe detection + environment manifest + hermes verify smoke runner)
8cb066404 fix(plugins): address portable MCP review feedback
6575fb0f8 fix(plugins): preserve opaque stdio commands
e288d93fc fix(review): harden portable plugin boundaries
ca78c6d7a feat(plugins): load portable agent components
c5117655b feat(plugins): validate portable agent packages
920eaf2fc chore(relay): require 0.7.1
6e87d43a5 fix(tools): lazily bring up sandbox for vision_analyze reads
bc80a0be5 test: stub EnvironmentConnectionError in environments.base module stub
5c29566e8 feat(terminal): graceful degradation for remote backend connection failures
c228d1c55 fix(dashboard): fold one-field doctor category into general tab
1006faa6f feat(doctor): add opt-in `hermes doctor --live` real-call backend probes
0ebaa490b test: use valid 2-task batches in schema-rejection tests
d6ee58b58 feat(delegation): optional structured-output schema on delegate_task
e166159f2 feat(vision): optional region zoom crop on vision_analyze
fe66596df feat(security): protected agent-instruction files always require write approval
c8369e37f feat(mcp): trust-tier gating for write-capable MCP tools via readOnlyHint
37cc99992 feat(mcp): collapse const-only anyOf/oneOf unions to property enums
9fad45fcd feat(kanban,mcp): orphaned-card reconciliation + per-server MCP identity header
5db1b72b1 feat(cli): global emergency stop — `hermes pause` / `hermes resume`
5396da844 docs: DX sweep — 7 verified-absent documentation items
d7635e43b feat(delegation): surface per-delegation cost in the result entry
94bc3194b feat(delegation): validate batch task quality before spawning children
ed903f953 feat(cron): pre-dispatch configuration validation (blocked_config + alert-once)
04e8a661f feat(cron): per-job durable notepad — KV scratchpad surviving scheduled runs
6dff2109a feat(cron): monitor-mode jobs — hash-suppressed change detection
563f0a6fd feat(cli): add `hermes approvals test` — dry-run approval verdict CLI
7cf71c32b fix: follow-ups for salvaged PR #80740
fb435aae9 perf(model): disk-cache custom-provider /v1/models probes
83bad5cdd fix: follow-ups for salvaged PR #80795
2d0c2682c docs: document the gateway agent cache memory budget
6bbe55dd0 fix(gateway): bound the agent cache by memory, not just count and age
5ded99af4 chore: add prashantjain25 to AUTHOR_MAP
48e2dcd7a fmt(js): `npm run fix` on merge (#81102)
a4b235c4b fix(desktop): virtualize git file-tree to cap DOM nodes (#77257)
4a3942d94 fix: show explicit member spend cap message instead of 'no credits'
813793db2 test(tui_gateway): pin the raising-close swallow + no-retry contract
be14a4bee tui_gateway: close dedicated profile SessionDB handles at teardown too
79625e3c0 tui_gateway: session.resume abandons the profile SessionDB it opens
fecba5afc refactor(agent): fold simplify findings — DB picker parity, single scan, canonical strip delegation
4eabb595f fix(agent): finish the #80622 bug class — sibling predicates, refund ordering, prompt carve-out, honest skip response
b9636b104 test(agent): cover reference-only handoff sole-active-turn regression
6d3ff6eda fix(agent): stop reference-only compaction handoff from becoming the active turn
3737bb1ad docs(compression): correct the projection's safety claims (review findings)
6d89b1065 fix(agent): project real usage in preflight defer instead of fixed growth tolerance
e7667e56d docs(stt): honest memory-behavior wording for idle unload
72c63aa58 fix(stt): close idle-unload races — strong model ref, single long-lived watcher
7b006ea6e feat(stt): idle unload for local whisper model
5cff192b3 docs(stt): document the 12s short-clip gate for the cloud trim
3277eb887 refactor(stt): fold review findings into the cloud silence trim
a683ef95d feat(stt): pre-upload silence trim for cloud providers
5c6aff143 fix(desktop): keep the chat in front of the terminal in Focus layout (#81019)
b7eb97a83 fix(vision): stream image and video downloads with chunk-by-chunk size cap
23dce021a perf(fts): drain trash tables with a high-water marker instead of re-scanning
f3ec2f36f perf(slack): parallelize conversations.info lookups with asyncio.gather
025fc7e74 fix(slack): dedupe thread-qualified channel lookups (#80668)
e5e96e8bb fix: harden _await_disconnect_step against outer cancellation + add claim keys
95e78556f test(gateway): cover fatal-handler queue-before-disconnect (#80598)
7141a6dc3 fix(gateway): queue reconnect before fatal disconnect wedges (#80598)
dfa0de92c chore: add contributor email mappings for dombejar + toprakeker
2a0d0bc69 refactor(gateway): drop dead degraded token field; de-churn salvage diff
3a3aed3c1 fix(gateway): keep pending turn lease acquires registered
b3e9e9170 fix(gateway): configure turn lease timeout via yaml
b2b681fef fix(gateway): harden turn-lease timeout rejection
29af112cd fix(gateway): fail closed when session turn lease times out
2ef294f02 docs: spell out the rewind contract on prompt.submit
c24ff38c5 fix(gateway): make a history-dropping submit prove it meant to
bf2e193a0 fix(cron): review follow-ups for the fail-closed cwd-lock timeout
30679b876 test(cron): pin fail-closed TERMINAL_CWD lock timeout behavior
5fcca432f test(cron): cover bounded TERMINAL_CWD lock acquisition
11ce6419c fix(cron): fail closed when the TERMINAL_CWD lock times out (#79768)
69cf06a82 chore: map texasich commit email to GitHub login
458ce7b2b fix(streaming): close the same mid-tool-call drop gap on the Anthropic path
e6f31b07c test(streaming): cover mixed tool-call and retry-exhaustion paths for #80498
f73457803 fix(streaming): flag empty tool-call args on clean stream end (#80498)
72b730526 polish: document newline residual, reuse span local, cheap check first
9377c5a53 fix(redact): narrow control-split join guard to line-crossing spans
afb46fdab refactor(cron): polish registration partial-failure surfaces
f346458f2 fix(cron): surface initial scheduler registration failures
261aef526 perf(cron): stat-stamp fast path for the shrink-merge; no caller-list mutation
5511ec623 test(cron): cover jobs.json shrink-merge against concurrent creates
4d84aa2a6 fix(cron): preserve concurrent creates when saving jobs.json
aecb9ca89 fix(redact): don't join across controls when a fragment already matches
8969ebac1 fix(secrets): redact command in process checkpoint file (#77484)
e9d1551e6 fix(redact): strip control chars from mask_secret display (#55319, #55321)
5444f6853 test(redact): harden new #77484 tests - assert fragments, opaque values (review)
8563fe343 fix(redact): close emission gaps - env suffix keys, control-char splits, process(list) (#77484)
15d7103aa fix: harden .env-read detection — review follow-ups for #61352
cf755f5c4 fix: redact .env terminal output via detection instead of known-env-var list
83902620c chore: map soheil.fakour@gmail.com -> thatssoheil for attribution
1a02e8a79 fix(agent): preserve destroyed tool-call argument bytes in the WARNING log
c18e19c3c fix(agent): make the send-path copy structural — close the write-through class
cd152d9da chore: map ahmetsonersancak@anadolu.edu.tr -> 0xGr1mm for attribution
e60ca1c6c fix(agent): stop the send-path repair from rewriting persisted history
8b6dd27cd test(auxiliary): update _resolve_auto patch to _resolve_auto_route
c95a1b717 fix(auxiliary): widen effective provider to relay, logging, and endpoint detection
293e67328 fix(agent): preserve auto-routed provider identity
a82910c37 test: fold review findings — plain fixture, call-shaped probe guard, public-API row counting
1e5b50744 fix(cron): move watchdog state under the request lock; fail closed on resolver errors
d7fb503c2 docs: note that the non-stream stale budget covers cron and subagents
cb066a971 fix(cron): bound the inline non-streaming call with a stale watchdog
ee6d79648 fix(state): finish the #80216 bug class — archive-preserving rewrites at the two remaining sibling sites
20e01f935 fix(voice): early-exit sliding window on match, clear barge phase in finally, fix test helper
979bf0cc4 fix(voice): require minimum evidence for fragment echo matching, use char windows
b7bff6f2d fix(voice): catch short echoed fragments of longer multi-sentence TTS replies
d4a753ea4 fix(voice): drop playback-phase barge transcripts that echo Hermes' own TTS
6ab7528c3 refactor(matrix): extract _strip_reply_fallback to deduplicate text+media handlers
e8511efe7 fix(matrix): propagate sender + reply context to media MessageEvents too
e245a9878 fix(matrix): propagate sender MXID + reply context to MessageEvent
dacdae014 chore: map contributor cwt@users.noreply.github.com → Wintle
1fe53bd1a docs: comment accuracy — pending-ness is a presumption, not a construction guarantee
03beb662e fix: cover the partial multi-call batch in the in-flight exemption
c4c2265f0 chore: map craig@shotflame.local -> Shotflame in contributor directory
788b8ab49 fix(compress): preserve in-flight tool chain across context compression (#79278)
416d2a015 fix(gateway): re-signal interrupts when work is still live at settle-window exit
d9ddfb23d fix(gateway): interrupt every in-flight API turn on shutdown, not just /v1/runs
51fa7db46 fix(gateway): interrupt api server runs on shutdown timeout
2d9b809ff fix(yuanbao): preserve archived history on recall redaction
30c1421ac fix(gateway): make retry archive preservation fail-safe
56fbac6b3 fix(gateway): preserve archived compaction history on /retry
65de109ef fix: notify_all on lock timeout to wake blocked readers
a1e5ccb32 fix(cron): bound TERMINAL_CWD lock acquire with timeout (#79768)
99237a444 refactor: derive teams install hint via feature_install_command(venv_pip=True)
f5784617e refactor: fold simplify-code review findings
a658dfe50 fix: address self-review findings on the check_fn/ensure_deps_fn split
0d32607c6 fix(gateway): split check_fn (passive probe) from ensure_deps_fn (active installer)
042c309ec docs(teams): native gateway start and Hermes-venv dependency install
98408f713 fix(teams): lazy-install SDK via registry check_fn
a0801b878 fix: bind continuation-marker exclusions to the queried parent (fail-open fix)
95a7058e4 fix(sessions): fence expired orphan recovery leases
988f2baaf fix(sessions): recover compression parents without continuations
71dc211b9 docs(cron): document async manual runs and per-run prompt context
358d55051 fix(plugins): use asyncio.wait_for instead of ClientTimeout in Matrix standalone send
66c60f81b fix(cron): thread per-run prompt through cronjob(action='run') (#57331)
fa9641999 test(cron): add _build_job_prompt extra_prompt regression tests
7a5fe0024 fix(cron): deliver manual runs on gateway loop
3671c9f18 fix: share in-flight cron dedupe between ticker and manual runs
7ab42dda6 fix: dispatch cronjob(action='run') to the background like delegate_task
32e7fb07a feat(/learn): expansive knowledge-base skills for books and large corpora
eb1e63090 fix(skills): align hermes-agent-skill-authoring with hardline authoring standards
bdee48928 fix(dashboard): derive the stale-schema read probe from SCHEMA_SQL
fc05247be fix: preserve session history when a turn crashes
6f1072c83 fix(desktop): drop the gateway-pill dogfood plugin
a5cddcd8d fix(desktop): render already-glued reasoning as separate blocks
6bb630ef7 fix(codex): split reasoning summary parts on summary_index
0f8366180 fix(reasoning): keep gpt-5.x summary parts as separate blocks on the chat wire
eb8421ba9 fmt(js): `npm run fix` on merge (#80725)
45f23205d fix(desktop): show every pinned session, however many there are
0265797b8 fix(desktop): keep elapsed status text from overlapping
75717d29e feat(desktop): stop hiding a session behind Show earlier
31459ef0c feat(desktop): price a turn by what it paints
7eb461d69 refactor(desktop): share how a tool row renders
03b759db8 fix(desktop): rank dragged sessions inside their date group
256aac54d fix(desktop): show a pinned session once, and keep its drag order
daeedf67c fix(desktop): hold the pin write guard until a page confirms it
fd9fc50dd fix(desktop): stop dropping pinned sessions past the page limit
cef7d1a1e fix(api): persist session pins instead of 400ing them
226b095a5 Fireworks user agent (#80422)
f88f6f8e6 docs(reference): document the desktop_ui toolset
ac745a0b0 docs(agents): surface capability belongs to the session, not the process env
7ad9ace2c fix(agent): the desktop's tools reach it on remote and cloud backends too
fe3a1cad6 fix: align helper PID check with Python parser + dedupe drain-wait
9d213918e chore: map rjhilgefort@gmail.com -> rjhilgefort in contributor directory
65b7151db fix(launchd): require a supervised PID to call a reload successful
a1e4c905f fix(launchd): stop stranding gateway label on plist reload
