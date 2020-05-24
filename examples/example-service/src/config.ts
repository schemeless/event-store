export const config = {
  serviceName: 'balance',
  baseToken: 'XQB',
  defaultTokenLimit: 10 * 1000,
  // attendanceClaimPeriod: 10 * 1000, // 10 seconds
  attendanceClaimPeriod: 60 * 60 * 1000, // 1 hour
  dbConnections: {
    eventStore: {
      name: 'event-store',
      type: 'mysql',
      url: '',
      database: 'eventstore',
      charset: 'utf8mb4',
      logger: 'advanced-console',
      logging: ['error', 'warn'],
      dropSchema: false,
      synchronize: false
    },
    projective: {
      name: 'projective',
      type: 'mysql',
      url: '',
      database: 'balance',
      charset: 'utf8mb4',
      logger: 'advanced-console',
      logging: ['error', 'warn'],
      dropSchema: false,
      synchronize: false
    }
  }
};
