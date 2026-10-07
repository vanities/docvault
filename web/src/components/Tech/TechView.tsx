import { Cpu } from 'lucide-react';
import { ResearchPanel } from '../Quant/ResearchPanel';

// Tech research — a dedicated partition for technology content: creator
// videos (filed by custom jobs like the bundled Theo example), pasted
// articles/transcripts, and uploaded PDFs. Mirrors the Politics research
// inbox pattern: a thin domain wrapper around ResearchPanel.
export function TechView() {
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Cpu className="w-5 h-5 text-indigo-400" />
        <h1 className="text-xl font-semibold text-surface-950">Tech</h1>
      </div>
      <p className="text-[12px] text-surface-800 mb-6 leading-relaxed">
        Technology research feed — creator videos, articles, and papers. Scheduled jobs file new
        content here automatically; you can also paste text, fetch YouTube captions, or upload PDFs
        directly.
      </p>
      <ResearchPanel
        domain="tech"
        title="Tech research inbox"
        description="Paste articles or transcripts, fetch YouTube captions, or upload PDFs into a tech-only research partition."
        pdfHint="Whitepapers, docs, and technical reports. Text is extracted automatically — no AI parsing."
      />
    </div>
  );
}
