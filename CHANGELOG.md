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
