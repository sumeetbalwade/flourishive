import { scopeArgs } from './tenant-scoping.js';

const T = 'tenant-a';

describe('scopeArgs', () => {
  it('adds the tenant to reads, keeping the original filter', () => {
    expect(
      scopeArgs('Entity', 'findMany', { where: { name: 'x' } }, T),
    ).toEqual({
      where: { AND: [{ name: 'x' }, { tenantId: T }] },
    });
    expect(scopeArgs('Entity', 'count', {}, T)).toEqual({
      where: { tenantId: T },
    });
  });

  it('adds the tenant to unique lookups so another tenant gets no row', () => {
    expect(
      scopeArgs('Entity', 'findUnique', { where: { id: '1' } }, T),
    ).toEqual({
      where: { id: '1', tenantId: T },
    });
  });

  it('stamps creates and refuses a different tenantId', () => {
    expect(scopeArgs('Entity', 'create', { data: { name: 'x' } }, T)).toEqual({
      data: { name: 'x', tenantId: T },
    });
    expect(() =>
      scopeArgs('Entity', 'create', { data: { tenantId: 'other' } }, T),
    ).toThrow('Cross-tenant write refused');
    expect(
      scopeArgs(
        'Entity',
        'createMany',
        { data: [{ name: 'a' }, { name: 'b' }] },
        T,
      ).data,
    ).toEqual([
      { name: 'a', tenantId: T },
      { name: 'b', tenantId: T },
    ]);
  });

  it('scopes the tenants table by its own id', () => {
    expect(scopeArgs('Tenant', 'findMany', {}, T)).toEqual({
      where: { id: T },
    });
  });

  it('refuses operations it does not know how to scope', () => {
    expect(() => scopeArgs('Entity', 'somethingNew', {}, T)).toThrow(
      'not allowed',
    );
  });
});
