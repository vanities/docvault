import { MapPin } from 'lucide-react';
import { ResearchPanel } from '../Quant/ResearchPanel';

// Local news — a dedicated partition for city/county/regional coverage:
// official municipal news-flash feeds, hometown papers, and keyword-gated
// regional outlets (filed by custom jobs like the bundled local-news
// example). Mirrors the Tech/Politics research inbox pattern: a thin domain
// wrapper around ResearchPanel.
export function LocalNewsView() {
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <MapPin className="w-5 h-5 text-rose-400" />
        <h1 className="text-xl font-semibold text-surface-950">Local</h1>
      </div>
      <p className="text-[12px] text-surface-800 mb-6 leading-relaxed">
        Local news feed — city and county announcements, hometown paper stories, and regional
        coverage that mentions your area. Scheduled jobs file new items here automatically; you can
        also paste text, fetch YouTube captions, or upload PDFs directly.
      </p>
      <ResearchPanel
        domain="local"
        title="Local news inbox"
        description="Paste articles or meeting notes, fetch YouTube captions, or upload PDFs into a local-only research partition."
        pdfHint="Council agendas, public notices, and planning documents. Text is extracted automatically — no AI parsing."
      />
    </div>
  );
}
