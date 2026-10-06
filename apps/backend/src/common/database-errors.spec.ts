import { Prisma } from '@prisma/client';
import { isDatabaseUnavailable } from './all-exceptions.filter';
import { withConnectionTimeouts } from './prisma.service';

describe('database connection handling', () => {
  it('gives a remote database time to open connections, keeping values the URL already sets', () => {
    expect(withConnectionTimeouts('postgresql://u:p@h:5432/db')).toBe('postgresql://u:p@h:5432/db?connect_timeout=30&pool_timeout=30');
    expect(withConnectionTimeouts('postgresql://u:p@h:5432/db?connection_limit=5')).toBe('postgresql://u:p@h:5432/db?connection_limit=5&connect_timeout=30&pool_timeout=30');
    expect(withConnectionTimeouts('postgresql://u:p@h/db?connect_timeout=10')).toBe('postgresql://u:p@h/db?connect_timeout=10&pool_timeout=30');
    // a password containing "@" is left exactly as written
    expect(withConnectionTimeouts('postgresql://u:p@ss@h/db')).toBe('postgresql://u:p@ss@h/db?connect_timeout=30&pool_timeout=30');
    expect(withConnectionTimeouts(undefined)).toBeUndefined();
  });

  it('treats connection failures as "database unavailable", not as ordinary errors', () => {
    const known = (code: string) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test' });
    expect(isDatabaseUnavailable(known('P1001'))).toBe(true);
    expect(isDatabaseUnavailable(known('P2024'))).toBe(true);
    expect(isDatabaseUnavailable(new Prisma.PrismaClientInitializationError("Can't reach database server", 'test'))).toBe(true);
    expect(isDatabaseUnavailable(known('P2002'))).toBe(false);
    expect(isDatabaseUnavailable(new Error('boom'))).toBe(false);
  });
});
