import type { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service.js';

function makeCrypto(keyBytes = 32): CryptoService {
  const key = Buffer.alloc(keyBytes, 7).toString('base64');
  const config = { get: () => key } as unknown as ConfigService;
  const crypto = new CryptoService(config);
  crypto.onModuleInit();
  return crypto;
}

describe('CryptoService', () => {
  it('round-trips encrypt/decrypt', () => {
    const crypto = makeCrypto();
    const enc = crypto.encrypt('npsso-secret-token');
    expect(enc).not.toContain('npsso-secret-token');
    expect(crypto.decrypt(enc)).toBe('npsso-secret-token');
  });

  it('produces different ciphertext each time (random IV)', () => {
    const crypto = makeCrypto();
    expect(crypto.encrypt('same')).not.toBe(crypto.encrypt('same'));
  });

  it('fails to decrypt tampered ciphertext', () => {
    const crypto = makeCrypto();
    const buf = Buffer.from(crypto.encrypt('secret'), 'base64');
    buf[buf.length - 1] ^= 0xff; // flip a bit in the ciphertext
    expect(() => crypto.decrypt(buf.toString('base64'))).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => makeCrypto(16)).toThrow();
  });
});
