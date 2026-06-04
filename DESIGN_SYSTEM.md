# Sidekick Design System

Reference document for LLMs and developers building Sidekick UI.

## Colors

```
Page background:           #FFFFFF
Surface/cards:             #F4F4F4
Sidebar background:        #EAEAEA
Sidebar border:            #B0B0B0

Card border:               #D4D4D4
Input/table border:        #D0D0D0
Active element border:     #A7A7A7
Button border:             #CFCFCF

Text primary:              #000000
Text secondary:            #737373 (muted IDs, subtitles)
Text tertiary:             #A3A3A3 (timestamps)
Text faint:                #B6B6B6 (commit timestamps)
Text on inputs:            #393939
Text placeholder:          #7F7F7F
Text placeholder (light):  #959595

Accent (orange):           #D47E2F (bar charts, selected states, internal message borders)
Accent background:         #FFF5EC (selected table rows)
Accent bg warm:            #FFF3EA (internal message boxes)

Link blue:                 #0085B5
Git added:                 #007706
Git removed:               #BF0000
```

## Typography

Font families: **Inter** (primary sans-serif), **Cascadia Mono** (monospace for IDs, emails, technical values).

| Scale      | Size | Weight         | Tracking | Usage                                  |
| ---------- | ---- | -------------- | -------- | -------------------------------------- |
| Heading XL | 48px | Bold           | -1.92px  | Page titles, large counts              |
| Heading L  | 32px | Bold           | -0.96px  | Card titles, user names                |
| Heading M  | 27px | Bold           | -0.81px  | Section headers, bento titles          |
| Body L     | 24px | Regular        | -0.48px  | Navigation text, stat labels           |
| Body M     | 20px | Regular/Medium | -0.6px   | Default body text, table cells         |
| Body S     | 16px | Regular        | -0.48px  | Timeline details, secondary text       |
| Body XS    | 15px | Regular        | -0.45px  | Email addresses, tiny labels           |

## Border Radii

| Token          | Value  | Usage                                          |
| -------------- | ------ | ---------------------------------------------- |
| Bento          | 36px   | Homepage bento cards                           |
| Card           | 32px   | User cards, check cards, address cards         |
| Section        | 16px   | Inner sections, screenshots, bar chart corners |
| Sidebar button | 12px   | Sidebar nav buttons, input groups              |
| Tag            | 8px    | Inline buttons, status tags, timeline messages |
| Full           | 9999px | Avatars, profile pictures                      |

## Shadows

- **Card shadow:** `0px 4px 6.7px 0px rgba(0, 0, 0, 0.15)` -- used on review page bentoboxes
- **Sidebar active button:** `0px 4px 2px rgba(0, 0, 0, 0.13)` -- drop shadow on active nav button

## Spacing

| Context                    | Value                                          |
| -------------------------- | ---------------------------------------------- |
| Homepage bento padding     | 50px horizontal, 36px vertical                 |
| Card internal padding      | 64px                                           |
| Gap between bento rows     | 48px                                           |
| Gap between review bentoboxes | 24px                                        |
| Gap within card sections   | 32px                                           |
| Sidebar collapsed width    | 96px (16px padding + 64px button + 16px padding) |
| Sidebar expanded width     | 280px                                          |

## Component Patterns

### BentoBox

Rounded-[36px] container with #F4F4F4 background. Header row has: icon (left), title + description (center), optional count/slot (right). Content area below fills remaining space.

### UserCard

Border-2 #C6C6C6, rounded-[32px], shadow-card. Shows: avatar (65px rounded-full) + name (32px bold) + join date (20px regular), Slack button (top-right). Below: detail rows with icon + label (left) + value (right, monospace for IDs).

### NamedLink

Compound input: label button (border, rounded-left) + URL text display (border top/bottom) + copy button (border, rounded-right). Height: 63px.

### StatusLight

16px colored circle. Colors: green (#007706 for pass/OK), yellow/orange (#D47E2F for pending), red (#BF0000 for fail).

### SidebarButton

64x64px, rounded-[12px]. Regular: #EAEAEA background. Active: white background, #A7A7A7 border-2, drop-shadow.

### OrderTableRow

Full-width row, 86px height. Regular: #D0D0D0 side borders. Selected: #FFF5EC background, #D47E2F border-2. Columns separated by right borders.

### Timeline Events

Vertical stem connects events. Each event: icon (32px) + avatar (48px, border) + text details. Ship: anchor/ship icon. Rejection: circle-x icon (red). Approval: circle-check icon (green). Messages shown in rounded-[8px] boxes: reviewer message in #F5F5F5, internal/justification in #FFF3EA with dashed #D47E2F border.

## Icons

Use **lucide-svelte** exclusively. All non-brand icons are Lucide. Import as `import { IconName } from 'lucide-svelte'`.

Key icons used:

- Home: `House`
- Review: `Scale`
- Fulfillment: `Package`
- Settings: `Settings`
- Ship event: `Ship`
- Approval: `CircleCheck`
- Rejection: `CircleX`
- Comment: `MessageSquare`
- Copy: `Copy`
- External link: `ExternalLink`
- Search: `UserSearch`
- Filter: `Funnel`
- Map pin: `MapPin`
- Notebook: `NotebookPen`
- Door open: `DoorOpen`
- Chevron: `ChevronDown`
- Expand sidebar: `PanelLeftOpen`
- Back/Forward: `ChevronLeft` / `ChevronRight`
