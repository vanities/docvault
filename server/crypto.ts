// =============================================================================
// Crypto Balance Queries & Trade History
// =============================================================================
// Fetches balances from exchanges (Coinbase, Gemini, Kraken) and on-chain
// wallets (BTC via Blockstream, ETH via Etherscan/public RPC).
// Prices from CoinGecko free API (no key required).
// Trade history from exchange APIs for cost basis / gains tracking.

import crypto from 'crypto';
import { encodeFunctionData, decodeFunctionResult } from 'viem';
import { createLogger, type Logger } from './logger.js';

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

// Per-namespace loggers (created once at module load)
const logCoinGecko = createLogger('CoinGecko');
const logCoinbase = createLogger('Coinbase');
const logCoinbaseTrades = createLogger('Coinbase Trades');
const logGemini = createLogger('Gemini');
const logGeminiTrades = createLogger('Gemini Trades');
const logKraken = createLogger('Kraken');
const logKrakenTrades = createLogger('Kraken Trades');
const logBtc = createLogger('BTC');
const logEth = createLogger('ETH');
const logChainlink = createLogger('Chainlink');
const logBalances = createLogger('Balances');

// Map asset symbols (UPPERCASE) to CoinGecko IDs
// All keys must be uppercase — lookups use .toUpperCase()
export const COINGECKO_IDS: Record<string, string> = {
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
  POL: 'polygon-ecosystem-token',
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
  // DeFi / blue chips
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
  // Governance / protocol tokens
  ENS: 'ethereum-name-service',
  BAT: 'basic-attention-token',
  IMX: 'immutable-x',
  BLUR: 'blur',
  LPT: 'livepeer-token',
  GODS: 'gods-unchained',
  STG: 'stargate-finance',
  STRK: 'starknet',
  FOX: 'shapeshift-fox-token',
  XSUSHI: 'xsushi',
  FTM: 'fantom',
  ONE: 'harmony',
};

export async function fetchPrices(assets: string[]): Promise<Record<string, number>> {
  const now = Date.now();
  if (now - priceCacheTime < PRICE_CACHE_TTL && Object.keys(priceCache).length > 0) {
    const age = Math.round((now - priceCacheTime) / 1000);
    logCoinGecko.info(
      `Using cached prices (${Object.keys(priceCache).length} assets, ${age}s old)`
    );
    return priceCache;
  }

  // Always fetch all known IDs so the cache is comprehensive regardless of
  // which assets triggered the refresh (avoids partial-cache misses).
  const ids = Object.values(COINGECKO_IDS);
  void assets; // caller-provided list unused after moving to full fetch

  logCoinGecko.info(`Fetching prices for ${ids.length} assets...`);
  const elapsed = logCoinGecko.timer();

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;
    const res = await fetch(url);
    if (!res.ok) {
      logCoinGecko.warn(
        `HTTP ${res.status} — using stale cache (${Object.keys(priceCache).length} assets)`
      );
      return priceCache;
    }

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

    const missing = ids.filter((id) => !data[id]?.usd).length;
    logCoinGecko.info(
      `Prices fetched in ${elapsed()}ms — ${Object.keys(prices).length} resolved, ${missing} missing from API`
    );

    priceCache = prices;
    priceCacheTime = now;
    return prices;
  } catch (err) {
    logCoinGecko.warn(`Fetch failed (${err}) — using stale cache`);
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
  logCoinbase.debug(`Key type: ${isEd25519Key(config.apiSecret) ? 'Ed25519' : 'ECDSA'}`);
  logCoinbase.debug(`URI: ${uri}`);
  logCoinbase.debug(`Key name: ${config.apiKey.substring(0, 30)}...`);

  const elapsed = logCoinbase.timer();
  const res = await fetch(`https://api.coinbase.com${requestPath}?limit=250`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    logCoinbase.error(`HTTP ${res.status}: ${text}`);
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

  logCoinbase.info(
    `${balances.length} non-zero balances fetched in ${elapsed()}ms (${data.accounts?.length ?? 0} total accounts)`
  );
  return balances;
}

// -----------------------------------------------------------------------------
// Exchange: Gemini
// -----------------------------------------------------------------------------

async function fetchGeminiBalances(config: ExchangeConfig): Promise<Balance[]> {
  logGemini.info('Fetching balances...');
  const elapsed = logGemini.timer();
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
    logGemini.error(`HTTP ${res.status}: ${text}`);
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

  logGemini.info(`${balances.length} non-zero balances fetched in ${elapsed()}ms`);
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
  logKraken.info('Fetching balances...');
  const elapsed = logKraken.timer();
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

  logKraken.info(`${balances.length} non-zero balances fetched in ${elapsed()}ms`);
  return balances;
}

// -----------------------------------------------------------------------------
// Wallet: Bitcoin (Blockstream API, no key needed)
// -----------------------------------------------------------------------------

async function fetchBtcBalance(address: string): Promise<Balance[]> {
  logBtc.info(`Fetching balance for ${address.slice(0, 8)}...`);
  const elapsed = logBtc.timer();
  const res = await fetch(`https://blockstream.info/api/address/${address}`);
  if (!res.ok) {
    logBtc.error(`Blockstream API error ${res.status} for ${address}`);
    throw new Error(`Blockstream API error ${res.status}`);
  }

  const data = await res.json();
  // Balance in satoshis: funded - spent
  const funded = data.chain_stats?.funded_txo_sum || 0;
  const spent = data.chain_stats?.spent_txo_sum || 0;
  const btcAmount = (funded - spent) / 1e8;

  logBtc.info(`${address.slice(0, 8)}...: ${btcAmount.toFixed(8)} BTC (fetched in ${elapsed()}ms)`);
  if (btcAmount <= 0) return [];
  return [{ asset: 'BTC', amount: btcAmount }];
}

// -----------------------------------------------------------------------------
// Wallet: Ethereum (native ETH + ERC-20 tokens via Etherscan free API)
// -----------------------------------------------------------------------------

// Etherscan V2 API supports multiple chains via chainid= parameter.
const ETHERSCAN_API = 'https://api.etherscan.io/v2/api';
let etherscanApiKey: string | undefined;
export function setEtherscanApiKey(key: string | undefined): void {
  etherscanApiKey = key;
}

// Etherscan quirk: the API returns HTTP 200 even when it rate-limits or
// transiently fails — the failure lives in the JSON body as `{status:"0"}`
// (message usually "NOTOK" or "Max rate limit reached"). A single 5-req/s
// burst collision is common during the multi-chain balance sweep, so this
// helper retries both HTTP-level AND body-level failures with exponential
// backoff. "No transactions found" is returned as-is — it's a valid
// terminal response, not an error.
async function etherscanFetch(
  url: string,
  label: string,
  log: Logger
): Promise<{ status: string; message?: string; result?: unknown } | null> {
  const MAX_ATTEMPTS = 6;
  const PER_ATTEMPT_TIMEOUT_MS = 15_000;
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS),
      });
      if (!res.ok) {
        // 4xx (other than 429) won't recover — fail fast by returning null.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          log.warn(`${label} HTTP ${res.status} (non-retryable)`);
          return null;
        }
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        const data = (await res.json()) as {
          status: string;
          message?: string;
          result?: unknown;
        };
        if (data.status === '0') {
          const msg = String(data.message ?? data.result ?? '');
          // Expected terminal cases — don't burn retries on them.
          if (msg === 'No transactions found' || msg === 'No records found') {
            return data;
          }
          lastErr = new Error(`status=0: ${msg}`);
        } else {
          return data;
        }
      }
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < MAX_ATTEMPTS) {
      // Start at 1s and back off — Etherscan's per-second bucket needs time
      // to drain, and tight retries just compete with the next token in the
      // sweep for the same limit. Cap at 30s with ±500ms jitter.
      const delay = Math.min(30_000, 1_000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
      log.warn(
        `${label} attempt ${attempt}/${MAX_ATTEMPTS} failed (${lastErr?.message ?? 'unknown'}); retrying in ${delay}ms`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  log.warn(`${label} gave up after ${MAX_ATTEMPTS} attempts: ${lastErr?.message ?? 'unknown'}`);
  return null;
}

// L2 token lists — native tokens on their home chains
export const ARBITRUM_TOKENS: { contract: string; symbol: string; decimals: number }[] = [
  { contract: '0x912CE59144191C1204E64559FE8253a0e49E6548', symbol: 'ARB', decimals: 18 },
  { contract: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6 },
  { contract: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', decimals: 6 },
  // Dead / defunct (Arbitrum-native)
  { contract: '0x09E18590E8f76b6Cf471b3cd75fE1A1a9D2B2c2b', symbol: 'AIDOGE', decimals: 18 },
];

export const OPTIMISM_TOKENS: { contract: string; symbol: string; decimals: number }[] = [
  { contract: '0x4200000000000000000000000000000000000042', symbol: 'OP', decimals: 18 },
  { contract: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', symbol: 'USDC', decimals: 6 },
  { contract: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', symbol: 'USDT', decimals: 6 },
];

export const POLYGON_TOKENS: { contract: string; symbol: string; decimals: number }[] = [
  { contract: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', decimals: 6 },
  { contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', decimals: 6 },
  // Dead / defunct (Polygon-native)
  { contract: '0x4C392822D4bE8494B798cEA17B43d48B2308109C', symbol: 'POLY', decimals: 18 },
];

export const AVALANCHE_TOKENS: { contract: string; symbol: string; decimals: number }[] = [
  { contract: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', symbol: 'USDC', decimals: 6 },
  { contract: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', symbol: 'USDT', decimals: 6 },
];

// Chainlink Staking v0.2 — staked LINK is locked in these contracts (no receipt token)
const CHAINLINK_STAKING_POOLS = [
  { address: '0xBc10f2E862ED4502144c7d632a3459F49DFCDB5e', label: 'CL Community Pool' },
  { address: '0xa1d76a7ca72128541e9fcacafbda3a92ef94fdc5', label: 'CL Operator Pool' },
] as const;

const GET_STAKER_PRINCIPAL_ABI = [
  {
    name: 'getStakerPrincipal',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'staker', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

async function fetchChainlinkStakedBalance(address: string): Promise<number> {
  const apiKeyParam = etherscanApiKey ? `&apikey=${etherscanApiKey}` : '';
  const rateDelay = etherscanApiKey ? 250 : 5100;
  let total = 0;

  for (const pool of CHAINLINK_STAKING_POOLS) {
    // Respect Etherscan's 5 req/s limit — chain scanning ends just before this
    await new Promise((r) => setTimeout(r, rateDelay));
    try {
      const data = encodeFunctionData({
        abi: GET_STAKER_PRINCIPAL_ABI,
        functionName: 'getStakerPrincipal',
        args: [address as `0x${string}`],
      });

      const json = await etherscanFetch(
        `${ETHERSCAN_API}?chainid=1&module=proxy&action=eth_call&to=${pool.address}&data=${data}&tag=latest${apiKeyParam}`,
        pool.label,
        logChainlink
      );
      if (!json) continue;
      logChainlink.debug(`${pool.label} raw result: ${JSON.stringify(json).slice(0, 200)}`);
      const result = json.result;
      if (typeof result !== 'string' || result === '0x' || !/^0x[0-9a-fA-F]+$/.test(result))
        continue;

      const principal = decodeFunctionResult({
        abi: GET_STAKER_PRINCIPAL_ABI,
        functionName: 'getStakerPrincipal',
        data: result as `0x${string}`,
      }) as bigint;

      total += Number(principal) / 1e18;
    } catch (err) {
      logChainlink.warn(`${pool.label} error: ${err}`);
    }
  }

  return total;
}

// Well-known ERC-20 token contracts on Ethereum mainnet
export const ERC20_TOKENS: { contract: string; symbol: string; decimals: number }[] = [
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
  // Additional DeFi / protocol tokens
  { contract: '0x8798249c2E607446EfB7Ad49eC89dD1865Ff4272', symbol: 'xSUSHI', decimals: 18 },
  { contract: '0xc00e94Cb662C3520282E6f5717214004A7f26888', symbol: 'COMP', decimals: 18 },
  { contract: '0x4E15361FD6b4BB609Fa63C81A2be19d873717870', symbol: 'FTM', decimals: 18 },
  { contract: '0x799a4202c12ca952cB311598a024C80eD371a41e', symbol: 'ONE', decimals: 18 },
  // Dead / defunct projects
  { contract: '0x09a3EcAFa817268f77BE1283176B946C4ff2E608', symbol: 'MIR', decimals: 18 },
  { contract: '0x0A913beaD80F321E7Ac35285Ee10d9d922659cB7', symbol: 'DOS', decimals: 18 },
  { contract: '0x3b484b82567a09e2588A13D54D032153f0c0aee0', symbol: 'SOS', decimals: 18 },
  { contract: '0xf16e81dce15b08f326220742020379b855b87df9', symbol: 'ICE', decimals: 18 },
];

// Fetch native + ERC-20 balances for any EVM chain supported by Etherscan v2.
export async function fetchChainBalances(
  address: string,
  chainId: number,
  nativeSymbol: string,
  tokens: { contract: string; symbol: string; decimals: number }[]
): Promise<Balance[]> {
  const balances: Balance[] = [];
  const base = `${ETHERSCAN_API}?chainid=${chainId}`;
  const apiKeyParam = etherscanApiKey ? `&apikey=${etherscanApiKey}` : '';
  const rateDelay = etherscanApiKey ? 210 : 5100;

  const log = createLogger(`Chain ${chainId}`);
  log.info(
    `Scanning ${address.slice(0, 8)}... — ${nativeSymbol} + ${tokens.length} tokens (${etherscanApiKey ? 'keyed' : 'unkeyed'}, ${rateDelay}ms delay)`
  );
  const elapsed = log.timer();

  // Native balance
  try {
    const data = await etherscanFetch(
      `${base}&module=account&action=balance&address=${address}&tag=latest${apiKeyParam}`,
      `Native ${nativeSymbol}`,
      log
    );
    if (data && data.status === '1' && typeof data.result === 'string') {
      const amount = parseInt(data.result, 10) / 1e18;
      if (amount > 0) {
        log.info(`${nativeSymbol}: ${amount.toFixed(6)}`);
        balances.push({ asset: nativeSymbol, amount });
      }
    }
  } catch (err) {
    log.error(`Native balance error: ${err}`);
  }

  // ERC-20 balances
  let tokenHits = 0;
  for (const token of tokens) {
    try {
      await new Promise((r) => setTimeout(r, rateDelay));
      const data = await etherscanFetch(
        `${base}&module=account&action=tokenbalance&contractaddress=${token.contract}&address=${address}&tag=latest${apiKeyParam}`,
        token.symbol,
        log
      );
      if (data && data.status === '1' && typeof data.result === 'string' && data.result !== '0') {
        const amount = parseInt(data.result, 10) / Math.pow(10, token.decimals);
        if (amount > 0.001) {
          log.info(`${token.symbol}: ${amount.toFixed(4)}`);
          tokenHits++;
          balances.push({ asset: token.symbol, amount });
        }
      }
    } catch (err) {
      log.warn(`${token.symbol} error: ${err}`);
    }
  }

  log.info(
    `Done — ${balances.length} balances (${tokenHits}/${tokens.length} tokens hit) in ${elapsed()}ms`
  );
  return balances;
}

async function fetchEthBalance(address: string): Promise<Balance[]> {
  // Scan chains sequentially to stay within Etherscan's 5 req/s rate limit.
  // Parallel scanning caused silent rate-limit failures (status:"0" skipped as empty).
  logEth.info(`Starting full scan for ${address}`);
  const elapsed = logEth.timer();
  const mainnet = await fetchChainBalances(address, 1, 'ETH', ERC20_TOKENS);
  const arbitrum = await fetchChainBalances(address, 42161, 'ETH', ARBITRUM_TOKENS);
  const optimism = await fetchChainBalances(address, 10, 'ETH', OPTIMISM_TOKENS);
  const polygon = await fetchChainBalances(address, 137, 'POL', POLYGON_TOKENS);
  const avalanche = await fetchChainBalances(address, 43114, 'AVAX', AVALANCHE_TOKENS);
  const stakedLink = await fetchChainlinkStakedBalance(address);

  // Merge: sum amounts for the same symbol across chains
  const merged = new Map<string, number>();
  for (const { asset, amount } of [
    ...mainnet,
    ...arbitrum,
    ...optimism,
    ...polygon,
    ...avalanche,
  ]) {
    merged.set(asset, (merged.get(asset) ?? 0) + amount);
  }

  // Add staked LINK on top of any liquid LINK already in wallet
  if (stakedLink > 0) {
    merged.set('LINK', (merged.get('LINK') ?? 0) + stakedLink);
    logChainlink.info(`${address}: ${stakedLink.toFixed(4)} LINK staked`);
  }

  const result = Array.from(merged.entries()).map(([asset, amount]) => ({ asset, amount }));
  logEth.info(`${address} scan complete — ${result.length} assets in ${elapsed()}ms`);
  return result;
}

// =============================================================================
// Trade History Fetchers (for cost basis / gains tracking)
// =============================================================================

// --- Coinbase: GET /api/v3/brokerage/orders/historical/fills ---
async function fetchCoinbaseTrades(config: ExchangeConfig): Promise<CryptoTrade[]> {
  logCoinbaseTrades.info('Fetching fill history (paginated, max 50 pages)...');
  const elapsed = logCoinbaseTrades.timer();
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
    logCoinbaseTrades.info(
      `Page ${page + 1}: ${(data.fills || []).length} fills, cursor continues...`
    );
  }

  logCoinbaseTrades.info(`${trades.length} USD-denominated trades fetched in ${elapsed()}ms`);
  return trades;
}

// --- Gemini: POST /v1/mytrades ---
async function fetchGeminiTrades(config: ExchangeConfig): Promise<CryptoTrade[]> {
  logGeminiTrades.info('Fetching trade history for all USD pairs...');
  const elapsed = logGeminiTrades.timer();
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

      if (!res.ok) {
        logGeminiTrades.warn(`${symbol}: HTTP ${res.status}`);
        continue;
      }
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

      if (data.length > 0) logGeminiTrades.info(`${symbol}: ${data.length} trades`);
      // Small delay between symbols for rate limiting
      await new Promise((r) => setTimeout(r, 120));
    } catch (err) {
      logGeminiTrades.warn(`${symbol} error: ${err}`);
    }
  }

  logGeminiTrades.info(`${trades.length} trades fetched in ${elapsed()}ms`);
  return trades;
}

// --- Kraken: POST /0/private/TradesHistory ---
async function fetchKrakenTrades(config: ExchangeConfig): Promise<CryptoTrade[]> {
  logKrakenTrades.info('Fetching trade history (paginated, max 5000 trades)...');
  const elapsed = logKrakenTrades.timer();
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

    logKrakenTrades.info(
      `offset=${offset}: ${tradeEntries.length} entries, running total ${trades.length}`
    );
    if (tradeEntries.length < 50) break;
    // Small delay between pages
    await new Promise((r) => setTimeout(r, 200));
  }

  logKrakenTrades.info(`${trades.length} USD-denominated trades fetched in ${elapsed()}ms`);
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
      logBalances.info(`${exchange.id}: ${trades.length} trades fetched`);
    } catch (err) {
      logBalances.error(`${exchange.id} trades error: ${err}`);
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
  onProgress?: (current: number, total: number, label: string) => void,
  onSource?: (source: SourceBalance) => void
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
  const btcWallets = wallets.filter((w) => w.chain === 'btc');
  const ethWallets = wallets.filter((w) => w.chain === 'eth');
  const totalSteps = enabledExchanges.length + wallets.length + 1; // +1 for prices
  let completed = 0;

  logBalances.info(
    `Starting sync — ${enabledExchanges.length} exchanges, ${btcWallets.length} BTC wallets, ${ethWallets.length} ETH wallets (Etherscan key: ${etherscanApiKey ? 'yes' : 'no'})`
  );
  const elapsed = logBalances.timer();

  // Pre-fetch prices so each source can be priced immediately as it completes.
  logBalances.info('Pre-fetching prices...');
  const prices = await fetchPrices([]);

  const attachPrices = (balances: Balance[]) => {
    for (const b of balances) {
      b.usdValue = b.amount * (prices[b.asset] || prices[b.asset.toUpperCase()] || 0);
    }
  };

  // Fetch all exchange balances in parallel — emit each source as it completes
  await Promise.all(
    enabledExchanges.map(async (exchange) => {
      const fetcher = EXCHANGE_FETCHERS[exchange.id]!;
      let balances: Balance[] = [];
      let error: string | undefined;
      try {
        balances = await fetcher(exchange);
        attachPrices(balances);
      } catch (err) {
        error = err instanceof Error ? err.message : 'Unknown error';
      }
      if (error) logBalances.error(`${exchange.id} error: ${error}`);
      else logBalances.info(`${exchange.id}: ${balances.length} balances`);
      balances.forEach((b) => allAssets.add(b.asset));
      completed++;
      onProgress?.(completed, totalSteps, EXCHANGE_LABELS[exchange.id] || exchange.id);
      const source: SourceBalance = {
        sourceId: exchange.id,
        sourceType: 'exchange',
        label: EXCHANGE_LABELS[exchange.id] || exchange.id,
        balances,
        totalUsdValue: balances.reduce((sum, b) => sum + (b.usdValue || 0), 0),
        error,
        lastUpdated: new Date().toISOString(),
      };
      sources.push(source);
      onSource?.(source);
    })
  );

  // Fetch BTC wallets in parallel — emit each as it completes
  await Promise.all(
    btcWallets.map(async (wallet) => {
      let balances: Balance[] = [];
      let error: string | undefined;
      try {
        balances = await fetchBtcBalance(wallet.address);
        attachPrices(balances);
      } catch (err) {
        error = err instanceof Error ? err.message : 'Unknown error';
      }
      if (error) logBalances.error(`BTC wallet ${wallet.label}: ${error}`);
      balances.forEach((b) => allAssets.add(b.asset));
      completed++;
      onProgress?.(completed, totalSteps, wallet.label || 'BTC Wallet');
      const source: SourceBalance = {
        sourceId: wallet.id,
        sourceType: 'wallet',
        label: wallet.label || 'BTC Wallet',
        balances,
        totalUsdValue: balances.reduce((sum, b) => sum + (b.usdValue || 0), 0),
        error,
        lastUpdated: new Date().toISOString(),
      };
      sources.push(source);
      onSource?.(source);
    })
  );

  // Fetch ETH wallets sequentially (Etherscan rate limit) — emit each as it completes
  for (const wallet of ethWallets) {
    let balances: Balance[] = [];
    let error: string | undefined;
    try {
      balances = await fetchEthBalance(wallet.address);
      attachPrices(balances);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
    }
    balances.forEach((b) => allAssets.add(b.asset));
    completed++;
    onProgress?.(completed, totalSteps, wallet.label || 'ETH Wallet');
    const source: SourceBalance = {
      sourceId: wallet.id,
      sourceType: 'wallet',
      label: wallet.label || 'ETH Wallet',
      balances,
      totalUsdValue: balances.reduce((sum, b) => sum + (b.usdValue || 0), 0),
      error,
      lastUpdated: new Date().toISOString(),
    };
    sources.push(source);
    onSource?.(source);
  }

  onProgress?.(completed, totalSteps, 'Done');

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

  logBalances.info(
    `Complete — $${totalUsdValue.toFixed(0)} total across ${sources.length} sources in ${elapsed()}ms`
  );

  return {
    sources,
    totalUsdValue,
    byAsset,
    lastUpdated: new Date().toISOString(),
  };
}
