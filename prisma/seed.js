'use strict';

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create roles
  const adminRole = await prisma.role.upsert({
    where: { name: 'Administrator' },
    update: {},
    create: { name: 'Administrator' },
  });

  const employeeRole = await prisma.role.upsert({
    where: { name: 'Employee' },
    update: {},
    create: { name: 'Employee' },
  });

  // Default local accounts – passwords MUST be changed on first login
  const adminPasswordHash = await bcrypt.hash('admin', 12);
  const userPasswordHash = await bcrypt.hash('user', 12);

  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      firstName: 'System',
      lastName: 'Administrator',
      email: 'admin@localhost',
      isLocal: true,
      passwordHash: adminPasswordHash,
      isActive: true,
      profile: {
        create: { language: 'en' },
      },
      roles: {
        create: { roleId: adminRole.id },
      },
    },
  });

  const defaultUser = await prisma.user.upsert({
    where: { username: 'user' },
    update: {},
    create: {
      username: 'user',
      firstName: 'Default',
      lastName: 'User',
      email: 'user@localhost',
      isLocal: true,
      passwordHash: userPasswordHash,
      isActive: true,
      profile: {
        create: { language: 'en' },
      },
      roles: {
        create: { roleId: employeeRole.id },
      },
    },
  });

  // Default company
  await prisma.company.upsert({
    where: { name: 'My Organisation' },
    update: {},
    create: { name: 'My Organisation', isDefault: true },
  });

  console.log(`Created roles: ${adminRole.name}, ${employeeRole.name}`);
  console.log(`Created local accounts: ${adminUser.username}, ${defaultUser.username}`);
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
