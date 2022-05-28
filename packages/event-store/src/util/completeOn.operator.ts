import { Observable, of } from 'rxjs';

export function completeOn<T>() {
  return (observable: Observable<T>) =>
    new Observable<T>((subscriber) => {
      let lastNum: undefined | null | number = undefined;
      const subscription = observable.subscribe({
        next(value) {
          if (lastNum === value && (lastNum === null || lastNum === 0)) {
            subscriber.complete();
          } else {
            lastNum = value;
            subscriber.next(value);
          }
        },
        error(err) {
          subscriber.error(err);
        },
        complete() {
          subscriber.complete();
        },
      });

      // Return the finalization logic. This will be invoked when
      // the result errors, completes, or is unsubscribed.
      return () => {
        subscription.unsubscribe();
      };
    });
}
