from __future__ import annotations

import pytest

from af.chief import ChiefAgentArchitect
from af.clock import ManualClock
from af.runtime import DeterministicBehaviour
from af.system import build_system


@pytest.fixture()
def clock():
    return ManualClock()


@pytest.fixture()
def system(clock):
    return build_system(":memory:", clock=clock, behaviour=DeterministicBehaviour())


@pytest.fixture()
def owner(system):
    return system.owner()


@pytest.fixture()
def project(system, owner):
    return system.factory.create_project("test-project", principal=owner)


@pytest.fixture()
def chief(system, owner, clock):
    c = ChiefAgentArchitect(system, clock=clock)
    c.bootstrap(owner)
    return c


@pytest.fixture()
def specialist(system, chief, owner, project):
    """An ACTIVE specialist, ready to receive work."""
    contract = chief.propose_specialist(
        capability="test_work", project_id=project, outputs=("result",))
    return system.factory.activate(contract.id, principal=owner)
