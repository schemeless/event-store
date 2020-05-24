// http://getpino.io/#/

import pino from 'pino';
import { environment } from '../../env';

const stream = environment.logger.isServerless
  ? ({ write: (str: string) => console.log(str) } as any) // serverless logger
  : undefined;

export const logger = pino(
  {
    name: environment.logger.name
  },
  stream
);
