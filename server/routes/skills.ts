// HTTP routes for Chat Skills — user-authored SKILL.md packs under
// DATA_DIR/skills/<name>/, managed from Settings → Skills and suggested in the
// chat composer via `$name` mentions.
//
//   GET    /api/skills          list skills      { skills: SkillSummary[] }
//   GET    /api/skills/:name    read one         SkillRecord
//   PUT    /api/skills/:name    create/replace   { description, instructions }
//   DELETE /api/skills/:name    remove the skill folder

import { jsonResponse } from '../data.js';
import { listSkills, readSkill, writeSkill, deleteSkill, isValidSkillName } from '../skills.js';
import { readJsonBody } from '../http.js';

export async function handleSkillsRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/skills') {
    if (req.method !== 'GET') return null;
    return jsonResponse({ skills: await listSkills() });
  }

  const match = /^\/api\/skills\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  const name = decodeURIComponent(match[1]);
  if (!isValidSkillName(name)) {
    return jsonResponse(
      { error: 'Skill name must be kebab-case: lowercase letters, digits, hyphens (max 64)' },
      400
    );
  }

  if (req.method === 'GET') {
    const skill = await readSkill(name);
    return skill ? jsonResponse(skill) : jsonResponse({ error: `No skill named "${name}"` }, 404);
  }

  if (req.method === 'PUT') {
    const body = await readJsonBody<{ description?: string; instructions?: string }>(req).catch(
      (): { description?: string; instructions?: string } => ({})
    );
    if (typeof body.description !== 'string' || typeof body.instructions !== 'string') {
      return jsonResponse({ error: 'description and instructions (strings) are required' }, 400);
    }
    try {
      return jsonResponse(await writeSkill(name, body.description, body.instructions));
    } catch (err) {
      return jsonResponse({ error: (err as Error).message }, 400);
    }
  }

  if (req.method === 'DELETE') {
    const removed = await deleteSkill(name);
    return removed
      ? jsonResponse({ ok: true })
      : jsonResponse({ error: `No skill named "${name}"` }, 404);
  }

  return null;
}
