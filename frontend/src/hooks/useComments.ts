import { useCallback, useEffect, useMemo, useState } from "react";
import { addComment, ensureSeeded, listComments, removeComment, stanceTally, subscribe, type Comment, type Stance } from "../lib/comments";

export interface CommentsState {
  comments: Comment[];
  tally: { yes: number; no: number; neutral: number };
  post: (input: { author: string; stance: Stance; text: string }) => void;
  remove: (id: string) => void;
}

/**
 * Debate wall data source. On mount, seeded takes are written into the local store
 * (demo markets only); afterwards every mutation is broadcast to all open walls
 * through the subscription in lib/comments.
 */
export function useComments(marketId: string, seedIds: string[] = []): CommentsState {
  const [version, setVersion] = useState(0);

  useEffect(() => subscribe(() => setVersion((v) => v + 1)), []);

  useEffect(() => {
    if (seedIds.length > 0) ensureSeeded(seedIds);
  }, [seedIds]);

  const comments = useMemo(() => listComments(marketId), [marketId, version]);
  const tally = useMemo(() => stanceTally(marketId), [marketId, version]);

  const post = useCallback(
    (input: { author: string; stance: Stance; text: string }) => {
      if (!input.text.trim()) return;
      addComment(marketId, input);
    },
    [marketId],
  );

  const remove = useCallback((id: string) => removeComment(marketId, id), [marketId]);

  return { comments, tally, post, remove };
}
