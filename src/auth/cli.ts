import { emitKeypressEvents, type Key } from 'node:readline';
import { AuthError, safeAuthError } from './errors.js';
import { AuthService } from './service.js';
import { AuroraError } from '../aurora/errors.js';

export function hiddenPrompt(label: string, signal: AbortSignal): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || !process.stderr.isTTY) throw new AuthError('INTERACTIVE_REQUIRED');
  if (signal.aborted) return Promise.reject(new AuroraError('CANCELLED'));
  process.stderr.write(label);
  emitKeypressEvents(input);
  const wasRaw = input.isRaw;
  input.setRawMode(true); input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    function cleanup() {
      input.removeListener('keypress', keypress);
      input.removeListener('end', cancel);
      signal.removeEventListener('abort', cancel);
      input.setRawMode(wasRaw); input.pause();
      process.stderr.write('\n');
    }
    function cancel() { value = ''; cleanup(); reject(new AuroraError('CANCELLED')); }
    function keypress(text: string | undefined, key: Key) {
      if ((key.ctrl && (key.name === 'c' || key.name === 'd')) || key.name === 'escape') { cancel(); return; }
      if (key.name === 'return' || key.name === 'enter') { const answer = value; value = ''; cleanup(); resolve(answer); return; }
      if (key.name === 'backspace') { value = Array.from(value).slice(0, -1).join(''); return; }
      if (text && !key.ctrl && !key.meta && !/[\r\n\u0000-\u001f\u007f]/u.test(text) && value.length + text.length <= 1024) value += text; // eslint-disable-line no-control-regex
    }
    input.on('keypress', keypress);
    input.once('end', cancel);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

export async function runAuthCli(args: string[], service = new AuthService()): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const command = args[0];
    if (command === 'status' && (args.length === 1 || (args.length === 2 && args[1] === '--verify'))) {
      console.error(JSON.stringify(await service.status({ verify: args[1] === '--verify' }, controller.signal)));
    } else if (command === 'logout' && args.length === 1) {
      await service.store.clear();
      console.error('Local session and encryption key removed. This does not revoke the session on Aurora Repos; log out on the website to revoke it.');
    } else if (command === 'login' && args.length === 1) {
      if (!process.stdin.isTTY || !process.stderr.isTTY) throw new AuthError('INTERACTIVE_REQUIRED');
      const client = await service.createLogin();
      try {
        let email = await hiddenPrompt('Email (hidden): ', controller.signal);
        let password = await hiddenPrompt('Password (hidden): ', controller.signal);
        let step;
        try { step = await client.begin(email, password, controller.signal); }
        finally { email = ''; password = ''; }
        if (step.kind === 'two_factor') {
          console.error(`Two-factor authentication required (${step.method}).`);
          let code = await hiddenPrompt('2FA code (hidden; type resend to explicitly request another code): ', controller.signal);
          let resends = 0;
          while (code === 'resend' && resends++ < 2) {
            await client.resend(controller.signal);
            console.error('Code resend requested.');
            code = await hiddenPrompt('2FA code (hidden): ', controller.signal);
          }
          try { await client.verify(code, controller.signal); }
          finally { code = ''; }
        }
        await service.finishLogin(client, controller.signal);
        console.error('Login verified; encrypted session saved. Password and 2FA code were not saved.');
      } finally { client.cancel(); }
    } else {
      console.error('Usage: aurorarepos-mcp auth login | auth status [--verify] | auth logout. No credential arguments are supported.');
      process.exitCode = 1;
    }
  } catch (error) {
    const safe = safeAuthError(error);
    console.error(`${safe.code}: ${safe.message}`);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  }
}
