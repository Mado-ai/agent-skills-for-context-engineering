"""add shots, shots_on_target, fouls to player_match_stats

Manual/match-event stats to complete the broadcast head-to-head row set.

Revision ID: c2d3e4f5a6b7
Revises: b1f2a3c4d5e6
Create Date: 2026-06-23 00:30:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c2d3e4f5a6b7"
down_revision: Union[str, None] = "b1f2a3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for col in ("shots", "shots_on_target", "fouls"):
        op.add_column(
            "player_match_stats",
            sa.Column(col, sa.Integer(), nullable=True, server_default="0"),
        )


def downgrade() -> None:
    for col in ("fouls", "shots_on_target", "shots"):
        op.drop_column("player_match_stats", col)
