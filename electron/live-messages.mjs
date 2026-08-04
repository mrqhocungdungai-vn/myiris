// Gemini Live server-message and tool-call handling, and the two outbound
// send paths that read the live session directly (audio chunks, ad hoc
// text/command). Split out of electron/main.mjs (split-main-process-modules)
// alongside live-session.mjs, which owns the connection itself — see that
// module's header comment for why this landed as two files instead of one.
// Electron-free — the live session is reached through an injected accessor,
// never imported directly.

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
 *   submitClaudeTask: (params: any) => any,
 *   isListenOnlyEngaged: () => boolean,
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
  isListenOnlyEngaged,
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
      }
    }

    if (message.goAway) {
      // Server warns the connection is about to be dropped (connection
      // lifetime limit). No deliberate rotation to trigger any more (the
      // listening-mode reconnect this once fed was retired by
      // replace-listening-mode-with-listen-only, design.md D10) — onclose
      // fires shortly after and the ordinary reconnect handles it.
      console.log("[IRIS][goAway] timeLeft=", message.goAway.timeLeft || "(unknown)");
    }

    if (message.toolCall) {
      handleToolCall(message.toolCall).catch((error) => {
        emitEvent({ type: "fatal", message: "Tool call failed", error: error.message });
      });
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
    }

    if (content.outputTranscription?.text) appendModelTranscript(content.outputTranscription.text);

    for (const part of content.modelTurn?.parts || []) {
      if (part.text) appendModelTranscript(part.text);
      const inlineData = part.inlineData;
      if (!inlineData?.data) continue;
      const mimeType = inlineData.mimeType || "audio/pcm;rate=24000";
      if (!mimeType.startsWith("audio/")) continue;
      emitToRenderer("live:audio", { data: inlineData.data, mimeType });
      // A silent reply reads as silent, not as speech (design.md D6):
      // main's own listen-only flag decides which state to report — never a
      // value the renderer reported back — so it stays trustworthy even if
      // the renderer is slow or crashed.
      emitEvent({ type: "audio_state", state: isListenOnlyEngaged() ? "replying" : "speaking" });
    }

    if (content.turnComplete) {
      flushTranscripts();
      emitEvent({ type: "audio_state", state: "listening" });
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
    // The developer-facing "just run this string" escape hatch. It routes
    // through the deprecated task tool, which dispatches as `execute` — there is
    // no verb to name here, and no `agent` to pass any more.
    if (command?.type === "submit_claude_task" && command.task) {
      try {
        const result = submitClaudeTask({ task: command.task });
        if (result?.status === "error") {
          emitEvent({ type: "claude_task_update", status: "error", task: command.task, error: result.error });
        }
      } catch (error) {
        emitEvent({ type: "claude_task_update", status: "error", task: command.task, error: error.message });
      }
    }
  }

  return {
    handleToolCall,
    handleLiveMessage,
    sendAudioChunk,
    sendCommand,
  };
}
