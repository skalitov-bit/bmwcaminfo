# Sound balance (SpeedCAM 0.9.84)

Open **Settings → Notifications → Sound mixer**, or **Engineering → Audio channels → Mixer**. The mixer uses the saved audio mode. Voice and beeper each have five attenuation levels plus mute, relative to the existing overall notification volume. Ducking sets the beeper's remaining level during speech: 100%, 75%, 50%, 25%, or 10%. Default balance is voice 100%, beeper 100%, duck 25%, preserving the previous behavior.

Listen auditions the draft while parked; Save persists it atomically in the voice service's `audio-mixer.json`. Reset only resets the form; Save applies that reset. Back discards unsaved changes. Active warnings block saving or auditioning. Diagnostic output blocks normal alerts until cleanup. Settings are included in the audio report.

ALSA/Converter and its three native profiles use independent voice and beeper gains in their existing mixer. Native profiles receive a bounded setup packet before PCM. PulseAudio keeps two concurrent streams and the existing shared headroom. Limiter, buffer sizes, stream routing and audio assets are unchanged. Native helper must be rebuilt along with the JS service; packaging checks its mixer protocol marker.

M4A retains its original player and Overlay path. Voice balance selects the nearest existing 10% audio variant (minimum nonzero 10%). M4A cannot provide a live independent beeper, so Listen is voice-only in that mode. These controls do not change the vehicle's master/music mixer.

The PC emulator auditions production PCM assets through the production JS mixer with draft settings; it does not execute the MGU ALSA/PulseAudio server or prove audible hardware output. Local tests cover gains, persistence, cancellation, route preservation, native mixer/stream via WASM, and built UI navigation. Real MGU validation is still needed. Included in SpeedCAM 0.9.84 / voice service 0.1.46.
