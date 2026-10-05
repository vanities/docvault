// Synthetic numbers and chart labels only. Exercises the real WASM interpreter.
import { expect, test } from 'vite-plus/test';
import { runCalculation } from './chat-calculation.js';
import { readCalculationChart, calculationChartSvg } from './calculation-chart.js';

test('aggregates JSON data, captures logs, and returns a chart', async () => {
  const result = await runCalculation(
    `const sum = data.reduce((a,b)=>a+b,0); console.log('sum',sum); return {sum, chart:{kind:'bar',title:'Synthetic totals',labels:['A','B','C'],series:[{name:'Count',values:data}]}};`,
    [2, 4, 6]
  );
  expect(result.result).toMatchObject({ sum: 12 });
  expect(result.logs).toEqual(['sum 12']);
  expect(result.chart?.series[0]?.values).toEqual([2, 4, 6]);
  expect(calculationChartSvg(result.chart!)).toContain('<rect');
});
test('has no host filesystem, network, environment, or module loader', async () => {
  expect(
    (
      await runCalculation(
        `return [typeof process,typeof require,typeof Bun,typeof fetch,typeof XMLHttpRequest,typeof setTimeout];`
      )
    ).result
  ).toEqual(Array(6).fill('undefined'));
  await expect(runCalculation(`return import('node:fs');`)).rejects.toThrow();
});
test('interrupts runaway loops, caps memory, and recovers on the next call', async () => {
  await expect(runCalculation('while(true){}')).rejects.toThrow();
  await expect(runCalculation("return new Array(50_000_000).fill('x');")).rejects.toThrow();
  expect((await runCalculation('return 7*6;')).result).toBe(42);
}, 10_000);
test('rejects non-JSON, asynchronous, oversized and invalid chart results', async () => {
  for (const code of [
    'return NaN;',
    'return undefined;',
    'return Promise.resolve(1);',
    "return 'x'.repeat(100001);",
    'return {chart:{kind:"line",title:"bad",labels:["A"],series:[{name:"A",values:[1,2]}]}};',
    'const x={};x.self=x;return x;',
  ]) {
    await expect(runCalculation(code)).rejects.toThrow();
  }
  await expect(runCalculation('return data;', 'x'.repeat(256001))).rejects.toThrow(/Input/);
});
test('chart rendering escapes markup and rejects untrusted persisted shapes', () => {
  const chart = readCalculationChart({
    kind: 'line',
    title: '<script>alert(1)</script>',
    labels: ['<img>'],
    series: [{ name: '&test', values: [-4] }],
  })!;
  const svg = calculationChartSvg(chart);
  expect(svg).not.toContain('<script>');
  expect(svg).toContain('&lt;script&gt;');
  expect(
    readCalculationChart({ ...chart, series: [{ name: 'X', values: [Infinity] }] })
  ).toBeNull();
});
