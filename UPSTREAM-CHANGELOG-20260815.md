# Upstream Changelog 2026-08-15

Merged 198 upstream commits from origin/main (HEAD..origin/main).

## Highlights

### feat (24)
- `/loop` recurring in-session wakeups (Claude Code parity)
- Desktop: "Open in terminal" session menu item; sender-side delivery notices; agent-to-agent message cards; sidebar data-attributes for custom skinning
- Gateway: wedged worker stack dump on turn reaper; roster previews show latest message; concise background process notifications
- Dashboard: RFC 8252 native sign-in for password providers; disk-pressure banner; memory-pressure / OOM-restart surfacing
- Skills: bundled Box productivity skill
- Models: unified selection-time guards; data-training tier warnings

### fix (120, selected)
- Sessions: cross-process turn lease hardening (refresh, boundary scoping, lease fence, revive uncontested)
- TUI: status bar flicker reduction; Zellij synchronized output handling; BSU/ESU capability gating
- Desktop: ARM64 get-windows tolerance; high-DPI focus fix
- file_tools: refuse plain-text writes that corrupt binary documents
- Gateway: profile HERMES_HOME override bindings; platforms-list config tolerance

### perf (4)
- croniter cache + lock-free precompute
- Image attach chip preview byte reuse

### test (15)
- Session turn lease, sequential tool timeout, /loop command, etc.

### other
- 17 chore, 4 fmt, 4 ci, 3 docs, 2 style, 2 refactor

Local ahead: 72 commits preserved (QQBot ACL/prefix fixes, model favorites,
local dep overrides, changelogs). Backup branch: backup-before-merge.