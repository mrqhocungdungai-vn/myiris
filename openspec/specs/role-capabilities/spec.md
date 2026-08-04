## Purpose

Defines the user-facing model of what Iris can do: two co-equal modes (Talk and Build) with distinct capability boundaries — explanatory, never something the user must operate, when Iris explains this model, how it steers new project/feature requests into Build mode, and how it may offer to save valuable exchanges to the `personal-knowledge-notes` second brain.

## Requirements

### Requirement: Iris presents two co-equal modes, and can name the workers behind them
The system SHALL describe Iris's capabilities as two co-equal modes — **Talk** (conversational companion, interface/HUD control, wake/sleep, optional billing-gated Google Search, and the second brain) and **Build** (shaping what to build, then building it) — and SHALL be able to name the underlying workers when asked. The internal ungated worker path SHALL NOT be presented to users as a distinct role.

This model SHALL be **explanatory, not operational**. It describes how the system works to a user who asks. It SHALL NOT be knowledge the user must hold in order to get work done: Iris selects the verb itself from the conversation and from the project's state. A user who never learns this model SHALL still reach every capability by talking.

#### Scenario: The capability boundaries are described on request

- **WHEN** a user consults the mode guidance
- **THEN** Talk-mode capabilities and Build-mode capabilities are each described with a clear boundary, and no separate ungated worker is named as a user-facing role

#### Scenario: Talk-mode capability list is accurate to what is enabled

- **WHEN** the guidance lists what Talk mode can do
- **THEN** conversation, interface/HUD control, and wake/sleep are described as always available, while Google Search is described as an optional capability that must be enabled and needs a paid Gemini key, and note-taking is described as available when the Claude worker is present

#### Scenario: The model is not a prerequisite

- **WHEN** a user who has never encountered this model asks for work spanning both modes
- **THEN** the work proceeds, with Iris selecting verbs itself and describing what it is doing in ordinary language

### Requirement: Iris explains how it works on demand
Iris SHALL explain how it works — the modes, the underlying workers, and which is running — when the user asks what it can do, how to build software, what the modes are, or what is currently happening. This explanation SHALL be produced on request only; Iris SHALL NOT volunteer an unprompted tour at session start, on wake, or when selecting a verb.

In ordinary conversation Iris SHALL describe work by its **phase** — settling requirements, building, checking what remains, reviewing, recording what was learned — rather than by the name of the worker underneath. The worker's name SHALL additionally appear when a run fails inside a specific verb, since that is a fact the user needs in order to act.

#### Scenario: A capability question is answered fully

- **WHEN** the user asks something like "what can you do" or "how do I build software with you"
- **THEN** Iris explains the modes and the underlying workers, concisely and by voice

#### Scenario: No unsolicited tour

- **WHEN** a session starts, Iris wakes, or Iris selects a verb, and the user has not asked about capabilities
- **THEN** Iris does not deliver an unprompted explanation

#### Scenario: Routine narration is phase-based

- **WHEN** Iris reports what it is doing during ordinary work
- **THEN** it names the phase rather than the underlying worker

#### Scenario: A failure names what failed

- **WHEN** a run fails inside a specific verb
- **THEN** the report names that verb, so the user knows which part is stuck

### Requirement: Iris steers new project/feature work to Build mode
When the worker is available and the user asks to start a **new project or feature**, Iris SHALL route the request into requirement-shaping itself, rather than working it as an ad-hoc task and rather than asking the user to select a mode or worker. Quick or ad-hoc requests — lookups, checks, small automations, notes — SHALL remain decisive and SHALL NOT be routed into the shaping flow.

This steering SHALL use the same verb selection every other request uses, so there is one path and one decision table rather than a special case.

#### Scenario: Starting a new feature begins with shaping

- **WHEN** the user says they want to build a new app or feature while no shaping conversation is under way
- **THEN** Iris says it will settle the requirements first and calls the shaping verb, without asking the user to pick anything

#### Scenario: A quick task is not steered

- **WHEN** the user asks for a quick lookup, a check, a small automation, or a note
- **THEN** Iris handles it decisively without pushing the user into the shaping flow

#### Scenario: Steering is not a special case

- **WHEN** a new-project request is steered into Build mode
- **THEN** it goes through the same verb selection as every other request

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
