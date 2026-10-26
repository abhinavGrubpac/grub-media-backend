import { Geocoder } from './geocoder';

const okResponse = (
  lat: string,
  lon: string,
): { ok: boolean; status: number; json: () => Promise<Array<{ lat: string; lon: string }>> } => ({
  ok: true,
  status: 200,
  json: async () => [{ lat, lon }],
});

/** Fresh geocoder per test: isolated memory cache, stubbed fetch, no Redis. */
function makeGeocoder(fetchImpl: jest.Mock): Geocoder {
  const geocoder = new Geocoder();
  (geocoder as unknown as { fetchImpl: jest.Mock }).fetchImpl = fetchImpl;
  return geocoder;
}

describe('Geocoder.geocodePlace', () => {
  it('resolves a place via the provider and returns validated coordinates', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse('19.9975', '73.7898'));
    const geocoder = makeGeocoder(fetchImpl);

    const point = await geocoder.geocodePlace('Nashik');

    expect(point).toEqual({ lat: 19.9975, lng: 73.7898 });
    const url = decodeURIComponent(fetchImpl.mock.calls[0][0] as string);
    expect(url).toContain('q=Nashik');
    expect(url).toContain('countrycodes=in');
    expect(url).toContain('format=json');
  });

  it('caches hits (one provider call for repeated lookups)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse('19.0', '73.0'));
    const geocoder = makeGeocoder(fetchImpl);

    await geocoder.geocodePlace('Nashik');
    await geocoder.geocodePlace('Nashik');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns null for an unknown place and caches the miss', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    const geocoder = makeGeocoder(fetchImpl);

    expect(await geocoder.geocodePlace('Atlantis')).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await geocoder.geocodePlace('Atlantis')).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never throws: provider outage resolves to null', async () => {
    const geocoder = makeGeocoder(jest.fn().mockRejectedValue(new Error('boom')));
    expect(await geocoder.geocodePlace('Nashik')).toBeNull();
  });

  it('returns null for blank input without a network call', async () => {
    const fetchImpl = jest.fn();
    const geocoder = makeGeocoder(fetchImpl);
    expect(await geocoder.geocodePlace('   ')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
