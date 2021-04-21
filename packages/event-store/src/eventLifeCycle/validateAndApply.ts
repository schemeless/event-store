import type { CreatedEvent, EventFlow, } from '@schemeless/event-store-types'
import * as R from 'ramda'
import { apply } from './apply'
import { validate } from './validate'
import { preApply } from './preApply'

export const validateAndApply = (eventFlow: EventFlow) => (event: CreatedEvent<any>): Promise<CreatedEvent<any>> =>
  R.pipeP(
    validate(eventFlow),
    preApply(eventFlow),
    apply(eventFlow)
  )(event)
