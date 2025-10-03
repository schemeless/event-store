import { monotonicFactory, ULID } from 'ulid';

let ulidInstance: ULID;

export const getUlid = (): string => {
  if (ulidInstance) return ulidInstance();
  ulidInstance = monotonicFactory();
  return ulidInstance();
};
