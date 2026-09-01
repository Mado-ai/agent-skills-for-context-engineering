import { bootstrapLoopJobs, createRuntime } from '../runtime.js';
import { createApiServer } from './server.js';

const runtime = createRuntime();
bootstrapLoopJobs(runtime);

const api = createApiServer({ runtime });

const { host, port } = await api.listen();
runtime.scheduler.start(5000);

console.log(`AI Workforce OS v0.4 (pre-production)`);
console.log(`  Control Center  http://${host}:${port}/`);
console.log(`  API             http://${host}:${port}/api/health`);
console.log(`  database        ${runtime.db.path}`);
console.log(`  model provider  ${runtime.provider.name} (${runtime.provider.model})`);
if (!process.env.WORKFORCE_API_TOKEN) {
  console.log('  auth            none — bound to loopback only. Set WORKFORCE_API_TOKEN to require a bearer token.');
}

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received; shutting down.`);
  runtime.scheduler.stop();
  await api.close();
  runtime.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
