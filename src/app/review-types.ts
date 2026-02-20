import type {
  AiReviewChunk,
  AiReviewFinding,
  AiReviewProgressEvent,
} from "@/lib/backend";
import type { ReviewScope } from "@/app/review-scope";

export type ReviewWorkbenchTab =
  | "description"
  | "issues"
  | "chat"
  | "suggestions"
  | "findings"
  | "qa"
  | "runs";

export type ReviewRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "canceled";

export type ReviewRun = {
  id: string;
  status: ReviewRunStatus;
  scope: ReviewScope;
  scopeLabel: string;
  startedAt: number;
  endedAt: number | null;
  model: string | null;
  review: string | null;
  diffTruncated: boolean;
  error: string | null;
  progressEvents: AiReviewProgressEvent[];
  chunks: AiReviewChunk[];
  findings: AiReviewFinding[];
};

export type ReviewChatSharedDiffContext = {
  filePath: string;
  diff: string;
  truncated: boolean;
};
