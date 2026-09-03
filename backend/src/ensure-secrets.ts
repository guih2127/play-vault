import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const GENERATED: Record<string, () => string> = {
  JWT_SECRET: () => randomBytes(48).toString('base64'),
  ENCRYPTION_KEY: () => randomBytes(32).toString('base64'),
};

/**
 * Resolve required secrets before the app boots.
 *
 * Priority: real environment variables (injected by the host in production) always win. Only
 * when a secret is absent from the environment do we fall back to a local `.env` file — and
 * only in development do we auto-generate and persist a missing one.
 *
 * In production a missing secret is a hard error. Silently generating one would write it to an
 * ephemeral filesystem, so it would change on the next deploy — logging every user out and
 * making already-encrypted PSN tokens permanently undecryptable.
 */
export function ensureSecrets(): void {
  const isProd = process.env.NODE_ENV === 'production';
  const envPath = join(process.cwd(), '.env');
  const examplePath = join(process.cwd(), '.env.example');

  let content = '';
  if (existsSync(envPath)) content = readFileSync(envPath, 'utf8');
  else if (existsSync(examplePath)) content = readFileSync(examplePath, 'utf8');

  let changed = !existsSync(envPath);
  const generated: string[] = [];
  const missing: string[] = [];

  for (const [key, gen] of Object.entries(GENERATED)) {
    // 1. Already provided by the host environment — always wins.
    if (process.env[key]?.trim()) continue;

    // 2. Present in a local .env file.
    const re = new RegExp(`^${key}=(.*)$`, 'm');
    const match = content.match(re);
    const current = match?.[1]?.trim();
    if (current) {
      process.env[key] = current;
      continue;
    }

    // 3. Missing everywhere. In production this is fatal; in dev we generate one.
    if (isProd) {
      missing.push(key);
      continue;
    }
    const value = gen();
    content = match
      ? content.replace(re, `${key}=${value}`)
      : `${content}${content && !content.endsWith('\n') ? '\n' : ''}${key}=${value}\n`;
    process.env[key] = value;
    generated.push(key);
    changed = true;
  }

  if (missing.length) {
    throw new Error(
      `Missing required secret(s) in production: ${missing.join(', ')}. ` +
        `Set them as environment variables — do not rely on the auto-generated .env, which lives ` +
        `on an ephemeral filesystem and is lost on redeploy (rotating it logs out every user and ` +
        `makes stored PSN tokens undecryptable). ` +
        `Generate values with: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`,
    );
  }

  // Never write secrets to disk in production (the FS is ephemeral and the values are managed
  // by the host). In dev, persist so the same secrets survive restarts.
  if (!isProd && changed) writeFileSync(envPath, content);
  if (generated.length) {
    console.log(`[ensure-secrets] generated and saved to .env: ${generated.join(', ')}`);
  }
}
