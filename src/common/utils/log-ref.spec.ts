import { logRefOf } from './log-ref';

describe('logRefOf', () => {
  it('prefers the employeeId code when present', () => {
    expect(logRefOf({ id: 'u1', email: 'a@b.c', employeeId: 'EMP-001' })).toBe('EMP-001');
  });

  it('falls back to the email when employeeId is empty (User default)', () => {
    expect(logRefOf({ id: 'u1', email: 'a@b.c', employeeId: '' })).toBe('a@b.c');
  });

  it('falls back to the email when employeeId is null/undefined', () => {
    expect(logRefOf({ id: 'u1', email: 'a@b.c', employeeId: null })).toBe('a@b.c');
    expect(logRefOf({ id: 'u1', email: 'a@b.c' })).toBe('a@b.c');
  });

  it('falls back to the id when both employeeId and email are missing', () => {
    expect(logRefOf({ id: 'u1', email: null, employeeId: '' })).toBe('u1');
    expect(logRefOf({ id: 'u1' })).toBe('u1');
  });

  it('returns "unknown" for a null/undefined user', () => {
    expect(logRefOf(null)).toBe('unknown');
    expect(logRefOf(undefined)).toBe('unknown');
  });
});
