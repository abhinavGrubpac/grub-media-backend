import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';

export class EmailAlreadyExistsException extends ConflictException {
  constructor() {
    super({ message: 'Email already in use', errorCode: 'CONFLICT' });
  }
}

export class UserNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'User not found', errorCode: 'NOT_FOUND' });
  }
}

export class InvalidCredentialsException extends UnauthorizedException {
  constructor() {
    super({ message: 'Invalid credentials', errorCode: 'UNAUTHORIZED' });
  }
}
