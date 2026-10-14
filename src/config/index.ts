import appConfig from './app.config';
import databaseConfig from './database.config';
import jwtConfig from './jwt.config';
import mailerConfig from './mailer.config';
import redisConfig from './redis.config';
import s3Config from './s3.config';
import throttleConfig from './throttle.config';

export {
  appConfig,
  databaseConfig,
  jwtConfig,
  mailerConfig,
  redisConfig,
  s3Config,
  throttleConfig,
};

/** Loaders passed to ConfigModule.forRoot({ load: configLoaders }). */
export const configLoaders = [
  appConfig,
  databaseConfig,
  jwtConfig,
  mailerConfig,
  redisConfig,
  s3Config,
  throttleConfig,
];
