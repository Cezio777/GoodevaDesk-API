import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const organizations = [
  { name: 'Acme Corp (Demo)', api_key: 'sk_live_123456789' },
  { name: 'Globex Inc (Demo)', api_key: 'sk_live_987654321' },
];

async function main() {
  for (const org of organizations) {
    const result = await prisma.organization.upsert({
      where: { api_key: org.api_key },
      update: { name: org.name },
      create: org,
    });
    console.log(`✓ ${result.name} — API Key: ${result.api_key}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());