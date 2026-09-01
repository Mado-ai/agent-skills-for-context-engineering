import type { Db } from '../connection.js';
import { createAgentRepo } from './agents.js';
import { createBudgetRepo } from './budgets.js';
import { createGovernanceRepo } from './governance.js';
import { createJobRepo } from './jobs.js';
import { createMemoryRepo } from './memory.js';
import { createProjectRepo } from './projects.js';
import { createQualityRepo } from './quality.js';
import { createTaskRepo } from './tasks.js';

export interface Repos {
  agents: ReturnType<typeof createAgentRepo>;
  projects: ReturnType<typeof createProjectRepo>;
  tasks: ReturnType<typeof createTaskRepo>;
  memory: ReturnType<typeof createMemoryRepo>;
  quality: ReturnType<typeof createQualityRepo>;
  governance: ReturnType<typeof createGovernanceRepo>;
  budgets: ReturnType<typeof createBudgetRepo>;
  jobs: ReturnType<typeof createJobRepo>;
}

export function createRepos(db: Db): Repos {
  return {
    agents: createAgentRepo(db),
    projects: createProjectRepo(db),
    tasks: createTaskRepo(db),
    memory: createMemoryRepo(db),
    quality: createQualityRepo(db),
    governance: createGovernanceRepo(db),
    budgets: createBudgetRepo(db),
    jobs: createJobRepo(db),
  };
}

export * from './agents.js';
export * from './projects.js';
export * from './tasks.js';
export * from './memory.js';
export * from './quality.js';
export * from './governance.js';
export * from './budgets.js';
export * from './jobs.js';
