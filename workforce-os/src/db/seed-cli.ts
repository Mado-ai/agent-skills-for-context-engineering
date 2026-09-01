import { createRuntime } from '../runtime.js';
import { seed } from './seed.js';

const runtime = createRuntime();
try {
  const result = seed(runtime);
  if (!result.seeded) {
    console.log('Already seeded (a Chief Agent Architect is registered); nothing to do.');
  } else {
    console.log(
      `Seeded ${result.projects} project(s), ${result.loops} loop(s), ${result.templates} template(s), ` +
        `${result.agents.length} agent(s), ${result.memory_records} authoritative memory record(s).`,
    );
    for (const id of result.agents) {
      const agent = runtime.repos.agents.getAgent(id)!;
      console.log(`  ${agent.role_level.padEnd(11)} ${agent.display_name} (${agent.agent_id}) — ${agent.status}`);
    }
  }
} finally {
  runtime.close();
}
