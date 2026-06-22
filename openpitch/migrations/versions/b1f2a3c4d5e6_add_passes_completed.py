"""add passes_completed to player_match_stats

Stores completed passes alongside attempts so profiles can report pass accuracy.

Revision ID: b1f2a3c4d5e6
Revises: 04abd77dc06c
Create Date: 2026-06-22 22:10:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b1f2a3c4d5e6"
down_revision: Union[str, None] = "04abd77dc06c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "player_match_stats",
        sa.Column("passes_completed", sa.Integer(), nullable=True, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("player_match_stats", "passes_completed")
