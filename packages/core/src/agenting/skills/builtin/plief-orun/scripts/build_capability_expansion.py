#!/usr/bin/env python3
"""Build Orun's large capability shard from catalog evidence and typed seeds.

The generated JSON is retrieval data. This authoring file keeps the expansion
reviewable and reproducible, while the runtime only loads the selected records.
No package version or API claim is inferred when the official source does not
support it; those records remain explicitly freshness-gated.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TODAY = "2026-09-01"
CAP_OUT = ROOT / "knowledge" / "capabilities-expansion.json"
GRAPH_OUT = ROOT / "knowledge" / "capability-graph-expansion.json"


def source(title: str, url: str, authority: str, claim: str) -> dict:
    return {
        "title": title,
        "url": url,
        "source_type": "OFFICIAL_DOCUMENTATION",
        "authority": authority,
        "checked_at": TODAY,
        "claim": claim,
    }


SOURCES = {
    "ark-ui": source("Ark UI", "https://ark-ui.com/", "PROJECT_OWNER", "Ark UI documents headless, accessible component primitives and state machines."),
    "zag-js": source("Zag.js", "https://zagjs.com/", "PROJECT_OWNER", "Zag.js documents framework-agnostic state machines for interactive UI components."),
    "cmdk": source("cmdk", "https://cmdk.paco.me/", "PROJECT_OWNER", "cmdk documents a command menu primitive with composable React behavior."),
    "vaul": source("Vaul", "https://vaul.emilkowal.ski/", "PROJECT_OWNER", "Vaul documents a drawer interaction for React with mobile-oriented gesture behavior."),
    "sonner": source("Sonner", "https://sonner.emilkowal.ski/", "PROJECT_OWNER", "Sonner documents toast notifications and their host integration surface."),
    "tanstack-form": source("TanStack Form", "https://tanstack.com/form/latest", "PROJECT_OWNER", "TanStack Form documents typed form state, validation and framework adapters."),
    "zod": source("Zod", "https://zod.dev/", "PROJECT_OWNER", "Zod documents TypeScript-first schema declaration and runtime validation."),
    "valibot": source("Valibot", "https://valibot.dev/", "PROJECT_OWNER", "Valibot documents modular schema validation with a small import surface."),
    "downshift": source("Downshift", "https://www.downshift-js.com/", "PROJECT_OWNER", "Downshift documents primitives for accessible autocomplete, combobox and select behavior."),
    "react-select": source("React Select", "https://react-select.com/home", "PROJECT_OWNER", "React Select documents configurable select, async and creatable controls."),
    "day-picker": source("React DayPicker", "https://daypicker.dev/", "PROJECT_OWNER", "React DayPicker documents date selection behavior, modifiers and localization."),
    "tanstack-query": source("TanStack Query", "https://tanstack.com/query/latest", "PROJECT_OWNER", "TanStack Query documents server-state caching, synchronization and request lifecycles."),
    "tanstack-router": source("TanStack Router", "https://tanstack.com/router/latest", "PROJECT_OWNER", "TanStack Router documents typed client routing and route-level data concerns."),
    "react-window": source("react-window", "https://github.com/bvaughn/react-window", "PROJECT_OWNER", "react-window documents windowed rendering for large lists and grids."),
    "react-virtuoso": source("React Virtuoso", "https://virtuoso.dev/", "PROJECT_OWNER", "React Virtuoso documents virtualized lists, tables and grouped content."),
    "ag-grid": source("AG Grid", "https://www.ag-grid.com/javascript-data-grid/", "PRODUCT_OWNER", "AG Grid documents a feature-rich data grid with community and enterprise boundaries."),
    "react-grid-layout": source("React Grid Layout", "https://github.com/react-grid-layout/react-grid-layout", "PROJECT_OWNER", "React Grid Layout documents draggable and resizable responsive layouts."),
    "resizable-panels": source("react-resizable-panels", "https://github.com/bvaughn/react-resizable-panels", "PROJECT_OWNER", "react-resizable-panels documents accessible resizable panel groups for React."),
    "monaco": source("Monaco Editor", "https://microsoft.github.io/monaco-editor/", "PROJECT_OWNER", "Monaco Editor documents the browser code editor used by VS Code-derived experiences."),
    "codemirror": source("CodeMirror", "https://codemirror.net/", "PROJECT_OWNER", "CodeMirror documents a modular browser code editor and extension model."),
    "react-mentions": source("react-mentions", "https://github.com/signavio/react-mentions", "PROJECT_OWNER", "react-mentions documents mention-aware text inputs with overlay suggestion behavior."),
    "gsap": source("GSAP", "https://gsap.com/docs/v3/", "PROJECT_OWNER", "GSAP documents timeline, tween and plugin-based animation control."),
    "motion": source("Motion for React", "https://motion.dev/docs/react", "PROJECT_OWNER", "Motion documents React animation, layout, gesture and presence features."),
    "auto-animate": source("AutoAnimate", "https://auto-animate.formkit.com/", "PROJECT_OWNER", "AutoAnimate documents a focused layout-transition helper for adding motion to DOM changes."),
    "lottie": source("Lottie", "https://airbnb.io/lottie/", "PROJECT_OWNER", "Lottie documents playback of authored animation assets in supported runtimes."),
    "anime": source("Anime.js", "https://animejs.com/documentation/", "PROJECT_OWNER", "Anime.js documents a JavaScript animation engine for DOM, SVG and object values."),
    "react-spring": source("React Spring", "https://react-spring.dev/", "PROJECT_OWNER", "React Spring documents physics-based animation primitives for React and related targets."),
    "web-animations": source("Web Animations API", "https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API", "MDN", "MDN documents the browser Web Animations API and its playback model."),
    "scroll-driven": source("CSS scroll-driven animations", "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll-driven_animations", "MDN", "MDN documents CSS timelines driven by scroll or view progress."),
    "view-transitions": source("View Transition API", "https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API", "MDN", "MDN documents browser-managed transitions between DOM view states."),
    "gltf-transform": source("glTF Transform", "https://gltf-transform.dev/", "PROJECT_OWNER", "glTF Transform documents inspection and optimization workflows for glTF assets."),
    "draco": source("Draco", "https://google.github.io/draco/", "GOOGLE", "Draco documents mesh and point-cloud compression and decoding."),
    "meshopt": source("meshoptimizer", "https://meshoptimizer.org/", "PROJECT_OWNER", "meshoptimizer documents geometry, index and compression optimizations for real-time assets."),
    "react-rapier": source("React Three Rapier", "https://github.com/pmndrs/react-three-rapier", "PROJECT_OWNER", "React Three Rapier documents React bindings for Rapier physics in Three.js scenes."),
    "react-postprocessing": source("React Postprocessing", "https://github.com/pmndrs/react-postprocessing", "PROJECT_OWNER", "React Postprocessing documents React bindings for postprocessing effects in Three.js."),
    "babylon": source("Babylon.js", "https://doc.babylonjs.com/", "PROJECT_OWNER", "Babylon.js documents a browser 3D engine with rendering, scene and tooling APIs."),
    "playcanvas": source("PlayCanvas", "https://developer.playcanvas.com/", "PROJECT_OWNER", "PlayCanvas documents a browser engine and editor-oriented workflow for interactive 3D."),
    "model-viewer": source("<model-viewer>", "https://modelviewer.dev/", "GOOGLE", "Model Viewer documents a web component for displaying interactive 3D and AR-ready models."),
    "ogl": source("OGL", "https://github.com/oframe/ogl", "PROJECT_OWNER", "OGL documents a small WebGL library with explicit low-level scene and render control."),
    "regl": source("regl", "https://regl.party/", "PROJECT_OWNER", "regl documents functional WebGL command construction and resource management patterns."),
    "pixi": source("PixiJS", "https://pixijs.com/", "PROJECT_OWNER", "PixiJS documents a 2D rendering engine for high-performance interactive graphics."),
    "p5": source("p5.js", "https://p5js.org/reference/", "PROJECT_OWNER", "p5.js documents an approachable creative-coding API for canvas and related media."),
    "webgl": source("WebGL API", "https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API", "MDN", "MDN documents the browser WebGL API and its graphics context boundary."),
    "three-webgpu": source("Three.js WebGPU renderer", "https://threejs.org/manual/en/webgpurenderer", "THREEJS", "Three.js documents WebGPU rendering, asynchronous initialization and WebGL2 fallback considerations."),
    "webgpu": source("WebGPU API", "https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API", "MDN", "MDN documents WebGPU feature detection, adapter/device setup and browser boundary."),
    "webxr": source("WebXR Device API", "https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API", "MDN", "MDN documents browser access to immersive XR sessions and their capability boundary."),
    "offscreen-canvas": source("OffscreenCanvas", "https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas", "MDN", "MDN documents rendering canvas work away from the main window context."),
    "echarts": source("Apache ECharts", "https://echarts.apache.org/en/", "APACHE", "Apache ECharts documents a configurable visualization library and its charting model."),
    "vega": source("Vega", "https://vega.github.io/vega/", "PROJECT_OWNER", "Vega documents a declarative visualization grammar and runtime."),
    "vega-lite": source("Vega-Lite", "https://vega.github.io/vega-lite/", "PROJECT_OWNER", "Vega-Lite documents a concise declarative grammar compiled to Vega."),
    "nivo": source("Nivo", "https://nivo.rocks/", "PROJECT_OWNER", "Nivo documents React data-visualization components built around established rendering backends."),
    "recharts": source("Recharts", "https://recharts.org/en-US/", "PROJECT_OWNER", "Recharts documents composable React chart components."),
    "plotly": source("Plotly JavaScript", "https://plotly.com/javascript/", "PRODUCT_OWNER", "Plotly documents interactive scientific and business chart types for the browser."),
    "deck": source("deck.gl", "https://deck.gl/", "VISGL", "deck.gl documents GPU-accelerated geospatial visualization layers."),
    "cytoscape": source("Cytoscape.js", "https://js.cytoscape.org/", "PROJECT_OWNER", "Cytoscape.js documents graph/network visualization and interaction."),
    "leaflet": source("Leaflet", "https://leafletjs.com/reference.html", "PROJECT_OWNER", "Leaflet documents a mobile-friendly interactive map library with layer and control APIs."),
    "openlayers": source("OpenLayers", "https://openlayers.org/", "PROJECT_OWNER", "OpenLayers documents browser mapping with multiple source and projection models."),
    "cesium": source("CesiumJS", "https://cesium.com/platform/cesiumjs/", "PRODUCT_OWNER", "CesiumJS documents a 3D geospatial globe and visualization engine."),
    "turf": source("Turf.js", "https://turfjs.org/", "PROJECT_OWNER", "Turf.js documents modular geospatial analysis functions for JavaScript."),
    "mse": source("Media Source Extensions", "https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API", "MDN", "MDN documents appending segmented media data to an HTML media element."),
    "dash": source("dash.js", "https://github.com/Dash-Industry-Forum/dash.js", "DASH-IF", "dash.js documents a reference MPEG-DASH client for browser media playback."),
    "videojs": source("Video.js", "https://videojs.com/", "PROJECT_OWNER", "Video.js documents a customizable HTML5 video player and plugin ecosystem."),
    "mux": source("Mux Player", "https://www.mux.com/docs/guides/player", "MUX", "Mux documents a web player route and media delivery integration points."),
    "webcodecs": source("WebCodecs API", "https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API", "MDN", "MDN documents low-level browser access to audio and video codec frames."),
    "media-recorder": source("MediaRecorder API", "https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder", "MDN", "MDN documents recording media streams into browser-supported chunks."),
    "web-audio": source("Web Audio API", "https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API", "MDN", "MDN documents graph-based audio processing and synthesis in the browser."),
    "webrtc": source("WebRTC API", "https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API", "MDN", "MDN documents real-time peer media and data communication primitives."),
    "media-session": source("Media Session API", "https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API", "MDN", "MDN documents integration of media playback with platform controls."),
    "webvtt": source("WebVTT", "https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API", "MDN", "MDN documents timed text tracks for media accessibility and synchronization."),
    "image-bitmap": source("ImageBitmap", "https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmap", "MDN", "MDN documents decoded bitmap objects suitable for efficient image and canvas workflows."),
    "vitest": source("Vitest", "https://vitest.dev/guide/", "PROJECT_OWNER", "Vitest documents a Vite-aware unit and component test runner."),
    "testing-library": source("Testing Library", "https://testing-library.com/docs/", "PROJECT_OWNER", "Testing Library documents user-centered DOM queries and interaction testing."),
    "axe": source("axe-core", "https://github.com/dequelabs/axe-core", "DEQUE", "axe-core documents automated accessibility rules for browser DOM content."),
    "storybook": source("Storybook", "https://storybook.js.org/docs", "PROJECT_OWNER", "Storybook documents isolated component development, testing and documentation."),
    "lighthouse": source("Lighthouse", "https://developer.chrome.com/docs/lighthouse/overview", "GOOGLE", "Lighthouse documents audits for performance, accessibility, best practices and SEO."),
    "web-vitals": source("web-vitals", "https://github.com/GoogleChrome/web-vitals", "GOOGLE", "web-vitals documents measurement of browser user-centric performance metrics."),
    "bundle-analyzer": source("webpack-bundle-analyzer", "https://github.com/webpack-contrib/webpack-bundle-analyzer", "PROJECT_OWNER", "webpack-bundle-analyzer documents visual inspection of webpack bundle composition."),
    "rollup-visualizer": source("rollup-plugin-visualizer", "https://github.com/btd/rollup-plugin-visualizer", "PROJECT_OWNER", "rollup-plugin-visualizer documents visual reports for bundler output composition."),
    "cypress": source("Cypress", "https://docs.cypress.io/", "PROJECT_OWNER", "Cypress documents browser end-to-end and component testing workflows."),
    "web-test-runner": source("Web Test Runner", "https://modern-web.dev/docs/test-runner/overview/", "OPEN-WC", "Web Test Runner documents running browser tests against real browser environments."),
    "otel-browser": source("OpenTelemetry JavaScript", "https://opentelemetry.io/docs/languages/js/", "CNCF", "OpenTelemetry documents browser instrumentation and telemetry export concepts."),
    "shadcn": source("shadcn/ui", "https://ui.shadcn.com/docs", "PROJECT_OWNER", "shadcn/ui documents source-owned component acquisition and composition patterns."),
    "magic-ui": source("Magic UI", "https://magicui.design/docs", "PROJECT_OWNER", "Magic UI documents animated source components intended for adaptation into a host codebase."),
    "aceternity": source("Aceternity UI", "https://ui.aceternity.com/", "PROJECT_OWNER", "Aceternity UI documents source examples for visually expressive React interfaces."),
    "twentyfirst": source("21st.dev", "https://21st.dev/", "PRODUCT_OWNER", "21st.dev documents a community component discovery and adaptation workflow."),
    "tailwind-ui": source("Tailwind UI", "https://tailwindui.com/", "TAILWIND_LABS", "Tailwind UI documents a paid component and template library with license terms."),
    "daisyui": source("daisyUI", "https://daisyui.com/docs/", "PROJECT_OWNER", "daisyUI documents Tailwind CSS components and theme tokens."),
    "mantine": source("Mantine", "https://mantine.dev/", "PROJECT_OWNER", "Mantine documents a React component and hooks library with its own styling contracts."),
    "primereact": source("PrimeReact", "https://primereact.org/", "PRODUCT_OWNER", "PrimeReact documents a broad React component suite and theme configuration."),
}


def seed(id_: str, name: str, source_key: str, category: str, focus: str, when: str, avoid: str, alternatives: list[str], package: str | None, repo: str | None, framework: list[str], volatility: str = "MEDIUM") -> dict:
    return {
        "id": id_, "name": name, "source": source_key, "category": category,
        "focus": focus, "when": when, "avoid": avoid, "alternatives": alternatives,
        "package": package, "repository": repo, "framework": framework,
        "volatility": volatility,
    }


SEEDS = [
    seed("ark-ui", "Ark UI", "ark-ui", "accessible-primitives", "headless React components backed by reusable state-machine behavior", "the host needs accessible behavior with a different visual system", "the project cannot absorb a second state or styling contract", ["radix-primitives", "zag-js", "react-aria-components"], "@ark-ui/react", "https://github.com/chakra-ui/ark", ["React", "Vue", "Solid"]),
    seed("zag-js", "Zag.js State Machines", "zag-js", "accessible-primitives", "framework-agnostic state machines for comboboxes, dialogs, menus and other interaction patterns", "behavior should be shared across frameworks or rendered by a custom host", "the team needs a turnkey visual component library", ["ark-ui", "radix-primitives", "react-aria-components"], "@zag-js/*", "https://github.com/chakra-ui/zag", ["React", "Vue", "Solid", "Svelte"]),
    seed("cmdk-command-menu", "cmdk Command Menu", "cmdk", "accessible-primitives", "keyboard-first command menu filtering and composition", "a product has a discoverable command surface with a modest result set", "commands are the only navigation route or results need server-scale indexing", ["radix-primitives", "downshift", "headless-ui"], "cmdk", "https://github.com/pacocoursey/cmdk", ["React"]),
    seed("vaul-drawer", "Vaul Drawer", "vaul", "accessible-primitives", "mobile drawer behavior with gesture-aware open, close and snap interaction", "a drawer is a deliberate mobile surface with a clear focus boundary", "the content needs desktop resizable panes or a non-modal side rail", ["radix-primitives", "react-aria-components"], "vaul", "https://github.com/emilkowalski/vaul", ["React"]),
    seed("sonner-toasts", "Sonner Toasts", "sonner", "accessible-primitives", "transient status notifications with a small host API", "feedback is short-lived and does not need a full dialog or inbox", "the message is critical, long, or must be reliably revisited", ["radix-primitives", "aria-live"], "sonner", "https://github.com/emilkowalski/sonner", ["React"]),
    seed("tanstack-form", "TanStack Form", "tanstack-form", "forms-state", "typed form state, validation lifecycle and field-array composition", "form state must remain explicit and portable across a complex flow", "a single trivial form would gain more machinery than value", ["react-hook-form", "formik", "native-forms"], "@tanstack/react-form", "https://github.com/TanStack/form", ["React", "Vue", "Solid", "Angular"]),
    seed("zod-schemas", "Zod Runtime Schemas", "zod", "forms-state", "runtime validation that shares typed schemas between input, API boundaries and parsing", "untrusted data must be validated at a clear boundary", "the schema is only being used to decorate an already typed local constant", ["valibot", "arktype", "io-ts"], "zod", "https://github.com/colinhacks/zod", ["TypeScript", "JavaScript"]),
    seed("valibot-schemas", "Valibot Runtime Schemas", "valibot", "forms-state", "modular runtime schemas with a deliberately small import surface", "bundle-sensitive applications need validation without a broad helper runtime", "the team depends on an ecosystem integration not covered by the current adapters", ["zod-schemas", "arktype", "io-ts"], "valibot", "https://github.com/fabian-hiller/valibot", ["TypeScript", "JavaScript"]),
    seed("downshift-combobox", "Downshift Combobox", "downshift", "forms-state", "accessible autocomplete and combobox state with host-controlled rendering", "the product needs custom markup but must keep keyboard and ARIA behavior coherent", "a simple native select is sufficient or the dataset cannot support filtering", ["react-select", "react-aria-components", "zag-js"], "downshift", "https://github.com/downshift-js/downshift", ["React"]),
    seed("react-select-controls", "React Select Controls", "react-select", "forms-state", "single, multi, async and creatable select controls", "select behavior is richer than native controls and a mature control contract is useful", "the host requires fully source-owned behavior or minimal bundle cost", ["downshift-combobox", "react-aria-components", "native-select"], "react-select", "https://github.com/JedWatson/react-select", ["React"]),
    seed("react-day-picker", "React DayPicker", "day-picker", "forms-state", "calendar navigation, date selection, modifiers and localized date presentation", "date choice is a primary task and calendar behavior deserves a tested primitive", "a date input can remain native or the task needs time-zone scheduling semantics outside the picker", ["react-aria-components", "native-date-input"], "react-day-picker", "https://github.com/gpbl/react-day-picker", ["React"]),
    seed("tanstack-query", "TanStack Query Server State", "tanstack-query", "data-state", "cache, stale state, retries and mutation lifecycles for server data", "remote data has independent freshness and loading/error states", "the state is purely local or a server cache would hide a required domain event", ["swr", "rtk-query", "native-fetch"], "@tanstack/react-query", "https://github.com/TanStack/query", ["React", "Vue", "Solid", "Svelte"]),
    seed("tanstack-router", "TanStack Router", "tanstack-router", "data-state", "typed routes, search params and route-level data loading", "URL state and navigation need compile-time contracts", "the host already has a stable router and migration would create duplicate ownership", ["react-router", "next-router", "native-history"], "@tanstack/react-router", "https://github.com/TanStack/router", ["React"]),
    seed("react-window-virtualization", "react-window Virtualization", "react-window", "virtualization", "windowed list and grid rendering for bounded row/cell DOM cost", "large repeated collections need a small, explicit virtualization layer", "content must be browser-findable, server-rendered, or measured in a way the primitive cannot represent", ["react-virtuoso", "tanstack-virtual"], "react-window", "https://github.com/bvaughn/react-window", ["React"]),
    seed("react-virtuoso-virtualization", "React Virtuoso Virtualization", "react-virtuoso", "virtualization", "virtualized lists, grouped lists and tables with less measurement plumbing", "variable-height content needs a higher-level virtualizer", "the project needs the smallest possible primitive or custom scroll ownership", ["react-window-virtualization", "tanstack-virtual"], "react-virtuoso", "https://github.com/petyosi/react-virtuoso", ["React"]),
    seed("ag-grid", "AG Grid", "ag-grid", "data-tables", "feature-rich data grids with sorting, filtering, editing and column behavior", "the grid itself is a product surface with many established behaviors", "the table is simple or the project cannot accept enterprise/community licensing review", ["tanstack-table", "react-aria-components", "react-data-grid"], "ag-grid-community", "https://github.com/ag-grid/ag-grid", ["React", "Angular", "Vue", "JavaScript"], "HIGH"),
    seed("react-grid-layout", "React Grid Layout", "react-grid-layout", "productivity-layout", "draggable, resizable and responsive dashboard layouts", "users arrange panels and layout is persistent state", "a fixed editorial composition is the goal or drag is not central to the task", ["react-resizable-panels", "css-grid"], "react-grid-layout", "https://github.com/react-grid-layout/react-grid-layout", ["React"]),
    seed("react-resizable-panels", "Resizable Panels", "resizable-panels", "productivity-layout", "accessible resizable panel groups and persistence of panel proportions", "the interface has a stable multi-pane workflow", "panes are merely decorative columns or the mobile route cannot be designed", ["react-grid-layout", "css-grid"], "react-resizable-panels", "https://github.com/bvaughn/react-resizable-panels", ["React"]),
    seed("monaco-editor", "Monaco Editor", "monaco", "rich-editors", "browser code editing with language services and VS Code-derived interaction patterns", "the product is a code editor or needs rich developer-tool editing", "the content is ordinary rich text or bundle/startup cost is not justified", ["codemirror", "tiptap", "textarea"], "monaco-editor", "https://github.com/microsoft/monaco-editor", ["JavaScript", "TypeScript"]),
    seed("codemirror-editor", "CodeMirror Editor", "codemirror", "rich-editors", "modular code editing with extensions and controlled document state", "the host needs a customizable editor with a smaller, modular core", "the product needs Monaco's language-service surface without building it", ["monaco-editor", "tiptap", "textarea"], "@codemirror/view", "https://github.com/codemirror/dev", ["JavaScript", "TypeScript"]),
    seed("react-mentions", "Mention-aware Text Input", "react-mentions", "rich-editors", "text input with mention triggers and positioned suggestions", "mentions are a real domain entity and the text surface remains mostly plain text", "the product needs collaborative rich documents or arbitrary editor plugins", ["downshift-combobox", "tiptap", "textarea"], "react-mentions", "https://github.com/signavio/react-mentions", ["React"]),
    seed("gsap-timelines", "GSAP Timelines", "gsap", "motion-interaction", "sequenced timelines, precise tween control and plugin-oriented animation", "art-directed sequences need explicit timing and independent control", "simple state feedback is enough or motion must stay entirely CSS-owned", ["motion-react", "web-animations", "scroll-driven-css"], "gsap", "https://github.com/greensock/GSAP", ["JavaScript", "React", "Vue", "Web Components"]),
    seed("motion-react-layout", "Motion React Layout", "motion", "motion-interaction", "React presence, layout and gesture transitions tied to component state", "motion is part of UI state and should remain close to the component tree", "the project needs a long art-directed master timeline or only trivial CSS transitions", ["gsap-timelines", "react-spring", "web-animations"], "motion", "https://github.com/motiondivision/motion", ["React"]),
    seed("auto-animate-layout", "AutoAnimate Layout Transitions", "auto-animate", "motion-interaction", "automatic transitions when DOM layout changes", "small local layout changes need a low-ceremony transition", "motion needs authored choreography, semantic state or a reduced-motion design beyond the helper", ["motion-react-layout", "web-animations", "css-transitions"], "@formkit/auto-animate", "https://github.com/formkit/auto-animate", ["JavaScript", "React", "Vue"]),
    seed("lottie-authored-motion", "Lottie Authored Motion", "lottie", "motion-interaction", "playback of authored vector animation assets with timeline control", "an animation asset already exists and the asset is the product content", "motion is generated from UI state or the asset is too large/opaque for the task", ["rive-runtime", "css-animation", "video-playback"], "lottie-web", "https://github.com/airbnb/lottie-web", ["JavaScript", "React"]),
    seed("animejs-tweens", "Anime.js Tweens", "anime", "motion-interaction", "scriptable DOM, SVG and object animation with a compact mental model", "a small set of scripted visual transitions needs direct control", "the app already owns a different timeline engine or physics is the core requirement", ["gsap-timelines", "motion-react-layout", "web-animations"], "animejs", "https://github.com/juliangarnier/anime", ["JavaScript"]),
    seed("react-spring-physics", "React Spring Physics", "react-spring", "motion-interaction", "spring-based transitions for values tied to React state", "physical response helps communicate dragging, panels or direct manipulation", "timing must be deterministic and art-directed rather than physics-like", ["motion-react-layout", "gsap-timelines", "css-transitions"], "@react-spring/web", "https://github.com/pmndrs/react-spring", ["React"]),
    seed("web-animations-api", "Web Animations API", "web-animations", "motion-interaction", "browser-native playback and keyframe animation without a third-party engine", "the interaction can be expressed with platform primitives and controlled playback", "the design needs a broad plugin ecosystem or complex React presence semantics", ["css-transitions", "motion-react-layout", "gsap-timelines"], None, None, ["Modern browsers", "Web Components"], "HIGH"),
    seed("scroll-driven-css", "CSS Scroll-driven Animations", "scroll-driven", "motion-interaction", "scroll and view progress as native animation timelines", "a scroll-linked effect can remain declarative and non-critical", "the effect must work across unsupported browsers without a meaningful fallback", ["gsap-timelines", "web-animations", "motion-react-layout"], None, None, ["Modern browsers"], "HIGH"),
    seed("view-transition-api", "View Transition API", "view-transitions", "motion-interaction", "browser-managed transitions between DOM view states", "route or state changes benefit from continuity and feature detection is acceptable", "the product needs one visual result across browsers with no fallback budget", ["motion-react-layout", "css-transitions", "react-router"], None, None, ["Modern browsers"], "HIGH"),
    seed("gltf-transform-pipeline", "glTF Transform Pipeline", "gltf-transform", "3d-assets", "inspect, transform and optimize glTF assets before runtime delivery", "a 3D pipeline needs asset-level control over size, geometry and textures", "the project does not own the asset pipeline or only needs a static image", ["draco-compression", "meshopt-compression", "three-js"], "@gltf-transform/core", "https://github.com/donmccurdy/glTF-Transform", ["Node.js", "Three.js", "Babylon.js"]),
    seed("draco-compression", "Draco Mesh Compression", "draco", "3d-assets", "compressed mesh delivery with a decoder cost at runtime", "bandwidth is a material constraint and the asset pipeline supports decoder loading", "the asset is tiny, decoder boot cost dominates, or a simpler compression path is enough", ["meshopt-compression", "gltf-transform-pipeline"], "draco3d", "https://github.com/google/draco", ["WebGL", "WebGPU", "Three.js"], "HIGH"),
    seed("meshopt-compression", "meshoptimizer Compression", "meshopt", "3d-assets", "geometry, index and glTF compression/optimization for real-time scenes", "asset throughput and GPU vertex/index work are measurable bottlenecks", "the team cannot validate decoder compatibility or does not control assets", ["draco-compression", "gltf-transform-pipeline"], "meshoptimizer", "https://github.com/zeux/meshoptimizer", ["WebGL", "WebGPU", "Three.js"], "HIGH"),
    seed("react-three-rapier", "React Three Rapier Physics", "react-rapier", "3d-rendering", "rigid-body and collider physics in a React Three Fiber scene", "physics is part of the product interaction rather than a decorative wobble", "the scene only needs a deterministic scripted transform or a 2D interaction is clearer", ["three-js", "babylon-js", "playcanvas-engine"], "@react-three/rapier", "https://github.com/pmndrs/react-three-rapier", ["React", "Three.js"]),
    seed("react-postprocessing", "React Postprocessing", "react-postprocessing", "gpu-shaders", "composable postprocessing effects in a Three.js render pipeline", "an effect materially supports spatial evidence and has a flat/disabled fallback", "postprocessing only adds spectacle or the GPU budget is unknown", ["three-js", "custom-webgl-shader", "css-filters"], "@react-three/postprocessing", "https://github.com/pmndrs/react-postprocessing", ["React", "Three.js"]),
    seed("babylonjs-engine", "Babylon.js Engine", "babylon", "3d-rendering", "full browser 3D engine with scene, asset, interaction and tooling primitives", "the product needs an engine-centered 3D application rather than a small embedded scene", "a DOM-first product only needs a single model or simple motion", ["three-js", "playcanvas-engine", "model-viewer"], "@babylonjs/core", "https://github.com/BabylonJS/Babylon.js", ["JavaScript", "TypeScript"]),
    seed("playcanvas-engine", "PlayCanvas Engine", "playcanvas", "3d-rendering", "browser 3D engine and editor-oriented production workflow", "a team values an engine/editor workflow for an interactive 3D product", "the project needs a tiny React-owned scene or no one owns engine-specific production", ["babylonjs-engine", "three-js", "model-viewer"], "playcanvas", "https://github.com/playcanvas/engine", ["JavaScript", "TypeScript"]),
    seed("model-viewer-component", "Model Viewer Web Component", "model-viewer", "3d-rendering", "interactive display of a provided 3D model with a higher-level web component", "the product needs inspectable model viewing, not an authored 3D application", "the interface requires custom scene graph logic, physics or multi-object choreography", ["three-js", "babylonjs-engine", "playcanvas-engine"], "@google/model-viewer", "https://github.com/google/model-viewer", ["Web Components", "React", "Vue"]),
    seed("ogl-low-level-webgl", "OGL Low-level WebGL", "ogl", "gpu-shaders", "small explicit WebGL rendering primitives with minimal abstraction", "the experience is a custom shader surface and the team owns render lifecycle details", "the scene needs a mature asset ecosystem or accessible product UI in the canvas", ["regl-command-webgl", "three-js", "webgl-native"], "ogl", "https://github.com/oframe/ogl", ["JavaScript", "WebGL"]),
    seed("regl-command-webgl", "regl Command WebGL", "regl", "gpu-shaders", "functional WebGL command construction and explicit resource lifecycle", "rendering can be expressed as repeatable commands with a controlled data flow", "the project needs a full scene graph, loaders or broad beginner-friendly tooling", ["ogl-low-level-webgl", "pixijs-renderer", "three-js"], "regl", "https://github.com/regl-project/regl", ["JavaScript", "WebGL"]),
    seed("pixijs-renderer", "PixiJS 2D Renderer", "pixi", "2d-rendering", "GPU-accelerated 2D sprites, text and scene interaction", "the product is a 2D canvas application or game-like surface", "HTML semantics, text selection or document accessibility are primary", ["canvas-2d", "svg-native", "p5-creative-coding"], "pixi.js", "https://github.com/pixijs/pixijs", ["JavaScript", "TypeScript"]),
    seed("p5-creative-coding", "p5.js Creative Coding", "p5", "2d-rendering", "approachable generative drawing, interaction and media sketches", "creative coding is the content and a canvas surface is an honest boundary", "the task needs a product UI, exact semantic labels or a very small runtime", ["canvas-2d", "svg-native", "pixijs-renderer"], "p5", "https://github.com/processing/p5.js", ["JavaScript"]),
    seed("webgl-native", "WebGL Native Context", "webgl", "gpu-shaders", "direct browser WebGL context, buffers, shaders and draw calls", "a specialized renderer cannot justify an engine abstraction", "the project needs loaders, scene management or accessible DOM behavior", ["ogl-low-level-webgl", "regl-command-webgl", "canvas-2d"], None, None, ["WebGL", "JavaScript"], "HIGH"),
    seed("three-webgpu-renderer", "Three.js WebGPURenderer", "three-webgpu", "webgpu", "Three.js rendering through WebGPU with an explicit fallback decision", "GPU features or rendering scale justify the emerging API and the fallback is engineered", "a marketing background can use CSS/canvas or browser coverage is a hard requirement", ["three-js", "webgpu-native", "webgl-native"], "three", "https://github.com/mrdoob/three.js", ["JavaScript", "TypeScript"], "HIGH"),
    seed("webgpu-native-runtime", "WebGPU Native API", "webgpu", "webgpu", "modern browser GPU device, render and compute pipeline access", "measured GPU work needs WebGPU and feature detection/fallback are first-class", "the task is simple UI, browser coverage is unknown, or no fallback can be maintained", ["three-webgpu-renderer", "webgpu-native", "webgl-native", "canvas-2d"], None, None, ["WebGPU", "JavaScript"], "HIGH"),
    seed("webxr-spatial-session", "WebXR Spatial Session", "webxr", "spatial-runtime", "immersive and inline XR session lifecycle with browser feature detection", "the product question explicitly requires headset or spatial input", "a desktop 3D scene or a marketing animation is enough", ["three-js", "model-viewer-component", "webgpu-native"], None, None, ["WebXR", "JavaScript"], "HIGH"),
    seed("offscreen-canvas-worker", "OffscreenCanvas Worker Rendering", "offscreen-canvas", "performance-runtime", "moving canvas rendering work into a worker when the browser supports it", "main-thread contention is measured and the rendering boundary can be isolated", "there is no reproducible main-thread problem or worker fallback doubles complexity", ["webgl-native", "webgpu-native", "canvas-2d"], None, None, ["Modern browsers", "Web Workers"], "HIGH"),
    seed("echarts-configurable-viz", "Apache ECharts Visualization", "echarts", "charts-and-data", "configurable interactive charts with multiple rendering and interaction options", "the chart vocabulary and interaction model match the question being answered", "the product needs minimal custom SVG or a specialized graph/network renderer", ["d3", "vega", "recharts"], "echarts", "https://github.com/apache/echarts", ["JavaScript", "React", "Vue"]),
    seed("vega-declarative-viz", "Vega Declarative Visualization", "vega", "charts-and-data", "declarative visualization specifications with runtime interaction", "a visualization spec should be inspectable, data-driven and separated from UI layout", "a tiny one-off chart needs more implementation than specification", ["vega-lite-declarative-viz", "d3", "echarts-configurable-viz"], "vega", "https://github.com/vega/vega", ["JavaScript"]),
    seed("vega-lite-declarative-viz", "Vega-Lite Grammar", "vega-lite", "charts-and-data", "concise declarative chart specifications compiled to Vega", "the team needs consistent chart composition with a smaller grammar", "the chart requires unusual custom rendering or a full graph editor", ["vega-declarative-viz", "d3", "recharts"], "vega-lite", "https://github.com/vega/vega-lite", ["JavaScript"]),
    seed("nivo-react-viz", "Nivo React Visualization", "nivo", "charts-and-data", "React chart components with established chart families and theming", "a product needs common charts quickly while keeping visual tokens configurable", "the visualization requires an unusual mark or very tight bundle control", ["recharts", "visx", "echarts-configurable-viz"], "@nivo/core", "https://github.com/plouc/nivo", ["React"]),
    seed("recharts-react-charts", "Recharts React Charts", "recharts", "charts-and-data", "composable React chart primitives for common analytical views", "the chart is part of a React surface and custom composition matters", "canvas-scale rendering or dense scientific interaction is the dominant need", ["nivo-react-viz", "visx", "echarts-configurable-viz"], "recharts", "https://github.com/recharts/recharts", ["React"]),
    seed("plotly-scientific-charts", "Plotly Scientific Charts", "plotly", "charts-and-data", "interactive scientific and business charts with broad chart-type coverage", "the data question benefits from rich built-in analytical interactions", "the product needs a very small, brand-specific chart language", ["vega-declarative-viz", "echarts-configurable-viz", "d3"], "plotly.js", "https://github.com/plotly/plotly.js", ["JavaScript", "React"]),
    seed("deckgl-geospatial-layers", "deck.gl Geospatial Layers", "deck", "maps", "GPU-backed geospatial layers over a map or globe", "large geospatial datasets justify layer-based GPU rendering", "the task is a small marker map or lacks a tile/source licensing plan", ["maplibre-gl-js", "leaflet-maps", "cesium-globe"], "@deck.gl/core", "https://github.com/visgl/deck.gl", ["JavaScript", "React"]),
    seed("cytoscape-network-viz", "Cytoscape.js Network Visualization", "cytoscape", "charts-and-data", "interactive graph/network rendering and layout", "nodes and edges are the user-facing data model", "a tree/list or ordinary flowchart is clearer than a force graph", ["react-flow-diagrams", "d3", "svg-native"], "cytoscape", "https://github.com/cytoscape/cytoscape.js", ["JavaScript", "React"]),
    seed("leaflet-maps", "Leaflet Maps", "leaflet", "maps", "lightweight interactive maps with tile, layer and control composition", "the map is a 2D geographic surface with modest layer complexity", "the product needs globe-scale 3D, dense GPU layers or a custom renderer", ["maplibre-gl-js", "openlayers-maps", "cesium-globe"], "leaflet", "https://github.com/Leaflet/Leaflet", ["JavaScript", "React"]),
    seed("openlayers-maps", "OpenLayers Maps", "openlayers", "maps", "2D maps with varied sources, projections and vector layers", "projection/source flexibility matters more than a small API", "a simple slippy map is enough or the product needs a globe", ["leaflet-maps", "maplibre-gl-js", "cesium-globe"], "ol", "https://github.com/openlayers/openlayers", ["JavaScript", "TypeScript"]),
    seed("cesium-globe", "CesiumJS Globe", "cesium", "maps", "3D globe, terrain and geospatial visualization", "the user needs global spatial context, terrain or time-aware geospatial views", "the route is a local map or 3D is only decorative", ["deckgl-geospatial-layers", "maplibre-gl-js", "openlayers-maps"], "cesium", "https://github.com/CesiumGS/cesium", ["JavaScript", "TypeScript"], "HIGH"),
    seed("turf-geospatial-analysis", "Turf.js Geospatial Analysis", "turf", "maps", "modular client-side geospatial calculations and transformations", "the calculation belongs near the map interaction and input sizes are bounded", "authoritative geodata processing or large analysis belongs server-side", ["openlayers-maps", "deckgl-geospatial-layers", "native-geometry"], "@turf/turf", "https://github.com/Turfjs/turf", ["JavaScript", "TypeScript"]),
    seed("mse-streaming", "Media Source Extensions", "mse", "media-playback", "application-managed segmented media buffering into an HTML media element", "adaptive streaming control is required and native playback does not cover the delivery contract", "the video is a simple progressive file or the platform can own streaming", ["hls-js", "dashjs-streaming", "videojs-player"], None, None, ["Modern browsers", "HTMLMediaElement"], "HIGH"),
    seed("dashjs-streaming", "dash.js Streaming", "dash", "media-playback", "MPEG-DASH playback and adaptive media orchestration", "the delivery pipeline emits DASH and the client needs an established playback layer", "content is ordinary MP4/HLS or licensing/DRM needs are unresolved", ["mse-streaming", "hls-js", "videojs-player"], "dashjs", "https://github.com/Dash-Industry-Forum/dash.js", ["JavaScript", "HTMLMediaElement"], "HIGH"),
    seed("videojs-player", "Video.js Player", "videojs", "media-playback", "customizable HTML5 video controls and plugin integrations", "the product needs a player surface rather than hand-built controls", "native controls are sufficient or the media route is a fully managed platform", ["mux-player", "mse-streaming", "native-video"], "video.js", "https://github.com/videojs/video.js", ["JavaScript", "React"]),
    seed("mux-player", "Mux Player", "mux", "media-playback", "managed video player integration with Mux-oriented delivery and telemetry", "the media backend is Mux and its product/runtime contract is acceptable", "the backend is provider-neutral or external player ownership is required", ["videojs-player", "native-video", "mse-streaming"], "@mux/mux-player", "https://github.com/muxinc/elements", ["Web Components", "React"], "HIGH"),
    seed("webcodecs-pipeline", "WebCodecs Pipeline", "webcodecs", "media-processing", "low-level encoded chunk and decoded frame processing", "a measured media-processing product needs frame-level browser control", "the task is playback, a canvas animation, or no codec fallback exists", ["mse-streaming", "image-bitmap-decode", "native-video"], None, None, ["Modern browsers", "Web Workers"], "HIGH"),
    seed("media-recorder-capture", "MediaRecorder Capture", "media-recorder", "media-processing", "recording MediaStream output into browser-supported chunks", "the app records camera, microphone or canvas output and can handle permission/failure states", "the product needs deterministic server-grade encoding or a simple upload form", ["webrtc-realtime", "webcodecs-pipeline", "native-file-input"], None, None, ["Modern browsers"], "HIGH"),
    seed("web-audio-graph", "Web Audio Graph", "web-audio", "media-processing", "interactive audio graph, effects and analysis", "audio processing itself is a product or a measured interaction signal", "audio is only background media or must stay entirely native", ["media-session-controls", "media-recorder-capture"], None, None, ["Modern browsers"], "HIGH"),
    seed("webrtc-realtime", "WebRTC Realtime Media", "webrtc", "media-processing", "peer media and data channels with permission and network-state handling", "real-time collaboration or communication is the core product requirement", "the product only plays stored media or lacks a signaling/security plan", ["media-recorder-capture", "mse-streaming"], None, None, ["Modern browsers"], "HIGH"),
    seed("media-session-controls", "Media Session Controls", "media-session", "media-playback", "platform media controls and metadata for ongoing playback", "audio/video should remain controllable outside the page focus", "media is short-lived or there is no persistent playback session", ["native-video", "web-audio-graph"], None, None, ["Modern browsers"], "HIGH"),
    seed("webvtt-captions", "WebVTT Captions", "webvtt", "media-playback", "timed text tracks, captions and synchronized text", "media has spoken content or timed descriptions that users must be able to access", "the asset is decorative and has no audible/semantic content", ["native-video", "videojs-player"], None, None, ["HTMLMediaElement", "Modern browsers"], "HIGH"),
    seed("image-bitmap-decode", "ImageBitmap Decode", "image-bitmap", "media-processing", "decoded bitmap handoff to canvas or worker rendering", "image decode is measurable work in a canvas/media pipeline", "ordinary `<img>` rendering already meets the product budget", ["offscreen-canvas-worker", "canvas-2d"], None, None, ["Modern browsers", "Web Workers"], "HIGH"),
    seed("vitest-runner", "Vitest Test Runner", "vitest", "verification", "fast unit, component and module tests aligned with Vite transforms", "the project is Vite-based or wants a modern local test runner", "browser behavior, layout or real network integration is the actual test subject", ["jest", "testing-library-dom", "playwright-e2e"], "vitest", "https://github.com/vitest-dev/vitest", ["JavaScript", "TypeScript"]),
    seed("testing-library-dom", "Testing Library DOM", "testing-library", "verification", "user-centered DOM queries and interaction assertions", "tests should validate accessible user outcomes rather than implementation details", "the behavior requires real browser rendering, layout or network", ["vitest-runner", "playwright-e2e", "cypress-e2e"], "@testing-library/dom", "https://github.com/testing-library/dom-testing-library", ["JavaScript", "React", "Vue"]),
    seed("axe-core-a11y", "axe-core Accessibility Rules", "axe", "verification", "automated checks for a subset of DOM accessibility rules", "automated accessibility regression detection supplements manual and assistive-tech review", "the team treats automated results as a full conformance certification", ["playwright-e2e", "testing-library-dom", "lighthouse-audits"], "axe-core", "https://github.com/dequelabs/axe-core", ["JavaScript", "Browser"]),
    seed("storybook-workbench", "Storybook Workbench", "storybook", "verification", "isolated component states, documentation and interaction test surfaces", "component states need repeatable review and a shared visual contract", "the project has no reusable component boundary or stories would become detached demos", ["playwright-e2e", "testing-library-dom", "design-system"], "storybook", "https://github.com/storybookjs/storybook", ["React", "Vue", "Angular", "Web Components"]),
    seed("lighthouse-audits", "Lighthouse Audits", "lighthouse", "performance-audit", "audits across performance, accessibility, best practices and SEO", "a representative page can be measured with a documented environment", "a single score is being used as proof of all real-user performance", ["web-vitals-metrics", "playwright-e2e", "bundle-analysis"], None, "https://github.com/GoogleChrome/lighthouse", ["Browser", "CI"], "HIGH"),
    seed("web-vitals-metrics", "Web Vitals Measurement", "web-vitals", "performance-audit", "client measurement of user-centric loading and responsiveness signals", "the product needs field or lab signals tied to a real page experience", "there is no sampling/privacy/aggregation plan or the metric is treated as a diagnosis by itself", ["lighthouse-audits", "otel-browser", "performance-api"], "web-vitals", "https://github.com/GoogleChrome/web-vitals", ["JavaScript", "Browser"], "HIGH"),
    seed("bundle-analysis", "Bundle Composition Analysis", "bundle-analyzer", "performance-audit", "visual inspection of webpack chunk and module composition", "bundle weight and duplication need an inspectable build artifact", "the build is not webpack or the report cannot be tied to a budget decision", ["rollup-visualizer", "lighthouse-audits"], "webpack-bundle-analyzer", "https://github.com/webpack-contrib/webpack-bundle-analyzer", ["Webpack", "JavaScript"]),
    seed("rollup-visualizer", "Rollup Output Visualization", "rollup-visualizer", "performance-audit", "visual reports for Rollup/Vite output composition and treemap analysis", "a Rollup-family build needs evidence for chunk ownership and duplication", "the project cannot reproduce the same build artifacts in review", ["bundle-analysis", "lighthouse-audits"], "rollup-plugin-visualizer", "https://github.com/btd/rollup-plugin-visualizer", ["Rollup", "Vite", "JavaScript"]),
    seed("cypress-e2e", "Cypress Browser Tests", "cypress", "verification", "interactive browser tests with a component and end-to-end workflow", "the team values a debuggable browser test loop and the supported runtime fits", "multi-tab, cross-origin or browser-control constraints require another runner", ["playwright-e2e", "web-test-runner", "testing-library-dom"], "cypress", "https://github.com/cypress-io/cypress", ["JavaScript", "TypeScript"]),
    seed("web-test-runner", "Web Test Runner", "web-test-runner", "verification", "tests against real browsers with modern web module tooling", "web platform behavior is the subject and browser execution must be direct", "the project requires broad integrated fixtures that another runner already owns", ["playwright-e2e", "cypress-e2e", "vitest-runner"], "@web/test-runner", "https://github.com/modernweb-dev/web", ["JavaScript", "Web Components"]),
    seed("otel-browser", "OpenTelemetry Browser Instrumentation", "otel-browser", "observability", "portable traces, metrics and browser instrumentation boundaries", "the team has an observability backend and needs vendor-neutral signals", "telemetry governance, consent and sampling are unresolved", ["web-vitals-metrics", "sentry-browser"], "@opentelemetry/sdk-browser", "https://github.com/open-telemetry/opentelemetry-js", ["JavaScript", "Browser"], "HIGH"),
    seed("shadcn-source-registry", "shadcn/ui Source Registry", "shadcn", "component-registries", "copy-owned component source that can be adapted to host tokens and behavior", "the team is ready to inspect and own every copied file", "the source cannot be reviewed for license, dependencies or accessibility", ["radix-primitives", "headless-ui", "tailwind-ui-library"], None, "https://github.com/shadcn-ui/ui", ["React", "Tailwind CSS"]),
    seed("magic-ui-source-registry", "Magic UI Source Registry", "magic-ui", "component-registries", "animated source components for adaptation into a product-specific system", "a motion pattern is useful and the host will remove decorative excess", "a copied demo would replace product-specific interaction design", ["shadcn-source-registry", "aceternity-source-registry", "motion-react-layout"], None, "https://github.com/magicuidesign/magicui", ["React", "Tailwind CSS"]),
    seed("aceternity-source-registry", "Aceternity UI Source Registry", "aceternity", "component-registries", "expressive React component examples with visible visual and motion assumptions", "the team needs a starting point for a specific effect and can harden it", "the design language is quiet or the demo's dependencies are not acceptable", ["magic-ui-source-registry", "shadcn-source-registry", "motion-react-layout"], None, "https://github.com/aceternityui/aceternity-ui", ["React", "Tailwind CSS"]),
    seed("twentyfirst-component-discovery", "21st.dev Component Discovery", "twentyfirst", "component-registries", "search and compare community component implementations before acquisition", "discovery is useful but provenance and integration review remain mandatory", "the team wants an unreviewed paste-in answer or the source terms are unclear", ["shadcn-source-registry", "magic-ui-source-registry"], None, None, ["React", "Tailwind CSS"], "HIGH"),
    seed("tailwind-ui-library", "Tailwind UI Licensed Library", "tailwind-ui", "component-registries", "paid Tailwind component and template source with explicit licensing review", "the project has a valid license and wants production-oriented starting points", "the project cannot confirm license scope or wants a source-free design system", ["shadcn-source-registry", "daisyui-themes", "mantine-components"], None, None, ["React", "Vue", "Tailwind CSS"]),
    seed("daisyui-themes", "daisyUI Theme Components", "daisyui", "component-registries", "Tailwind component classes and theme variables for rapid themed UI", "the host accepts utility/class-based component conventions and will test semantics", "visual identity needs every component owned at a lower level or CSS payload is constrained", ["tailwind-ui-library", "shadcn-source-registry", "mantine-components"], "daisyui", "https://github.com/saadeghi/daisyui", ["Tailwind CSS"]),
    seed("mantine-components", "Mantine Components", "mantine", "component-registries", "broad React components, hooks and theme contracts", "a product benefits from a coherent ready-made component family", "the host already has a competing design system or needs unstyled primitives", ["primereact-suite", "radix-primitives", "headless-ui"], "@mantine/core", "https://github.com/mantinedev/mantine", ["React"]),
    seed("primereact-suite", "PrimeReact Component Suite", "primereact", "component-registries", "broad React components with themes and enterprise-oriented controls", "coverage breadth matters and the product can accept the suite's theme/terms boundary", "the product needs a distinct source-owned visual grammar or a small custom surface", ["mantine-components", "ag-grid", "radix-primitives"], "primereact", "https://github.com/primefaces/primereact", ["React"], "HIGH"),
]


CATEGORY_DOMAINS = {
    "accessible-primitives": "accessible-primitives",
    "forms-state": "forms-and-validation",
    "data-state": "data-tables",
    "data-tables": "data-tables",
    "virtualization": "virtualization",
    "productivity-layout": "data-tables",
    "rich-editors": "rich-text",
    "motion-interaction": "motion",
    "3d-assets": "3d-rendering",
    "3d-rendering": "3d-rendering",
    "spatial-runtime": "3d-rendering",
    "gpu-shaders": "shaders",
    "webgpu": "webgpu",
    "performance-runtime": "performance-audit",
    "2d-rendering": "2d-canvas-svg",
    "charts-and-data": "charts-and-data",
    "maps": "maps",
    "media-playback": "media-playback",
    "media-processing": "media-playback",
    "verification": "browser-verification",
    "performance-audit": "performance-audit",
    "observability": "performance-audit",
    "component-registries": "component-registries",
}


def safe_id(value: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", value.lower()).strip("-")


def evidence(source_key: str, claim: str, checked_at: str = TODAY, state: str = "VERIFIED") -> dict:
    item = SOURCES[source_key]
    return {"url": item["url"], "claim": claim, "state": state, "checked_at": checked_at, "volatility": "HIGH" if source_key in {"webgpu", "three-webgpu", "webcodecs", "webrtc", "mse", "scroll-driven", "view-transitions"} else "MEDIUM"}


def curated_record(item: dict) -> dict:
    src = SOURCES[item["source"]]
    high = item["volatility"] == "HIGH"
    domain = CATEGORY_DOMAINS[item["category"]]
    return {
        "id": item["id"],
        "name": item["name"],
        "canonical_source": src["title"],
        "official_docs": src["url"],
        "repository": item["repository"],
        "package": item["package"],
        "category": item["category"],
        "capabilities": [item["focus"], f"selection boundary: {item['when']}", f"retrieval route: {domain} before implementation"],
        "limitations": [item["avoid"], "does not replace product-specific information architecture, accessibility review or error recovery", "API, browser and licensing facts must be refreshed before installation or release"],
        "framework_support": item["framework"],
        "runtime_requirements": ["browser/runtime support for the selected capability", "an explicit host integration boundary and cleanup path"],
        "browser_support": ["verify current support in the official source", "provide a meaningful fallback when this record is freshness-gated"],
        "SSR_constraints": ["keep browser-only work behind the client boundary", "do not read window, canvas, media or GPU state during server render"],
        "accessibility_characteristics": ["semantic DOM or an explicit non-canvas equivalent is required when UI meaning lives outside the capability", "keyboard, focus, reduced-motion and failure behavior remain the host's responsibility"],
        "performance_characteristics": [f"measure the cost of {item['focus']} on representative content and devices", "bound startup, memory, frame, network and cleanup cost before shipping"],
        "bundle_implications": ["prefer targeted imports and inspect generated chunks", "asset/runtime cost is part of selection, not an afterthought"],
        "dependencies": ["the package/runtime named in this record", "host framework and project conventions"],
        "licensing": "Verify current package, repository, asset and commercial terms from the official source before acquisition.",
        "maintenance_status": "ACTIVE",
        "API_stability": "EVOLVING" if high else "STABLE",
        "integration_complexity": "HIGH" if item["category"] in {"webgpu", "gpu-shaders", "3d-rendering", "spatial-runtime", "media-processing", "observability"} else "MEDIUM",
        "adaptability": "HIGH" if item["category"] in {"accessible-primitives", "forms-state", "motion-interaction", "component-registries"} else "MEDIUM",
        "design_flexibility": "HIGH" if item["category"] in {"accessible-primitives", "motion-interaction", "gpu-shaders", "2d-rendering", "component-registries"} else "MEDIUM",
        "best_for": [item["when"], item["focus"]],
        "avoid_when": [item["avoid"], "the project cannot state the capability's fallback and verification owner"],
        "alternatives": item["alternatives"],
        "known_conflicts": ["duplicate ownership of the same interaction, render loop, media controls or global theme", "copying an example without reviewing its source, license, dependencies and accessibility"],
        "verification_method": [f"read the current official documentation at {src['url']}", "inspect package metadata and generated output without assuming an undocumented API", "exercise loading, error, resize, keyboard/focus, reduced-motion and fallback states relevant to the capability"],
        "source_evidence": [evidence(item["source"], src["claim"]), evidence(item["source"], f"The source is the authority for selecting {item['name']}; the host must still verify fit for {item['when']}.", state="INFERRED")],
        "confidence": "MEDIUM" if high else "HIGH",
        "last_verified": TODAY,
        "volatility": item["volatility"],
        "selection_rule": item["when"],
        "avoid_rule": item["avoid"],
        "domain_owner": domain,
        "evidence_requirements": ["official docs/package terms", "project-native capability check", "rendered or runtime proof for the selected use case"],
        "freshness": "VERIFY_REQUIRED_BEFORE_API_OR_COMPATIBILITY_CLAIM" if high else "REFRESH_ON_MAJOR_CHANGE_OR_RELEASE",
        "tags": [item["category"], safe_id(item["source"]), *[safe_id(v) for v in item["framework"][:2]]],
    }


def catalog_record(item: dict) -> dict:
    ref = item.get("official_reference")
    if not isinstance(ref, str) or not ref.startswith("http"):
        ref = "https://github.com/emanueldssss/plief"
    checked = item.get("last_verified") or "2026-08-26"
    tags = item.get("tags") or [item.get("type") or "catalog-item", item.get("source") or "unknown-source"]
    source_name = item.get("source") or "unknown catalog source"
    display = item.get("canonical_name") or item["id"]
    dependencies: list[str] = []
    for value in (item.get("dependencies"), item.get("registry_dependencies")):
        if isinstance(value, list):
            dependencies.extend(str(v) for v in value)
        elif value:
            dependencies.append(str(value))
    if not dependencies:
        dependencies = ["unknown; inspect catalog source"]
    return {
        "id": f"catalog-{safe_id(item['id'])}",
        "name": f"Catalog: {source_name} / {display} [{item['id']}]",
        "canonical_source": f"Orun catalog / {source_name}",
        "official_docs": ref,
        "repository": None,
        "package": item.get("install"),
        "category": "catalog-item",
        "capabilities": [f"catalogued {item.get('type') or 'frontend'} capability: {display}", f"discovery source: {source_name}", f"catalog tags: {', '.join(tags[:6])}"],
        "limitations": ["catalog metadata is a discovery signal, not proof that the current package/API matches the host", "missing catalog fields remain unknown and are not invented", "acquisition requires source, license, dependency and rendered-behavior review"],
        "framework_support": item.get("framework") or ["verify from source"],
        "runtime_requirements": ["the runtime named by the source/package", "host integration, cleanup and responsive behavior review"],
        "browser_support": ["not asserted by this catalog mirror", "verify current browser support from the official reference"],
        "SSR_constraints": ["treat browser-only behavior as client-owned until verified", "test hydration, portals and layout measurement when present"],
        "accessibility_characteristics": ["catalog does not certify accessibility", "verify semantics, focus, keyboard, announcements and reduced motion in the adapted implementation"],
        "performance_characteristics": ["catalog does not provide a performance guarantee", "measure asset, dependency, DOM, frame and network cost in the host"],
        "bundle_implications": ["inspect the generated source and transitive dependencies before adding it", "prefer the smallest acquired path that proves the requirement"],
        "dependencies": dependencies,
        "licensing": "Unknown from this mirror unless the catalog item states otherwise; verify current source and asset terms before use.",
        "maintenance_status": "UNKNOWN",
        "API_stability": "UNKNOWN",
        "integration_complexity": "UNKNOWN",
        "adaptability": "MEDIUM",
        "design_flexibility": "MEDIUM",
        "best_for": [f"initial discovery of {display}", "comparison before an explicit selection record"],
        "avoid_when": ["the project needs a verified production dependency immediately", "the source, license or behavior cannot be inspected"],
        "alternatives": [],
        "known_conflicts": ["catalog source can introduce global CSS, registry dependencies or duplicate component ownership", "demo assumptions may not match the host's framework, content or accessibility contract"],
        "verification_method": [f"open and inspect the catalog source at {ref}", "resolve missing metadata instead of inferring it", "adapt in a disposable branch and verify keyboard, responsive, runtime and build behavior"],
        "source_evidence": [{"url": ref, "claim": f"The Orun catalog records {display} as a discovery item from {source_name}; this evidence does not certify its current behavior.", "state": "INFERRED", "checked_at": checked, "volatility": "HIGH"}],
        "confidence": "LOW",
        "last_verified": checked,
        "volatility": "HIGH",
        "selection_rule": "Use only as a discovery candidate; promote to a verified capability only after current source inspection.",
        "avoid_rule": "Do not treat null catalog metadata as a positive capability claim.",
        "domain_owner": "component-registries",
        "evidence_requirements": ["current source/package metadata", "license and dependency review", "rendered behavior and accessibility proof"],
        "freshness": "VERIFY_REQUIRED_BEFORE_USE",
        "tags": [safe_id(v) for v in tags[:8]],
        "catalog_item_id": item["id"],
        "catalog_snapshot": item,
    }


def add_edge(edges: list[dict], seen: set[tuple[str, str, str]], from_: str, to: str, kind: str, evidence_text: str) -> None:
    key = (from_, to, kind)
    if from_ == to or key in seen:
        return
    seen.add(key)
    edges.append({"from": from_, "to": to, "kind": kind, "evidence": evidence_text})


def main() -> int:
    base_caps = json.loads((ROOT / "knowledge" / "capabilities.json").read_text(encoding="utf-8-sig"))["capabilities"]
    catalog = json.loads((ROOT / "catalogs" / "items.json").read_text(encoding="utf-8-sig"))["items"]
    seed_ids = [x["id"] for x in SEEDS]
    assert len(seed_ids) == len(set(seed_ids)), "duplicate curated seed id"
    base_ids = {x["id"] for x in base_caps}
    assert not base_ids.intersection(seed_ids), f"curated seed collides with baseline: {base_ids.intersection(seed_ids)}"
    curated = [curated_record(item) for item in SEEDS]
    catalog_records = [catalog_record(item) for item in catalog]
    records = curated + catalog_records
    record_ids = {x["id"] for x in records}
    assert len(record_ids) == len(records), "duplicate expansion record id"
    all_names = {re.sub(r"[^a-z0-9]+", "", x["name"].lower()) for x in base_caps}
    assert not all_names.intersection(re.sub(r"[^a-z0-9]+", "", x["name"].lower()) for x in curated), "curated name collides with baseline"

    domain_candidates: dict[str, list[str]] = {}
    for record in records:
        domain_candidates.setdefault(record["domain_owner"], []).append(record["id"])
    domain_candidates = {k: sorted(v) for k, v in domain_candidates.items()}
    output = {
        "corpus": "plief-orun-capability-expansion",
        "version": "1.0.0",
        "baseline_corpus": "knowledge/capabilities.json",
        "catalog_snapshot": "catalogs/items.json",
        "last_verified": TODAY,
        "coverage_semantics": "INDEX_OF_IMPLEMENTED_AND_CATALOGUED_KNOWLEDGE",
        "coverage": sorted(record["name"] for record in records),
        "domain_candidates": domain_candidates,
        "capabilities": records,
        "source_registry": list(SOURCES.values()),
        "metrics": {"curated_records": len(curated), "catalog_derived_records": len(catalog_records), "source_count": len(SOURCES)},
    }
    CAP_OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")

    base_graph = json.loads((ROOT / "knowledge" / "capability-graph.json").read_text(encoding="utf-8-sig"))
    edges: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for domain, ids in domain_candidates.items():
        for record_id in ids:
            add_edge(edges, seen, domain, record_id, "candidate", "Expansion record is routed through its owning capability domain.")
    for item in SEEDS:
        domain = CATEGORY_DOMAINS[item["category"]]
        for alternative in item["alternatives"]:
            if alternative in record_ids or alternative in base_ids:
                add_edge(edges, seen, item["id"], alternative, "alternative_to", "Curated seed declares an explicit selection alternative.")
        peers = [x["id"] for x in SEEDS if x["category"] == item["category"] and x["id"] != item["id"]][:3]
        for peer in peers:
            add_edge(edges, seen, item["id"], peer, "compatible_with", "Same capability family; compatibility still requires host-level verification.")
        add_edge(edges, seen, item["id"], domain, "belongs_to", "Curated record declares its retrieval owner domain.")
    for record in catalog_records:
        source_name = safe_id(record["canonical_source"].replace("orun-catalog-", ""))
        peers = [x["id"] for x in catalog_records if x["id"] != record["id"] and safe_id(x["canonical_source"]) == source_name][:2]
        for peer in peers:
            add_edge(edges, seen, record["id"], peer, "compatible_with", "Catalog items share an acquisition source and require independent review.")
    graph = {
        "version": "1.0.0",
        "baseline_graph": "knowledge/capability-graph.json",
        "last_verified": TODAY,
        "coverage_semantics": "EXPLICIT_ROUTING_AND_COMPATIBILITY_EDGES",
        "nodes": [{"id": record["id"], "type": "capability"} for record in records],
        "edges": edges,
        "metrics": {"new_nodes": len(records), "new_edges": len(edges), "domain_edges": sum(len(v) for v in domain_candidates.values())},
    }
    GRAPH_OUT.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {len(curated)} curated and {len(catalog_records)} catalog-derived Orun records")
    print(f"wrote {len(edges)} Orun expansion graph edges")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
