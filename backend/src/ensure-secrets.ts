import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const GENERATED: Record<string, () => string> = {
  JWT_SECRET: () => randomBytes(48).toString('base64'),
  ENCRYPTION_KEY: () => randomBytes(32).toString('base64'),
};

export function ensureSecrets(): void {
  const envPath = join(process.cwd(), '.env');
  const examplePath = join(process.cwd(), '.env.example');

  let content = '';
  if (existsSync(envPath)) content = readFileSync(envPath, 'utf8');
  else if (existsSync(examplePath)) content = readFileSync(examplePath, 'utf8');

  let changed = !existsSync(envPath);
  const generated: string[] = [];

  for (const [key, gen] of Object.entries(GENERATED)) {
    const re = new RegExp(`^${key}=(.*)$`, 'm');
    const match = content.match(re);
    const current = match?.[1]?.trim();
    if (current) {
      process.env[key] = current;
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

  if (changed) writeFileSync(envPath, content);
  if (generated.length) {
    console.log(`[ensure-secrets] generated and saved to .env: ${generated.join(', ')}`);
  }
}
