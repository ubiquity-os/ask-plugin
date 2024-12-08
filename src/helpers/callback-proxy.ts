import { issueCommentCreatedCallback } from "../handlers/comment-created-callback";
import { performPullPrecheck } from "../handlers/pull-request-callback";
import { Context, SupportedEvents } from "../types";
import { CallbackResult, ProxyCallbacks } from "../types/proxy";
import { bubbleUpErrorComment } from "./errors";

/**
 * The `callbacks` object defines an array of callback functions for each supported event type.
 *
 * Since multiple callbacks might need to be executed for a single event, we store each
 * callback in an array. This design allows for extensibility and flexibility, enabling
 * us to add more callbacks for a particular event without modifying the core logic.
 */
const callbacks = {
  "issue_comment.created": [issueCommentCreatedCallback],
  "pull_request.opened": [performPullPrecheck],
  "pull_request.ready_for_review": [performPullPrecheck],
} as ProxyCallbacks;

export async function callCallbacks(context: Context, eventName: SupportedEvents): Promise<CallbackResult> {
  if (!callbacks[eventName]) {
    context.logger.info(`No callbacks found for event ${eventName}`);
    return { status: 204, reason: "skipped" };
  }

  try {
    return (await Promise.all(callbacks[eventName].map((callback) => handleCallback(callback, context))))[0];
  } catch (er) {
    return { status: 500, reason: (await bubbleUpErrorComment(context, er)).logMessage.raw };
  }
}

/**
 * Why do we need this wrapper function?
 *
 * By using a generic `Function` type for the callback parameter, we bypass strict type
 * checking temporarily. This allows us to pass a standard `Context` object, which we know
 * contains the correct event and payload types, to the callback safely.
 *
 * We can trust that the `ProxyCallbacks` type has already ensured that each callback function
 * matches the expected event and payload types, so this function provides a safe and
 * flexible way to handle callbacks without introducing type or logic errors.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function handleCallback(callback: Function, context: Context) {
  return callback(context);
}
