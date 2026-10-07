// OGE asset-name → ticker inference. Ported verbatim from the Check the Vote
// repo (`lib/ingest/trades/oge-asset-normalization.ts`). OGE 278-T filings are
// scanned PDFs, so asset names arrive OCR-mangled and without tickers — this maps
// known issuer names to symbols and screens out bonds/notes/money-funds.

function cleanSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

const OGE_TICKER_PATTERNS: Array<[RegExp, string]> = [
  [/\bNVIDIA\b|\bNVDA\b/, 'NVDA'],
  [/\bMICROSOFT\b|\bMSFT\b/, 'MSFT'],
  [/\bAMAZON(?:\.COM)?\b|\bAMZN\b/, 'AMZN'],
  [/\bAPPLE\s+INC\b|\bAAPL\b/, 'AAPL'],
  [/\bORACLE\b|\bORCL\b/, 'ORCL'],
  [/\bSERVICENOW\b|^NOW$/, 'NOW'],
  [/\bBROADCOM\b|\bAVGO\b/, 'AVGO'],
  [/\bMOTOROLA\b|\bMSI\b/, 'MSI'],
  [/\bTEXAS INSTRUMENTS\b|\bTXN\b/, 'TXN'],
  [/\bDELL\b/, 'DELL'],
  [/\bMETA\b|\bFACEBOOK\b/, 'META'],
  [/\bCOSTCO\b/, 'COST'],
  [/\bUBER\b/, 'UBER'],
  [/\bEATON\b/, 'ETN'],
  [/\bCADENCE\b/, 'CDNS'],
  [/\bSCHWAB\b|\bCHARLES SCHWAB\b/, 'SCHW'],
  [/\bJABIL\b/, 'JBL'],
  [/\bTRANSDIGM\b/, 'TDG'],
  [/\bADOBE\b/, 'ADBE'],
  [/\bPALANTIR\b/, 'PLTR'],
  [/\bADVANCED MICRO DEVICES\b|\bAMD\b/, 'AMD'],
  [/\bINTEL\b/, 'INTC'],
  [/\bGOLDMAN SACHS\b/, 'GS'],
  [/\bALPHABET\b|\bGOOGLE\b|\bGOOGL\b/, 'GOOGL'],
  [/\bAIRBNB\b/, 'ABNB'],
  [/\bDOORDASH\b/, 'DASH'],
  [/\bMICRON\b/, 'MU'],
  [/\bBLOOM ENERGY\b/, 'BE'],
  [/\bBOEING\b/, 'BA'],
  [/\bNETFLIX\b/, 'NFLX'],
  [/\bCOREWEAVE\b/, 'CRWV'],
  [/\bVANGUARD S&P 500\b|\bVANGUARD 500\b/, 'VOO'],
  [/\bSPDR S&P 500\b|\bSPDR SERIES TRUST.*S&P 500\b/, 'SPY'],
  [/\bINVESCO.*S&P 500 EQUAL\b|\bS&P 500 EQUAL WEIGHT\b/, 'RSP'],
  [/\bRUS(?:SELL|SOLL) 1000\b/, 'IWB'],
  [/\bJ&J\s+SNACK\b|\bJJSNACK\b/, 'JJSF'],
  [/\bITRON\b/, 'ITRI'],
  [/\bWENDY'?S\b|\bWENDYS\b/, 'WEN'],
  [/\bUPWORK\b/, 'UPWK'],
  [/\bALKERMES\b/, 'ALKS'],
  [/\bGRIFFON\b/, 'GFF'],
  [/\bSAFEHOLD\b/, 'SAFE'],
  [/\bBLACKLINE\b/, 'BL'],
  [/\bAPOGEE\b/, 'APOG'],
  [/\bGIBRALTAR\b/, 'ROCK'],
  [/\bRITHM\b/, 'RITM'],
  [/\bPARK NATL\b|\bPARKNATL\b/, 'PRK'],
  [/\bSPS\s*COMM\b|\bSPSCOMM\b/, 'SPSC'],
  [/\bDNOW\b/, 'DNOW'],
  [/\bINSPIRE\b/, 'INSP'],
];

const NON_EQUITY_PATTERNS = [
  /\bUNITED STATES TREAS/i,
  /\bTREAS\s+BILL/i,
  /\bMUN\b/i,
  /\bDUE\s+\d/i,
  /\bDUE\s*\d/i,
  /\bSENIOR\s+(?:UN)?SECURED\s+NOTE/i,
  /\b(?:NOTE|NOTES|NTS|DEBS)\b/i,
  /\b(?:ALT\s+TIER|TIER\s+I|PERP|DEP\s+SHS?)\b/i,
  /\b(?:GOVERNMENT\s+)?MONEY\s+FUND\b/i,
  /\bREGS\b.*\bDUE\b/i,
  /\bB[/.]?E\s*\d/i,
  /\bBIE\s*\d/i,
  /[0-9OQ][^A-Z0-9]{0,4}\d{3,4}%/i,
  /\b\d{1,2}\.\d{3,4}%\b/i,
  /\b\d{1,2}\.\d{2,4}%\s*(?:DUE|\d{6}|\d{2}\/\d{2})/i,
  /(?:DTD|OTD)\d{6}/i,
  /\bREVENUE\b/i,
  /\bRFDG\b/i,
  /\bREFUND/i,
];

const ETF_TICKERS = new Set(['IWB', 'RSP', 'SPY', 'VOO']);

function findPatternIndex(pattern: RegExp, value: string): number | null {
  const match = value.match(pattern);
  return match?.index ?? null;
}

function prefixLooksLikeDifferentSecurity(prefix: string): boolean {
  return /\b(?:INC|CORP|CORPORATION|COMPANY|CO|ETF|TRUST|REIT|CLASS|CL)\b/i.test(prefix);
}

export function normalizeOgeAssetName(assetName: string): string {
  return cleanSpaces(
    assetName
      .replace(/[“”]/g, '"')
      .replace(/[’]/g, "'")
      .replace(/\b(?:INC|CORP|CORPORATION|COMPANY|CO|LTD|PLC)\b\.?/gi, '')
      .replace(/\b(?:COM|COMMON STOCK|OPSH|DPSH)\b/gi, '')
      .replace(/[^A-Za-z0-9&.'/%+ -]+/g, ' ')
  );
}

export function inferOgeTicker(assetName: string, assetType?: string | null): string | null {
  const original = cleanSpaces(assetName).toUpperCase();
  const normalized = normalizeOgeAssetName(assetName).toUpperCase();
  const type = assetType?.trim().toUpperCase() ?? '';

  if (type === 'BOND' && !/\bCOREWEAVE\b/.test(original)) return null;
  if (NON_EQUITY_PATTERNS.some((pattern) => pattern.test(original))) return null;

  const candidates = OGE_TICKER_PATTERNS.flatMap(([pattern, ticker]) => {
    const originalIndex = findPatternIndex(pattern, original);
    if (originalIndex != null) return [{ ticker, index: originalIndex, source: original }];
    const normalizedIndex = findPatternIndex(pattern, normalized);
    if (normalizedIndex != null) return [{ ticker, index: normalizedIndex, source: normalized }];
    return [];
  }).sort((a, b) => a.index - b.index);

  const first = candidates[0];
  if (!first) return null;

  const prefix = first.source.slice(0, first.index).trim();
  if (prefix && !ETF_TICKERS.has(first.ticker) && prefixLooksLikeDifferentSecurity(prefix)) {
    return null;
  }

  return first.ticker;
}
