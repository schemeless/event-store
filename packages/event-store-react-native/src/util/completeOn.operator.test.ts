import { lastValueFrom, of, throwError } from 'rxjs';
import { toArray } from 'rxjs/operators';

import { completeOn } from './completeOn.operator';

describe('completeOn operator', () => {
  it('completes after receiving the same terminal queue size twice', async () => {
    const emissions = await lastValueFrom(of(3, 2, 1, 0, 0).pipe(completeOn(), toArray()));

    expect(emissions).toEqual([3, 2, 1, 0]);
  });

  it('continues emitting when repeated values are not terminal', async () => {
    const emissions = await lastValueFrom(of(1, 1, 2, 0, 0, 1).pipe(completeOn(), toArray()));

    expect(emissions).toEqual([1, 1, 2, 0]);
  });

  it('propagates source errors', async () => {
    await expect(lastValueFrom(throwError(() => new Error('boom')).pipe(completeOn()))).rejects.toThrow('boom');
  });
});
