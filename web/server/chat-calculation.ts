import { getQuickJS } from 'quickjs-emscripten';
import { readCalculationChart, type CalculationChart } from './calculation-chart.js';

export interface CalculationResult {
  result: unknown;
  logs: string[];
  chart?: CalculationChart;
}

/** A new guest runtime per call. No host objects, callbacks, module loader, or I/O. */
export async function runCalculation(
  code: string,
  data: unknown = null,
  signal?: AbortSignal
): Promise<CalculationResult> {
  if (code.length > 20_000) throw new Error('Code exceeds 20,000 characters');
  const input = JSON.stringify(data);
  if (input === undefined || input.length > 256_000)
    throw new Error('Input must be JSON under 256,000 characters');
  signal?.throwIfAborted();
  const quickjs = await getQuickJS();
  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(32 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + 1000;
  runtime.setInterruptHandler(() => Date.now() > deadline || !!signal?.aborted);
  const context = runtime.newContext();
  try {
    // Serialize and validate inside the guest so getters, toJSON, and huge results
    // stay inside the same execution/memory limits as the user's calculation.
    const evaluation = context.evalCode(
      `(() => {
      const stringify = JSON.stringify.bind(JSON), parse = JSON.parse.bind(JSON);
      const logs = [];
      const console = { log: (...args) => { if (logs.length < 50) logs.push(args.map(v => typeof v === 'string' ? v : stringify(v)).join(' ').slice(0, 1000)); } };
      const data = parse(${JSON.stringify(input)});
      const result = (function(data, console) { "use strict";\n${code}\n})(data, console);
      if (result === undefined || (result && typeof result.then === 'function')) throw new Error('Return a synchronous JSON result');
      const text = stringify({result, logs}, (key, value) => {
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Result contains a non-finite number');
        if (['undefined','function','symbol','bigint'].includes(typeof value)) throw new Error('Result must contain only JSON values');
        return value;
      });
      if (text.length > 100000) throw new Error('Output exceeds 100,000 characters');
      return text;
    })()`,
      'calculation.js'
    );
    if (evaluation.error) {
      try {
        const error = context.dump(evaluation.error) as { message?: string } | null;
        throw new Error(error?.message ?? 'Calculation failed (memory or execution limit)');
      } finally {
        evaluation.error.dispose();
      }
    }
    let output: CalculationResult;
    try {
      output = JSON.parse(context.getString(evaluation.value)) as CalculationResult;
    } finally {
      evaluation.value.dispose();
    }
    if (output.result && typeof output.result === 'object' && 'chart' in output.result) {
      const chart = readCalculationChart((output.result as { chart: unknown }).chart);
      if (!chart)
        throw new Error(
          'Invalid chart: use kind line/bar, title, labels, and 1–4 named series with matching finite values'
        );
      output.chart = chart;
    }
    return output;
  } finally {
    context.dispose();
    runtime.dispose();
  }
}
