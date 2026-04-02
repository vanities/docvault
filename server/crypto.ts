// =============================================================================
// Crypto Balance Queries & Trade History
// =============================================================================
// Fetches balances from exchanges (Coinbase, Gemini, Kraken) and on-chain
// wallets (BTC via Blockstream, ETH via Etherscan/public RPC).
// Prices from CoinGecko free API (no key required).
// Trade history from exchange APIs for cost basis / gains tracking.

import crypto from 'crypto';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface ExchangeConfig {
  id: 'coinbase' | 'gemini' | 'kraken';
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  enabled: boolean;
}

interface WalletConfig {
  id: string;
  address: string;
  chain: 'btc' | 'eth';
  label: string;
}

interface Balance {
  asset: string;
  amount: number;
  usdValue?: number;
}

interface SourceBalance {
  sourceId: string;
  sourceType: 'exchange' | 'wallet';
  label: string;
  balances: Balance[];
  totalUsdValue: number;
  error?: string;
  lastUpdated: string;
}

// Trade history types for cost basis tracking
export interface CryptoTrade {
  asset: string; // Normalized symbol (BTC, ETH, etc.)
  side: 'buy' | 'sell';
  amount: number;
  priceUsd: number; // Price per unit in USD at time of trade
  totalCost: number; // amount * priceUsd + fee
  fee: number;
  timestamp: string; // ISO date string
  source: string; // Exchange ID
}

export interface CryptoAssetGains {
  asset: string;
  totalAmount: number;
  totalCostBasis: number;
  currentValue: number;
  unrealizedGain: number;
  shortTermGain: number; // Gains on lots held < 1 year
  longTermGain: number; // Gains on lots held >= 1 year
  lots: {
    amount: number;
    costPerUnit: number;
    date: string;
    gainType: 'short-term' | 'long-term';
  }[];
}

export interface CryptoGainsSummary {
  assets: CryptoAssetGains[];
  totalCostBasis: number;
  totalCurrentValue: number;
  totalUnrealizedGain: number;
  totalShortTermGain: number;
  totalLongTermGain: number;
  lastUpdated: string;
  tradeCount: number;
}

// -----------------------------------------------------------------------------
// Price Cache (CoinGecko, 60s TTL)
// -----------------------------------------------------------------------------

let priceCache: Record<string, number> = {};
let priceCacheTime = 0;
const PRICE_CACHE_TTL = 60_000; // 1 minute

// Map asset symbols (UPPERCASE) to CoinGecko IDs
// All keys must be uppercase — lookups use .toUpperCase()
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  USDC: 'usd-coin',
  USDT: 'tether',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  DOT: 'polkadot',
  LINK: 'chainlink',
  AVAX: 'avalanche-2',
  MATIC: 'matic-network',
  UNI: 'uniswap',
  ATOM: 'cosmos',
  XRP: 'ripple',
  LTC: 'litecoin',
  // Liquid staking
  STETH: 'staked-ether',
  RETH: 'rocket-pool-eth',
  RPL: 'rocket-pool',
  CBETH: 'coinbase-wrapped-staked-eth',
  SFRXETH: 'staked-frax-ether',
  // Wrapped
  WBTC: 'wrapped-bitcoin',
  WETH: 'weth',
  // Other
  AAVE: 'aave',
  SHIB: 'shiba-inu',
  DAI: 'dai',
  ARB: 'arbitrum',
  NEAR: 'near',
  RNDR: 'render-token',
  FET: 'fetch-ai',
  GRT: 'the-graph',
  BCH: 'bitcoin-cash',
  BNB: 'binancecoin',
  EIGEN: 'eigenlayer',
  BABY: 'babylon-labs',
  COMP: 'compound-governance-token',
  CRO: 'crypto-com-chain',
};

async function fetchPrices(assets: string[]): Promise<Record<string, number>> {
  const now = Date.now();
  if (now - priceCacheTime < PRICE_CACHE_TTL && Object.keys(priceCache).length > 0) {
    return priceCache;
  }

  // Map assets to CoinGecko IDs (lookup is case-insensitive)
  const uniqueUpper = [...new Set(assets.map((a) => a.toUpperCase()))];
  const ids = uniqueUpper.map((a) => COINGECKO_IDS[a]).filter(Boolean);

  if (ids.length === 0) return priceCache;

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;
    const res = await fetch(url);
    if (!res.ok) return priceCache; // Use stale cache on error

    const data = await res.json();

    // Build reverse map: UPPERCASE symbol -> price
    // Then also map original-case symbols so lookups work either way
    const prices: Record<string, number> = {};
    for (const [upperSymbol, cgId] of Object.entries(COINGECKO_IDS)) {
      if (data[cgId]?.usd) {
        prices[upperSymbol] = data[cgId].usd;
      }
    }
    // Also store prices keyed by original asset casing
    for (const asset of assets) {
      const upper = asset.toUpperCase();
      if (prices[upper] && !prices[asset]) {
        prices[asset] = prices[upper];
      }
    }
    // Stablecoins fallback
    if (!prices['USDC']) prices['USDC'] = 1;
    if (!prices['USDT']) prices['USDT'] = 1;
    if (!prices['USD']) prices['USD'] = 1;

    priceCache = prices;
    priceCacheTime = now;
    return prices;
  } catch {
    return priceCache;
  }
}

// -----------------------------------------------------------------------------
// Exchange: Coinbase (CDP API Keys — JWT auth)
// -----------------------------------------------------------------------------
// Coinbase CDP keys come in two flavors:
//   - Ed25519 (new default): private key is a raw base64 string (no PEM headers)
//   - ECDSA (legacy): private key is a PEM-encoded EC key
// We auto-detect based on whether the key has PEM headers.

function isEd25519Key(key: string): boolean {
  const cleaned = key.replace(/\\n/g, '\n').trim();
  return !cleaned.includes('-----BEGIN');
}

function buildCoinbaseJwt(apiKeyName: string, privateKey: string, uri: string): string {
  const isEd25519 = isEd25519Key(privateKey);

  // Header
  const header = {
    alg: isEd25519 ? 'EdDSA' : 'ES256',
    kid: apiKeyName,
    nonce: crypto.randomBytes(16).toString('hex'),
    typ: 'JWT',
  };

  // Payload
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: apiKeyName,
    iss: 'cdp',
    aud: ['cdp_service'],
    nbf: now,
    exp: now + 120, // 2 minute expiry
    uri,
  };

  const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');

  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  let sigB64: string;

  if (isEd25519) {
    // Ed25519: key is base64-encoded 64 bytes (32-byte seed + 32-byte pubkey)
    // Node's crypto.sign('Ed25519') needs a PKCS8-wrapped key or raw seed
    const keyBytes = Buffer.from(privateKey.replace(/\\n/g, '').replace(/\s/g, ''), 'base64');
    const seed = keyBytes.subarray(0, 32); // First 32 bytes = private seed

    // Wrap raw Ed25519 seed in PKCS8 DER format for Node's crypto API
    // PKCS8 prefix for Ed25519: 302e020100300506032b657004220420 + 32 bytes seed
    const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
    const pkcs8Der = Buffer.concat([pkcs8Prefix, seed]);

    const keyObject = crypto.createPrivateKey({
      key: pkcs8Der,
      format: 'der',
      type: 'pkcs8',
    });
    const sig = crypto.sign(null, Buffer.from(signingInput), keyObject);
    sigB64 = sig.toString('base64url');
  } else {
    // ECDSA (ES256): key is PEM-encoded EC private key
    const cleanPem = privateKey.replace(/\\n/g, '\n');
    const sign = crypto.createSign('SHA256');
    sign.update(signingInput);
    const derSig = sign.sign({ key: cleanPem, dsaEncoding: 'ieee-p1363' });
    sigB64 = derSig.toString('base64url');
  }

  return `${signingInput}.${sigB64}`;
}

async function fetchCoinbaseBalances(config: ExchangeConfig): Promise<Balance[]> {
  const method = 'GET';
  const requestPath = '/api/v3/brokerage/accounts';
  // URI in JWT should NOT include query params
  const uri = `${method} api.coinbase.com${requestPath}`;

  const jwt = buildCoinbaseJwt(config.apiKey, config.apiSecret, uri);
  console.log('[Coinbase] Key type:', isEd25519Key(config.apiSecret) ? 'Ed25519' : 'ECDSA');
  console.log('[Coinbase] URI:', uri);
  console.log('[Coinbase] Key name:', config.apiKey.substring(0, 30) + '...');

  const res = await fetch(`https://api.coinbase.com${requestPath}?limit=250`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('[Coinbase] Error response:', res.status, text);
    throw new Error(`Coinbase API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const balances: Balance[] = [];

  for (const account of data.accounts || []) {
    const amount = parseFloat(account.available_balance?.value || '0');
    if (amount > 0) {
      balances.push({
        asset: account.currency?.toUpperCase() || account.available_balance?.currency || 'UNKNOWN',
        amount,
      });
    }
  }

  return balances;
}

// -----------------------------------------------------------------------------
// Exchange: Gemini
// -----------------------------------------------------------------------------

async function fetchGeminiBalances(config: ExchangeConfig): Promise<Balance[]> {
  const nonce = Date.now().toString();
  const payload = JSON.stringify({
    request: '/v1/balances',
    nonce,
  });
  const encodedPayload = Buffer.from(payload).toString('base64');
  const signature = crypto
    .createHmac('sha384', config.apiSecret)
    .update(encodedPayload)
    .digest('hex');

  const res = await fetch('https://api.gemini.com/v1/balances', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'X-GEMINI-APIKEY': config.apiKey,
      'X-GEMINI-PAYLOAD': encodedPayload,
      'X-GEMINI-SIGNATURE': signature,
      'Cache-Control': 'no-cache',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const balances: Balance[] = [];

  for (const entry of data) {
    const amount = parseFloat(entry.amount || '0');
    if (amount > 0) {
      balances.push({
        asset: (entry.currency || 'UNKNOWN').toUpperCase(),
        amount,
      });
    }
  }

  return balances;
}

// -----------------------------------------------------------------------------
// Exchange: Kraken
// -----------------------------------------------------------------------------

// Kraken uses weird asset names: XXBT=BTC, XETH=ETH, ZUSD=USD, etc.
// Staked assets have suffixes: ETH2.S (staked), ETH2 (rewards), DOT.S, SOL.S, etc.
const KRAKEN_ASSET_MAP: Record<string, string> = {
  XXBT: 'BTC',
  XBT: 'BTC',
  XETH: 'ETH',
  ZUSD: 'USD',
  XXRP: 'XRP',
  XLTC: 'LTC',
  XXDG: 'DOGE',
  XSOL: 'SOL',
  XXLM: 'XLM',
  DOT: 'DOT',
  ADA: 'ADA',
  USDC: 'USDC',
  USDT: 'USDT',
  EIGEN: 'EIGEN',
  // Staked asset variants → map to base asset
  'ETH2.S': 'ETH',
  ETH2: 'ETH',
  'XBT.M': 'BTC',
  'XBT.P': 'BTC',
  'XBT.S': 'BTC',
  'DOT.S': 'DOT',
  'DOT28.S': 'DOT',
  'SOL.S': 'SOL',
  'ADA.S': 'ADA',
  'ATOM.S': 'ATOM',
  'MATIC.S': 'MATIC',
  'FLOW.S': 'FLOW',
  'ALGO.S': 'ALGO',
  'MINA.S': 'MINA',
  'KAVA.S': 'KAVA',
  'TRX.S': 'TRX',
  'SCRT.S': 'SCRT',
  'XTZ.S': 'XTZ',
  'KSM.S': 'KSM',
};

// Kraken pair map — trade pairs use different prefixes than balance assets
const KRAKEN_PAIR_MAP: Record<string, string> = {
  XXBT: 'BTC',
  XBT: 'BTC',
  XETH: 'ETH',
  XXRP: 'XRP',
  XLTC: 'LTC',
  XXDG: 'DOGE',
  XXLM: 'XLM',
  ZUSD: 'USD',
  ZEUR: 'EUR',
  ZGBP: 'GBP',
  ZJPY: 'JPY',
};

function normalizeKrakenAsset(asset: string): string {
  const mapped = KRAKEN_ASSET_MAP[asset] || KRAKEN_PAIR_MAP[asset];
  if (mapped) return mapped;
  const stripped = asset.replace(/\.\w+$/, '');
  return (
    KRAKEN_ASSET_MAP[stripped] ||
    KRAKEN_PAIR_MAP[stripped] ||
    stripped.replace(/^[XZ]/, '').toUpperCase()
  );
}

// Parse a Kraken pair string like "XXBTZUSD" or "ETHUSDT" into [base, quote]
function parseKrakenPair(pair: string): [string, string] | null {
  // Try known 4-char prefixes first (XXBT, XETH, etc.)
  for (const prefix of Object.keys(KRAKEN_PAIR_MAP).sort((a, b) => b.length - a.length)) {
    if (pair.startsWith(prefix)) {
      const rest = pair.slice(prefix.length);
      return [normalizeKrakenAsset(prefix), normalizeKrakenAsset(rest)];
    }
  }
  // Fallback: try splitting at common quote currencies
  for (const quote of ['ZUSD', 'ZEUR', 'USD', 'USDT', 'USDC', 'EUR']) {
    if (pair.endsWith(quote)) {
      const base = pair.slice(0, pair.length - quote.length);
      return [normalizeKrakenAsset(base), normalizeKrakenAsset(quote)];
    }
  }
  return null;
}

function krakenSignRequest(
  apiSecret: string,
  urlPath: string,
  nonce: string,
  postData: string
): string {
  const hash = crypto
    .createHash('sha256')
    .update(nonce + postData)
    .digest();
  return crypto
    .createHmac('sha512', Buffer.from(apiSecret, 'base64'))
    .update(Buffer.concat([Buffer.from(urlPath), hash]))
    .digest('base64');
}

async function fetchKrakenBalances(config: ExchangeConfig): Promise<Balance[]> {
  const nonce = Date.now().toString();
  const urlPath = '/0/private/Balance';
  const postData = `nonce=${nonce}`;

  const hmac = krakenSignRequest(config.apiSecret, urlPath, nonce, postData);

  const res = await fetch(`https://api.kraken.com${urlPath}`, {
    method: 'POST',
    headers: {
      'API-Key': config.apiKey,
      'API-Sign': hmac,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: postData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kraken API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  if (data.error?.length > 0) {
    throw new Error(`Kraken: ${data.error.join(', ')}`);
  }

  // Aggregate by normalized symbol so staked + spot are combined
  const assetTotals = new Map<string, number>();
  for (const [asset, value] of Object.entries(data.result || {})) {
    const amount = parseFloat(value as string);
    if (amount > 0.000001) {
      // Check explicit map first, then strip staking suffix, then strip X/Z prefix
      let symbol = KRAKEN_ASSET_MAP[asset];
      if (!symbol) {
        // Handle unknown staking variants: strip .S / .M / .P suffixes
        const stripped = asset.replace(/\.\w+$/, '');
        symbol = KRAKEN_ASSET_MAP[stripped] || stripped.replace(/^[XZ]/, '');
      }
      symbol = symbol.toUpperCase();
      assetTotals.set(symbol, (assetTotals.get(symbol) || 0) + amount);
    }
  }

  const balances: Balance[] = [];
  for (const [asset, amount] of assetTotals) {
    balances.push({ asset, amount });
  }

  return balances;
}

// -----------------------------------------------------------------------------
// Wallet: Bitcoin (Blockstream API, no key needed)
// -----------------------------------------------------------------------------

async function fetchBtcBalance(address: string): Promise<Balance[]> {
  const res = await fetch(`https://blockstream.info/api/address/${address}`);
  if (!res.ok) {
    throw new Error(`Blockstream API error ${res.status}`);
  }

  const data = await res.json();
  // Balance in satoshis: funded - spent
  const funded = data.chain_stats?.funded_txo_sum || 0;
  const spent = data.chain_stats?.spent_txo_sum || 0;
  const btcAmount = (funded - spent) / 1e8;

  if (btcAmount <= 0) return [];
  return [{ asset: 'BTC', amount: btcAmount }];
}

// -----------------------------------------------------------------------------
// Wallet: Ethereum (native ETH + ERC-20 tokens via Etherscan free API)
// -----------------------------------------------------------------------------

// Etherscan V2 API (V1 deprecated). chainid=1 for Ethereum mainnet.
const ETHERSCAN_BASE = 'https://api.etherscan.io/v2/api?chainid=1';
let etherscanApiKey: string | undefined;

// Well-known ERC-20 token contracts on Ethereum mainnet
const ERC20_TOKENS: { contract: string; symbol: string; decimals: number }[] = [
  // Stablecoins
  { contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
  { contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
  { contract: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', decimals: 18 },
  // Liquid staking
  { contract: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', symbol: 'stETH', decimals: 18 }, // Lido
  { contract: '0xae78736Cd615f374D3085123A210448E74Fc6393', symbol: 'rETH', decimals: 18 }, // Rocket Pool ETH
  { contract: '0xD33526068D116cE69F19A9ee46F0bd304F21A51f', symbol: 'RPL', decimals: 18 }, // Rocket Pool token
  { contract: '0xac3E018457B222d93114458476f3E3416Abbe38F', symbol: 'sfrxETH', decimals: 18 }, // Frax staked ETH
  { contract: '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704', symbol: 'cbETH', decimals: 18 }, // Coinbase staked ETH
  // Wrapped
  { contract: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', decimals: 8 },
  { contract: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: 18 },
  // DeFi / blue chips
  { contract: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK', decimals: 18 },
  { contract: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', symbol: 'UNI', decimals: 18 },
  { contract: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', symbol: 'AAVE', decimals: 18 },
  { contract: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', symbol: 'MATIC', decimals: 18 },
  { contract: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', symbol: 'SHIB', decimals: 18 },
  // Governance / protocol tokens
  { contract: '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72', symbol: 'ENS', decimals: 18 },
  { contract: '0x0D8775F648430679A709E98d2b0Cb6250d2887EF', symbol: 'BAT', decimals: 18 },
  { contract: '0xc944E90C64B2c07662A292be6244BDf05Cda44a7', symbol: 'GRT', decimals: 18 },
  { contract: '0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1', symbol: 'ARB', decimals: 18 },
  { contract: '0xF57e7e7C23978C3cAEC3C3548E3D615c346e79fF', symbol: 'IMX', decimals: 18 },
  { contract: '0x5283D291DBCF85356A21bA090E6db59121208b44', symbol: 'BLUR', decimals: 18 },
  { contract: '0x58b6A8A3302369DAEc383334672404Ee733aB239', symbol: 'LPT', decimals: 18 },
  { contract: '0xcCC8cb5229B0ac8069C51fd58367fd1e622aFD97', symbol: 'GODS', decimals: 18 },
  { contract: '0xA0b73E1Ff0B80914AB6fe0444E65848C4C34450b', symbol: 'CRO', decimals: 8 },
  { contract: '0xAf5191B0De278C7286d6C7CC6ab6BB8A73bA2Cd6', symbol: 'STG', decimals: 18 },
  { contract: '0x31c8EAcBFFdD875c74b94b077895Bd78CF1E64A3', symbol: 'RAD', decimals: 18 },
  { contract: '0xc770EEfAd204B5180dF6a14Ee197D99d808ee52d', symbol: 'FOX', decimals: 18 },
  { contract: '0xCa14007Eff0dB1f8135f4C25B34De49AB0d42766', symbol: 'STRK', decimals: 18 },
  { contract: '0x455e53CBB86018Ac2B8092FdCd39d8444aFFC3F6', symbol: 'POL', decimals: 18 },
];

async function fetchEthBalance(address: string): Promise<Balance[]> {
  const balances: Balance[] = [];

  const apiKeyParam = etherscanApiKey ? `&apikey=${etherscanApiKey}` : '';
  // With API key: 5 calls/sec → 210ms delay. Without: 1 call/5sec → 5100ms delay
  const rateDelay = etherscanApiKey ? 210 : 5100;

  // 1. Fetch native ETH balance via Etherscan
  try {
    const ethRes = await fetch(
      `${ETHERSCAN_BASE}&module=account&action=balance&address=${address}&tag=latest${apiKeyParam}`
    );
    if (ethRes.ok) {
      const ethData = await ethRes.json();
      if (ethData.status === '1' && ethData.result) {
        const ethAmount = parseInt(ethData.result, 10) / 1e18;
        if (ethAmount > 0) {
          balances.push({ asset: 'ETH', amount: ethAmount });
        }
      }
    }
  } catch (err) {
    console.error('[ETH] Native balance error:', err);
  }

  // 2. Fetch ERC-20 token balances
  for (const token of ERC20_TOKENS) {
    try {
      await new Promise((r) => setTimeout(r, rateDelay));
      const tokenRes = await fetch(
        `${ETHERSCAN_BASE}&module=account&action=tokenbalance&contractaddress=${token.contract}&address=${address}&tag=latest${apiKeyParam}`
      );
      if (tokenRes.ok) {
        const tokenData = await tokenRes.json();
        if (tokenData.status === '1' && tokenData.result && tokenData.result !== '0') {
          const amount = parseInt(tokenData.result, 10) / Math.pow(10, token.decimals);
          if (amount > 0.001) {
            balances.push({ asset: token.symbol, amount });
          }
        }
      }
    } catch {
      // Skip failed token lookups silently
    }
  }

  return balances;
}

// =============================================================================
// Trade History Fetchers (for cost basis / gains tracking)
// =============================================================================

// --- Coinbase: GET /api/v3/brokerage/orders/historical/fills ---
async function fetchCoinbaseTrades(config: ExchangeConfig): Promise<CryptoTrade[]> {
  const trades: CryptoTrade[] = [];
  let cursor: string | undefined;

  // Paginate through all fills
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('cursor', cursor);

    const requestPath = '/api/v3/brokerage/orders/historical/fills';
    const uri = `GET api.coinbase.com${requestPath}`;
    const jwt = buildCoinbaseJwt(config.apiKey, config.apiSecret, uri);

    const res = await fetch(`https://api.coinbase.com${requestPath}?${params}`, {
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    });

    if (!res.ok) break;
    const data = await res.json();

    for (const fill of data.fills || []) {
      const productId = fill.product_id || ''; // e.g. "BTC-USD"
      const [base, quote] = productId.split('-');
      if (!base || !quote) continue;

      // Only track USD-denominated trades for cost basis
      if (quote !== 'USD' && quote !== 'USDC' && quote !== 'USDT') continue;

      const price = parseFloat(fill.price || '0');
      const size = parseFloat(fill.size || '0');
      const commission = parseFloat(fill.commission || '0');
      const side = fill.side === 'BUY' ? 'buy' : 'sell';

      if (size > 0 && price > 0) {
        trades.push({
          asset: base.toUpperCase(),
          side: side as 'buy' | 'sell',
          amount: size,
          priceUsd: price,
          totalCost: price * size + (side === 'buy' ? commission : -commission),
          fee: commission,
          timestamp: fill.trade_time || new Date().toISOString(),
          source: 'coinbase',
        });
      }
    }

    cursor = data.cursor;
    if (!cursor || (data.fills || []).length < 100) break;
  }

  return trades;
}

// --- Gemini: POST /v1/mytrades ---
async function fetchGeminiTrades(config: ExchangeConfig): Promise<CryptoTrade[]> {
  const trades: CryptoTrade[] = [];

  // Fetch trades for common USD pairs
  const symbols = [
    'btcusd',
    'ethusd',
    'solusd',
    'dogeusd',
    'adausd',
    'dotusd',
    'linkusd',
    'ltcusd',
    'xrpusd',
    'uniusd',
    'avaxusd',
    'atomusd',
    'maticusd',
  ];

  for (const symbol of symbols) {
    try {
      const nonce = Date.now().toString();
      const payload = JSON.stringify({
        request: '/v1/mytrades',
        nonce,
        symbol,
        limit_trades: 500,
      });
      const encodedPayload = Buffer.from(payload).toString('base64');
      const signature = crypto
        .createHmac('sha384', config.apiSecret)
        .update(encodedPayload)
        .digest('hex');

      const res = await fetch('https://api.gemini.com/v1/mytrades', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'X-GEMINI-APIKEY': config.apiKey,
          'X-GEMINI-PAYLOAD': encodedPayload,
          'X-GEMINI-SIGNATURE': signature,
          'Cache-Control': 'no-cache',
        },
      });

      if (!res.ok) continue;
      const data = await res.json();

      // Extract base asset from symbol (e.g. "btcusd" -> "BTC")
      const base = symbol.replace(/usd$/, '').toUpperCase();

      for (const trade of data) {
        const price = parseFloat(trade.price || '0');
        const amount = parseFloat(trade.amount || '0');
        const fee = parseFloat(trade.fee_amount || '0');
        const side = trade.type === 'Buy' ? 'buy' : 'sell';

        if (amount > 0 && price > 0) {
          trades.push({
            asset: base,
            side,
            amount,
            priceUsd: price,
            totalCost: price * amount + (side === 'buy' ? fee : -fee),
            fee,
            timestamp: new Date(trade.timestampms || trade.timestamp * 1000).toISOString(),
            source: 'gemini',
          });
        }
      }

      // Small delay between symbols for rate limiting
      await new Promise((r) => setTimeout(r, 120));
    } catch {
      // Skip failed symbol lookups
    }
  }

  return trades;
}

// --- Kraken: POST /0/private/TradesHistory ---
async function fetchKrakenTrades(config: ExchangeConfig): Promise<CryptoTrade[]> {
  const trades: CryptoTrade[] = [];

  // Paginate through all trades (50 per page)
  for (let offset = 0; offset < 5000; offset += 50) {
    const nonce = Date.now().toString();
    const urlPath = '/0/private/TradesHistory';
    const postData = `nonce=${nonce}&ofs=${offset}`;

    const hmac = krakenSignRequest(config.apiSecret, urlPath, nonce, postData);

    const res = await fetch(`https://api.kraken.com${urlPath}`, {
      method: 'POST',
      headers: {
        'API-Key': config.apiKey,
        'API-Sign': hmac,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: postData,
    });

    if (!res.ok) break;
    const data = await res.json();
    if (data.error?.length > 0) break;

    const tradeEntries = Object.values(data.result?.trades || {}) as any[];
    if (tradeEntries.length === 0) break;

    for (const trade of tradeEntries) {
      const pair = trade.pair || '';
      const parsed = parseKrakenPair(pair);
      if (!parsed) continue;
      const [base, quote] = parsed;

      // Only track USD-denominated trades
      if (quote !== 'USD' && quote !== 'USDT' && quote !== 'USDC') continue;

      const price = parseFloat(trade.price || '0');
      const vol = parseFloat(trade.vol || '0');
      const cost = parseFloat(trade.cost || '0');
      const fee = parseFloat(trade.fee || '0');
      const side = trade.type === 'buy' ? 'buy' : 'sell';

      if (vol > 0 && price > 0) {
        trades.push({
          asset: base,
          side,
          amount: vol,
          priceUsd: price,
          totalCost: cost + (side === 'buy' ? fee : -fee),
          fee,
          timestamp: new Date(trade.time * 1000).toISOString(),
          source: 'kraken',
        });
      }
    }

    if (tradeEntries.length < 50) break;
    // Small delay between pages
    await new Promise((r) => setTimeout(r, 200));
  }

  return trades;
}

const TRADE_FETCHERS: Record<string, (config: ExchangeConfig) => Promise<CryptoTrade[]>> = {
  coinbase: fetchCoinbaseTrades,
  gemini: fetchGeminiTrades,
  kraken: fetchKrakenTrades,
};

// =============================================================================
// FIFO Cost Basis Calculator
// =============================================================================

const ONE_YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

function computeGains(
  trades: CryptoTrade[],
  currentPrices: Record<string, number>
): CryptoGainsSummary {
  // Group trades by asset, sorted by time
  const byAsset = new Map<string, CryptoTrade[]>();
  for (const trade of trades) {
    const existing = byAsset.get(trade.asset) || [];
    existing.push(trade);
    byAsset.set(trade.asset, existing);
  }

  const assets: CryptoAssetGains[] = [];

  for (const [asset, assetTrades] of byAsset) {
    // Sort by time ascending
    assetTrades.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // FIFO lot tracking
    const lots: { amount: number; costPerUnit: number; date: string }[] = [];

    for (const trade of assetTrades) {
      if (trade.side === 'buy') {
        lots.push({
          amount: trade.amount,
          costPerUnit: trade.totalCost / trade.amount,
          date: trade.timestamp,
        });
      } else {
        // Sell: consume lots FIFO
        let remaining = trade.amount;
        while (remaining > 0 && lots.length > 0) {
          const lot = lots[0];
          const consumed = Math.min(remaining, lot.amount);
          lot.amount -= consumed;
          remaining -= consumed;
          if (lot.amount <= 0.000001) lots.shift();
        }
      }
    }

    // Remaining lots are our current holdings
    const now = Date.now();
    const currentPrice = currentPrices[asset] || currentPrices[asset.toUpperCase()] || 0;
    const totalAmount = lots.reduce((s, l) => s + l.amount, 0);
    const totalCostBasis = lots.reduce((s, l) => s + l.amount * l.costPerUnit, 0);
    const currentValue = totalAmount * currentPrice;

    let shortTermGain = 0;
    let longTermGain = 0;
    const enrichedLots = lots
      .filter((l) => l.amount > 0.000001)
      .map((lot) => {
        const held = now - new Date(lot.date).getTime();
        const gainType: 'short-term' | 'long-term' =
          held >= ONE_YEAR_MS ? 'long-term' : 'short-term';
        const lotValue = lot.amount * currentPrice;
        const lotCost = lot.amount * lot.costPerUnit;
        const gain = lotValue - lotCost;

        if (gainType === 'short-term') shortTermGain += gain;
        else longTermGain += gain;

        return { amount: lot.amount, costPerUnit: lot.costPerUnit, date: lot.date, gainType };
      });

    if (totalAmount > 0.000001) {
      assets.push({
        asset,
        totalAmount,
        totalCostBasis,
        currentValue,
        unrealizedGain: currentValue - totalCostBasis,
        shortTermGain,
        longTermGain,
        lots: enrichedLots,
      });
    }
  }

  // Sort by current value descending
  assets.sort((a, b) => b.currentValue - a.currentValue);

  return {
    assets,
    totalCostBasis: assets.reduce((s, a) => s + a.totalCostBasis, 0),
    totalCurrentValue: assets.reduce((s, a) => s + a.currentValue, 0),
    totalUnrealizedGain: assets.reduce((s, a) => s + a.unrealizedGain, 0),
    totalShortTermGain: assets.reduce((s, a) => s + a.shortTermGain, 0),
    totalLongTermGain: assets.reduce((s, a) => s + a.longTermGain, 0),
    lastUpdated: new Date().toISOString(),
    tradeCount: trades.length,
  };
}

// =============================================================================
// Public API: Trade History & Gains
// =============================================================================

export async function fetchAllTrades(
  exchanges: ExchangeConfig[],
  onProgress?: (current: number, total: number, label: string) => void
): Promise<CryptoTrade[]> {
  const enabledExchanges = exchanges.filter((e) => e.enabled && TRADE_FETCHERS[e.id]);
  const allTrades: CryptoTrade[] = [];

  for (let i = 0; i < enabledExchanges.length; i++) {
    const exchange = enabledExchanges[i];
    onProgress?.(i, enabledExchanges.length, `Fetching ${EXCHANGE_LABELS[exchange.id]} trades`);
    try {
      const trades = await TRADE_FETCHERS[exchange.id](exchange);
      allTrades.push(...trades);
      console.log(`[crypto] ${exchange.id}: ${trades.length} trades fetched`);
    } catch (err) {
      console.error(`[crypto] ${exchange.id} trades error:`, err);
    }
  }

  onProgress?.(enabledExchanges.length, enabledExchanges.length, 'Done');
  return allTrades;
}

export async function fetchCryptoGains(
  exchanges: ExchangeConfig[],
  onProgress?: (current: number, total: number, label: string) => void
): Promise<CryptoGainsSummary> {
  const trades = await fetchAllTrades(exchanges, onProgress);
  const assets = [...new Set(trades.map((t) => t.asset))];
  const prices = await fetchPrices(assets);
  return computeGains(trades, prices);
}

// -----------------------------------------------------------------------------
// Public API: Balances
// -----------------------------------------------------------------------------

const EXCHANGE_LABELS: Record<string, string> = {
  coinbase: 'Coinbase',
  gemini: 'Gemini',
  kraken: 'Kraken',
};

const EXCHANGE_FETCHERS: Record<string, (config: ExchangeConfig) => Promise<Balance[]>> = {
  coinbase: fetchCoinbaseBalances,
  gemini: fetchGeminiBalances,
  kraken: fetchKrakenBalances,
};

export async function fetchSourceBalance(
  sourceId: string,
  exchanges: ExchangeConfig[],
  wallets: WalletConfig[],
  etherscanKey_?: string
): Promise<SourceBalance> {
  etherscanApiKey = etherscanKey_;

  // Check if it's an exchange
  const exchange = exchanges.find((e) => e.id === sourceId);
  if (exchange) {
    const fetcher = EXCHANGE_FETCHERS[exchange.id];
    if (!fetcher) throw new Error(`Unknown exchange: ${sourceId}`);
    try {
      const balances = await fetcher(exchange);
      const prices = await fetchPrices(balances.map((b) => b.asset));
      for (const b of balances) {
        b.usdValue = b.amount * (prices[b.asset] || prices[b.asset.toUpperCase()] || 0);
      }
      return {
        sourceId: exchange.id,
        sourceType: 'exchange',
        label: EXCHANGE_LABELS[exchange.id] || exchange.id,
        balances,
        totalUsdValue: balances.reduce((sum, b) => sum + (b.usdValue || 0), 0),
        lastUpdated: new Date().toISOString(),
      };
    } catch (err) {
      return {
        sourceId: exchange.id,
        sourceType: 'exchange',
        label: EXCHANGE_LABELS[exchange.id] || exchange.id,
        balances: [],
        totalUsdValue: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
        lastUpdated: new Date().toISOString(),
      };
    }
  }

  // Check if it's a wallet
  const wallet = wallets.find((w) => w.id === sourceId);
  if (wallet) {
    const fetcher = wallet.chain === 'btc' ? fetchBtcBalance : fetchEthBalance;
    try {
      const balances = await fetcher(wallet.address);
      const prices = await fetchPrices(balances.map((b) => b.asset));
      for (const b of balances) {
        b.usdValue = b.amount * (prices[b.asset] || prices[b.asset.toUpperCase()] || 0);
      }
      return {
        sourceId: wallet.id,
        sourceType: 'wallet',
        label: wallet.label || `${wallet.chain.toUpperCase()} Wallet`,
        balances,
        totalUsdValue: balances.reduce((sum, b) => sum + (b.usdValue || 0), 0),
        lastUpdated: new Date().toISOString(),
      };
    } catch (err) {
      return {
        sourceId: wallet.id,
        sourceType: 'wallet',
        label: wallet.label || `${wallet.chain.toUpperCase()} Wallet`,
        balances: [],
        totalUsdValue: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
        lastUpdated: new Date().toISOString(),
      };
    }
  }

  throw new Error(`Source not found: ${sourceId}`);
}

export async function fetchAllBalances(
  exchanges: ExchangeConfig[],
  wallets: WalletConfig[],
  etherscanKey_?: string,
  onProgress?: (current: number, total: number, label: string) => void
): Promise<{
  sources: SourceBalance[];
  totalUsdValue: number;
  byAsset: Balance[];
  lastUpdated: string;
}> {
  // Set Etherscan API key for wallet queries
  etherscanApiKey = etherscanKey_;

  const sources: SourceBalance[] = [];
  const allAssets = new Set<string>();

  const enabledExchanges = exchanges.filter((e) => e.enabled && EXCHANGE_FETCHERS[e.id]);
  const totalSteps = enabledExchanges.length + wallets.length + 1; // +1 for prices
  let completed = 0;

  // Fetch all exchange balances in parallel
  const exchangeResults = await Promise.allSettled(
    enabledExchanges.map(async (exchange) => {
      const fetcher = EXCHANGE_FETCHERS[exchange.id]!;
      try {
        const balances = await fetcher(exchange);
        return { exchange, balances, error: undefined };
      } catch (err) {
        return {
          exchange,
          balances: [] as Balance[],
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    })
  );

  for (const result of exchangeResults) {
    const { exchange, balances, error } =
      result.status === 'fulfilled'
        ? result.value
        : { exchange: enabledExchanges[0], balances: [] as Balance[], error: 'Fetch failed' };
    balances.forEach((b) => allAssets.add(b.asset));
    completed++;
    onProgress?.(completed, totalSteps, EXCHANGE_LABELS[exchange.id] || exchange.id);
    sources.push({
      sourceId: exchange.id,
      sourceType: 'exchange',
      label: EXCHANGE_LABELS[exchange.id] || exchange.id,
      balances,
      totalUsdValue: 0,
      error,
      lastUpdated: new Date().toISOString(),
    });
  }

  // Fetch BTC wallets in parallel (Blockstream has no rate limit)
  const btcWallets = wallets.filter((w) => w.chain === 'btc');
  const ethWallets = wallets.filter((w) => w.chain === 'eth');

  const btcResults = await Promise.allSettled(
    btcWallets.map(async (wallet) => {
      try {
        const balances = await fetchBtcBalance(wallet.address);
        return { wallet, balances, error: undefined };
      } catch (err) {
        return {
          wallet,
          balances: [] as Balance[],
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    })
  );

  for (const result of btcResults) {
    const { wallet, balances, error } =
      result.status === 'fulfilled'
        ? result.value
        : { wallet: btcWallets[0], balances: [] as Balance[], error: 'Fetch failed' };
    balances.forEach((b) => allAssets.add(b.asset));
    completed++;
    onProgress?.(completed, totalSteps, wallet.label || 'BTC Wallet');
    sources.push({
      sourceId: wallet.id,
      sourceType: 'wallet',
      label: wallet.label || 'BTC Wallet',
      balances,
      totalUsdValue: 0,
      error,
      lastUpdated: new Date().toISOString(),
    });
  }

  // Fetch ETH wallets sequentially (Etherscan rate limit shared across calls)
  for (const wallet of ethWallets) {
    try {
      const balances = await fetchEthBalance(wallet.address);
      balances.forEach((b) => allAssets.add(b.asset));
      completed++;
      onProgress?.(completed, totalSteps, wallet.label || 'ETH Wallet');
      sources.push({
        sourceId: wallet.id,
        sourceType: 'wallet',
        label: wallet.label || `ETH Wallet`,
        balances,
        totalUsdValue: 0,
        lastUpdated: new Date().toISOString(),
      });
    } catch (err) {
      completed++;
      onProgress?.(completed, totalSteps, wallet.label || 'ETH Wallet');
      sources.push({
        sourceId: wallet.id,
        sourceType: 'wallet',
        label: wallet.label || `ETH Wallet`,
        balances: [],
        totalUsdValue: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
        lastUpdated: new Date().toISOString(),
      });
    }
  }

  // Fetch prices and calculate USD values
  onProgress?.(completed, totalSteps, 'Fetching prices');
  const prices = await fetchPrices(Array.from(allAssets));
  completed++;
  onProgress?.(completed, totalSteps, 'Done');

  for (const source of sources) {
    for (const balance of source.balances) {
      const price = prices[balance.asset] || prices[balance.asset.toUpperCase()] || 0;
      balance.usdValue = balance.amount * price;
    }
    source.totalUsdValue = source.balances.reduce((sum, b) => sum + (b.usdValue || 0), 0);
  }

  // Aggregate by asset across all sources
  const assetTotals = new Map<string, number>();
  for (const source of sources) {
    for (const b of source.balances) {
      assetTotals.set(b.asset, (assetTotals.get(b.asset) || 0) + b.amount);
    }
  }

  const byAsset: Balance[] = Array.from(assetTotals.entries())
    .map(([asset, amount]) => ({
      asset,
      amount,
      usdValue: amount * (prices[asset] || prices[asset.toUpperCase()] || 0),
    }))
    .sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0));

  const totalUsdValue = sources.reduce((sum, s) => sum + s.totalUsdValue, 0);

  return {
    sources,
    totalUsdValue,
    byAsset,
    lastUpdated: new Date().toISOString(),
  };
}
