// scripts/seed-demo.ts
// Standalone demo seed runner — invoke after `npm run build` to seed demo data.
import { seedDemo } from '../lib/seed';

async function main() {
  console.log('Seeding demo data...');
  try {
    const result = await seedDemo();
    console.log(`Demo seeded successfully. Project IDs: ${result.projectIds.join(', ')}`);
    process.exit(0);
  } catch (error) {
    console.error('Demo seed failed:', error);
    process.exit(1);
  }
}

main();