---
name: concept-diagrams
description: Generate flat, minimal educational SVG visuals as HTML.
version: 0.1.0
author: v1k22 (original PR), ported into hermes-agent
license: MIT
dependencies: []
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [diagrams, svg, visualization, education, physics, chemistry, engineering]
    related_skills: [architecture-diagram, excalidraw]
---

# Concept Diagrams

Generate production-quality SVG diagrams with a unified flat, minimal design system. Output is a single self-contained HTML file that renders identically in any modern browser, with automatic light/dark mode.

## Scope

**Best suited for:**
- Physics setups, chemistry mechanisms, math curves, biology
- Physical objects (aircraft, turbines, smartphones, mechanical watches, cells)
- Anatomy, cross-sections, exploded layer views
- Floor plans, architectural conversions
- Narrative journeys (lifecycle of X, process of Y)
- Hub-spoke system integrations (smart city, IoT networks, electricity grids)
- Educational / textbook-style visuals in any domain
- Quantitative charts (grouped bars, energy profiles)

**Look elsewhere first for:**
- Dedicated software / cloud infrastructure architecture with a dark tech aesthetic (consider `architecture-diagram` if available)
- Hand-drawn whiteboard sketches (consider `excalidraw` if available)
- Animated explainers or video output (consider an animation skill)

If a more specialized skill is available for the subject, prefer that. If none fits, this skill can serve as a general-purpose SVG diagram fallback — the output will carry the clean educational aesthetic described below, which is a reasonable default for almost any subject.

## Workflow

1. Decide on the diagram type (see Diagram Types below).
2. Lay out components using the Design System rules.
3. Write the full HTML page using `templates/template.html` as the wrapper — paste your SVG where the template says `<!-- PASTE SVG HERE -->`.
4. Save as a standalone `.html` file (for example `~/my-diagram.html` or `./my-diagram.html`).
5. User opens it directly in a browser — no server, no dependencies.

Optional: if the user wants a browsable gallery of multiple diagrams, see "Local Preview Server" at the bottom.

Load the HTML template:
```
read_file("skills/creative/concept-diagrams/templates/template.html")
```

The template embeds the full CSS design system (`c-*` color classes, text classes, light/dark variables, arrow marker styles). The SVG you generate relies on these classes being present on the hosting page.

---

## Design System & Boilerplate

The design system (colors, typography, spacing) and the SVG boilerplate are in
`references/design-system.md`.
## Diagram Types

Choose the layout that fits the subject:

1. **Flowchart** — CI/CD pipelines, request lifecycles, approval workflows, data processing. Single-direction flow (top-down or left-right). Max 4-5 nodes per row.
2. **Structural / Containment** — Cloud infrastructure nesting, system architecture with layers. Large outer containers with inner regions. Dashed rects for logical groupings.
3. **API / Endpoint Map** — REST routes, GraphQL schemas. Tree from root, branching to resource groups, each containing endpoint nodes.
4. **Microservice Topology** — Service mesh, event-driven systems. Services as nodes, arrows for communication patterns, message queues between.
5. **Data Flow** — ETL pipelines, streaming architectures. Left-to-right flow from sources through processing to sinks.
6. **Physical / Structural** — Vehicles, buildings, hardware, anatomy. Use shapes that match the physical form — `<path>` for curved bodies, `<polygon>` for tapered shapes, `<ellipse>`/`<circle>` for cylindrical parts, nested `<rect>` for compartments. See `references/physical-shape-cookbook.md`.
7. **Infrastructure / Systems Integration** — Smart cities, IoT networks, multi-domain systems. Hub-spoke layout with central platform connecting subsystems. Semantic line styles (`.data-line`, `.power-line`, `.water-pipe`, `.road`). See `references/infrastructure-patterns.md`.
8. **UI / Dashboard Mockups** — Admin panels, monitoring dashboards. Screen frame with nested chart/gauge/indicator elements. See `references/dashboard-patterns.md`.

For physical, infrastructure, and dashboard diagrams, load the matching reference file before generating — each one provides ready-made CSS classes and shape primitives.

---

## Validation Checklist

Before finalizing any SVG, verify ALL of the following:

1. Every `<text>` has class `t`, `ts`, or `th`.
2. Every `<text>` inside a box has `dominant-baseline="central"`.
3. Every connector `<path>` or `<line>` used as arrow has `fill="none"`.
4. No arrow line crosses through an unrelated box.
5. `box_width >= (longest_label_chars × 8) + 48` for 14px text.
6. `box_width >= (longest_label_chars × 6.5) + 48` for 12px text.
7. ViewBox height = bottom-most element + 40px.
8. All content stays within x=40 to x=640.
9. Color classes (`c-*`) are on `<g>` or shape elements, never on `<path>` connectors.
10. Arrow `<defs>` block is present.
11. No gradients, shadows, blur, or glow effects.
12. Stroke width is 0.5px on all node borders.

---

## Output & Preview

### Default: standalone HTML file

Write a single `.html` file the user can open directly. No server, no dependencies, works offline. Pattern:

```python
# 1. Load the template
template = read_file("skills/creative/concept-diagrams/templates/template.html")

# 2. Fill in title, subtitle, and paste your SVG
html = template.replace(
    "<!-- DIAGRAM TITLE HERE -->", "SN2 reaction mechanism"
).replace(
    "<!-- OPTIONAL SUBTITLE HERE -->", "Bimolecular nucleophilic substitution"
).replace(
    "<!-- PASTE SVG HERE -->", svg_content
)

# 3. Write to a user-chosen path (or ./ by default)
write_file("./sn2-mechanism.html", html)
```

Tell the user how to open it:

```
# macOS
open ./sn2-mechanism.html
# Linux
xdg-open ./sn2-mechanism.html
```

### Optional: local preview server (multi-diagram gallery)

Only use this when the user explicitly wants a browsable gallery of multiple diagrams.

**Rules:**
- Bind to `127.0.0.1` only. Never `0.0.0.0`. Exposing diagrams on all network interfaces is a security hazard on shared networks.
- Pick a free port (do NOT hard-code one) and tell the user the chosen URL.
- The server is optional and opt-in — prefer the standalone HTML file first.

Recommended pattern (lets the OS pick a free ephemeral port):

```bash
# Put each diagram in its own folder under .diagrams/
mkdir -p .diagrams/sn2-mechanism
# ...write .diagrams/sn2-mechanism/index.html...

# Serve on loopback only, free port
cd .diagrams && python -c "
import http.server, socketserver
with socketserver.TCPServer(('127.0.0.1', 0), http.server.SimpleHTTPRequestHandler) as s:
    print(f'Serving at http://127.0.0.1:{s.server_address[1]}/')
    s.serve_forever()
" &
```

If the user insists on a fixed port, use `127.0.0.1:<port>` — still never `0.0.0.0`. Document how to stop the server (`kill %1` or `pkill -f "http.server"`).

---

## Examples Reference

The `examples/` directory ships 15 complete, tested diagrams. Browse them for working patterns before writing a new diagram of a similar type:

| File | Type | Demonstrates |
|------|------|--------------|
| `hospital-emergency-department-flow.md` | Flowchart | Priority routing with semantic colors |
| `feature-film-production-pipeline.md` | Flowchart | Phased workflow, horizontal sub-flows |
| `automated-password-reset-flow.md` | Flowchart | Auth flow with error branches |
| `autonomous-llm-research-agent-flow.md` | Flowchart | Loop-back arrows, decision branches |
| `place-order-uml-sequence.md` | Sequence | UML sequence diagram style |
| `commercial-aircraft-structure.md` | Physical | Paths, polygons, ellipses for realistic shapes |
| `wind-turbine-structure.md` | Physical cross-section | Underground/above-ground separation, color coding |
| `smartphone-layer-anatomy.md` | Exploded view | Alternating left/right labels, layered components |
| `apartment-floor-plan-conversion.md` | Floor plan | Walls, doors, proposed changes in dotted red |
| `banana-journey-tree-to-smoothie.md` | Narrative journey | Winding path, progressive state changes |
| `cpu-ooo-microarchitecture.md` | Hardware pipeline | Fan-out, memory hierarchy sidebar |
| `sn2-reaction-mechanism.md` | Chemistry | Molecules, curved arrows, energy profile |
| `smart-city-infrastructure.md` | Hub-spoke | Semantic line styles per system |
| `electricity-grid-flow.md` | Multi-stage flow | Voltage hierarchy, flow markers |
| `ml-benchmark-grouped-bar-chart.md` | Chart | Grouped bars, dual axis |

Load any example with:
```
read_file("skills/creative/concept-diagrams/examples/<filename>")
```

---

## Quick Reference: What to Use When

| User says | Diagram type | Suggested colors |
|-----------|--------------|------------------|
| "show the pipeline" | Flowchart | gray start/end, purple steps, red errors, teal deploy |
| "draw the data flow" | Data pipeline (left-right) | gray sources, purple processing, teal sinks |
| "visualize the system" | Structural (containment) | purple container, teal services, coral data |
| "map the endpoints" | API tree | purple root, one ramp per resource group |
| "show the services" | Microservice topology | gray ingress, teal services, purple bus, coral workers |
| "draw the aircraft/vehicle" | Physical | paths, polygons, ellipses for realistic shapes |
| "smart city / IoT" | Hub-spoke integration | semantic line styles per subsystem |
| "show the dashboard" | UI mockup | dark screen, chart colors: teal, purple, coral for alerts |
| "power grid / electricity" | Multi-stage flow | voltage hierarchy (HV/MV/LV line weights) |
| "wind turbine / turbine" | Physical cross-section | foundation + tower cutaway + nacelle color-coded |
| "journey of X / lifecycle" | Narrative journey | winding path, progressive state changes |
| "layers of X / exploded" | Exploded layer view | vertical stack, alternating labels |
| "CPU / pipeline" | Hardware pipeline | vertical stages, fan-out to execution ports |
| "floor plan / apartment" | Floor plan | walls, doors, proposed changes in dotted red |
| "reaction mechanism" | Chemistry | atoms, bonds, curved arrows, transition state, energy profile |
