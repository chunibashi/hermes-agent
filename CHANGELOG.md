# Changelog — 2026-08-08

Upstream merge: 226 commits from NousResearch/hermes-agent.

### 🌟 Highlights

- **Terminal 隔离加固** — 本地后台执行器放入独立 systemd cgroup，scope 回退/内存上限/退出码校验，Windows 安全进程组销毁
- **Gateway 会话韧性** — 活动 turn 标记失败原子化，非正常退出后精确恢复 turn，消除歧义恢复清理
- **Desktop 会话恢复** — stale session 掉线后恢复 checkpoint/图片附件/compress/tile 操作，Files 面板 cwd 去同步修复，workspace-cwd 所有权原子切换
- **插件可移植化** — 加载/校验 portable agent 组件，MCP 工具 readOnlyHint 信任分级门控，保留不透明 stdio 命令
- **verify 子系统** — 集成 run-recipe 检测 + 环境清单 + `hermes verify` smoke runner
- **Cron 可观测性** — `usage_audit.jsonl` token 泄漏埋点，`skip_background_review` 标志
- **安全** — protected agent-instruction 文件强制写审批；`prompt.submit` 增加 `confirm_truncate` 防误删历史守卫（#80763）
- **新增能力** — `hermes doctor --live` 真实调用探针；delegate_task 结构化输出 schema；vision_analyze 区域缩放裁剪

## Features

- feat(terminal): isolate local background executors in their own systemd cgroup (#70716)
- feat(terminal): graceful degradation for remote backend connection failures
- feat(gateway): session.workspace.move — re-home a stored session's workspace
- feat(cron): add usage_audit.jsonl logger for cron token leak instrumentation
- feat(cron): set skip_background_review=True; doc title-generation non-presence
- feat(agent): add skip_background_review flag to AIAgent constructor
- feat(plugins): load portable agent components / validate portable agent packages
- feat(plugins): preserve opaque stdio commands
- feat(skills): add document-to-action-items (promoted to bundled tier)
- feat(doctor): add opt-in `hermes doctor --live` real-call backend probes
- feat(delegation): optional structured-output schema on delegate_task
- feat(vision): optional region zoom crop on vision_analyze
- feat(security): protected agent-instruction files always require write approval
- feat(mcp): trust-tier gating for write-capable MCP tools via readOnlyHint
- feat(desktop): move a session to another project from its row menu
- Integrate verify subsystem with the existing verification stack

## Fixes

- fix(gateway): close ambiguous recovery cleanup gaps; make active turn markers failure-atomic; recover exact turns after unclean exits; normalize common repo root separators in git probe
- fix(terminal): harden scope fallback and memory override; align worker limit with local guard; bound isolated worker memory; make systemd cleanup gateway-safe; serialize systemd scope capability probe; fully-qualified .scope unit name, exit-code check (#70716)
- fix(desktop): recover checkpoint restore, tile actions, image/file attach, /compress after a stale session drop; rebind Files pane cwd on switch; workspace-cwd ownership; preserve root recovery through StrictMode replay; stop rendering main checkout as duplicate sidebar lane
- fix(tui_gateway): report a lazy session's own cwd, not the launch dir; refuse unconfirmed truncation (confirm_truncate guard)
- fix(models): corrupt-at cache rows degrade to live fetch in cached_provider_model_ids
- fix(plugins): address portable MCP review feedback; harden portable plugin boundaries
- fix(tools): lazily bring up sandbox for vision_analyze reads
- fix(dashboard): fold one-field doctor category into general tab
- fix: Windows-safe process-group teardown in verify runner
- fix: add Hermes headers to Fireworks provider (#81321)

## Refactor / Chore / Test

- refactor(desktop): one resolver for stale runtime-session recovery
- refactor: match current assistant-ui lookup errors
- test(desktop): cover stale-session recovery bug class; cover Files-pane cwd desync bug class
- test(verify): use valid 2-task batches in schema-rejection tests
- chore(skills/document-to-action-items): tighten to hardline standards, move to optional
- chore(relay): require 0.7.1
- chore: map contributor email
- fmt(js): `npm run fix` on merge (#81259, #81276)

# Changelog — 2026-08-05

Upstream merge: 63 commits from NousResearch/hermes-agent.

## 🌟 Highlights

- **Desktop: multi-tab drag & session re-homing** — shift/opt-click selects tabs to drag together, session move to project via row menu, transcript-window paging, read/unread state, render-weight budget
- **Profile sharing** — /export, /import, REST API, portable bundle (theme, layout, skills, plugins)
- **Desktop plugin SDK expansion** — ctx.os (curated OS door), ctx.notifyNative (native OS notifications)
- **Credential pool hardening** — key rotation clears exhaustion state, sole-credential transient cooldown, full 403 bench, .env edits adopt at turn boundary
- **Observability: relay shared metrics v2** — aggregated bounded tool metrics, model/provider attribution, lifecycle metrics, schema v2
- **Relay stability** — skipped-turn context preservation, LIFO enforcement, concurrent turn scope fix
- **Dev sandbox** — fake installer/main/git clones, proxy/SSH shim, release tag sampling
- **Install E2E tests** — update-from-release pipeline validation

## Features

- feat(dev-sandbox): support fake installer / fake main / git clones (84874c58a)
- feat(desktop): move a session to another project from its row menu (edae3eed1)
- feat(gateway): session.workspace.move — re-home a stored session's workspace (28b3b0dd1)
- feat(desktop): shift-click and opt-click select tabs to drag together (33c1d1f26)
- feat(desktop): the layout tree moves a tab block as one unit (cc8e97499)
- feat(state): sessions carry read/unread state (ec0c8d9c2)
- feat(desktop): share a profile as a portable bundle - theme, layout, skills (6e7eafc7e)
- feat(cli): /export and /import slash commands for profile sharing (bde8c4e10)
- feat(profiles): REST export/import + extra_files overlay hook (d1196750c)
- feat(desktop): ctx.os — the curated OS door for plugins (e8ccb4a2e)
- feat(desktop): Show earlier pages the DOM, then pulls older history from the store (62012a536)
- feat(desktop): expose native OS notifications to plugins via ctx.notifyNative (5d24594ab)
- feat(observability): aggregate bounded tool metrics (8b0c3da8c)
- feat(observability): report model and provider usage (dc4714b1e)

## Bug Fixes

- fix(models): a model id missing its vendor prefix says so instead of 404ing (#78909) (fdc342c08)
- fix(models): a model id missing its vendor prefix says so instead of 404ing (#78856) (43717123c)
- fix(profiles): exported archives open in Finder (GNU tar, not PAX) (1d6606d2c)
- fix(credential-pool): bench a billing 403 fully, even as the sole key (9cd033868)
- fix: thread sole_credential into next_available_at sibling site (d1eb08fcf)
- fix(credential-pool): short cooldown for sole credential on transient throttle (dcd750434)
- fix(debug): say where a client-side log lives instead of "(file not found)" (#78687) (97641a820)
- fix(agent): adopt .env credential/base-url edits at the turn boundary (#67843) (2d70f5632)
- fix(credential-pool): clear exhaustion state on key rotation (#22622) (fe859a1f5)
- fix(desktop): bound the transcript reaching assistant-ui by render cost (#55191) (a538b1c98)
- fix(desktop): ⌘1 / ⌃Tab return to the chat from a full-page view (91337e578)
- fix(model-switch): treat models dict as metadata, not allowlist (f66319097)
- fix(relay): gate skipped task completion (80c7ccf4a)
- fix(relay): preserve skipped turn context (e1caa611b)
- fix(relay): gate skipped turn metrics (a2a08fe14)
- fix(relay): preserve legacy turn shims (704baa5c3)
- fix(relay): avoid concurrent turn scope corruption (9a9b670e2)
- fix(observability): include auxiliary model routes (43d29a37c)
- fix(observability): preserve shared metrics compatibility (dfb8c1bd4)
- fix(observability): harden tool lifecycle metrics (8502e464a)
- fix(observability): derive tool metrics from runtime metadata (4ad78a98f)
- fix(observability): preserve configured model attribution (a0476b360)

## Refactors

- refactor(desktop): share render weight between the two transcript budgets (1ed702be7)

## Tests

- test(install): prove updating from a release reaches this commit (3d9ec4d62)
- test: teach the hand-rolled fake pools the failure_reason kwarg (9712b8f0c)
- test(model-switch): cover Ollama context_length models dict probing (e6977f41b)
- test(relay): enforce LIFO in overlap regression (2e65b0c60)

## CI / Chores

- ci: test updating from sampled release tags, on tag + every 12h (36cb5ae55)
- chore(ci): rerun checks (9ce917f8a)

## Other

- Discord drops an empty outbound message instead of sending it (#78815) (b3e45a3d4)
