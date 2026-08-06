## MODIFIED Requirements

### Requirement: Backdrop render loop pauses when inactive

Whenever the backdrop is rendered at all, its render loop SHALL stop consuming GPU (no continuous frame advancement) when Iris is asleep or the deck window is unfocused, and SHALL resume automatically on wake or focus. The quality preference SHALL NOT weaken this: the high-fidelity path pauses on exactly the same conditions, and the light path — which does not create the backdrop — has no loop to pause.

**Pausing SHALL stop frame advancement, never rendering itself.** A paused backdrop
SHALL remain visible, showing its particle network at rest rather than vanishing.
This holds even if it was paused before it had ever drawn a frame, which is reachable
on a fresh start.

While paused the backdrop SHALL redraw when what it depicts changes. Redrawing on
change is not frame advancement and SHALL NOT be read as a violation of the pausing
rules above.

#### Scenario: Pauses on sleep

- **WHEN** the backdrop is rendered and Iris transitions to the asleep state
- **THEN** the backdrop's render loop stops advancing frames

#### Scenario: Pauses on unfocus

- **WHEN** the backdrop is rendered and the deck window loses OS focus
- **THEN** the backdrop's render loop stops advancing frames, and resumes advancing when focus returns

#### Scenario: A paused backdrop is still visible

- **WHEN** the backdrop is mounted and paused for any reason
- **THEN** its particle network is drawn on screen at rest, rather than leaving the
  deck with an empty background
