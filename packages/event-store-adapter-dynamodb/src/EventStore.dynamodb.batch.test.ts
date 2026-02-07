import 'reflect-metadata';
import { ConcurrencyError, CreatedEvent } from '@schemeless/event-store-types';
import { EventStoreRepo } from './EventStore.dynamodb.repo';
import { EventStoreEntity } from './EventStore.dynamodb.entity';

const sendMock = jest.fn();
const uploadMock = jest.fn();
const doneMock = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn().mockImplementation(() => ({
        send: sendMock,
    })),
    DescribeTableCommand: jest.fn(),
    CreateTableCommand: jest.fn(),
    DeleteTableCommand: jest.fn(),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: {
        from: jest.fn().mockImplementation(() => ({
            send: sendMock,
        })),
    },
    PutCommand: jest.fn().mockImplementation(function (input) {
        this.input = input;
    }),
    GetCommand: jest.fn().mockImplementation(function (input) {
        this.input = input;
    }),
    QueryCommand: jest.fn().mockImplementation(function (input) {
        this.input = input;
    }),
    BatchGetCommand: jest.fn().mockImplementation(function (input) {
        this.input = input;
    }),
    TransactWriteCommand: jest.fn().mockImplementation(function (input) {
        this.input = input;
    }),
}));

jest.mock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn().mockImplementation(() => ({
        send: sendMock,
    })),
    HeadBucketCommand: jest.fn(),
    CreateBucketCommand: jest.fn(),
    GetObjectCommand: jest.fn().mockImplementation(function (input) {
        this.input = input;
    }),
}));

jest.mock('@aws-sdk/lib-storage', () => ({
    Upload: jest.fn().mockImplementation(() => ({
        done: doneMock,
    })),
}));

const sizeofMock = jest.fn();
jest.mock('object-sizeof', () => ({
    default: (...args: any[]) => sizeofMock(...args),
    __esModule: true,
}));

// Helper to create events
const createEvents = (count: number, domain: string = 'test', identifier: string = 'user-1'): CreatedEvent<any>[] => {
    return Array.from({ length: count }, (_, i) => ({
        id: `${i + 1}`,
        domain,
        type: 'TEST',
        payload: { i },
        created: new Date(),
        identifier,
    }));
};

describe('DynamoDB Advanced OCC Scenarios', () => {
    beforeEach(() => {
        sendMock.mockReset();
        uploadMock.mockReset();
        doneMock.mockReset();
        sizeofMock.mockReset();
        sizeofMock.mockReturnValue(100); // Default small size
    });

    const repo = new EventStoreRepo({ send: sendMock } as any, { send: sendMock } as any, {
        tableNamePrefix: 'prefix',
        s3BucketName: 'bucket',
        skipDynamoDBTableCreation: true,
        skipS3BucketCreation: true,
    });

    describe('Large Batch (>25 items)', () => {
        it('should split 30 events into chunks of 25 and 5', async () => {
            const events = createEvents(30);

            // Mocks for recursive calls
            // 1. GetStreamSequence (HEAD) - initially 0
            sendMock.mockResolvedValueOnce({ Item: { version: 0 } });

            // 2. TransactWrite for first chunk (25 items)
            sendMock.mockResolvedValueOnce({});

            // 3. TransactWrite for second chunk (5 items)
            sendMock.mockResolvedValueOnce({});

            await repo.storeEvents(events);

            // Verify sequence of calls
            // Call 1: GetCommand (HEAD)
            expect(sendMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
                input: expect.objectContaining({ Key: { id: 'EventID#HEAD::test::user-1', created: 'HEAD' } })
            }));

            // Call 2: TransactWrite (first 25 items + HEAD update to 25)
            const call2 = sendMock.mock.calls[1][0];
            expect(call2.input.TransactItems).toHaveLength(26); // 1 HEAD + 25 Events
            expect(call2.input.TransactItems[0].Update.ExpressionAttributeValues[':newVersion']).toBe(25);

            // Call 3: TransactWrite (next 5 items + HEAD update to 30)
            const call3 = sendMock.mock.calls[2][0];
            expect(call3.input.TransactItems).toHaveLength(6); // 1 HEAD + 5 Events
            expect(call3.input.TransactItems[0].Update.ExpressionAttributeValues[':newVersion']).toBe(30);
            expect(call3.input.TransactItems[0].Update.ExpressionAttributeValues[':expected']).toBe(25);
        });
    });

    describe('S3 Offload + OCC', () => {
        it('should handle large payloads correctly within OCC transaction', async () => {
            const events = createEvents(1);
            // Make event oversized
            sizeofMock.mockReturnValue(400000);

            // Mocks
            // 1. S3 Upload (doneMock)
            doneMock.mockResolvedValue({});

            // 2. GetStreamSequence (HEAD)
            sendMock.mockResolvedValueOnce({ Item: { version: 5 } });

            // 3. TransactWrite
            sendMock.mockResolvedValueOnce({});

            await repo.storeEvents(events);

            // Verify S3 upload happened
            expect(doneMock).toHaveBeenCalledTimes(1);

            // Verify TransactWrite used s3Reference
            const transactCall = sendMock.mock.calls[1][0]; // 0 is GetCommand, 1 is TransactWrite
            const putItem = transactCall.input.TransactItems[1].Put.Item;

            expect(putItem.s3Reference).toBeDefined();
            expect(putItem.payload).toBeUndefined();
            expect(putItem.sequence).toBe(6);
        });
    });

    describe('Multi-stream Batch', () => {
        it('should process multiple streams independently', async () => {
            const events = [
                ...createEvents(1, 'A', 'user-1'),
                ...createEvents(1, 'B', 'user-2')
            ];

            // Mocks
            // 1. GetStreamSequence for A
            sendMock.mockResolvedValueOnce({ Item: { version: 10 } });
            // 2. TransactWrite for A
            sendMock.mockResolvedValueOnce({});

            // 3. GetStreamSequence for B
            sendMock.mockResolvedValueOnce({ Item: { version: 20 } });
            // 4. TransactWrite for B
            sendMock.mockResolvedValueOnce({});

            await repo.storeEvents(events);

            // Verify 2 separate transactions
            expect(sendMock).toHaveBeenCalledTimes(4); // 2 Gets + 2 Transactions
        });
    });
});
