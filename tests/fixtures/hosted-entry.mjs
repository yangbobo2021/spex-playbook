export default {
  id: 'fixture',
  artifactSchema: 3,
  requiredRoleIds: ['checker', 'reviewer'],
  createRuntime(_options, _capabilities) {
    let session;
    let waiting = false;
    return {
      async init(current) { session = current; },
      async restore(current, snapshot) {
        if (current.sessionId !== snapshot.identity) throw new Error('Incorrect restored identity');
        session = current;
        waiting = snapshot.waiting;
      },
      exportSnapshot() { return { identity: session.sessionId, waiting }; },
      describe() {
        return { pendingQuestions: waiting ? [{ questionId: 'manual', question: '同意吗？' }] : [] };
      },
      async handleBossInput({ text, signal }) {
        if (text === 'claim denied') {
          await session.ports.emitTelemetry({
            topic: 'playbook.trace',
            payload: { type: 'fsm.transition', payload: { state: { stateId: 'check' } } },
          });
          throw new Error("EPERM: mkdir '/project/.git/playbook-effect-claims'");
        }
        if (waiting) {
          return { outcome: 'terminal', terminal: { kind: 'success' }, output: { resumed: text } };
        }
        if (text === 'review?') {
          waiting = true;
          return { outcome: 'quiescent' };
        }
        const checked = await session.ports.callPlayer('checker', text, signal, { resume: false });
        if (checked.status !== 'ok') {
          return { outcome: 'failed', state: { stateId: 'check' }, error: { message: checked.error } };
        }
        if (checked.finalText === 'duplicate') {
          return { outcome: 'terminal', terminal: { kind: 'failure' }, output: 'duplicate' };
        }
        const reviewed = await session.ports.callPlayer('reviewer', checked.finalText, signal, { resume: false });
        return { outcome: 'terminal', terminal: { kind: 'success' }, output: reviewed.finalText };
      },
      async dispose() {},
    };
  },
};
