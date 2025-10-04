import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export class EventModel extends Model {
  static table = 'events';

  @field('domain')
  domain!: string;

  @field('type')
  type!: string;

  @field('payload')
  payload!: string;

  @field('meta')
  meta!: string | null;

  @field('identifier')
  identifier!: string | null;

  @field('correlation_id')
  correlationId!: string | null;

  @field('causation_id')
  causationId!: string | null;

  @field('created')
  created!: number;
}
