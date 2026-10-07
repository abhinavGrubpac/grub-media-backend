import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE = 'response_message';

/** Sets the human-readable `message` used by the global ResponseInterceptor. */
export const ResponseMessage = (message: string) => SetMetadata(RESPONSE_MESSAGE, message);
