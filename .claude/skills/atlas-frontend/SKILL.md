---
name: atlas-frontend
description: Build or review Atlas frontend behavior using existing component libraries and responsive verification.
---

# Atlas Frontend

Read `docs/product.md` for scope and `docs/architecture.md` for the client boundary.
The team still needs to review UI choices; no visual direction or pixel layout is locked.

## Component and interaction work

- Compose existing library components; do not invent custom UI primitives.
- Do not draw custom SVG icons or use emojis as UI icons.
- Do not use lucide-react; use an approved existing icon library.
- Preserve keyboard behavior and accessible names supplied by components.
- Keep loading, empty, error, and approval states understandable when touched.
- Separate persisted user data from temporary optimistic state.

Do not introduce a new design system, mandatory Storybook, or additional product surfaces solely for this task.
Use current framework documentation and actual repository patterns before integration.

## Verification and review

Exercise the changed flow at desktop and mobile widths.
Check wrapping, overflow, focus, and meaningful error recovery.
Capture before/after screenshots for visible changes or a short recording for interactions.
Describe actual limitations, including unavailable browser verification.
Present visual and interaction decisions to the team for review.
Do not treat reference mockups as approved product requirements.
