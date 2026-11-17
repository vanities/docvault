// The one yahoo-finance2 client for the server. When Yahoo answers with a result that fails the
// library's schema (a delisted or empty symbol does), the default client prints a ~30-line dump
// to the console and then throws anyway. The throw still reaches the caller; only the dump is
// off, because it buried the server log (135 dumps in two weeks on the NAS, Nov 2026).
import YahooFinance from 'yahoo-finance2';

export const yahooFinance = new YahooFinance({ validation: { logErrors: false } });
