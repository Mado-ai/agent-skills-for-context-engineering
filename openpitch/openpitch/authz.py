"""Role-based access control for organizations.

Roles (per the v4 architecture §5.1) and what each can do:

* owner / admin / coach  — full management + read of the org's teams,
  players and matches ("staff" roles).
* parent                 — read-only, limited to their linked player.
* player                 — read-only, limited to their own player record.
* scout                  — no authenticated org access; sees public-tier
  profiles only (via share links).

Authorization is enforced in the Application API (the single chokepoint),
so these helpers are the one place membership roles are interpreted.
"""

from __future__ import annotations

OWNER = "owner"
ADMIN = "admin"
COACH = "coach"
PARENT = "parent"
PLAYER = "player"
SCOUT = "scout"

ALL_ROLES = {OWNER, ADMIN, COACH, PARENT, PLAYER, SCOUT}
STAFF_ROLES = {OWNER, ADMIN, COACH}      # full manage + read
ADMIN_ROLES = {OWNER, ADMIN}             # manage members
LINKED_ROLES = {PARENT, PLAYER}          # restricted to a linked player
