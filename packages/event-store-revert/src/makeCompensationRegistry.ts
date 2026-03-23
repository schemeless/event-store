import type { CompensationFn, CompensationRegistry } from './types';

export function makeCompensationRegistry(): CompensationRegistry {
  const map = new Map<string, CompensationFn>();
  return {
    register(domain, type, fn) {
      map.set(`${domain}::${type}`, fn);
    },
    get(domain, type) {
      return map.get(`${domain}::${type}`);
    },
  };
}
