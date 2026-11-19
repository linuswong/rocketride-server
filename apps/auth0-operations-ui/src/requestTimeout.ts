/** A local wait limit; timing out does not stop the remote request. */
export async function withRequestTimeout<T>(request: Promise<T>, stage: string, milliseconds: number): Promise<T> {
 let timer: ReturnType<typeof setTimeout> | undefined;
 try {
  return await Promise.race([request, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${stage} timed out. Remote work may still be running; check the engine before starting another request.`)), milliseconds); })]);
 } finally { if (timer) clearTimeout(timer); }
}
