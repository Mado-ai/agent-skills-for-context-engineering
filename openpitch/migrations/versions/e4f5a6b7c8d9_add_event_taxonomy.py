"""add FIFA-style event taxonomy to player_match_stats

Standard-data event fields (key passes, crosses, dribbles, tackles,
interceptions, clearances, blocks, duels won, recoveries, offsides, cards,
saves) — entered/annotated alongside tracking metrics.

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-06-23 02:30:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e4f5a6b7c8d9"
down_revision: Union[str, None] = "d3e4f5a6b7c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLS = ("key_passes", "crosses", "dribbles", "tackles", "interceptions",
         "clearances", "blocks", "duels_won", "recoveries", "offsides",
         "yellow_cards", "red_cards", "saves")


def upgrade() -> None:
    for col in _COLS:
        op.add_column("player_match_stats",
                      sa.Column(col, sa.Integer(), nullable=True, server_default="0"))


def downgrade() -> None:
    for col in reversed(_COLS):
        op.drop_column("player_match_stats", col)
