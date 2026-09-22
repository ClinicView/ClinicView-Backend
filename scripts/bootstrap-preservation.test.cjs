'use strict';

// No PrismaClient instance, environment loading, socket, or real database.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolve } = require('node:path');
require('ts-node').register({ project: resolve(__dirname, '../tsconfig.json') });
const {
  BootstrapIdentityConflictError,
  seedAccessCatalog,
  seedInitialAdministrator,
} = require('../prisma/seed-access');

const roles = [
  { key: 'ADMINISTRADOR', name: 'Administrador', description: 'Default administrator' },
  { key: 'MEDICO', name: 'Médico', description: 'Default clinician' },
];
const permissions = [
  { key: 'records.read', description: 'Default read' },
  { key: 'records.create', description: 'Default create' },
];
const defaults = {
  ADMINISTRADOR: ['records.read', 'records.create'],
  MEDICO: ['records.read'],
};
const adminInput = {
  email: ' bootstrap@example.invalid ', password: 'SYNTHETIC_NOT_A_REAL_PASSWORD',
  username: ' Bootstrap.Admin ', fullName: 'Administrador de Prueba',
};
const conflict = () => Object.assign(new Error('Synthetic unique conflict'), { code: 'P2002' });
const missingRelation = () => Object.assign(new Error('Synthetic missing relation'), { code: 'P2025' });

function memoryClient(initial = {}) {
  const state = {
    permissions: structuredClone(initial.permissions ?? []),
    roles: structuredClone(initial.roles ?? []),
    users: structuredClone(initial.users ?? []),
  };
  const calls = { permissionWrites: [], roleCreates: [], userCreates: [] };
  const forbidden = async () => { throw new Error('Standalone update/upsert/grant is forbidden in create-only bootstrap.'); };
  const client = {
    permission: {
      async upsert(args) {
        calls.permissionWrites.push(structuredClone(args));
        const existing = state.permissions.find((entry) => entry.key === args.where.key);
        if (existing) {
          Object.assign(existing, args.update);
          return { id: existing.id };
        }
        const value = { id: `permission-${state.permissions.length}`, ...args.create };
        state.permissions.push(value);
        return { id: value.id };
      },
    },
    role: {
      async findUnique({ where }) {
        const existing = state.roles.find((entry) => entry.key === where.key);
        return existing ? { id: existing.id } : null;
      },
      async create(args) {
        calls.roleCreates.push(structuredClone(args));
        if (state.roles.some((entry) => entry.key === args.data.key)) throw conflict();
        const grants = args.data.rolePermissions.create.map((entry) => entry.permission.connect.key);
        if (grants.some((key) => !state.permissions.some((entry) => entry.key === key))) throw missingRelation();
        // Emulate the atomic boundary of Prisma's single nested create: validate
        // every relation before applying any change to this in-memory store.
        const { rolePermissions, ...data } = args.data;
        const value = { id: `role-${state.roles.length}`, ...data, grants };
        state.roles.push(value);
        return { id: value.id };
      },
      upsert: forbidden, update: forbidden,
    },
    user: {
      async findFirst({ where }) {
        const field = where.email ? 'email' : 'username';
        assert.equal(where[field].mode, 'insensitive');
        const value = where[field].equals.toLowerCase();
        const existing = state.users.find((entry) => entry[field].toLowerCase() === value);
        return existing ? { id: existing.id } : null;
      },
      async create(args) {
        calls.userCreates.push(structuredClone(args));
        if (state.users.some((entry) => entry.email === args.data.email || entry.username === args.data.username)) throw conflict();
        const roleKey = args.data.userRoles.create.role.connect.key;
        if (!state.roles.some((entry) => entry.key === roleKey)) throw missingRelation();
        const { userRoles, ...data } = args.data;
        const value = { id: `user-${state.users.length}`, isActive: true, ...data, roles: [roleKey] };
        state.users.push(value);
        return { id: value.id };
      },
      upsert: forbidden, update: forbidden,
    },
    rolePermission: { create: forbidden, upsert: forbidden, createMany: forbidden, deleteMany: forbidden },
    userRole: { create: forbidden, upsert: forbidden, createMany: forbidden, deleteMany: forbidden },
  };
  return { client, state, calls };
}

function seededAdminRole() {
  return { id: 'existing-admin-role', key: 'ADMINISTRADOR', name: 'Nombre institucional', description: 'Decisión administrativa', grants: ['records.read'] };
}

test('new roles and complete default grants use a single nested create per role', async () => {
  const { client, state, calls } = memoryClient();
  const result = await seedAccessCatalog(client, roles, permissions, defaults);
  assert.deepEqual(result, { permissionsEnsured: 2, rolesCreated: 2, rolesPreserved: 0, grantsCreated: 3 });
  assert.deepEqual(state.roles.map((entry) => entry.grants), [['records.read', 'records.create'], ['records.read']]);
  assert.equal(calls.roleCreates.length, 2);
  assert.deepEqual(calls.roleCreates[0].data.rolePermissions.create, [
    { permission: { connect: { key: 'records.read' } } },
    { permission: { connect: { key: 'records.create' } } },
  ]);
});

test('rerunning preserves role names, descriptions, timestamps, removed grants and custom grants', async () => {
  const { client, state, calls } = memoryClient();
  await seedAccessCatalog(client, roles, permissions, defaults);
  Object.assign(state.roles[0], { name: 'Administrador restringido', description: 'Revisado por responsable', updatedAt: 'SYNTHETIC_TIMESTAMP', grants: ['custom.review'] });
  state.roles[1].grants = [];
  state.permissions[0].description = 'Descripción institucional';
  const before = structuredClone(state);
  calls.roleCreates.length = 0;
  const result = await seedAccessCatalog(client, roles, permissions, defaults);
  assert.deepEqual(state, before);
  assert.equal(calls.roleCreates.length, 0);
  assert.deepEqual(result, { permissionsEnsured: 2, rolesCreated: 0, rolesPreserved: 2, grantsCreated: 0 });
  assert.ok(calls.permissionWrites.every((write) => Object.keys(write.update).length === 0));
});

test('a new catalog permission is not automatically granted to pre-existing roles', async () => {
  const { client, state } = memoryClient();
  await seedAccessCatalog(client, roles, permissions, defaults);
  const beforeGrants = structuredClone(state.roles.map((entry) => entry.grants));
  const extra = { key: 'records.confirm', description: 'New capability' };
  await seedAccessCatalog(client, roles, [...permissions, extra], { ...defaults, ADMINISTRADOR: [...defaults.ADMINISTRADOR, extra.key] });
  assert.ok(state.permissions.some((entry) => entry.key === extra.key));
  assert.deepEqual(state.roles.map((entry) => entry.grants), beforeGrants);
});

test('only absent roles receive defaults and duplicate grants are deduplicated', async () => {
  const existing = seededAdminRole();
  const { client, state } = memoryClient({ roles: [existing] });
  const result = await seedAccessCatalog(client, roles, permissions, { ...defaults, MEDICO: ['records.read', 'records.read'] });
  assert.deepEqual(state.roles[0], existing);
  assert.deepEqual(state.roles[1].grants, ['records.read']);
  assert.equal(result.rolesCreated, 1);
  assert.equal(result.grantsCreated, 1);
});

test('invalid default capability is rejected before any catalog writes', async () => {
  const { client, state, calls } = memoryClient();
  await assert.rejects(seedAccessCatalog(client, roles, permissions, { ...defaults, MEDICO: ['unknown.permission'] }), /no declarada/);
  assert.equal(calls.permissionWrites.length, 0);
  assert.equal(state.roles.length, 0);
});

test('nested role creation failure cannot leave an empty partially initialized role', async () => {
  const { client, state, calls } = memoryClient();
  const create = client.role.create;
  client.role.create = async (args) => {
    state.permissions = [];
    return create(args);
  };
  await assert.rejects(seedAccessCatalog(client, roles, permissions, defaults), { code: 'P2025' });
  assert.equal(state.roles.length, 0);
  assert.equal(calls.roleCreates.length, 1);
  assert.equal(calls.roleCreates[0].data.rolePermissions.create.length, 2);
});

test('concurrent role creation preserves the winning role instead of adding defaults', async () => {
  const { client, state } = memoryClient();
  const winner = { ...seededAdminRole(), grants: [] };
  client.role.create = async () => { state.roles.push(winner); throw conflict(); };
  const result = await seedAccessCatalog(client, [roles[0]], permissions, defaults);
  assert.deepEqual(state.roles, [winner]);
  assert.equal(result.rolesCreated, 0);
  assert.equal(result.rolesPreserved, 1);
  assert.equal(result.grantsCreated, 0);
});

test('non-unique database failures are not mistaken for existing roles', async () => {
  const { client } = memoryClient();
  client.role.create = async () => { throw Object.assign(new Error('Unavailable'), { code: 'P1001' }); };
  await assert.rejects(seedAccessCatalog(client, roles, permissions, defaults), { code: 'P1001' });
});

test('a genuinely new administrator is created together with its role and normalized identity', async () => {
  const { client, state, calls } = memoryClient({ roles: [seededAdminRole()] });
  const hashes = [];
  const result = await seedInitialAdministrator(client, adminInput, async (password) => { hashes.push(password); return 'SYNTHETIC_HASH'; });
  assert.equal(result, 'created');
  assert.deepEqual(hashes, [adminInput.password]);
  assert.equal(calls.userCreates.length, 1);
  assert.deepEqual(calls.userCreates[0].data.userRoles, { create: { role: { connect: { key: 'ADMINISTRADOR' } } } });
  assert.equal(state.users[0].email, 'bootstrap@example.invalid');
  assert.equal(state.users[0].username, 'bootstrap.admin');
  assert.deepEqual(state.users[0].roles, ['ADMINISTRADOR']);
  assert.equal(state.roles[0].grants.length, 1, 'Creating an account must not expand its existing role.');
});

for (const existingRoles of [['MEDICO'], [], ['ADMINISTRADOR']]) {
  test(`existing account with roles ${JSON.stringify(existingRoles)} is never promoted, reset or reactivated`, async () => {
    const existing = { id: 'person-existing', email: 'BOOTSTRAP@EXAMPLE.INVALID', username: 'clinical-account', fullName: 'Nombre elegido', passwordHash: 'HASH_EXISTENTE', roles: existingRoles, isActive: false, sessionVersion: 9 };
    const { client, state, calls } = memoryClient({ users: [existing] });
    const result = await seedInitialAdministrator(client, adminInput, async () => { throw new Error('Must not hash for an existing account'); });
    assert.equal(result, 'preserved');
    assert.deepEqual(state.users, [existing]);
    assert.equal(calls.userCreates.length, 0);
  });
}

test('an existing username on another account blocks initial admin creation without a grant', async () => {
  const other = { id: 'other', email: 'other@example.invalid', username: 'BOOTSTRAP.ADMIN', roles: ['MEDICO'] };
  const { client, state } = memoryClient({ users: [other], roles: [seededAdminRole()] });
  await assert.rejects(seedInitialAdministrator(client, adminInput, async () => { throw new Error('Must not hash for a conflict'); }), BootstrapIdentityConflictError);
  assert.deepEqual(state.users, [other]);
});

test('concurrent email insertion preserves the winning non-admin identity and its revoked roles', async () => {
  const { client, state } = memoryClient({ roles: [seededAdminRole()] });
  const winner = { id: 'concurrent', email: 'bootstrap@example.invalid', username: 'different-name', roles: [], isActive: false, passwordHash: 'WINNER_HASH' };
  client.user.create = async () => { state.users.push(winner); throw conflict(); };
  assert.equal(await seedInitialAdministrator(client, adminInput, async () => 'UNUSED_HASH'), 'preserved');
  assert.deepEqual(state.users, [winner]);
});

test('a concurrent username collision cannot be converted into an administrator', async () => {
  const { client, state } = memoryClient({ roles: [seededAdminRole()] });
  const winner = { id: 'concurrent', email: 'other@example.invalid', username: 'bootstrap.admin', roles: ['MEDICO'] };
  client.user.create = async () => { state.users.push(winner); throw conflict(); };
  await assert.rejects(seedInitialAdministrator(client, adminInput, async () => 'UNUSED_HASH'), BootstrapIdentityConflictError);
  assert.deepEqual(state.users, [winner]);
});

test('a missing initial role rolls back account creation instead of leaving a partial user', async () => {
  const { client, state, calls } = memoryClient();
  await assert.rejects(seedInitialAdministrator(client, adminInput, async () => 'SYNTHETIC_HASH'), { code: 'P2025' });
  assert.equal(state.users.length, 0);
  assert.equal(calls.userCreates.length, 1);
  assert.ok(calls.userCreates[0].data.userRoles.create.role.connect);
});

test('hash failure or missing credentials cannot create an account or grant', async () => {
  const { client, state, calls } = memoryClient({ roles: [seededAdminRole()] });
  await assert.rejects(seedInitialAdministrator(client, adminInput, async () => { throw new Error('Hash failure'); }), /Hash failure/);
  await assert.rejects(seedInitialAdministrator(client, { ...adminInput, password: '' }, async () => 'UNUSED_HASH'), /correo y contraseña/);
  assert.equal(calls.userCreates.length, 0);
  assert.equal(state.users.length, 0);
});
