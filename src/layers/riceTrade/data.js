import worldCountries from 'world-countries';

export const RICE_TRADE_COUNTRY_COUNT = 100;
export const RICE_TRADE_FLOW_COUNT = 200;

// Explicitly use sovereign states rather than all ISO 3166 territories.
// world-countries coordinates are country reference points, NOT production sites/ports.
const COUNTRY_POOL = worldCountries
  .filter((country) =>
    country.independent === true &&
    typeof country.cca3 === 'string' &&
    Array.isArray(country.latlng) &&
    country.latlng.length === 2 &&
    country.latlng.every(Number.isFinite) &&
    Math.abs(country.latlng[0]) <= 90 &&
    Math.abs(country.latlng[1]) <= 180,
  )
  .map((country) => ({
    id: country.cca3,
    name: country.name.common,
    lat: country.latlng[0],
    lon: country.latlng[1],
  }));

// Reproducible pseudo-random generator: changing seed produces a new scenario.
function makeRandom(seed) {
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Generates mock bilateral flows; all 100 sampled countries appear at least once. */
export function generateRiceTradeData({
  seed = 20261014,
  countryCount = RICE_TRADE_COUNTRY_COUNT,
  flowCount = RICE_TRADE_FLOW_COUNT,
} = {}) {
  if (!Number.isInteger(countryCount) || countryCount < 2 || countryCount > COUNTRY_POOL.length)
    throw new RangeError(`countryCount must be 2..${COUNTRY_POOL.length}`);
  if (!Number.isInteger(flowCount) || flowCount < countryCount || flowCount > countryCount * (countryCount - 1))
    throw new RangeError('flowCount must be between countryCount and its max directed pairs');

  const random = makeRandom(seed);
  const countries = shuffle(COUNTRY_POOL, random).slice(0, countryCount);
  const flows = [];
  const pairs = new Set();

  function addFlow(from, to) {
    if (from.id === to.id) return false;
    const key = `${from.id}:${to.id}`;
    if (pairs.has(key)) return false;
    pairs.add(key);
    const volumeKt = 1 + Math.floor(random() * 500); // 1-500 thousand metric tonnes/year
    flows.push({
      id: `rice-${flows.length + 1}`,
      from,
      to,
      volumeKt,
      simulated: true,
      phase: random(),
      durationSeconds: 7 + random() * 9,
    });
    return true;
  }

  // A ring guarantees every selected country participates in at least one trade flow.
  for (let i = 0; i < countries.length; i++)
    addFlow(countries[i], countries[(i + 1) % countries.length]);

  // Additional random, unique directed country pairs.
  while (flows.length < flowCount) {
    const from = countries[Math.floor(random() * countries.length)];
    const to = countries[Math.floor(random() * countries.length)];
    addFlow(from, to);
  }

  return { seed, countries, flows, units: 'thousand tonnes per year', simulated: true };
}
