import { featureEntities } from '../../../core-domains';
import { defaultInMenDBOptionProjective } from './testHelpers';
import { config } from '../config';
import { environment } from '../env';
import { getConnection } from '../managers/typeorm';

const connectionOptions = Object.assign({}, config.dbConnections.projective, {
  url: environment.projectiveDbURL
}) as any;

export const getProjectiveDbConnection = async (): Promise<import('typeorm').Connection> => {
  if (process.env.NODE_ENV === 'test') {
    return getConnection(featureEntities, defaultInMenDBOptionProjective);
  } else {
    return getConnection(featureEntities, connectionOptions);
  }
};
