export function browseFiles(files: string[], folder: string, query: string) {
  const needle = query.trim().toLowerCase();
  if (needle)
    return {
      folders: [],
      files: files
        .filter((file) => file.toLowerCase().includes(needle))
        .sort((a, b) => a.localeCompare(b)),
    };
  const prefix = folder ? `${folder}/` : '';
  const folders = new Map<string, number>();
  const directFiles: string[] = [];
  for (const file of files) {
    if (!file.startsWith(prefix)) continue;
    const rest = file.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) directFiles.push(file);
    else {
      const name = rest.slice(0, slash);
      folders.set(name, (folders.get(name) ?? 0) + 1);
    }
  }
  return {
    folders: [...folders]
      .map(([name, count]) => ({ name, path: prefix + name, count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    files: directFiles.sort((a, b) => a.localeCompare(b)),
  };
}
