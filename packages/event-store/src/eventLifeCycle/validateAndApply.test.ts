import type {
  EventFlow,
} from '@schemeless/event-store-types'
import { validateAndApply } from './validateAndApply'

describe('makeValidateAndApply ', () => {
  it('should work', async () => {
    const eventFlow: EventFlow<any> = {
      domain: 'a',
      type: 'b',
      receive: (eventStore => {}) as any
    }
    const event = {
      id: 'a',
      domain: 'a',
      type: 'b',
      created: new Date(),
      payload: {}
    }
    await expect(validateAndApply(eventFlow)(event)).resolves.toMatchObject({domain: 'a'})
  })
})
