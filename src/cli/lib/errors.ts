import { Exit } from '../mdreview';
import { isApiError, type ApiError } from './api';

/**
 * Map a thrown error from the API client to an (exitCode, stderr message) pair.
 * Used by every command's catch block.
 */
export function mapApiError(e: unknown, file?: string): { code: number; msg: string } {
  if (!isApiError(e)) {
    const detail = e instanceof Error ? e.message : String(e);
    return { code: Exit.USER, msg: `error: ${detail}\n` };
  }

  const err = e as ApiError;

  if (err.status === 0) {
    return {
      code: Exit.USER,
      msg: `error: cannot reach mdreview server (${err.body?.detail ?? 'network error'})\n`,
    };
  }

  if (err.status === 401) {
    return { code: Exit.USER, msg: `error: unauthorized — check MDREVIEW_USERNAME/MDREVIEW_PASSWORD\n` };
  }

  switch (err.error) {
    case 'not_found':
      return { code: Exit.NOT_FOUND, msg: `error: not_found: ${file ?? ''}\n` };
    case 'forbidden':
      return { code: Exit.NOT_FOUND, msg: `error: forbidden path: ${file ?? ''}\n` };
    case 'thread_not_found': {
      const tid = err.body?.threadId ?? '';
      return { code: Exit.THREAD, msg: `error: thread ${tid} not found\n` };
    }
    case 'orphan':
      return { code: Exit.VALIDATION, msg: `error: anchor orphan; quote not found\n` };
    case 'start_out_of_bounds':
      return { code: Exit.USER, msg: `error: start out of doc bounds\n` };
    case 'end_out_of_bounds':
      return { code: Exit.USER, msg: `error: end out of doc bounds\n` };
    case 'missing_path':
    case 'missing_thread_id':
    case 'invalid_text':
    case 'invalid_author_type':
    case 'invalid_start':
    case 'invalid_end':
    case 'end_before_start':
    case 'no_fields':
    case 'invalid_context':
      return { code: Exit.USER, msg: `error: ${err.error}\n` };
    default:
      return { code: Exit.USER, msg: `error: ${err.error} (status ${err.status})\n` };
  }
}
