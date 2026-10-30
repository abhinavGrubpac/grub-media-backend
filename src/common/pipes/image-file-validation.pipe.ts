import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  PipeTransform,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

@Injectable()
export class ImageFileValidationPipe implements PipeTransform<Express.Multer.File> {
  transform(file: Express.Multer.File): Express.Multer.File {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      throw new UnsupportedMediaTypeException(
        `Unsupported file type "${file.mimetype}". Allowed: ${ALLOWED_MIME.join(', ')}`,
      );
    }
    if (file.size > MAX_BYTES) {
      throw new PayloadTooLargeException('Image must be under 5 MB');
    }
    return file;
  }
}
