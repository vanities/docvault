import { Cloud, Download, Shield, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface BackupSectionProps {
  autoBackupPasswordSet: boolean;
  backupPassword: string;
  restorePassword: string;
  restoreFile: File | null;
  isBackingUp: boolean;
  isDownloadingLatest: boolean;
  isRestoring: boolean;
  onBackupPasswordChange: (value: string) => void;
  onRestorePasswordChange: (value: string) => void;
  onRestoreFileChange: (file: File | null) => void;
  onDownloadLatestBackup: () => void;
  onBackup: () => void;
  onRestore: () => void;
}

export function BackupSection({
  autoBackupPasswordSet,
  backupPassword,
  restorePassword,
  restoreFile,
  isBackingUp,
  isDownloadingLatest,
  isRestoring,
  onBackupPasswordChange,
  onRestorePasswordChange,
  onRestoreFileChange,
  onDownloadLatestBackup,
  onBackup,
  onRestore,
}: BackupSectionProps) {
  return (
    <Card variant="glass" className="p-6 mb-8">
      <h3 className="text-lg font-semibold text-surface-950 mb-2 flex items-center gap-2">
        <Shield className="w-5 h-5" />
        Encrypted Backup
      </h3>
      <p className="text-[13px] text-surface-600 mb-5">
        AES-256 encrypted backup of all settings, API keys, cached data, and portfolio snapshots.{' '}
        {autoBackupPasswordSet ? (
          <span className="text-green-500">
            Auto-backup is enabled and syncs to Dropbox every cycle.
          </span>
        ) : (
          <span className="text-surface-500">
            Set a backup password in Schedules above to auto-sync encrypted backups to Dropbox.
          </span>
        )}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-4 bg-surface-200/20 rounded-xl border border-border/30 flex flex-col">
          <h4 className="text-[13px] font-semibold text-surface-900 mb-3 flex items-center gap-1.5">
            <Cloud className="w-4 h-4" />
            Download Latest
          </h4>
          <p className="text-[11px] text-surface-500 mb-3">
            Download the most recent auto-generated backup. Uses the password set in Schedules.
          </p>
          <div className="mt-auto">
            <Button
              onClick={onDownloadLatestBackup}
              disabled={isDownloadingLatest}
              className="w-full bg-violet-500 hover:bg-violet-400"
            >
              <Download className="w-4 h-4" />
              {isDownloadingLatest ? 'Downloading...' : 'Download Latest'}
            </Button>
          </div>
        </div>

        <div className="p-4 bg-surface-200/20 rounded-xl border border-border/30 flex flex-col">
          <h4 className="text-[13px] font-semibold text-surface-900 mb-3 flex items-center gap-1.5">
            <Download className="w-4 h-4" />
            Manual Backup
          </h4>
          <div className="space-y-2 mt-auto">
            <Input
              type="password"
              value={backupPassword}
              onChange={(e) => onBackupPasswordChange(e.target.value)}
              placeholder="Encryption password (min 4 chars)"
              className="text-[13px] rounded-lg"
            />
            <Button
              onClick={onBackup}
              disabled={isBackingUp || backupPassword.length < 4}
              className="w-full bg-violet-500 hover:bg-violet-400"
            >
              <Download className="w-4 h-4" />
              {isBackingUp ? 'Encrypting...' : 'Create & Download'}
            </Button>
          </div>
        </div>

        <div className="p-4 bg-surface-200/20 rounded-xl border border-border/30 flex flex-col">
          <h4 className="text-[13px] font-semibold text-surface-900 mb-3 flex items-center gap-1.5">
            <Upload className="w-4 h-4" />
            Restore Backup
          </h4>
          <div className="space-y-2 mt-auto">
            <input
              type="file"
              accept=".enc"
              onChange={(e) => onRestoreFileChange(e.target.files?.[0] || null)}
              className="w-full text-[12px] text-surface-700 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-[12px] file:font-medium file:bg-surface-200/50 file:text-surface-700 hover:file:bg-surface-300/50"
            />
            <Input
              type="password"
              value={restorePassword}
              onChange={(e) => onRestorePasswordChange(e.target.value)}
              placeholder="Backup password"
              className="text-[13px] rounded-lg"
            />
            <Button
              onClick={onRestore}
              disabled={isRestoring || !restoreFile || !restorePassword}
              className="w-full bg-amber-500 hover:bg-amber-400"
            >
              <Upload className="w-4 h-4" />
              {isRestoring ? 'Restoring...' : 'Restore from Backup'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
