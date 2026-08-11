Put a custom 3D model here to replace the placeholder box on the per-device
pages — no code changes needed.

1. Export or download a model in **.glb** format (a single-file 3D model,
   the most common export option in Blender: File → Export → glTF 2.0 →
   format "glTF Binary (.glb)").
2. Name the file exactly:  head.glb
3. Put it in this folder (static/models/head.glb).
4. Refresh the dashboard in your browser.

That's it — it's auto-centered and auto-scaled to roughly match the old
placeholder's size, so you don't need to worry about matching units exactly.

Orientation convention: the model's local +Z axis is treated as "forward"
(the direction the nose/face points) and +Y as "up", matching how yaw
(rotate around Y), pitch (rotate around X) and roll (rotate around Z) get
applied. If your model looks like it's facing sideways or upside-down when
rotating, it just needs re-orienting in Blender before exporting (rotate it
so it faces +Z with +Y up, then apply the rotation).

If no head.glb is found here (or it fails to load), the dashboard silently
falls back to the placeholder box + cone — nothing breaks either way.
