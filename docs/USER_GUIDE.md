# User guide

## Start without an account

Open the app and edit the sample or choose **New**. Projects autosave to this browser. Use **Export** regularly if the browser profile or device is not backed up.

## Build a schedule

1. Select **Add task**.
2. Enter the task name, start date, working-day duration, and progress.
3. Enable **Advanced** to indent tasks, add dependency types and lags, select calendars, lock manual dates, or add constraints. A task with children becomes a recursive rollup: its dates, duration, progress, and critical state come from its descendants. Use its caret to collapse or expand the branch; timeline arrows show each direct parent-child relationship. Drag a row by its grip to reorder it; move right over another task before dropping to indent the dragged subtree inside it.
4. Use the pencil on any row to open task details. Outline color is available for every task; hierarchy parents also have a tint that spans their full grid and timeline row.
5. Open the project menu in the top bar to switch or delete projects. Every deletion asks for confirmation.
4. Red bars identify the critical path. The issue banner explains cycles, locked-date conflicts, non-working starts, and invalid summary links.
5. Open **Details** for comments and calendar exceptions.

Keyboard commands:

- Arrow keys move vertically between spreadsheet cells; Left/Right cross a cell boundary when the text caret is already at that edge.
- Home/End move to the first/last column; Ctrl+Home/Ctrl+End move to the first/last task.
- Ctrl+Z and Ctrl+Shift+Z undo and redo local changes.
- Ctrl+S exports an OpenGantt backup.
- Ctrl+K opens command search.
- Delete removes the selected task when focus is not inside an editor.

## Import and export

- **Export** is the lossless OpenGantt backup.
- **CSV** opens in Excel, Google Sheets, and LibreOffice but contains task rows only.
- **XML** exports the supported Microsoft Project interchange subset.
- **XLSX** creates or reads a formatted workbook compatible with Excel, Google Sheets, and LibreOffice.
- **Import** accepts OpenGantt, CSV, XLSX, or Microsoft Project XML. CSV presents a mapping preview. Review conversion warnings after import.
- XLSX imports are limited to 10 MB. Text imports are limited to 25 MB; CSV and normalized projects are limited to 10,000 tasks.

## Sharing

Hosted accounts, public links, and cloud project management are paused. The current app is local-first; use **Export** to share a project file. Basic self-hosted collaboration can be wired in later from the existing server pieces.

## Small screens

Use the **List** and **Timeline** switch rather than squeezing both panes onto the same screen. All editing remains available from the list and Details panel.
