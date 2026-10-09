import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ERROR_CODES } from '../constants/error-codes';

/**
 * Domain exceptions carry a stable `errorCode` alongside the message. The global
 * AllExceptionsFilter reads `errorCode` from the HttpException response body.
 * Only create a custom exception where it adds semantic value over the built-ins.
 */
export class EmailAlreadyExistsException extends ConflictException {
  constructor() {
    super({ message: 'Email already in use', errorCode: ERROR_CODES.CONFLICT });
  }
}

export class UserNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'User not found', errorCode: ERROR_CODES.NOT_FOUND });
  }
}

export class InvalidCredentialsException extends UnauthorizedException {
  constructor() {
    super({ message: 'Invalid credentials', errorCode: ERROR_CODES.UNAUTHORIZED });
  }
}

export class HelpCategoryNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Help category not found', errorCode: ERROR_CODES.NOT_FOUND });
  }
}

export class HelpFaqNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Help FAQ not found', errorCode: ERROR_CODES.NOT_FOUND });
  }
}
