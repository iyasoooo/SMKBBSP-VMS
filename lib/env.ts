import { z } from 'zod';

/**
 * Fail-fast environment validation.
 *
 * This module is imported by every server entry point that touches the
 * database, crypto, or mail. A misconfigured secret must stop the process at
 * boot rather than silently degrade to an insecure default at runtime.
 */

/** A base64-encoded 32-byte key, the size required by AES-256 and HMAC-SHA-256. */
const base64Key32 = z
  .string()
  .min(1, 'required')
  .refine((value) => !value.startsWith('CHANGE_ME'), {
    message: 'still set to the .env.example placeholder - generate a real key',
  })
  .refine(
    (value) => {
      try {
        return Buffer.from(value, 'base64').length === 32;
      } catch {
        return false;
      }
    },
    { message: 'must decode to exactly 32 bytes of base64' },
  );

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'required').startsWith('postgres'),

  APP_URL: z.url('must be an absolute URL, e.g. http://localhost:3000'),
  APP_TIMEZONE: z.string().min(1).default('Asia/Kuala_Lumpur'),

  SESSION_SECRET: base64Key32,
  IDENTITY_ENCRYPTION_KEY: base64Key32,
  IDENTITY_HMAC_KEY: base64Key32,
  IDENTITY_KEY_VERSION: z.coerce.number().int().positive().default(1),

  SMTP_HOST: z.string().min(1).default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: booleanish.default(false),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  MAIL_FROM_NAME: z.string().min(1).default('SMKBBSP Visitor Management System'),
  MAIL_FROM_ADDRESS: z.email().default('visitorpass@smkbbsp.test'),

  SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin#Demo2025'),
  SEED_GUARD_PASSWORD: z.string().min(8).default('Guard#Demo2025'),
  SEED_TEACHER_PASSWORD: z.string().min(8).default('Teacher#Demo2025'),

  /*
   * OCR assistance. Reading runs on an Ollama host that this server talks to;
   * the browser never addresses it, which is what keeps `connect-src 'self'`
   * intact and stops the model endpoint from being reachable from a page.
   *
   * Left empty, the OCR panel disappears entirely rather than failing at the
   * moment someone tries to use it. A school without a model host gets a form
   * that is simply typed in, which is the honest degradation.
   */
  OCR_OLLAMA_URL: z.string().default(''),
  /*
   * Pinned by name on purpose. An Ollama install can carry cloud-routed models
   * alongside local ones - `*:cloud` tags proxy to ollama.com - and defaulting
   * to whatever happens to be installed would eventually send a photograph of
   * someone's identity card to a third party. This value is compared against
   * the host's model list at call time and a mismatch is refused.
   */
  OCR_OLLAMA_MODEL: z.string().min(1).default('qwen3.5:0.8b'),
  /** How long one page is given to read a card before the request is dropped. */
  OCR_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/**
 * Parse and cache `process.env`.
 *
 * Throws a message that names the offending variables but never echoes their
 * values, so a boot failure cannot leak a secret into logs or a terminal
 * screenshot.
 */
export function getEnv(): AppEnv {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(
      'Invalid environment configuration. Fix these variables in your .env file:\n' +
        `${formatIssues(parsed.error)}\n\n` +
        'See .env.example for the expected shape and key-generation command.',
    );
  }

  const env = parsed.data;

  // Distinct-secret check: reusing one key across purposes means a single
  // leak compromises sessions, matching, and stored identities together.
  const secrets = [env.SESSION_SECRET, env.IDENTITY_ENCRYPTION_KEY, env.IDENTITY_HMAC_KEY];
  if (new Set(secrets).size !== secrets.length) {
    throw new Error(
      'SESSION_SECRET, IDENTITY_ENCRYPTION_KEY and IDENTITY_HMAC_KEY must all be different.',
    );
  }

  cached = env;
  return env;
}

/** Test-only reset so a suite can exercise different configurations. */
export function resetEnvCache(): void {
  cached = null;
}

export const isProduction = (): boolean => getEnv().NODE_ENV === 'production';
