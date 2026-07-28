// Gemini Live server-message and tool-call handling, and the two outbound
// send paths that read the live session directly (audio chunks, ad hoc
// text/command). Split out of electron/main.mjs (split-main-process-modules)
// alongside live-session.mjs, which owns the connection itself — see that
// module's header comment for why this landed as two files instead of one.
// Electron-free — the live session is reached through an injected accessor,
// never imported directly.
//
// Task 4.4 moves this block verbatim, including raw reads of the injected
// `listenMode` object's fields (engaged, transitioning, boundaryInFlight) —
// task 4.5 converts the write side in live-session.mjs into named
// transitions; this module only ever reads listenMode, never writes it.

/**
 * @param {{
 *   getLiveSession: () => any,
 *   setResumptionHandle: (handle: string) => void,
 *   emitEvent: (event: any) => void,
 *   emitToRenderer: (channel: string, payload: any) => void,
 *   flushTranscripts: () => void,
 *   appendUserTranscript: (text: string) => void,
 *   appendModelTranscript: (text: string) => void,
 *   executeClaudeTool: (name: string, args: any) => Promise<any>,
 *   submitClaudeTask: (params: any) => Promise<any>,
 *   listenMode: any,
 *   notifyFreshResumptionHandle: (handle: string) => void,
 *   notifyTurnComplete: () => void,
 *   runListenRotation: () => Promise<void>,
 * }} deps
 */
export function createLiveMessages({
  getLiveSession,
  setResumptionHandle,
  emitEvent,
  emitToRenderer,
  flushTranscripts,
  appendUserTranscript,
  appendModelTranscript,
  executeClaudeTool,
  submitClaudeTask,
  listenMode,
  notifyFreshResumptionHandle,
  notifyTurnComplete,
  runListenRotation,
}) {
  async function handleToolCall(toolCall) {
    const functionResponses = [];
    for (const call of toolCall.functionCalls || []) {
      emitEvent({ type: "tool_call", name: call.name, args: call.args || {} });
      try {
        const result = await executeClaudeTool(call.name, call.args || {});
        functionResponses.push({ id: call.id, name: call.name, response: { result } });
      } catch (error) {
        functionResponses.push({
          id: call.id,
          name: call.name,
          response: { status: "error", error: error.message },
        });
      }
    }
    const liveSession = getLiveSession();
    if (functionResponses.length && liveSession) {
      liveSession.sendToolResponse({ functionResponses });
    }
  }

  function handleLiveMessage(message) {
    if (message.sessionResumptionUpdate) {
      const { resumable, newHandle } = message.sessionResumptionUpdate;
      if (resumable && newHandle) {
        setResumptionHandle(newHandle);
        notifyFreshResumptionHandle(newHandle);
      }
    }

    if (message.goAway) {
      // Server warns the connection is about to be dropped (connection lifetime
      // limit). Rotate immediately rather than betting the rest of the chunk on
      // an unmeasured goAway.timeLeft (design.md Decision 3) if listening mode
      // is engaged and idle; otherwise onclose fires shortly after and the
      // ordinary reconnect handles it.
      console.log("[IRIS][goAway] timeLeft=", message.goAway.timeLeft || "(unknown)");
      if (listenMode.isEngaged() && !listenMode.isTransitioning()) {
        runListenRotation().catch((error) => {
          emitEvent({ type: "log", level: "warn", message: `Listening-mode rotation (goAway) failed: ${error.message}` });
        });
      }
    }

    if (message.toolCall) {
      // A boundary turn cannot start background work (spec "A boundary turn
      // cannot start background work") — the listening config already ships
      // an empty tool set, so this only guards a stray call arriving folded
      // into the same batch as the boundary's turnComplete.
      if (!listenMode.isBoundaryInFlight()) {
        handleToolCall(message.toolCall).catch((error) => {
          emitEvent({ type: "fatal", message: "Tool call failed", error: error.message });
        });
      }
    }

    const content = message.serverContent;
    if (!content) return;

    if (content.interrupted) {
      flushTranscripts();
      emitToRenderer("live:interrupt", {});
      emitEvent({ type: "audio_state", state: "listening" });
      return;
    }

    if (content.inputTranscription?.text) {
      appendUserTranscript(content.inputTranscription.text);
      // Segment record: the recovery path for the current chunk (design.md
      // Decision 7). Accumulated whenever the mode is engaged, including
      // across a rotation's boundary — never written to disk or the vault.
      if (listenMode.isEngaged()) listenMode.appendToSegment(content.inputTranscription.text);
    }

    // Every boundary turn (rotation or exit alike) is neither heard nor shown
    // (spec "Every boundary turn is neither heard nor shown") — suppressed
    // here, in main, before any part of it reaches the renderer. Reusing the
    // renderer's speaker-mute suppression would be too late: this loop is what
    // appends to modelTranscriptBuffer and emits "speaking", both before the
    // renderer sees anything.
    if (!listenMode.isBoundaryInFlight()) {
      if (content.outputTranscription?.text) appendModelTranscript(content.outputTranscription.text);

      for (const part of content.modelTurn?.parts || []) {
        if (part.text) appendModelTranscript(part.text);
        const inlineData = part.inlineData;
        if (!inlineData?.data) continue;
        const mimeType = inlineData.mimeType || "audio/pcm;rate=24000";
        if (!mimeType.startsWith("audio/")) continue;
        emitToRenderer("live:audio", { data: inlineData.data, mimeType });
        emitEvent({ type: "audio_state", state: "speaking" });
      }
    }

    if (content.turnComplete) {
      flushTranscripts();
      emitEvent({ type: "audio_state", state: "listening" });
      notifyTurnComplete();
    }
  }

  function sendAudioChunk(arrayBuffer) {
    const liveSession = getLiveSession();
    if (!liveSession || !arrayBuffer) return;
    const buffer = Buffer.from(new Uint8Array(arrayBuffer));
    if (!buffer.byteLength) return;
    liveSession.sendRealtimeInput({
      audio: { data: buffer.toString("base64"), mimeType: "audio/pcm;rate=16000" },
    });
  }

  function sendCommand(command) {
    const liveSession = getLiveSession();
    if (command?.type === "text" && command.text) {
      if (!liveSession) throw new Error("Gemini Live is not running");
      liveSession.sendRealtimeInput({ text: command.text });
    }
    if (command?.type === "submit_claude_task" && command.task) {
      submitClaudeTask({ task: command.task, agent: command.agent }).catch((error) => {
        emitEvent({ type: "claude_task_update", status: "error", task: command.task, error: error.message });
      });
    }
  }

  return {
    handleToolCall,
    handleLiveMessage,
    sendAudioChunk,
    sendCommand,
  };
}
