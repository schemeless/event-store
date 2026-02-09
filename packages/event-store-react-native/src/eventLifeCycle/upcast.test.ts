import { upcast } from './upcast';
import { CreatedEvent, EventFlow } from '@schemeless/event-store-types';

const defaultEvent: CreatedEvent<any, any> = {
    id: '1',
    domain: 'test',
    type: 'test',
    created: new Date(),
    payload: { value: 1 },
    meta: {}
};

describe('upcast', () => {
    it('should return original event if no upcast hook', async () => {
        const flow: EventFlow = { domain: 'test', type: 'test', receive: null as any };
        const result = await upcast(flow, defaultEvent);
        expect(result).toBe(defaultEvent);
    });

    it('should skip upcast if fromVersion >= targetVersion', async () => {
        const flow: EventFlow = {
            domain: 'test',
            type: 'test',
            receive: null as any,
            schemaVersion: 1,
            upcast: jest.fn()
        };
        const event = { ...defaultEvent, meta: { schemaVersion: 1 } };
        const result = await upcast(flow, event as any);
        expect(result).toBe(event);
        expect(flow.upcast).not.toHaveBeenCalled();
    });

    it('should call upcast and update schemaVersion', async () => {
        const flow: EventFlow = {
            domain: 'test',
            type: 'test',
            receive: null as any,
            schemaVersion: 2,
            upcast: jest.fn().mockImplementation((ev) => ({
                ...ev,
                payload: { ...ev.payload, upgraded: true }
            }))
        };
        const event = { ...defaultEvent, meta: { schemaVersion: 1 } };

        const result = (await upcast(flow, event as any)) as CreatedEvent<any, any>;

        expect(flow.upcast).toHaveBeenCalledWith(event, 1);
        expect(result).not.toBe(event);
        expect(result.payload.upgraded).toBe(true);
        expect(result.meta?.schemaVersion).toBe(2);
    });

    it('should handle void return from upcast (no change)', async () => {
        const flow: EventFlow = {
            domain: 'test',
            type: 'test',
            receive: null as any,
            schemaVersion: 2,
            upcast: jest.fn().mockReturnValue(undefined)
        };
        const event = { ...defaultEvent, meta: { schemaVersion: 1 } };

        const result = await upcast(flow, event as any) as CreatedEvent<any, any>;

        expect(flow.upcast).toHaveBeenCalled();
        expect(result).toBe(event);
        // schemaVersion matches original event because upcast returned void
        expect(result.meta?.schemaVersion).toBe(1);
    });
});
