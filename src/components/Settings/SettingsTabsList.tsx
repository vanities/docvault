import {
  Activity,
  Archive,
  Banknote,
  Bitcoin,
  Brain,
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

export function SettingsTabsList() {
  return (
    <TabsList className="mb-2">
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
        AI
      </TabsTrigger>
      <TabsTrigger value="email">
        <Mail className="w-3.5 h-3.5" />
        Email
      </TabsTrigger>
      <TabsTrigger value="maps">
        <MapPin className="w-3.5 h-3.5" />
        Maps
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
        Sources
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
  );
}
