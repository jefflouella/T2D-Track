import { prisma } from '../src/db.js';
import { rebuildStockCache } from '../src/services/inventory.js';

const meds = await prisma.medication.findMany({ select: { id: true, name: true } });
for (const med of meds) {
  const balance = await rebuildStockCache(med.id);
  console.log(`${med.name}: ${balance.toString()}`);
}
await prisma.$disconnect();
