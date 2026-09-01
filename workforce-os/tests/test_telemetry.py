"""Acceptance: H5 — cost and latency telemetry, plus the scheduler/bus abstraction."""

from base import RuntimeTestCase


class TestTelemetry(RuntimeTestCase):
    def setUp(self):
        super().setUp()
        self.agent = self.make_agent(name="Metered", tools=("echo", "summarize"),
                                     domains=("public",), actions=("read", "analyze"))
        self.task = self.make_task(assignee=self.agent["id"])

    def test_metrics_aggregate(self):
        """H5: every call is metered, and the aggregates reconcile with the samples."""
        for i in range(3):
            self.rt.gateway.call(agent_id=self.agent["id"], tool_name="echo",
                                 arguments={"message": f"m{i}"}, task_id=self.task["id"])

        summary = self.rt.telemetry.summary(project_id=self.project_id)
        latency = next(m for m in summary["by_metric"] if m["metric"] == "latency_ms")
        self.assertEqual(latency["samples"], 3)
        self.assertGreater(summary["totals"]["latency_ms"], 0.0)
        self.assertEqual(summary["totals"]["cost_usd"], 0.0)

        # Scoping narrows correctly.
        by_task = self.rt.telemetry.summary(task_id=self.task["id"])
        self.assertEqual(
            next(m for m in by_task["by_metric"] if m["metric"] == "latency_ms")["samples"], 3)
        self.assertEqual(self.rt.telemetry.summary(agent_id="agt_nobody")["by_metric"], [])

    def test_tokens_are_metered(self):
        self.rt.gateway.call(agent_id=self.agent["id"], tool_name="summarize",
                             arguments={"text": "One. Two. Three. Four."},
                             task_id=self.task["id"])
        self.assertGreater(self.rt.telemetry.summary(project_id=self.project_id)["totals"]["tokens"], 0)

    def test_provider_is_offline_and_deterministic(self):
        """I4: the local adapter runs with no network and returns identical output."""
        self.assertTrue(self.rt.config.offline)
        self.assertTrue(self.rt.provider.describe()["offline"])
        first = self.rt.provider.complete(system_prompt="You are a test agent.",
                                          messages=[{"role": "user", "content": "hello"}],
                                          model="local-echo")
        second = self.rt.provider.complete(system_prompt="You are a test agent.",
                                           messages=[{"role": "user", "content": "hello"}],
                                           model="local-echo")
        self.assertEqual(first.text, second.text)
        self.assertTrue(first.confirmed)
        self.assertGreater(first.total_tokens, 0)


class TestBusAndScheduler(RuntimeTestCase):
    def test_subscribers_receive_published_events(self):
        received = []
        unsubscribe = self.rt.bus.subscribe("demo.event", received.append)
        self.rt.bus.publish("demo.event", actor_type="system", actor_id="test",
                            project_id=self.project_id, payload={"n": 1})
        self.assertEqual(len(received), 1)
        self.assertEqual(received[0]["payload"], {"n": 1})

        unsubscribe()
        self.rt.bus.publish("demo.event", actor_type="system", actor_id="test",
                            project_id=self.project_id, payload={"n": 2})
        self.assertEqual(len(received), 1, "unsubscribed handlers stop receiving")

    def test_publish_persists_even_when_a_subscriber_fails(self):
        def broken(_event):
            raise RuntimeError("subscriber blew up")

        self.rt.bus.subscribe("demo.fragile", broken)
        event = self.rt.bus.publish("demo.fragile", actor_type="system", actor_id="test",
                                    project_id=self.project_id, payload={})
        self.assertIn("subscriber_errors", event)
        self.assertEqual(len(self.rt.events.list(event_type="demo.fragile")), 1)
        self.rt.events.verify_chain()

    def test_due_jobs_are_claimed_exactly_once(self):
        job = self.rt.scheduler.schedule(kind="review_sweep", delay_seconds=0,
                                         project_id=self.project_id, payload={"scope": "all"})
        first = self.rt.scheduler.claim_due(worker_id="worker-a")
        second = self.rt.scheduler.claim_due(worker_id="worker-b")

        self.assertEqual([j["id"] for j in first], [job["id"]])
        self.assertEqual(second, [], "a claimed job must not be handed out twice")
        self.assertEqual(first[0]["payload"], {"scope": "all"})

        done = self.rt.scheduler.complete(job["id"])
        self.assertEqual(done["status"], "done")

    def test_future_jobs_are_not_claimed_early(self):
        self.rt.scheduler.schedule(kind="later", delay_seconds=3600, project_id=self.project_id)
        self.assertEqual(self.rt.scheduler.claim_due(worker_id="w"), [])
        self.assertEqual(len(self.rt.scheduler.pending(project_id=self.project_id)), 1)

    def test_failed_job_records_its_error(self):
        job = self.rt.scheduler.schedule(kind="flaky", delay_seconds=0, project_id=self.project_id)
        self.rt.scheduler.claim_due(worker_id="w")
        failed = self.rt.scheduler.complete(job["id"], error="downstream timeout")
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["last_error"], "downstream timeout")
