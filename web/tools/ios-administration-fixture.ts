// Fabricated Brain, Skills and local Markdown clones. No provider traffic.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export async function seedNativeAdministration(dataDir: string) {
  await writeFile(
    path.join(dataDir, '.docvault-brain.md'),
    '# Acme memory\n\n## Preferences\n\nRead the complete source 🧪.\n\n## Decisions\n\nKeep missing values unavailable. These notes are fabricated.\n'
  );
  const skillsDir = path.join(dataDir, 'skills');
  await rm(skillsDir, { recursive: true, force: true });
  for (const [name, description, instructions] of [
    [
      'document-review',
      'Review a document using saved evidence.',
      '# Document review\n\n1. Read the source.\n2. List missing evidence.\n\n| Check | Result |\n| --- | --- |\n| Source | Saved |',
    ],
    [
      'weekly-summary',
      'Summarize saved records from one week.',
      '# Weekly summary\n\nUse recorded work only.',
    ],
  ]) {
    await mkdir(path.join(skillsDir, name), { recursive: true });
    await writeFile(
      path.join(skillsDir, name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: "${description}"\n---\n\n${instructions}\n`
    );
  }
  const clonesDir = path.join(dataDir, '.external-sources');
  await rm(clonesDir, { recursive: true, force: true });
  const root = path.join(clonesDir, 'acme-library');
  const pages: Record<string, string> = {
    'README.md':
      '# Acme source library\n\nThese are fabricated read-only source pages.\n\nRead [[Overview|the overview]] and the [planning checklist](Guides/Planning/Checklist.md).\n',
    'Guides/Overview.md':
      '# Overview\n\nSaved evidence belongs beside the source.\n\nOpen [[Guides/Planning/Checklist]] or return to [Home](../README.md).\n',
    'Guides/Planning/Checklist.md':
      '# Checklist\n\n- Read the source\n- Keep exact observations\n- Review missing evidence\n\n| Step | Status |\n| --- | --- |\n| Review | Pending |\n',
    'Guides/Planning/Notes.md': '# Planning notes\n\nFabricated planning observations.\n',
    'Archive/Notes.md': '# Archive notes\n\nA second page deliberately shares a basename.\n',
    'Large.md': '# Large source\n\n' + 'Fabricated observation.\n'.repeat(14000),
  };
  for (const [filename, content] of Object.entries(pages)) {
    await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
    await writeFile(path.join(root, filename), content);
  }
  // A real local repository with no remote fails fetch immediately, leaving
  // cached pages intact. Sync tests never connect to a public repository.
  await promisify(execFile)('git', ['init', '--quiet', root]);
  const settingsPath = path.join(dataDir, '.docvault-settings.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  settings.externalSources = {
    repos: [
      {
        id: 'acme-library',
        name: 'Acme Research Library',
        url: 'https://example.com/acme/library.git',
        branch: 'main',
        enabled: true,
        lastSyncedAt: '2026-10-01T12:00:00Z',
        fileCount: Object.keys(pages).length,
        commit: 'abcdef0',
        lastError: null,
      },
    ],
  };
  await writeFile(settingsPath, JSON.stringify(settings));
}
