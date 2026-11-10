// The planets of Cosmos Space. Every chain is read through the same standard
// Cosmos SDK LCD routes, so adding one is just another entry here.
// Endpoints are tried in order with automatic failover.

export const PLANETS = [
  {
    key: 'juno', chainId: 'juno-1', name: 'Juno', symbol: 'JUNO', prefix: 'juno', color: '#f0827d',
    explorer: 'https://ping.pub/juno', simHeight: 43_000_000, simBlockTime: 2.8,
    endpoints: ['https://juno-rest.publicnode.com', 'https://juno-api.polkachu.com', 'https://rest.cosmos.directory/juno'],
  },
  {
    key: 'cosmoshub', chainId: 'cosmoshub-4', name: 'Cosmos Hub', symbol: 'ATOM', prefix: 'cosmos', color: '#6f7bf7', hub: true,
    explorer: 'https://ping.pub/cosmos', simHeight: 33_900_000, simBlockTime: 5.6,
    endpoints: ['https://cosmos-rest.publicnode.com', 'https://cosmos-api.polkachu.com', 'https://rest.cosmos.directory/cosmoshub'],
  },
  {
    key: 'osmosis', chainId: 'osmosis-1', name: 'Osmosis', symbol: 'OSMO', prefix: 'osmo', color: '#b565f5',
    explorer: 'https://ping.pub/osmosis', simHeight: 62_000_000, simBlockTime: 1.4,
    endpoints: ['https://osmosis-rest.publicnode.com', 'https://lcd.osmosis.zone', 'https://osmosis-api.polkachu.com', 'https://rest.cosmos.directory/osmosis'],
  },
  {
    key: 'neutron', chainId: 'neutron-1', name: 'Neutron', symbol: 'NTRN', prefix: 'neutron', color: '#6cc4f5',
    explorer: 'https://ping.pub/neutron', simHeight: 51_000_000, simBlockTime: 1.2,
    endpoints: ['https://neutron-api.polkachu.com', 'https://rest.lavenderfive.com/neutron', 'https://rest.cosmos.directory/neutron'],
  },
  {
    key: 'akash', chainId: 'akashnet-2', name: 'Akash', symbol: 'AKT', prefix: 'akash', color: '#ff4f5a',
    explorer: 'https://ping.pub/akash', simHeight: 29_400_000, simBlockTime: 6.1,
    endpoints: ['https://akash-rest.publicnode.com', 'https://akash-api.polkachu.com', 'https://rest.cosmos.directory/akash'],
  },
];

export const planetByKey = (key) => PLANETS.find((p) => p.key === key) || null;
