import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Archive,
  Banknote,
  Bitcoin,
  Brain,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Landmark,
  LayoutGrid,
  Library,
  LineChart,
  Mail,
  MapPin,
  Mic,
  RefreshCw,
  Sliders,
} from 'lucide-react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export function SettingsTabsList() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateOverflowCue = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
    const scrollLeft = Math.max(0, scroller.scrollLeft);
    setCanScrollLeft(scrollLeft > 8);
    setCanScrollRight(maxScrollLeft - scrollLeft > 8);
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    updateOverflowCue();
    scroller.addEventListener('scroll', updateOverflowCue, { passive: true });
    window.addEventListener('resize', updateOverflowCue);

    const resizeObserver = new ResizeObserver(updateOverflowCue);
    resizeObserver.observe(scroller);

    return () => {
      scroller.removeEventListener('scroll', updateOverflowCue);
      window.removeEventListener('resize', updateOverflowCue);
      resizeObserver.disconnect();
    };
  }, [updateOverflowCue]);

  const scrollTabs = (direction: 'left' | 'right') => {
    scrollerRef.current?.scrollBy({
      left: direction === 'left' ? -320 : 320,
      behavior: 'smooth',
    });
  };

  return (
    <div className="relative mb-2">
      <TabsList
        ref={scrollerRef}
        className={cn(
          'mb-0 scroll-smooth pr-16 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          canScrollLeft && 'pl-14',
          canScrollRight && 'shadow-[inset_-26px_0_28px_-28px_rgba(103,232,249,0.55)]'
        )}
        aria-label="Settings sections. Scroll horizontally for more sections."
      >
        <TabsTrigger value="all">
          <LayoutGrid className="w-3.5 h-3.5" />
          All
        </TabsTrigger>
        <TabsTrigger value="general">
          <Sliders className="w-3.5 h-3.5" />
          General
        </TabsTrigger>
        <TabsTrigger value="keys">
          <KeyRound className="w-3.5 h-3.5" />
          AI &amp; Chat
        </TabsTrigger>
        <TabsTrigger value="email">
          <Mail className="w-3.5 h-3.5" />
          Email
        </TabsTrigger>
        <TabsTrigger value="maps">
          <MapPin className="w-3.5 h-3.5" />
          Location
        </TabsTrigger>
        <TabsTrigger value="voice">
          <Mic className="w-3.5 h-3.5" />
          Voice
        </TabsTrigger>
        <TabsTrigger value="sync">
          <RefreshCw className="w-3.5 h-3.5" />
          Sync
        </TabsTrigger>
        <TabsTrigger value="sources">
          <Library className="w-3.5 h-3.5" />
          External
        </TabsTrigger>
        <TabsTrigger value="brain">
          <Brain className="w-3.5 h-3.5" />
          Brain
        </TabsTrigger>
        <TabsTrigger value="status">
          <Activity className="w-3.5 h-3.5" />
          Status
        </TabsTrigger>
        <TabsTrigger value="jobs">
          <Activity className="w-3.5 h-3.5" />
          Jobs
        </TabsTrigger>
        <TabsTrigger value="banking">
          <Banknote className="w-3.5 h-3.5" />
          Banking
        </TabsTrigger>
        <TabsTrigger value="crypto">
          <Bitcoin className="w-3.5 h-3.5" />
          Crypto
        </TabsTrigger>
        <TabsTrigger value="quant">
          <LineChart className="w-3.5 h-3.5" />
          Quant
        </TabsTrigger>
        <TabsTrigger value="politics">
          <Landmark className="w-3.5 h-3.5" />
          Politics
        </TabsTrigger>
        <TabsTrigger value="backup">
          <Archive className="w-3.5 h-3.5" />
          Backup
        </TabsTrigger>
      </TabsList>

      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scrollTabs('left')}
          className="absolute left-1 top-1/2 z-10 inline-flex h-8 w-10 -translate-y-1/2 items-center justify-center rounded-lg border border-surface-200 bg-surface-50/95 text-surface-700 shadow-lg shadow-surface-950/10 backdrop-blur hover:text-surface-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Scroll settings tabs left"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      {canScrollRight && (
        <button
          type="button"
          onClick={() => scrollTabs('right')}
          className="absolute right-1 top-1/2 z-10 inline-flex h-8 items-center gap-1 rounded-lg border border-cyan-400/30 bg-cyan-400/15 px-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200 shadow-lg shadow-cyan-950/20 backdrop-blur hover:border-cyan-300/50 hover:bg-cyan-400/20 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          aria-label="More settings tabs to the right"
        >
          More
          <ChevronRight className="h-4 w-4 animate-pulse" />
        </button>
      )}
    </div>
  );
}
