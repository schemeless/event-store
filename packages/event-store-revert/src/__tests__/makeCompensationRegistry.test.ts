import { makeCompensationRegistry } from '../makeCompensationRegistry';

const mockFn1 = jest.fn();
const mockFn2 = jest.fn();

beforeEach(() => {
  mockFn1.mockClear();
  mockFn2.mockClear();
});

describe('makeCompensationRegistry', () => {
  it('returns undefined for unregistered domain::type', () => {
    const registry = makeCompensationRegistry();
    expect(registry.get('domain', 'type')).toBeUndefined();
  });

  it('registers and retrieves a compensation function', () => {
    const registry = makeCompensationRegistry();
    registry.register('domain', 'type', mockFn1);
    expect(registry.get('domain', 'type')).toBe(mockFn1);
  });

  it('registers multiple compensation functions for different domain::type pairs', () => {
    const registry = makeCompensationRegistry();
    registry.register('domain1', 'type1', mockFn1);
    registry.register('domain2', 'type2', mockFn2);
    expect(registry.get('domain1', 'type1')).toBe(mockFn1);
    expect(registry.get('domain2', 'type2')).toBe(mockFn2);
    expect(registry.get('domain1', 'type2')).toBeUndefined();
    expect(registry.get('domain2', 'type1')).toBeUndefined();
  });

  it('overwrites existing registration for same domain::type', () => {
    const registry = makeCompensationRegistry();
    registry.register('domain', 'type', mockFn1);
    registry.register('domain', 'type', mockFn2);
    expect(registry.get('domain', 'type')).toBe(mockFn2);
  });

  it('uses :: as separator between domain and type', () => {
    const registry = makeCompensationRegistry();
    registry.register('dom::ain', 'ty::pe', mockFn1);
    expect(registry.get('dom::ain', 'ty::pe')).toBe(mockFn1);
    expect(registry.get('dom', 'ain')).toBeUndefined();
    expect(registry.get('ty', 'pe')).toBeUndefined();
  });
});
