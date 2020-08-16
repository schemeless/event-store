import { createRxQueue } from './RxQueue';
import { zip } from 'rxjs';

describe('Rx Queue', () => {
  it('should run', cb => {
    const rxQueue = createRxQueue<number>('test');
    zip(rxQueue.task$, rxQueue.done$).subscribe(([task, done]) => {
      console.log(task);
      done(task);
    });
    console.log(rxQueue.push);
    rxQueue.push(1, () => {
      console.log('done');
      cb();
    });
  });
});
