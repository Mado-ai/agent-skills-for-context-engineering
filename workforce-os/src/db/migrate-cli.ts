import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';

const db = openDatabase();
const result = migrate(db);
if (result.applied.length === 0) {
  console.log(`No pending migrations (${result.alreadyApplied.length} already applied).`);
} else {
  for (const name of result.applied) console.log(`applied ${name}`);
}
console.log(`database: ${db.path}`);
db.close();
