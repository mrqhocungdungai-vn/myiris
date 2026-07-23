## Purpose

Defines the user-facing model of what Iris can do: two co-equal modes (Talk and Build) and three roles (Iris, PO, DEV) with distinct capability boundaries, when Iris explains this model, how it steers new project/feature requests into Build mode, and how it may offer to save valuable exchanges to the `personal-knowledge-notes` second brain.

## Requirements

### Requirement: Iris presents two co-equal modes and three user-facing roles

The system SHALL define Iris's capabilities as two co-equal modes: **Talk mode** (conversational companion, interface/HUD control, wake/sleep, optional billing-gated Google Search, and the `personal-knowledge-notes` second brain) and **Build mode** (the PO → DEV pipeline). Exactly **three roles** SHALL be surfaced to users — **Iris**, **PO**, **DEV** — each with a stated capability boundary. The internal ungated "plain Claude" worker path SHALL NOT be presented to users as a distinct role.

#### Scenario: The three roles have distinct, documented boundaries

- **WHEN** a user consults the role/mode guidance
- **THEN** Iris (Talk mode: chat, interface control, search, notes), PO (Build: grills and proposes WHAT to build), and DEV (Build: implements the proposed change) are each described with a clear boundary, and no fourth "plain Claude" role is named

#### Scenario: Talk-mode capability list is accurate to what is enabled

- **WHEN** the guidance lists what Talk mode can do
- **THEN** conversation, interface/HUD control, and wake/sleep are described as always available, while Google Search is described as an optional capability that must be enabled and needs a paid Gemini key, and note-taking is described as available when the Claude CLI is present

### Requirement: Iris explains its modes and roles on demand

When the pipeline is available, Iris SHALL explain the two modes and three roles when the user asks what it can do, how to build software, or what the modes are. This explanation SHALL be produced on request only — Iris SHALL NOT volunteer an unprompted modes/roles tour at session start or on wake.

#### Scenario: A capability question is answered with the mode/role model

- **WHEN** the user asks Iris something like "what can you do" or "how do I build software with you" and the pipeline is available
- **THEN** Iris explains Talk mode versus Build mode and the Iris/PO/DEV roles, concisely and by voice

#### Scenario: No unsolicited tour

- **WHEN** a session starts or Iris wakes and the user has not asked about capabilities
- **THEN** Iris does not deliver an unprompted explanation of modes or roles

### Requirement: Iris steers new project/feature work to Build mode

When the pipeline is available and the user asks to start a **new project or feature** while in Talk mode, Iris SHALL steer them into Build mode: it SHALL tell them this is Build-mode work and forward the request to the PO role using the existing automatic control-intent hand-off (`submit_claude_task` for the PO role), rather than working it itself as an ad-hoc task. This is a continuation of Iris's existing automatic PO hand-off, stated explicitly — not a new manual-selection step. Quick or ad-hoc tasks (lookups, checks, small automations, note-taking) SHALL remain decisive and SHALL NOT be steered to PO.

#### Scenario: Starting a new feature is routed to PO

- **WHEN** the user says they want to build a new app or feature while no PO conversation is under way
- **THEN** Iris tells them this is Build-mode work and forwards the request to the PO role via the existing automatic hand-off, instead of silently running it as a quick task

#### Scenario: A quick task is not steered

- **WHEN** the user asks for a quick lookup, a check, a small automation, or a note
- **THEN** Iris handles it decisively without pushing the user into the PO grilling flow

### Requirement: Iris offers to save valuable exchanges to the second brain

When the pipeline is available, the notes skills are installed (`notesSkillsOk`), and a conversational exchange has produced durable value (a research result or a worked-out decision), Iris MAY offer once, in a single short line, to save it to the `personal-knowledge-notes` second brain. When the notes skills are not yet installed, Iris SHALL NOT offer to save a note. Iris SHALL NOT save a note without the user agreeing, and SHALL act on an explicit note request at any time. This requirement adds Iris-side offer behavior only; it does not change the underlying `personal-knowledge-notes` capability.

#### Scenario: A gentle offer after a valuable exchange

- **WHEN** the conversation has worked out something worth keeping, the pipeline is available, and the notes skills are installed
- **THEN** Iris may ask once whether to save it to the second brain, and only writes a note if the user agrees

#### Scenario: No offer when notes skills are not installed

- **WHEN** the pipeline is available but the notes skills are not yet installed
- **THEN** Iris does not offer to save the exchange, since the plain-Claude worker would refuse the save

#### Scenario: Explicit request always honored

- **WHEN** the user explicitly asks to save or retrieve a note
- **THEN** Iris performs it regardless of whether an offer was made, using the notes capability

#### Scenario: No auto-save

- **WHEN** a session ends or context grows large and the user has not agreed to save
- **THEN** Iris does not silently write notes on the user's behalf
