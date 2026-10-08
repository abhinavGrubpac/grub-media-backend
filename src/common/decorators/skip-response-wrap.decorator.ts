import { SetMetadata } from '@nestjs/common';

export const SKIP_RESPONSE_WRAP = 'skip_response_wrap';

/**
 * Marks a route whose payload must be returned verbatim (NOT wrapped in the
 * standard {success,message,data} envelope). Use for endpoints with their own
 * response contract — e.g. the Terminus health check, which has a well-known
 * shape that monitoring tools parse directly.
 */
export const SkipResponseWrap = () => SetMetadata(SKIP_RESPONSE_WRAP, true);
