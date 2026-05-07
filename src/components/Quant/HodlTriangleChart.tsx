import { useState } from 'react';
import { Triangle, AlertCircle, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';

type TriangleVariant = 'outs' | 'btc';

const VARIANTS: Record<TriangleVariant, { label: string; src: string; caption: string }> = {
  outs: {
    label: 'Number of Outputs',
    src: 'https://utxo.live/triangleOuts.png',
    caption: 'Each cell = number of UTXOs created on the Y-date and spent on the X-date.',
  },
  btc: {
    label: 'Amount of BTC',
    src: 'https://utxo.live/triangleBtc.png',
    caption: 'Each cell = total BTC value of UTXOs created on the Y-date and spent on the X-date.',
  },
};

export function HodlTriangleChart() {
  const [variant, setVariant] = useState<TriangleVariant>('outs');
  const [errored, setErrored] = useState(false);
  const v = VARIANTS[variant];

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Triangle className="w-5 h-5 text-amber-400" />
          Hodl Triangle
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          A 2D heatmap of every Bitcoin UTXO since 2009. The Y-axis is the date a coin was{' '}
          <strong>acquired</strong> (output created), the X-axis is the date it was{' '}
          <strong>spent</strong> (output consumed). The lower-right triangle shape is forced by
          causality — coins can&apos;t be spent before they exist.{' '}
          <span className="text-amber-300">Vertical bright streaks</span> are days when many old
          coins moved at once (typically near cycle tops);{' '}
          <span className="text-cyan-300">horizontal bright bands</span> are large acquisition
          cohorts still being slowly distributed years later.
        </p>
      </div>

      <div className="mb-4 flex items-center gap-2">
        {(Object.keys(VARIANTS) as TriangleVariant[]).map((key) => {
          const active = key === variant;
          return (
            <button
              key={key}
              onClick={() => {
                setErrored(false);
                setVariant(key);
              }}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all ${
                active
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-border/40 bg-surface-100/30 text-surface-800 hover:bg-surface-100/50'
              }`}
            >
              {VARIANTS[key].label}
            </button>
          );
        })}
      </div>

      {errored ? (
        <div className="h-[300px] flex flex-col items-center justify-center gap-2 text-danger-400 p-6 text-center border border-border/40 rounded-xl bg-surface-100/20">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Could not load triangle from utxo.live</div>
          <div className="text-[11px] text-surface-700 max-w-md">
            The image is hosted by utxo.live and may be temporarily unreachable.
          </div>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden border border-border/40 bg-black">
          <img
            key={variant}
            src={v.src}
            alt={`Hodl Triangle — ${v.label}`}
            loading="lazy"
            className="w-full h-auto block"
            onError={() => setErrored(true)}
          />
        </div>
      )}

      <p className="text-[11px] text-surface-700 mt-3 leading-relaxed">{v.caption}</p>

      <div className="mt-3 pt-3 border-t border-border/30 flex items-center justify-between text-[11px] text-surface-700">
        <span>
          Image regenerated daily by{' '}
          <a
            href="https://utxo.live/triangle/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300"
          >
            utxo.live
            <ExternalLink className="w-3 h-3" />
          </a>{' '}
          from a full Bitcoin archival node.
        </span>
      </div>
    </Card>
  );
}
