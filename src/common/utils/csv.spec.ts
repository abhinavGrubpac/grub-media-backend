import { toCsv, toCsvCell, toCsvRow } from './csv';

describe('toCsvCell', () => {
  it('passes plain values through as strings', () => {
    expect(toCsvCell('Login')).toBe('Login');
    expect(toCsvCell(42)).toBe('42');
  });

  it('renders null/undefined as empty cells', () => {
    expect(toCsvCell(null)).toBe('');
    expect(toCsvCell(undefined)).toBe('');
  });

  it('renders Dates as ISO strings', () => {
    expect(toCsvCell(new Date('2026-10-10T10:00:00.000Z'))).toBe('2026-10-10T10:00:00.000Z');
  });

  it('quotes cells containing separators or line breaks', () => {
    expect(toCsvCell('Leave, Approval')).toBe('"Leave, Approval"');
    expect(toCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('doubles embedded quotes', () => {
    expect(toCsvCell('He said "hi"')).toBe('"He said ""hi"""');
  });
});

describe('toCsvRow', () => {
  it('joins cells with commas in order', () => {
    expect(toCsvRow([1, 'a', null])).toBe('1,a,');
  });
});

describe('toCsv', () => {
  it('writes the header then rows, CRLF separated', () => {
    expect(
      toCsv(
        ['id', 'name'],
        [
          [1, 'a'],
          [2, 'b'],
        ],
      ),
    ).toBe('id,name\r\n1,a\r\n2,b');
  });

  it('returns just the header when there are no rows', () => {
    expect(toCsv(['id', 'name'])).toBe('id,name');
  });
});
