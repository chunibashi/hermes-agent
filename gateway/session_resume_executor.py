"""Executor dedicated to session-resume offloads.

Every ``asyncio.to_thread`` during a resume (lineage reads, display projection,
the banner inventory) runs on the SHARED loop executor, the same pool a
concurrent turn's tool calls occupy. When another session's turn is mid-flight
(a cron job, a second chat, a delegation) its tools can hold every worker for
seconds at a time, so a resume's offloads queue behind them and the client's 30s
RPC timeout fires — the desktop's ``session.resume`` timeouts under cron/parallel
activity. A tiny dedicated pool guarantees resume work its own workers.

Two workers: a resume's serial offload chain never needs more than one at a time,
and the pool must not become a second CPU hog beside the turns it competes with.
"""

from __future__ import annotations

import asyncio
import contextvars
import functools
from concurrent.futures import ThreadPoolExecutor

RESUME_EXECUTOR: ThreadPoolExecutor = ThreadPoolExecutor(
    max_workers=2, thread_name_prefix="resume")


async def resume_offload(fn, *args):
    """Run *fn* on the resume-dedicated executor, off the shared asyncio pool.

    Carries the caller's contextvars across the hop exactly like ``asyncio.to_thread``
    does: a resume runs under the owner profile's scope (home, secret scope, terminal
    scope), and the banner inventory's ``check_fn`` probes read their credentials
    through it. Dropping the context here would make every probe answer from the
    launch profile's ``.env`` instead of the served profile's.
    """
    loop = asyncio.get_running_loop()
    ctx = contextvars.copy_context()
    return await loop.run_in_executor(RESUME_EXECUTOR, functools.partial(ctx.run, fn, *args))