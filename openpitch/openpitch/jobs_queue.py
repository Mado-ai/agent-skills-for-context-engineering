"""Job queue abstraction.

* ``thread`` (default) — runs the analysis in an in-process daemon thread.
  Zero infra; fine for a single instance / dev.
* ``rq`` — enqueues onto Redis (``PLAYMETRICS_QUEUE=rq``, ``REDIS_URL``) for a
  separate worker pool. Run workers with:

      rq worker -u $REDIS_URL playmetrics

  Put workers on GPU nodes (and use ``detector=yolo``) for accelerated runs.

Both backends invoke the same :func:`openpitch.tasks.run_job`.
"""

from __future__ import annotations

import os
import threading

from . import tasks

_QUEUE_NAME = "playmetrics"


def enqueue(job_id: str, input_path: str, detector: str) -> None:
    backend = os.environ.get("PLAYMETRICS_QUEUE", "thread").lower()
    if backend == "rq":
        from redis import Redis  # noqa: PLC0415 (optional dependency)
        from rq import Queue  # noqa: PLC0415

        conn = Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
        Queue(_QUEUE_NAME, connection=conn).enqueue(
            "openpitch.tasks.run_job", job_id, str(input_path), detector,
            job_timeout=3600,
        )
    else:
        threading.Thread(
            target=tasks.run_job, args=(job_id, str(input_path), detector), daemon=True
        ).start()
