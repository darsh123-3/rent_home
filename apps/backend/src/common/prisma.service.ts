import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma waits only 5 s to open a connection (connect_timeout) and 10 s for a free one (pool_timeout). A Supabase
 * database in another region can take 3-5 s just to open a connection, so screens that run several queries at once
 * failed with a 500 after ~5 s. Unless the URL sets them, allow 30 s for both. The URL is edited as text, not parsed,
 * so passwords with special characters stay exactly as written.
 */
export function withConnectionTimeouts(url: string | undefined) {
  if (!url) return url;
  const extra = [['connect_timeout', '30'], ['pool_timeout', '30']].filter(([k]) => !new RegExp(`[?&]${k}=`).test(url)).map(([k, v]) => `${k}=${v}`);
  return extra.length ? `${url}${url.includes('?') ? '&' : '?'}${extra.join('&')}` : url;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Prisma's default interactive-transaction limit is 5 s, too tight when the database is in another region
    // (e.g. Supabase from a laptop or a Render free instance): it fails with "Transaction not found".
    super({
      datasourceUrl: withConnectionTimeouts(process.env.DATABASE_URL),
      transactionOptions: { maxWait: 15_000, timeout: 60_000 },
      ...(process.env.DEBUG_QUERIES ? { log: [{ emit: 'stdout' as const, level: 'query' as const }] } : {}),
    });
  }
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
