"""Provider selection: coverage, ranking, forcing, and honest gaps."""

from __future__ import annotations

import unittest

from agent_reach.registry import Registry, _provider
from agent_reach.selection import build_plan

# A fixed miniature catalog: selection behavior must not shift when the real
# catalog is re-tuned.
CATALOG = Registry(
    revision="test",
    providers=tuple(
        _provider(p)
        for p in [
            {
                "id": "strong-search",
                "name": "Strong Search",
                "capabilities": ["search", "extract"],
                "runtime": "python",
                "command": {"exec": "uvx", "args": ["strong"]},
                "keys": [{"env": "STRONG_KEY", "required": True, "signup": "https://strong.example"}],
                "stability": 95,
            },
            {
                "id": "weak-both",
                "name": "Weak Both",
                "capabilities": ["search", "fetch"],
                "runtime": "python",
                "command": {"exec": "uvx", "args": ["weak"]},
                "stability": 70,
            },
            {
                "id": "good-fetch",
                "name": "Good Fetch",
                "capabilities": ["fetch"],
                "runtime": "python",
                "command": {"exec": "uvx", "args": ["fetchy"]},
                "stability": 90,
            },
            {
                "id": "peer-fetch",
                "name": "Peer Fetch",
                "capabilities": ["fetch", "docs"],
                "runtime": "python",
                "command": {"exec": "uvx", "args": ["peer"]},
                "stability": 92,
            },
            {
                "id": "needs-node",
                "name": "Needs Missing Runtime",
                "capabilities": ["browse"],
                "runtime": "node",
                "command": {"exec": "definitely-not-installed-xyz", "args": []},
                "stability": 99,
            },
        ]
    ),
    profiles={"standard": ("search", "fetch"), "wide": ("search", "fetch", "docs")},
    default_profile="standard",
)

NO_KEYS: dict[str, str] = {}
WITH_KEY = {"STRONG_KEY": "secret"}


class SelectionTests(unittest.TestCase):
    def test_without_a_key_the_keyless_provider_wins(self) -> None:
        plan = build_plan(CATALOG, env=NO_KEYS)
        self.assertIn("weak-both", plan.provider_ids)
        self.assertNotIn("strong-search", plan.provider_ids)
        self.assertTrue(plan.complete)

    def test_a_large_stability_gap_beats_consolidation(self) -> None:
        # strong-search covers only `search`, so a second server is needed for
        # `fetch` — that is the right trade at a 25-point stability gap.
        plan = build_plan(CATALOG, env=WITH_KEY)
        self.assertIn("strong-search", plan.provider_ids)
        self.assertNotIn("weak-both", plan.provider_ids)
        self.assertEqual(plan.coverage["search"], "strong-search")

    def test_within_a_stability_band_the_broader_provider_wins(self) -> None:
        # good-fetch (90) and peer-fetch (92) are in the same band; peer-fetch
        # also closes `docs`, so it should be preferred.
        plan = build_plan(CATALOG, capabilities=("fetch", "docs"), env=NO_KEYS)
        self.assertIn("peer-fetch", plan.provider_ids)
        self.assertNotIn("good-fetch", plan.provider_ids)

    def test_every_requested_capability_is_covered_or_reported(self) -> None:
        plan = build_plan(CATALOG, capabilities=("search", "fetch", "browse"), env=NO_KEYS)
        covered = set(plan.coverage) | {g.capability for g in plan.gaps}
        self.assertEqual(covered, {"search", "fetch", "browse"})

    def test_a_gap_names_the_blocked_provider_and_the_remedy(self) -> None:
        plan = build_plan(CATALOG, capabilities=("browse",), env=NO_KEYS)
        self.assertFalse(plan.complete)
        gap = plan.gaps[0]
        self.assertEqual(gap.capability, "browse")
        self.assertIn("not on PATH", gap.reason)

    def test_a_missing_key_gap_points_at_the_signup_url(self) -> None:
        catalog = Registry(
            revision="t",
            providers=(CATALOG.get("strong-search"),),
            profiles={},
            default_profile="standard",
        )
        plan = build_plan(catalog, capabilities=("search",), env=NO_KEYS)
        self.assertIn("STRONG_KEY", plan.gaps[0].remedy)
        self.assertIn("https://strong.example", plan.gaps[0].remedy)

    def test_blocked_candidates_are_reported_even_when_another_wins(self) -> None:
        plan = build_plan(CATALOG, env=NO_KEYS)
        rejected = {r.provider.id: r.reason for r in plan.rejected}
        self.assertIn("strong-search", rejected)
        self.assertIn("STRONG_KEY", rejected["strong-search"])

    def test_allow_blocked_selects_a_provider_whose_key_is_missing(self) -> None:
        plan = build_plan(CATALOG, capabilities=("search",), env=NO_KEYS, allow_blocked=True)
        self.assertEqual(plan.coverage["search"], "strong-search")

    def test_include_forces_a_provider_in(self) -> None:
        plan = build_plan(CATALOG, env=NO_KEYS, include=("good-fetch",))
        self.assertIn("good-fetch", plan.provider_ids)

    def test_exclude_removes_a_provider_from_consideration(self) -> None:
        plan = build_plan(CATALOG, env=NO_KEYS, exclude=("weak-both",))
        self.assertNotIn("weak-both", plan.provider_ids)

    def test_include_and_exclude_conflict_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            build_plan(CATALOG, env=NO_KEYS, include=("weak-both",), exclude=("weak-both",))

    def test_no_provider_is_selected_twice(self) -> None:
        plan = build_plan(CATALOG, profile="wide", env=NO_KEYS, include=("peer-fetch",))
        self.assertEqual(len(plan.provider_ids), len(set(plan.provider_ids)))

    def test_a_forced_provider_satisfies_coverage_without_a_second_server(self) -> None:
        plan = build_plan(CATALOG, capabilities=("fetch",), env=NO_KEYS, include=("weak-both",))
        self.assertEqual(plan.provider_ids, ("weak-both",))

    def test_rejections_never_include_a_selected_provider(self) -> None:
        plan = build_plan(CATALOG, profile="wide", env=WITH_KEY)
        self.assertFalse(set(r.provider.id for r in plan.rejected) & set(plan.provider_ids))


if __name__ == "__main__":
    unittest.main()
