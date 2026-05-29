import { jsonResponse } from '../data.js';
import { loadCheckTheVoteStatus } from '../check-the-vote.js';

export async function handleCheckTheVoteRoutes(
  _req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/check-the-vote/status') {
    const status = await loadCheckTheVoteStatus();
    return jsonResponse(status);
  }

  return null;
}
