import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './modules/auth/decorators/public.decorator';

/**
 * Public landing response at the API root (`/api/v1`) so anyone opening the
 * shared tunnel link can confirm the service is live and find the docs/health
 * endpoints instead of getting a bare 404.
 */
@ApiTags('Meta')
@Controller({ version: '1' })
export class AppController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'API index — service status and documentation links' })
  index(): { name: string; status: string; apiBase: string; docs: string; health: string } {
    return {
      name: 'grub-media-backend',
      status: 'ok',
      apiBase: '/api/v1',
      docs: '/api/docs',
      health: '/api/health',
    };
  }
}
