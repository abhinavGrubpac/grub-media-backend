import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailerService } from './mailer.service';

const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test-id' });
const mockCreateTransport = jest.fn().mockReturnValue({ sendMail: mockSendMail });

jest.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => mockCreateTransport(...args),
}));

const configValues: Record<string, unknown> = {
  'mailer.configured': true,
  'mailer.host': 'smtp.test.com',
  'mailer.port': 587,
  'mailer.secure': false,
  'mailer.user': 'user@test.com',
  'mailer.pass': 'secret',
  'mailer.from': 'noreply@grubpac.com',
  'mailer.frontendUrl': 'http://localhost:3000',
};

describe('MailerService', () => {
  let service: MailerService;

  beforeEach(async () => {
    mockSendMail.mockClear();
    mockCreateTransport.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailerService,
        {
          provide: ConfigService,
          useValue: {
            get: <T>(key: string, defaultValue?: T): T | unknown =>
              configValues[key] ?? defaultValue,
          },
        },
      ],
    }).compile();

    service = module.get<MailerService>(MailerService);
    service.onModuleInit();
  });

  it('creates transporter with SMTP config on init', () => {
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.test.com', port: 587 }),
    );
  });

  it('sends OTP email with code in body', async () => {
    await service.sendOtp('user@example.com', '1234');
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: expect.stringContaining('login code'),
        text: expect.stringContaining('1234'),
        html: expect.stringContaining('1234'),
      }),
    );
  });

  it('sends password reset email with encoded token in link', async () => {
    await service.sendPasswordResetLink('user@example.com', 'raw-tok-en=abc');
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: expect.stringContaining('password'),
        text: expect.stringContaining('raw-tok-en%3Dabc'),
      }),
    );
  });
});
