import * as Sentry from '@sentry/node';
import { environment } from '../../env';
if (environment.sentry.dsn) {
  Sentry.init({ dsn: environment.sentry.dsn });
}
