# Glass interface

The sponsor dashboard defines the shared visual language: cool-gray canvas, white panels, muted green accents, restrained status colors and a red underline for the active section. Typography is system sans-serif; headings state the subject and descriptions stay brief. Financial values use tabular figures.

The same header and sponsor navigation now appear across application routes. The Workspace button opens a native modal navigation drawer with all routes and role controls. Escape closes it, focus stays inside while open, and a skip link reaches the main content. Demo controls are collapsed, with the data date and pinned state visible in the summary.

Shared Card, CardHeader, Stat, SectionTitle and table components provide consistent spacing, hierarchy and borders. Charts use the same green and gray palette while retaining distinct exception colors. The welcome page, login and presentation view follow the light theme. No financial calculations or operational workflows change with the restyling.

Local environment files are excluded from Docker build context. Production uses the existing Fly app and its configured secrets.
