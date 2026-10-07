import appConfig from './app.config';
import databaseConfig from './database.config';
import jwtConfig from './jwt.config';
import kafkaConfig from './kafka.config';
import redisConfig from './redis.config';
import storageConfig from './storage.config';
import throttleConfig from './throttle.config';

export {
  appConfig,
  databaseConfig,
  jwtConfig,
  kafkaConfig,
  redisConfig,
  storageConfig,
  throttleConfig,
};

/** Loaders passed to ConfigModule.forRoot({ load: configLoaders }). */
export const configLoaders = [
  appConfig,
  databaseConfig,
  jwtConfig,
  kafkaConfig,
  redisConfig,
  storageConfig,
  throttleConfig,
];
