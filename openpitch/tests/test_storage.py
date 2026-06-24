"""S3 storage backend (mocked with moto) + local backend basics."""

from __future__ import annotations

import boto3
import pytest
from moto import mock_aws

from openpitch.storage import LocalStorage, S3Storage, _safe_rel


def test_safe_rel_blocks_traversal():
    assert _safe_rel("a/b.mp4") == "a/b.mp4"
    with pytest.raises(ValueError):
        _safe_rel("../../etc/passwd")


def test_local_storage_roundtrip(tmp_path):
    st = LocalStorage(tmp_path)
    d = st.job_dir("job1")
    (d / "broadcast.mp4").write_bytes(b"data")
    st.finalize_job("job1")  # no-op for local
    assert st.local_path("job1", "broadcast.mp4") is not None
    assert st.local_path("job1", "missing.mp4") is None
    with pytest.raises(ValueError):  # traversal rejected
        st.local_path("job1", "../secret")
    st.delete_job("job1")
    assert st.local_path("job1", "broadcast.mp4") is None


@mock_aws
def test_s3_storage_upload_serve_delete(tmp_path):
    boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="pm-test")
    st = S3Storage("pm-test", prefix="jobs", work_root=tmp_path)

    d = st.job_dir("job9")
    (d / "broadcast.mp4").write_bytes(b"x" * 100)
    (d / "highlights").mkdir()
    (d / "highlights" / "h1.mp4").write_bytes(b"y" * 50)

    st.finalize_job("job9")
    # local working copy removed after upload
    assert not (tmp_path / "job9").exists()

    # objects exist in the bucket under the prefix
    s3 = boto3.client("s3", region_name="us-east-1")
    keys = {o["Key"] for o in s3.list_objects_v2(Bucket="pm-test", Prefix="jobs/job9/").get("Contents", [])}
    assert "jobs/job9/broadcast.mp4" in keys
    assert "jobs/job9/highlights/h1.mp4" in keys

    # presigned read URL is produced and points at the object
    url = st.presigned_url("job9", "broadcast.mp4")
    assert url and "jobs/job9/broadcast.mp4" in url

    st.delete_job("job9")
    assert not s3.list_objects_v2(Bucket="pm-test", Prefix="jobs/job9/").get("Contents")
