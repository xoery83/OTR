<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:otr-product-architecture -->
# OTR Product Architecture

Journey is not a travel planner. Journey is an Event Operating System for travel.

Capture is the primary entry point. Planner, Ledger, Memories, Photos, Hotels,
Reviews, Daily Summary, Travel Story, and future modules should be treated as
outputs generated from captured real-world events.

Before changing Capture, Planner import, Memories, Ledger, image indexing, or
AI event processing, read `doc/journey-capture-engine-v2.md` and preserve the
principles:

- Capture first. Structure later.
- Every capture creates one raw event.
- One event may generate multiple structured actions.
- LLM must never be called by default.
- Prefer rule engine, local NLP, and local vision before LLM escalation.
- New modules should usually be added as action handlers, not separate primary
  input workflows.
<!-- END:otr-product-architecture -->
