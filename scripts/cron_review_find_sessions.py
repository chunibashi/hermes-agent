#!/usr/bin/env python3
"""
cron-review Phase 1+2 script: find new (and revisited) sessions since last run,
deduplicate, select the most substantive ones, and compute session-learn triggers.

Two modes:
  - NEW sessions: started_at > marker_ts (brand new conversations)
  - REVISITED sessions: started_at <= marker_ts AND last_activity_at > marker_ts
    (old sessions that got new messages; only new messages are counted)

Output: JSON with selected sessions + trigger flags for session-learn audit.
Usage: python cron_review_find_sessions.py
"""
import json
import random
import re
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

MARKER_PATH = Path("D:/denia/wiki/memory/cron-review-last-session.json")
STATE_DB_PATH = Path.home() / "AppData" / "Local" / "hermes" / "state.db"
FALLBACK_HOURS = 24

# session-learn trigger thresholds
MIN_TOOL_CALLS_SKILL = 10
MIN_CONSECUTIVE_FAILURES = 3
MIN_REPEATED_ERRORS = 2


def load_marker(path: Path) -> dict:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    raw = data.get("last_created_at", 0)
    if isinstance(raw, str):
        # Parse ISO format (e.g., "2026-08-26T02:33:00+09:00")
        try:
            from datetime import datetime
            # Remove timezone suffix for fromisoformat compatibility
            clean = raw.replace("+09:00", "").replace("+00:00", "").replace("Z", "")
            data["last_created_at"] = datetime.fromisoformat(clean).timestamp()
        except (ValueError, AttributeError):
            data["last_created_at"] = 0
    return data


def get_first_user_message(conn: sqlite3.Connection, session_id: str) -> str:
    cur = conn.cursor()
    cur.execute(
        "SELECT content FROM messages WHERE session_id=? AND role='user' ORDER BY timestamp ASC LIMIT 1",
        (session_id,),
    )
    row = cur.fetchone()
    return (row[0] or "")[:300] if row else ""


def count_new_messages(conn: sqlite3.Connection, session_id: str, since_ts: float) -> int:
    """Count messages added after since_ts in an existing session."""
    cur = conn.cursor()
    cur.execute(
        "SELECT COUNT(*) FROM messages WHERE session_id=? AND timestamp > ?",
        (session_id, since_ts),
    )
    return cur.fetchone()[0]


def get_session_messages(conn: sqlite3.Connection, session_id: str) -> list[dict]:
    """Get all messages for a session, ordered by timestamp."""
    cur = conn.cursor()
    cur.execute(
        """SELECT role, content, tool_calls, tool_name, finish_reason, timestamp, compacted
           FROM messages WHERE session_id=? ORDER BY timestamp ASC""",
        (session_id,),
    )
    messages = []
    for row in cur.fetchall():
        role, content, tool_calls, tool_name, finish_reason, ts, compacted = row
        messages.append({
            "role": role,
            "content": (content or "")[:500],
            "tool_calls": tool_calls,
            "tool_name": tool_name,
            "finish_reason": finish_reason,
            "timestamp": ts,
            "compacted": compacted,
        })
    return messages


def compute_triggers(messages: list[dict]) -> dict:
    """
    Compute session-learn creation triggers for a session.
    Returns trigger flags + evidence for agent audit.
    """
    triggers = {
        "tool_calls_total": 0,
        "tool_calls_by_name": {},
        "consecutive_failures_max": 0,
        "error_signatures": [],
        "user_corrections": 0,
        "has_skill_invocation": False,
        "triggered": False,
        "trigger_reasons": [],
    }

    consecutive_failures = 0
    error_patterns = {}

    for msg in messages:
        # Tool calls from assistant messages
        if msg["role"] == "assistant" and msg["tool_calls"]:
            try:
                calls = json.loads(msg["tool_calls"]) if isinstance(msg["tool_calls"], str) else msg["tool_calls"]
                if isinstance(calls, list):
                    triggers["tool_calls_total"] += len(calls)
                    for call in calls:
                        name = call.get("function", {}).get("name", "unknown")
                        triggers["tool_calls_by_name"][name] = triggers["tool_calls_by_name"].get(name, 0) + 1
            except (json.JSONDecodeError, TypeError):
                triggers["tool_calls_total"] += 1

        # Detect failures
        if msg["finish_reason"] == "error":
            consecutive_failures += 1
            triggers["consecutive_failures_max"] = max(triggers["consecutive_failures_max"], consecutive_failures)
        elif msg["role"] == "tool":
            content_lower = msg["content"].lower()
            if any(kw in content_lower for kw in ["error", "failed", "traceback", "exception", "errno"]):
                consecutive_failures += 1
                triggers["consecutive_failures_max"] = max(triggers["consecutive_failures_max"], consecutive_failures)
                sig = _extract_error_signature(msg["content"])
                if sig:
                    error_patterns[sig] = error_patterns.get(sig, 0) + 1
            else:
                consecutive_failures = 0
        else:
            consecutive_failures = 0

        # Detect user corrections
        if msg["role"] == "user" and _is_user_correction(msg["content"]):
            triggers["user_corrections"] += 1

        # Check for skill invocation
        if msg["role"] == "user" and "skill" in msg["content"].lower():
            triggers["has_skill_invocation"] = True

    # Repeated errors
    repeated_errors = {sig: count for sig, count in error_patterns.items() if count >= MIN_REPEATED_ERRORS}
    triggers["error_signatures"] = [{"signature": sig, "count": count} for sig, count in repeated_errors.items()]

    # Evaluate triggers
    if triggers["tool_calls_total"] >= MIN_TOOL_CALLS_SKILL:
        triggers["trigger_reasons"].append(f"tool_calls>={MIN_TOOL_CALLS_SKILL} ({triggers['tool_calls_total']})")
    if triggers["consecutive_failures_max"] >= MIN_CONSECUTIVE_FAILURES:
        triggers["trigger_reasons"].append(f"consecutive_failures>={MIN_CONSECUTIVE_FAILURES} ({triggers['consecutive_failures_max']})")
    if triggers["error_signatures"]:
        triggers["trigger_reasons"].append(f"repeated_errors ({len(triggers['error_signatures'])} signatures)")
    if triggers["user_corrections"] > 0:
        triggers["trigger_reasons"].append(f"user_corrections ({triggers['user_corrections']})")

    triggers["triggered"] = len(triggers["trigger_reasons"]) > 0
    return triggers


def _extract_error_signature(content: str) -> str:
    """Extract a short error signature from tool output."""
    patterns = [
        r'Error:\s*([^\n]{10,80})',
        r'([A-Z][a-zA-Z]*Error):\s*([^\n]{10,80})',
        r'errno\s+(\d+)',
        r'ERROR_([A-Z_]+)',
        r'([A-Z][a-zA-Z]*Exception):\s*([^\n]{10,80})',
    ]
    for pat in patterns:
        m = re.search(pat, content)
        if m:
            return m.group(0)[:80]
    return ""


def _is_user_correction(content: str) -> bool:
    """Detect if a user message is correcting the agent."""
    correction_markers = [
        "不对", "不是", "错了", "不要", "别用", "应该是", "其实是",
        "not correct", "wrong", "don't use", "should be", "actually",
        "不是这样", "换个方式", "重新", "重来", "instead", "actually it's",
        "no,", "that's not", "incorrect", "try again",
    ]
    content_lower = content.lower()
    return any(marker in content_lower for marker in correction_markers)


def find_sessions(conn: sqlite3.Connection, since_ts: float) -> list[dict]:
    """
    Find two kinds of sessions:
    1. Brand new: started_at > since_ts
    2. Revisited: started_at <= since_ts AND last_activity_at > since_ts
    """
    cur = conn.cursor()

    # NEW sessions (started after marker)
    cur.execute(
        """
        SELECT id, title, started_at, ended_at, input_tokens, output_tokens,
               message_count, parent_session_id, last_activity_at
        FROM sessions
        WHERE started_at > ?
          AND archived = 0
          AND "hidden" = 0
        ORDER BY started_at ASC
        """,
        (since_ts,),
    )

    sessions = []
    for row in cur.fetchall():
        sid, title, started, ended, in_tok, out_tok, msg_count, parent, last_activity = row
        duration = (ended or started) - started
        total_tokens = (in_tok or 0) + (out_tok or 0)
        sessions.append({
            "id": sid,
            "title": title or "",
            "started_at": started,
            "ended_at": ended,
            "last_activity_at": last_activity,
            "duration": duration,
            "tokens": total_tokens,
            "message_count": msg_count or 0,
            "parent_session_id": parent,
            "first_message": get_first_user_message(conn, sid),
            "is_revisit": False,
            "new_messages": 0,
        })

    # REVISITED sessions (created before marker, but had activity after marker)
    cur.execute(
        """
        SELECT id, title, started_at, ended_at, input_tokens, output_tokens,
               message_count, parent_session_id, last_activity_at
        FROM sessions
        WHERE started_at <= ?
          AND last_activity_at > ?
          AND archived = 0
          AND "hidden" = 0
        ORDER BY last_activity_at ASC
        """,
        (since_ts, since_ts),
    )
    for row in cur.fetchall():
        sid, title, started, ended, in_tok, out_tok, msg_count, parent, last_activity = row
        # Skip if already added as a new session
        if any(s["id"] == sid for s in sessions):
            continue
        duration = (ended or started) - started
        total_tokens = (in_tok or 0) + (out_tok or 0)
        new_msgs = count_new_messages(conn, sid, since_ts)
        sessions.append({
            "id": sid,
            "title": title or "",
            "started_at": started,
            "ended_at": ended,
            "last_activity_at": last_activity,
            "duration": duration,
            "tokens": total_tokens,
            "message_count": msg_count or 0,
            "parent_session_id": parent,
            "first_message": get_first_user_message(conn, sid),
            "is_revisit": True,
            "new_messages": new_msgs,
        })

    return sessions


def group_similar(sessions: list[dict]) -> list[list[dict]]:
    """Group sessions that are near-identical: same title or same first message."""
    groups: list[list[dict]] = []
    for s in sessions:
        placed = False
        for group in groups:
            ref = group[0]
            # Same title (non-empty)
            if s["title"] and s["title"] == ref["title"]:
                group.append(s)
                placed = True
                break
            # Same first message (non-empty, >20 chars to avoid false positives)
            if (s["first_message"] and len(s["first_message"]) > 20
                    and s["first_message"] == ref["first_message"]):
                group.append(s)
                placed = True
                break
            # Parent-child relationship
            if (s["parent_session_id"] and s["parent_session_id"] == ref["id"]) or \
               (ref["parent_session_id"] and ref["parent_session_id"] == s["id"]):
                group.append(s)
                placed = True
                break
        if not placed:
            groups.append([s])
    return groups


def select_from_group(group: list[dict]) -> list[dict]:
    """Select: longest duration, most tokens, 1-3 random."""
    if len(group) <= 3:
        return group

    selected = []
    longest = max(group, key=lambda s: s["duration"])
    selected.append(longest)
    most_tokens = max(group, key=lambda s: s["tokens"])
    if most_tokens["id"] != longest["id"]:
        selected.append(most_tokens)
    remaining = [s for s in group if s["id"] not in {x["id"] for x in selected}]
    random_count = min(random.randint(1, 3), len(remaining))
    if remaining:
        selected.extend(random.sample(remaining, random_count))
    return selected


def main():
    marker = load_marker(MARKER_PATH)
    last_ts = marker.get("last_created_at", 0)

    if not last_ts:
        last_ts = (datetime.now() - timedelta(hours=FALLBACK_HOURS)).timestamp()

    conn = sqlite3.connect(str(STATE_DB_PATH))
    sessions = find_sessions(conn, last_ts)

    if not sessions:
        print(json.dumps({"sessions": [], "total_found": 0, "groups": 0, "selected": 0,
                          "triggered_count": 0, "revisit_count": 0}))
        conn.close()
        return

    groups = group_similar(sessions)
    selected = []
    for group in groups:
        selected.extend(select_from_group(group))

    # Compute triggers for each selected session
    for s in selected:
        messages = get_session_messages(conn, s["id"])
        triggers = compute_triggers(messages)
        s["triggers"] = triggers

    conn.close()

    selected.sort(key=lambda s: s["started_at"])

    triggered_count = sum(1 for s in selected if s["triggers"]["triggered"])
    revisit_count = sum(1 for s in selected if s["is_revisit"])

    result = {
        "sessions": selected,
        "total_found": len(sessions),
        "groups": len(groups),
        "selected": len(selected),
        "triggered_count": triggered_count,
        "revisit_count": revisit_count,
        "since_ts": last_ts,
        "since_iso": datetime.fromtimestamp(last_ts).isoformat(),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()