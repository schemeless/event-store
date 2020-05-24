import { v4 as uuid } from 'uuid';

export const environment = {
  isDev: process.env.NODE_ENV !== 'production',
  projectiveDbURL: process.env.BALANCE_SNAPSHOT_DB_URL || 'mysql://root:M0cFd80FAFOjIajY0_c@localhost:3307/service',
  EventSourceDbURL: process.env.EVENT_SOURCE_DB_URL || 'mysql://root:M0cFd80FAFOjIajY0_c@localhost:3308/event-store',
  redisUrl: process.env.EVENT_SOURCE_REDIS_URL || 'redis://127.0.0.1:6379/0',

  appSecret: process.env.APP_SECRET || 'secret',

  sentry: {
    dsn: process.env.SENTRY_DSN || ''
  },

  logger: {
    name: process.env.LOGGER_NAME || 'service'
  },

  permission: {
    adminUserIds: (process.env.ADMIN_USER_IDS || 'akinoniku').split(','),
    hackHeader: process.env.HACK_HEADER || undefined
  },

  S3: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: process.env.S3_SECRET_ACCESSkEY || undefined,
    bucketNameAttachment: process.env.S3_BUCKET_NAME_ATTACHMENT || 's3-bucket-name'
  },

  weixin: {
    callbackDomain: process.env.WEIXIN_CALLBACK_DOMAIN || '',
    clientId: process.env.WEIXIN_CLIENT_ID || 'test',
    clientSecret: process.env.WEIXIN_CLIENT_SECRET || ''
  },

  auth0: {
    callbackDomain: process.env.AUTH0_CALLBACK_DOMAIN || '',
    domain: process.env.AUTH0_DOMAIN || '',
    clientId: process.env.AUTH0_CLIENT_ID || '',
    clientSecret: process.env.AUTH0_CLIENT_SECRET || ''
  },

  cos: {
    secretId: process.env.TENCENT_SECRET_ID || undefined,
    secretKey: process.env.TENCENT_SECRET_KEY || undefined,
    region: process.env.TENCENT_COS_REGION || 'ap-guangzhou',
    bucketNameAttachment: process.env.TENCENT_COS_BUCKET_NAME_ATTACHMENT || ''
  },

  attachment: {
    use: (process.env.ATTACHMENT_USE || 'TC') as 'TC' | 'AWS'
  },

  eventStore: {
    waitQueuePrefix: process.env.WAIT_QUEUE_PREFIX || 'service', // unique for each micro-service
    applyQueuePrefix: process.env.APPLY_QUEUE_PREFIX || process.env.HOST || uuid() // unique for each instance / pod
  }
};
