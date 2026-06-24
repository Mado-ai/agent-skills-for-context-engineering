"""add coach tools: clip tags, telestrations, playbooks

Tables backing the coach video-workflow features:
* clip_tags     — coded moments (label + timestamp) on a job's video
* telestrations — saved vector drawings pinned to a frame time
* playbooks     — pitch-diagram set-piece / tactic boards per team

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
Create Date: 2026-06-24 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f5a6b7c8d9e0"
down_revision: Union[str, None] = "e4f5a6b7c8d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "clip_tags",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("job_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("t", sa.Float(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("note", sa.Text()),
        sa.Column("player_id", sa.Text()),
        sa.Column("created_at", sa.Float(), nullable=False),
    )
    op.create_index("ix_clip_tags_job", "clip_tags", ["job_id"])
    op.create_table(
        "telestrations",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("job_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("t", sa.Float(), nullable=False),
        sa.Column("shapes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
    )
    op.create_index("ix_telestrations_job", "telestrations", ["job_id"])
    op.create_table(
        "playbooks",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("team_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("field_type", sa.Integer(), server_default="11"),
        sa.Column("data", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
    )
    op.create_index("ix_playbooks_team", "playbooks", ["team_id"])


def downgrade() -> None:
    op.drop_index("ix_playbooks_team", table_name="playbooks")
    op.drop_table("playbooks")
    op.drop_index("ix_telestrations_job", table_name="telestrations")
    op.drop_table("telestrations")
    op.drop_index("ix_clip_tags_job", table_name="clip_tags")
    op.drop_table("clip_tags")
