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
  // Liquid staking
  stETH: 'staked-ether',
  rETH: 'rocket-pool-eth',
  RPL: 'rocket-pool',
  cbETH: 'coinbase-wrapped-staked-eth',
  sfrxETH: 'staked-frax-ether',
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
  { contract: '0xFe2e637202056d30016725477c5da089Ab0A043A', symbol: 'sfrxETH', decimals: 18 }, // Frax staked ETH
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
