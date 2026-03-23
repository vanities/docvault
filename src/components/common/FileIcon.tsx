import { FileText, Image, File } from 'lucide-react';

export function FileIcon({ fileType, className }: { fileType: string; className?: string }) {
  if (fileType.includes('image')) return <Image className={className} />;
  if (fileType.includes('pdf')) return <FileText className={className} />;
  return <File className={className} />;
}
