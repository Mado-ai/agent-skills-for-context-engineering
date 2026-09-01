"""Runtime composition root.

Wires the governed subsystems together over one database. Constructed once per process
(or per test); everything else takes its collaborators by injection.
"""

from .config import Config, load_config
from .core.approvals import ApprovalService
from .core.architect import ChiefArchitect
from .core.budgets import BudgetLedger
from .core.bus import EventBus, Scheduler
from .core.delegation import DelegationService
from .core.events import EventLog
from .core.memory import MemoryStore
from .core.packets import PacketService
from .core.projects import ProjectRegistry
from .core.quality import QualityService
from .core.registry import AgentRegistry
from .core.tasks import TaskService
from .core.telemetry import Telemetry
from .core.templates import TemplateService
from .db import migrator
from .gateway.gateway import ToolGateway
from .gateway.tools import ToolRegistry
from .providers.local import get_provider
from .db.connection import Database


class Runtime:
    def __init__(self, config: Config | None = None, *, db: Database | None = None):
        self.config = config or load_config()
        self.db = db or Database(self.config.database_path)
        migrator.migrate(self.db)

        self.events = EventLog(self.db)
        self.projects = ProjectRegistry(self.db, self.events)
        self.agents = AgentRegistry(self.db, self.events, self.config)
        self.budgets = BudgetLedger(self.db, self.events)
        self.tasks = TaskService(self.db, self.events, self.agents, self.config)
        self.packets = PacketService(self.db, self.events)
        self.delegation = DelegationService(self.db, self.events, self.agents, self.tasks,
                                            self.packets, self.config)
        self.templates = TemplateService(self.db, self.events, self.agents, self.config)
        self.memory = MemoryStore(self.db, self.events, self.agents)
        self.quality = QualityService(self.db, self.events, self.agents, self.tasks, self.config)
        self.bus = EventBus(self.events)
        self.scheduler = Scheduler(self.db, self.bus)
        self.telemetry = Telemetry(self.db)
        self.approvals = ApprovalService(self.db, self.events, self.config)
        self.tools = ToolRegistry()
        self.provider = get_provider(self.config)
        self.gateway = ToolGateway(self.db, self.events, self.agents, self.tasks, self.budgets,
                                   self.approvals, self.telemetry, self.config, tools=self.tools)
        self.architect = ChiefArchitect(self)

    def close(self) -> None:
        self.db.close()

    def health(self) -> dict:
        return {
            "status": "ok",
            "version": "0.4.0",
            "config": self.config.redacted(),
            "counts": {
                "projects": self.db.query_one("SELECT COUNT(*) AS n FROM projects")["n"],
                "agents": self.db.query_one("SELECT COUNT(*) AS n FROM agents")["n"],
                "tasks": self.db.query_one("SELECT COUNT(*) AS n FROM tasks")["n"],
                "events": self.db.query_one("SELECT COUNT(*) AS n FROM events")["n"],
            },
        }
