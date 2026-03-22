// =============================================================================
// Crypto Balance Queries
// =============================================================================
// Fetches balances from exchanges (Coinbase, Gemini, Kraken) and on-chain
// wallets (BTC via Blockstream, ETH via Etherscan/public RPC).
// Prices from CoinGecko free API (no key required).

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

// -----------------------------------------------------------------------------
// Price Cache (CoinGecko, 60s TTL)
// -----------------------------------------------------------------------------

let priceCache: Record<string, number> = {};
let priceCacheTime = 0;
const PRICE_CACHE_TTL = 60_000; // 1 minute

// Map common asset symbols to CoinGecko IDs
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
};

async function fetchPrices(assets: string[]): Promise<Record<string, number>> {
  const now = Date.now();
  if (now - priceCacheTime < PRICE_CACHE_TTL && Object.keys(priceCache).length > 0) {
    return priceCache;
  }

  // Map assets to CoinGecko IDs
  const ids = assets.map((a) => COINGECKO_IDS[a.toUpperCase()]).filter(Boolean);

  if (ids.length === 0) return priceCache;

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;
    const res = await fetch(url);
    if (!res.ok) return priceCache; // Use stale cache on error

    const data = await res.json();

    // Build reverse map: symbol -> price
    const prices: Record<string, number> = {};
    for (const [symbol, cgId] of Object.entries(COINGECKO_IDS)) {
      if (data[cgId]?.usd) {
        prices[symbol] = data[cgId].usd;
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
// Exchange: Coinbase (CDP API Keys — JWT ES256 auth)
// -----------------------------------------------------------------------------
// Coinbase now issues CDP keys: an "API Key Name" (the kid/subject) and
// an EC private key in PEM format. Auth uses a short-lived JWT signed with ES256.

function buildCoinbaseJwt(apiKeyName: string, privateKeyPem: string, uri: string): string {
  // Header
  const header = {
    alg: 'ES256',
    kid: apiKeyName,
    nonce: crypto.randomBytes(16).toString('hex'),
    typ: 'JWT',
  };

  // Payload
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: apiKeyName,
    iss: 'coinbase-cloud',
    aud: ['cdp_service'],
    nbf: now,
    exp: now + 120, // 2 minute expiry
    uris: [uri],
  };

  const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');

  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  // Clean up PEM — handle escaped newlines from JSON storage
  const cleanPem = privateKeyPem.replace(/\\n/g, '\n');

  const sign = crypto.createSign('SHA256');
  sign.update(signingInput);
  // EC signature in DER format — convert to raw r||s for JWT
  const derSig = sign.sign({ key: cleanPem, dsaEncoding: 'ieee-p1363' });
  const sigB64 = derSig.toString('base64url');

  return `${signingInput}.${sigB64}`;
}

async function fetchCoinbaseBalances(config: ExchangeConfig): Promise<Balance[]> {
  const method = 'GET';
  const requestPath = '/api/v3/brokerage/accounts?limit=250';
  const uri = `${method} api.coinbase.com${requestPath}`;

  const jwt = buildCoinbaseJwt(config.apiKey, config.apiSecret, uri);

  const res = await fetch(`https://api.coinbase.com${requestPath}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
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

async function fetchKrakenBalances(config: ExchangeConfig): Promise<Balance[]> {
  const nonce = Date.now().toString();
  const urlPath = '/0/private/Balance';
  const postData = `nonce=${nonce}`;

  // Kraken signature: HMAC-SHA512(urlPath + SHA256(nonce + postData), base64decode(secret))
  const hash = crypto
    .createHash('sha256')
    .update(nonce + postData)
    .digest();
  const hmac = crypto
    .createHmac('sha512', Buffer.from(config.apiSecret, 'base64'))
    .update(Buffer.concat([Buffer.from(urlPath), hash]))
    .digest('base64');

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

  // Kraken uses weird asset names: XXBT=BTC, XETH=ETH, ZUSD=USD, etc.
  // Staked assets have suffixes: ETH2.S (staked), ETH2 (rewards), DOT.S, SOL.S, etc.
  const KRAKEN_MAP: Record<string, string> = {
    XXBT: 'BTC',
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
    // Staked asset variants → map to base asset
    'ETH2.S': 'ETH',
    ETH2: 'ETH',
    'XBT.M': 'BTC',
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

  // Aggregate by normalized symbol so staked + spot are combined
  const assetTotals = new Map<string, number>();
  for (const [asset, value] of Object.entries(data.result || {})) {
    const amount = parseFloat(value as string);
    if (amount > 0.000001) {
      // Check explicit map first, then strip staking suffix, then strip X/Z prefix
      let symbol = KRAKEN_MAP[asset];
      if (!symbol) {
        // Handle unknown staking variants: strip .S / .M / .P suffixes
        const stripped = asset.replace(/\.\w+$/, '');
        symbol = KRAKEN_MAP[stripped] || stripped.replace(/^[XZ]/, '');
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
// Wallet: Ethereum (public RPC, no key needed)
// -----------------------------------------------------------------------------

async function fetchEthBalance(address: string): Promise<Balance[]> {
  // Use Cloudflare's public Ethereum RPC
  const res = await fetch('https://cloudflare-eth.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [address, 'latest'],
    }),
  });

  if (!res.ok) {
    throw new Error(`Ethereum RPC error ${res.status}`);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(`Ethereum RPC: ${data.error.message}`);
  }

  const weiHex = data.result || '0x0';
  const ethAmount = parseInt(weiHex, 16) / 1e18;

  if (ethAmount <= 0) return [];
  return [{ asset: 'ETH', amount: ethAmount }];
}

// -----------------------------------------------------------------------------
// Public API
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

const WALLET_FETCHERS: Record<string, (address: string) => Promise<Balance[]>> = {
  btc: fetchBtcBalance,
  eth: fetchEthBalance,
};

export async function fetchAllBalances(
  exchanges: ExchangeConfig[],
  wallets: WalletConfig[]
): Promise<{
  sources: SourceBalance[];
  totalUsdValue: number;
  byAsset: Balance[];
  lastUpdated: string;
}> {
  const sources: SourceBalance[] = [];
  const allAssets = new Set<string>();

  // Fetch exchange balances
  for (const exchange of exchanges) {
    if (!exchange.enabled) continue;
    const fetcher = EXCHANGE_FETCHERS[exchange.id];
    if (!fetcher) continue;

    try {
      const balances = await fetcher(exchange);
      balances.forEach((b) => allAssets.add(b.asset));
      sources.push({
        sourceId: exchange.id,
        sourceType: 'exchange',
        label: EXCHANGE_LABELS[exchange.id] || exchange.id,
        balances,
        totalUsdValue: 0,
        lastUpdated: new Date().toISOString(),
      });
    } catch (err) {
      sources.push({
        sourceId: exchange.id,
        sourceType: 'exchange',
        label: EXCHANGE_LABELS[exchange.id] || exchange.id,
        balances: [],
        totalUsdValue: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
        lastUpdated: new Date().toISOString(),
      });
    }
  }

  // Fetch wallet balances
  for (const wallet of wallets) {
    const fetcher = WALLET_FETCHERS[wallet.chain];
    if (!fetcher) continue;

    try {
      const balances = await fetcher(wallet.address);
      balances.forEach((b) => allAssets.add(b.asset));
      sources.push({
        sourceId: wallet.id,
        sourceType: 'wallet',
        label: wallet.label || `${wallet.chain.toUpperCase()} Wallet`,
        balances,
        totalUsdValue: 0,
        lastUpdated: new Date().toISOString(),
      });
    } catch (err) {
      sources.push({
        sourceId: wallet.id,
        sourceType: 'wallet',
        label: wallet.label || `${wallet.chain.toUpperCase()} Wallet`,
        balances: [],
        totalUsdValue: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
        lastUpdated: new Date().toISOString(),
      });
    }
  }

  // Fetch prices and calculate USD values
  const prices = await fetchPrices(Array.from(allAssets));

  for (const source of sources) {
    for (const balance of source.balances) {
      const price = prices[balance.asset] || 0;
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
      usdValue: amount * (prices[asset] || 0),
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
