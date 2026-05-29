import { ResearchPanel } from '../Quant/ResearchPanel';

export function PoliticsView() {
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-surface-600 font-semibold">
          Politics
        </p>
        <h1 className="font-display text-3xl text-surface-950 italic mt-1">
          Political intelligence
        </h1>
        <p className="text-sm text-surface-700 mt-2 max-w-3xl">
          Store political transcripts, PDFs, commentary notes, and source links separately from
          finance/health research. Check the Vote API status and trade/vote feeds can plug into this
          tab once the Pi service is live.
        </p>
      </div>

      <ResearchPanel
        domain="politics"
        title="Political research inbox"
        description="Upload disclosure PDFs, paste commentator transcripts/articles, or fetch YouTube captions into a politics-only research partition."
        pdfHint="Political disclosure PDFs, policy reports, and raw source documents. Text is extracted automatically — no AI parsing."
      />
    </div>
  );
}
