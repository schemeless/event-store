import { EventStoreDynamodbIterator } from './EventStore.dynamodb.iterator';
import { EventStoreEntity } from './EventStore.dynamodb.entity';

const makeRepo = () => {
  const pages = [
    [
      { id: 'b', created: new Date('2020-01-02T00:00:00.000Z') },
      { id: 'a', created: new Date('2020-01-01T00:00:00.000Z') },
    ],
  ];

  const scan = jest.fn().mockReturnValue({
    pages: () =>
      (async function* () {
        for (const page of pages) {
          yield page;
        }
      })(),
  });

  const batchGet = jest.fn().mockImplementation((entities: EventStoreEntity[]) =>
    (async function* () {
      yield entities.map((entity) => Object.assign(entity, { payload: entity.id }));
    })()
  );

  const getFullEvent = jest.fn(async (entity: EventStoreEntity) => ({ ...entity, loaded: true }));

  return {
    mapper: {
      scan,
      batchGet,
    },
    getFullEvent,
  };
};

describe('EventStoreDynamodbIterator', () => {
  it('sorts events by creation date across pages', async () => {
    const repo = makeRepo();
    const iterator = new EventStoreDynamodbIterator(repo as any, 1);

    await iterator.init();

    expect(iterator.allItems.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('retrieves paginated events with full data', async () => {
    const repo = makeRepo();
    const iterator = new EventStoreDynamodbIterator(repo as any, 1);

    await iterator.init();

    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual([
      expect.objectContaining({ id: 'a', payload: 'a', loaded: true }),
    ]);

    const second = await iterator.next();
    expect(second.done).toBe(false);
    expect(second.value).toEqual([
      expect.objectContaining({ id: 'b', payload: 'b', loaded: true }),
    ]);

    const third = await iterator.next();
    expect(third.done).toBe(true);
    expect(third.value).toEqual([]);

    expect(repo.mapper.batchGet).toHaveBeenCalled();
    expect(repo.getFullEvent).toHaveBeenCalledTimes(2);
  });
});
