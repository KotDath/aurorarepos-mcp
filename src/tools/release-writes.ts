import { acceptedContent, inputRequired, inputResponse, type McpServer, type ServerContext } from '@modelcontextprotocol/server';
import { AuthError } from '../auth/errors.js';
import { sanitizedError } from '../aurora/errors.js';
import { ReleaseError } from '../release/errors.js';
import { WriteError } from '../writes/errors.js';
import { approvalInput } from '../writes/schemas.js';
import * as s from '../writes/release-schemas.js';
import { ReleaseWriteService } from '../writes/releases.js';

export function registerReleaseWriteTools(server: McpServer, service: ReleaseWriteService, yolo = false): void {
  async function call(operation: s.ReleaseOperation, input: unknown, ctx: ServerContext) {
    try {
      if (yolo) {
        const preview = await service.preview(operation, input, ctx.mcpReq.signal);
        const output = await service.commit(operation, input, preview.ticket, ctx.mcpReq.signal);
        return { structuredContent: output, content: [{ type: 'text' as const, text: JSON.stringify(output) }] };
      }
      const ticket = ctx.mcpReq.requestState<unknown>(), response = inputResponse(ctx.mcpReq.inputResponses, 'approve');
      if (ticket === undefined) {
        if (response.kind !== 'missing') throw new WriteError('APPROVAL_INVALID');
        const preview = await service.preview(operation, input, ctx.mcpReq.signal);
        return inputRequired({ requestState: preview.ticket, inputRequests: {
          approve: inputRequired.elicit({ mode: 'form', message: preview.message, requestedSchema: {
            type: 'object', properties: { confirm: { type: 'boolean', title: 'Confirm this exact release write', default: false } }, required: ['confirm'],
          } }),
        } });
      }
      const accepted = acceptedContent(ctx.mcpReq.inputResponses, 'approve', approvalInput);
      if (!accepted?.confirm) { service.decline(ticket); throw new WriteError(response.kind === 'elicit' ? 'APPROVAL_DECLINED' : 'APPROVAL_INVALID'); }
      const output = await service.commit(operation, input, ticket, ctx.mcpReq.signal);
      return { structuredContent: output, content: [{ type: 'text' as const, text: JSON.stringify(output) }] };
    } catch (error) {
      const safe = error instanceof WriteError || error instanceof ReleaseError || error instanceof AuthError ? error : sanitizedError(error);
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: { code: safe.code, message: safe.message } }) }] };
    }
  }
  const annotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
  const approval = yolo ? 'YOLO mode: executes without asking for MCP confirmation.' : 'Requires exact user form confirmation.';
  server.registerTool('upload_release', { title: 'Upload a new owned release',
    description: `Upload one/two absolute-path ARM RPMs as a NEW release of an existing caller-owned app. Preserves existing description, contacts, icon, screenshots, beta and scheduling. ${approval} Rechecks bytes/state and rejects duplicate version/OS. 100,000,000 bytes/file. No signature or SDK verification. Server decides review/publication status; no admin status override. Never automatically retry unknown/already-attempted outcomes.`,
    inputSchema: s.uploadInput, outputSchema: s.releaseWriteOutput, annotations }, (input, ctx) => call('upload_release', input, ctx));
  server.registerTool('update_my_app_version', { title: 'Update owned release metadata',
    description: `Change plain-text description, category_id and/or release_notes for an owned version_id. Description/category are shared APP fields affecting all releases. Preserves unchanged contacts, owner, icon, screenshots, beta/scheduling and RPM references. ${approval} Requires unchanged state. Does not replace RPMs. Never automatically retry uncertain outcomes.`,
    inputSchema: s.updateInput, outputSchema: s.releaseWriteOutput, annotations }, (input, ctx) => call('update_my_app_version', input, ctx));
  server.registerTool('schedule_my_app_version', { title: 'Set owned publication schedule',
    description: `Set/cancel website is_delayed and publish_at for an owned version. Date is YYYY-MM-DDTHH:mm in WEBSITE wall-clock time: server timezone and actual delayed publication not verified. Does not force a status transition or bypass moderation. Preserves other editor fields and RPMs. ${approval} Never retry unknown outcomes.`,
    inputSchema: s.scheduleInput, outputSchema: s.releaseWriteOutput, annotations }, (input, ctx) => call('schedule_my_app_version', input, ctx));
}
