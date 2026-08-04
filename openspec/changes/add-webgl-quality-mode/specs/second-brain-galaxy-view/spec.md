## MODIFIED Requirements

### Requirement: The galaxy renders over an immersive opaque deep-space backdrop

While the galaxy is active, Iris SHALL paint an **opaque** deep-space backdrop (near-black fill, vignette, and a faint drifting starfield) that fully covers the desktop wallpaper, so the view reads as flying through space rather than a graph floating over the transparent desktop. The backdrop SHALL exist only while the galaxy layer is active and SHALL NOT leak into the transparent HUD when the galaxy is off. The rendering SHALL reuse the `three` instance already present in the app rather than introducing a second copy.

Whether the galaxy's nodes carry a glow SHALL follow the WebGL quality preference (see `webgl-quality-mode`). On the high-fidelity path the nodes SHALL be rendered with a bloom pass so they read as stars. On the light path — the default — no bloom pass SHALL be added: the galaxy is the app's most expensive surface, running a full-viewport post-processing pyramid on top of a live force simulation. The opaque backdrop, vignette and starfield SHALL be unconditional and present on both paths, because they are painted inside the scene rather than produced by the post-processing pass; removing the glow SHALL therefore never leave the galaxy on a transparent or bare background.

#### Scenario: The desktop wallpaper does not show through the galaxy

- **WHEN** the galaxy layer is active
- **THEN** the backdrop is opaque and the desktop behind the HUD is not visible through the galaxy

#### Scenario: Nodes glow on the high-fidelity path

- **WHEN** the galaxy is active and the quality preference is on the high-fidelity path
- **THEN** the nodes are rendered with a bloom pass and read as stars, exactly as before the preference existed

#### Scenario: No bloom pass on the light path

- **WHEN** the galaxy is active and the quality preference is on the light path
- **THEN** no bloom pass is added to the galaxy's rendering

#### Scenario: The path is fixed when the galaxy opens

- **WHEN** the quality preference changes while the galaxy is already open
- **THEN** the open galaxy keeps the path it was opened with and its settled node positions are retained, and the new path takes effect the next time the galaxy is opened

#### Scenario: The backdrop survives the light path

- **WHEN** the galaxy is active on the light path
- **THEN** the opaque near-black fill, the vignette and the drifting starfield are all still painted, and the desktop wallpaper is still not visible through the galaxy

#### Scenario: The backdrop is gone when the galaxy is off

- **WHEN** the galaxy layer is disabled
- **THEN** no deep-space backdrop is painted and the HUD is transparent again

#### Scenario: The galaxy stops rendering when the HUD is idle

- **WHEN** the galaxy is active and Iris goes to sleep (the same signal that pauses the reactor orb — sleep only; like the orb, the galaxy keeps rendering while awake even if the OS window is unfocused)
- **THEN** the galaxy's force simulation and render loop pause so it consumes no GPU while idle, and resume without losing node positions when Iris is awake again
