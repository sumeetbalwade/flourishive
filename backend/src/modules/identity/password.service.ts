import { BadRequestException, Injectable } from '@nestjs/common';
import { argon2Verify, argon2id } from 'hash-wasm';
import { randomBytes } from 'node:crypto';

// OWASP-recommended argon2id floor: 19 MiB, 2 passes, 1 lane. Pure WASM, so it
// runs on shared hosting without native modules.
const PARAMS = {
  parallelism: 1,
  iterations: 2,
  memorySize: 19 * 1024,
  hashLength: 32,
} as const;

export const MIN_PASSWORD_LENGTH = 12;

@Injectable()
export class PasswordService {
  /** Basic policy; the per-tenant password policy setting arrives with the settings module. */
  assertAcceptable(password: string): void {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    if (password.length > 256)
      throw new BadRequestException('Password is too long');
  }

  hash(password: string): Promise<string> {
    return argon2id({
      password,
      salt: randomBytes(16),
      outputType: 'encoded',
      ...PARAMS,
    });
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    try {
      return await argon2Verify({ password, hash: encoded });
    } catch {
      return false;
    }
  }

  /** Burns the same time as a real check so unknown emails are not detectable by latency. */
  private dummy?: Promise<string>;
  async verifyDummy(password: string): Promise<void> {
    this.dummy ??= this.hash('dummy-password-for-timing');
    await this.verify(password, await this.dummy);
  }
}
