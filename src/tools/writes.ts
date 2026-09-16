import { acceptedContent, inputRequired, inputResponse, type McpServer, type ServerContext } from '@modelcontextprotocol/server';
import { AuthError } from '../auth/errors.js';
import { sanitizedError } from '../aurora/errors.js';
import { WriteError } from '../writes/errors.js';
import * as s from '../writes/schemas.js';
import { WriteService } from '../writes/service.js';

export function registerWriteTools(server: McpServer, service: WriteService): void {
  async function call(operation: s.Operation, input: unknown, ctx: ServerContext) {
    try {
      const ticket = ctx.mcpReq.requestState<unknown>(), response = inputResponse(ctx.mcpReq.inputResponses, 'approve');
      if (ticket === undefined) {
        if (response.kind !== 'missing') throw new WriteError('APPROVAL_INVALID');
        const preview = await service.preview(operation, input, ctx.mcpReq.signal);
        return inputRequired({ requestState: preview.ticket, inputRequests: {
          approve: inputRequired.elicit({ mode: 'form', message: preview.message, requestedSchema: {
            type: 'object', properties: { confirm: { type: 'boolean', title: 'Confirm this exact write', default: false } }, required: ['confirm'],
          } }),
        } });
      }
      const accepted = acceptedContent(ctx.mcpReq.inputResponses, 'approve', s.approvalInput);
      if (!accepted?.confirm) { service.decline(ticket); throw new WriteError(response.kind === 'elicit' ? 'APPROVAL_DECLINED' : 'APPROVAL_INVALID'); }
      const output = await service.commit(operation, input, ticket, ctx.mcpReq.signal);
      return { structuredContent: output, content: [{ type: 'text' as const, text: JSON.stringify(output) }] };
    } catch (error) {
      const safe = error instanceof WriteError || error instanceof AuthError ? error : sanitizedError(error);
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: { code: safe.code, message: safe.message } }) }] };
    }
  }
  const annotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
  server.registerTool('create_app', { title: 'Create an application card',
    description: 'Create a caller-owned app name/card only, not a release or publication. Requires terminal login, verified dev scope and user form elicitation confirmation of this exact action. Refuses duplicate owned names. Observed frontend contract; live writes not verified. No model-supplied approval flag. Never retry an unknown write outcome.',
    inputSchema: s.createInput, outputSchema: s.output, annotations }, (input, ctx) => call('create_app', input, ctx));
  server.registerTool('rename_my_app', { title: 'Rename my application card',
    description: 'Rename an app_id from list_my_apps. Requires verified dev role, owned catalog membership, fresh unchanged state and user form elicitation confirmation. Does not upload/edit a release or publish. Observed frontend contract; live writes not verified. Never retry an unknown write outcome.',
    inputSchema: s.renameInput, outputSchema: s.output, annotations }, (input, ctx) => call('rename_my_app', input, ctx));
}
