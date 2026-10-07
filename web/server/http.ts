/**
 * Typed seam over Request.json(). Bun types json() as Promise<unknown>, so
 * every route handler declares the minimal body shape it actually reads.
 * Server-side mirror of the frontend's requestJson seam.
 */
export async function readJsonBody<T = unknown>(req: Request): Promise<T> {
  return (await req.json()) as T;
}
