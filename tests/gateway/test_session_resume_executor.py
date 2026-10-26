"""Regression: session resume offloads run on a dedicated executor, not the shared asyncio pool.

A resume's lineage read and display projection are ``asyncio.to_thread`` offloads.
On the shared pool they queue behind any concurrent turn's tool calls — a cron job,
a second chat, a delegation — so when another session is mid-flight the desktop's
``session.resume`` exceeds its 30s RPC timeout. ``gateway/session_resume_executor``
gives resume work its own two workers, and must carry the caller's contextvars
(profile home, secret scope, terminal scope) across the hop exactly like
``asyncio.to_thread`` does, or the banner's ``check_fn`` probes would answer from
the launch profile's ``.env``.
"""

import asyncio
import contextvars

from gateway.session_resume_executor import RESUME_EXECUTOR, resume_offload


def test_resume_offload_carries_contextvars():
    """The served profile's scope (a contextvar) must reach the worker thread."""
    cv = contextvars.ContextVar("probe", default="MISSING")
    cv.set("served-profile")

    async def main():
        def read_cv():
            return cv.get()

        return await resume_offload(read_cv)

    assert asyncio.run(main()) == "served-profile"


def test_resume_offload_targets_the_dedicated_executor():
    """resume_offload must submit to RESUME_EXECUTOR — never the loop's default (shared) pool."""
    async def main():
        loop = asyncio.get_running_loop()
        original = loop.run_in_executor
        used = []

        async def spy(executor, fn, *args):
            used.append(executor)
            return await original(executor, fn, *args)

        loop.run_in_executor = spy
        try:
            result = await resume_offload(lambda: "resume-done")
        finally:
            loop.run_in_executor = original
        assert result == "resume-done"
        assert used == [RESUME_EXECUTOR], "resume_offload must use the dedicated pool"

    asyncio.run(main())


def test_resume_executor_is_not_the_loop_default():
    """The module owns a small dedicated pool; it must never be the loop's default executor."""
    import asyncio

    async def main():
        loop = asyncio.get_running_loop()
        default = loop._default_executor
        assert RESUME_EXECUTOR is not default
        assert RESUME_EXECUTOR._max_workers == 2

    asyncio.run(main())