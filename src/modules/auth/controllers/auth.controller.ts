import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LogType } from '@prisma/client';
import type { Request } from 'express';
import { AuthService } from '../services/auth.service';
import { LogsService } from '../../logs/services/logs.service';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { LoginDto } from '../dto/login.dto';
import { OtpRequestDto } from '../dto/otp-request.dto';
import { OtpVerifyDto } from '../dto/otp-verify.dto';
import { RefreshDto } from '../dto/refresh.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { AuthResponseDto, TokenResponseDto } from '../dto/auth-response.dto';
import { Public } from '../decorators/public.decorator';
import { CurrentUser, AuthUser } from '../decorators/current-user.decorator';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { UserResponseDto } from '../../users/dto/user-response.dto';

function ctxOf(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('Authentication')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly logs: LogsService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate and receive access + refresh tokens' })
  @ResponseMessage('Logged in successfully')
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<AuthResponseDto> {
    return this.auth.login(dto, ctxOf(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token for a new token pair' })
  @ResponseMessage('Token refreshed')
  refresh(@Body() dto: RefreshDto, @Req() req: Request): Promise<TokenResponseDto> {
    return this.auth.refresh(dto.refreshToken, ctxOf(req));
  }

  @Public()
  @Post('login/otp-request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a 4-digit OTP login code via email' })
  @ResponseMessage('OTP sent to your registered email')
  async requestOtpLogin(@Body() dto: OtpRequestDto, @Req() req: Request): Promise<null> {
    await this.auth.requestOtpLogin(dto, ctxOf(req as never));
    return null;
  }

  @Public()
  @Post('login/otp-verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP code and receive access + refresh tokens' })
  @ResponseMessage('OTP verified. You are now logged in.')
  verifyOtpLogin(@Body() dto: OtpVerifyDto, @Req() req: Request): Promise<AuthResponseDto> {
    return this.auth.verifyOtpLogin(dto, ctxOf(req));
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset link via email' })
  @ResponseMessage('Password reset link sent to your email')
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<null> {
    await this.auth.forgotPassword(dto);
    return null;
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using the token from the reset link' })
  @ResponseMessage('Password reset successfully')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<null> {
    await this.auth.resetPassword(dto);
    return null;
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke all sessions for the current user' })
  @ResponseMessage('Logged out')
  async logout(@CurrentUser() user: AuthUser): Promise<null> {
    await this.auth.logout(user.id);
    return null;
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Get the current authenticated user' })
  @ResponseMessage('Current user')
  async me(@CurrentUser() user: AuthUser): Promise<UserResponseDto> {
    const profile = await this.auth.me(user.id);
    await this.logs.record({
      typeEnum: LogType.ACTIVITY,
      categoryName: 'Profile',
      actionName: 'View Profile',
      actionText: 'Viewed the profile of the signed-in user',
      userId: user.id,
      target: user.id,
    });
    return profile;
  }
}
