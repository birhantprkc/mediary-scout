import { NextResponse, type NextRequest } from "next/server";
import { runNextQueuedWorkflow } from "../../../../lib/workflow-runtime";

export async function POST(request: NextRequest) {
  const secret = process.env.MEDIA_TRACK_WORKER_SECRET;
  if (secret && request.headers.get("x-media-track-worker-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runNextQueuedWorkflow();
  return NextResponse.json(result);
}
