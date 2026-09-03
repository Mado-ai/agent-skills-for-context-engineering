"""Catalog loading, overlay merging, and the validation that guards both."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from agent_reach.registry import (
    RegistryError,
    load_document,
    load_registry,
    merge_documents,
)


def write(directory: Path, name: str, document: dict) -> Path:
    path = directory / name
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


class BundledCatalogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = load_registry(use_overlay=False)

    def test_bundled_catalog_loads(self) -> None:
        self.assertGreater(len(self.registry.providers), 0)
        self.assertTrue(all(p.id and p.command.exec for p in self.registry.providers))

    def test_capability_lookup_is_sorted_by_stability(self) -> None:
        found = self.registry.by_capability("search")
        self.assertTrue(found)
        scores = [p.stability for p in found]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_every_profile_is_satisfiable_by_the_catalog(self) -> None:
        for name, capabilities in self.registry.profiles.items():
            for capability in capabilities:
                with self.subTest(profile=name, capability=capability):
                    self.assertTrue(self.registry.by_capability(capability))

    def test_unknown_provider_lists_known_ids(self) -> None:
        with self.assertRaises(RegistryError) as ctx:
            self.registry.get("nope")
        self.assertIn("fetch", str(ctx.exception))

    def test_unknown_profile_raises(self) -> None:
        with self.assertRaises(RegistryError):
            self.registry.profile("does-not-exist")

    def test_keyless_providers_have_no_required_keys(self) -> None:
        fetch = self.registry.get("fetch")
        self.assertEqual(fetch.required_keys, ())


class MergeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.base = {
            "schema_version": 1,
            "revision": "base",
            "profiles": {"standard": ["search"]},
            "providers": [
                {"id": "a", "name": "A", "capabilities": ["search"], "command": {"exec": "a"}},
                {"id": "b", "name": "B", "capabilities": ["fetch"], "command": {"exec": "b"}},
            ],
        }

    def test_overlay_patches_a_single_field(self) -> None:
        merged = merge_documents(self.base, {"providers": [{"id": "a", "stability": 99}]})
        entry = next(p for p in merged["providers"] if p["id"] == "a")
        self.assertEqual(entry["stability"], 99)
        self.assertEqual(entry["name"], "A")  # untouched fields survive

    def test_overlay_adds_and_removes_providers(self) -> None:
        merged = merge_documents(
            self.base,
            {
                "providers": [
                    {"id": "b", "removed": True},
                    {"id": "c", "name": "C", "capabilities": ["docs"], "command": {"exec": "c"}},
                ]
            },
        )
        ids = [p["id"] for p in merged["providers"]]
        self.assertEqual(ids, ["a", "c"])

    def test_overlay_merges_profiles_without_dropping_base_ones(self) -> None:
        merged = merge_documents(self.base, {"profiles": {"extra": ["docs"]}})
        self.assertEqual(set(merged["profiles"]), {"standard", "extra"})

    def test_overlay_entry_without_id_is_rejected(self) -> None:
        with self.assertRaises(RegistryError):
            merge_documents(self.base, {"providers": [{"name": "no id"}]})

    def test_removed_flag_is_not_written_into_the_merged_entry(self) -> None:
        merged = merge_documents(self.base, {"providers": [{"id": "a", "stability": 5}]})
        entry = next(p for p in merged["providers"] if p["id"] == "a")
        self.assertNotIn("removed", entry)


class OverlayLoadingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())

    def test_overlay_is_applied_over_the_bundled_catalog(self) -> None:
        overlay = write(
            self.tmp,
            "registry.json",
            {
                "schema_version": 1,
                "revision": "later",
                "providers": [{"id": "fetch", "stability": 1}],
            },
        )
        registry = load_registry(overlay=overlay)
        self.assertEqual(registry.revision, "later")
        self.assertEqual(registry.get("fetch").stability, 1)
        self.assertEqual(len(registry.sources), 2)

    def test_missing_overlay_is_not_an_error(self) -> None:
        registry = load_registry(overlay=self.tmp / "absent.json")
        self.assertGreater(len(registry.providers), 0)

    def test_future_schema_version_is_refused(self) -> None:
        overlay = write(self.tmp, "future.json", {"schema_version": 2})
        with self.assertRaises(RegistryError) as ctx:
            load_registry(overlay=overlay)
        self.assertIn("schema_version", str(ctx.exception))

    def test_unknown_capability_is_refused(self) -> None:
        overlay = write(
            self.tmp,
            "bad.json",
            {
                "schema_version": 1,
                "providers": [
                    {
                        "id": "x",
                        "name": "X",
                        "capabilities": ["telepathy"],
                        "command": {"exec": "x"},
                    }
                ],
            },
        )
        with self.assertRaises(RegistryError):
            load_registry(overlay=overlay)

    def test_malformed_json_is_reported_with_the_path(self) -> None:
        path = self.tmp / "broken.json"
        path.write_text("{not json", encoding="utf-8")
        with self.assertRaises(RegistryError) as ctx:
            load_document(path)
        self.assertIn("broken.json", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
