import appConfig from './app.config';
import databaseConfig from './database.config';
import jwtConfig from './jwt.config';
import redisConfig from './redis.config';
import throttleConfig from './throttle.config';

export { appConfig, databaseConfig, jwtConfig, redisConfig, throttleConfig };

/** Loaders passed to ConfigModule.forRoot({ load: configLoaders }). */
export const configLoaders = [appConfig, databaseConfig, jwtConfig, redisConfig, throttleConfig];
