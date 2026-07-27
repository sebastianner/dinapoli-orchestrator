// Bootstraps the very first admin employee. Employee creation normally goes
// through POST /api/employees, which is admin-only (see routes/employees.ts)
// - so without this escape hatch there'd be no way to create the first admin
// at all. Runs directly against the DB (same as any other db/*.ts script),
// no server or HTTP call needed.
//
// Usage: npm run admin:create -- "<name>" "<password>"
import { addEmployee } from '../src/services/employeeService.js';

async function main(): Promise<void> {
  const [name, password] = process.argv.slice(2);
  if (!name || !password) {
    console.error('Usage: npm run admin:create -- "<name>" "<password>"');
    process.exit(1);
  }

  const employee = await addEmployee(name, null, 'admin', password);
  console.log(`Created admin employee "${employee.name}" (id ${employee.id}).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
