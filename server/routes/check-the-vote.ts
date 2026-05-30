import { jsonResponse } from '../data.js';
import { loadCheckTheVotePolitics, loadCheckTheVoteStatus } from '../check-the-vote.js';

export async function handleCheckTheVoteRoutes(
  _req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/check-the-vote/status') {
    const status = await loadCheckTheVoteStatus();
    return jsonResponse(status);
  }

  if (pathname === '/api/check-the-vote/politics') {
    const politics = await loadCheckTheVotePolitics();
    return jsonResponse(politics, politics.ok ? 200 : 502);
  }

  return null;
}
