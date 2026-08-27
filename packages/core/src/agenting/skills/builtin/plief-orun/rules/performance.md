# Performance Policy

Preference order when quality is equivalent:
1. CSS
2. browser APIs
3. already-installed library
4. small new dependency
5. heavy animation engine
6. WebGL/3D

Break the order only when the requirement pays for the complexity.

## Motion
Prefer transform/opacity where possible.
Avoid accidental layout reads/writes in the same frame.
Remove listeners/observers/timers.
Pause invisible work.
Lazy-load expensive effects.

## 3D
Budget:
- asset/network size
- texture memory
- drawing-buffer resolution
- DPR
- draw calls/materials
- render-loop lifetime
- post-processing
- disposal

Use measurement or explicit proxies before claiming improvement.
