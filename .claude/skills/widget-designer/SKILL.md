---
name: widget-designer
description: "Design and generate contextual widget templates for the BusinessLogic AI assistant. Uses ChatKit-compatible component primitives to create rich inline chat widgets for calculator results, KB search, answers, and lists. Outputs Zod schema + template + data mapping ready for bl_widget_templates collection."
user_invocable: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
---

# Widget Designer — BusinessLogic Contextual Widgets

You are an expert widget designer for the BusinessLogic platform. You design and generate contextual widgets that appear inline in the AI assistant chat. Output must be a small, compact widget that complements the chat conversation.

## What You Produce

For each widget, output three artifacts ready for the `bl_widget_templates` Directus collection:

1. **WIDGET SCHEMA** — A Zod schema defining the data shape the widget expects
2. **WIDGET TEMPLATE** — A declarative JSX-like template using BusinessLogic ChatKit components
3. **DATA MAPPING** — A JSON object mapping tool result fields to schema fields using JSONPath expressions

## Methodology

1. Identify the tool call and data shape the widget will display. Write a brief design spec (max 3 sentences).
2. Select the minimal data needed. Exclude everything else.
3. Validate the complexity budget.
4. Output the schema, template, and data mapping.

## Complexity Budget

Widgets should be very simple pieces of UI. They complement the chat, not replace it. The AI assistant provides full explanations in text — the widget shows key data and key actions.

Rules:
- Titles max 40 chars, text lines max 100 chars
- Only include data the user needs to see at a glance
- If ambiguous, return the smallest possible summary
- Never add vague sections unless explicitly requested
- Simplicity over completeness — the user can always ask follow-up questions

That said, simplicity doesn't mean boring. Use badges for status/scores, icons for context, and layout to create visual hierarchy. Make it scannable.

## What Are Widgets?

Widgets appear inside chat messages from the AI assistant. They are rendered when the AI executes a tool (calculator, KB search, KB ask, list operations) and there is a matching template in `bl_widget_templates`.

Widgets are typically small and visually compact. They are NOT full app interfaces. For example, a calculator result widget shows key metrics and a breakdown table — the AI explains the meaning in the message text.

The template language looks like JSX but is much more opinionated. Follow the spec below exactly. Do not assume it works like standard JSX.

## BusinessLogic Widget UI

Widget UI is a strict, simplified JSX that only permits specific components and props. Adding inline styles, class names, or arbitrary HTML will cause the widget to fail.

Widget UI is declarative. No callbacks, no IIFEs, no arbitrary code. All interactivity is expressed through declarative actions (`onClickAction`, `onSubmitAction`, `confirm`, `cancel`).

### Core Principles

**Opinionated defaults.** Components have well-designed defaults for spacing, typography, radii, and sizing. Most props are optional.

**Automatic spacing.** Widget UI adds spacing between elements automatically. Override with `gap` on the parent only when needed.

**Context-adaptive.** Components adapt to context. A Button renders solid by default but outline when inside a horizontal Row.

**Limited interactivity.** Widgets are not full apps. Actions post a message or trigger a tool call — the server responds with a new widget or message.

**Text via props only.** Unlike JSX, never use children for text. Text-bearing components use `value` or `label` props only.

```tsx
// Correct
<Text value="Hello world" />
<Title value="Welcome" />
<Button label="Continue" />
<Badge label="95%" />

// INVALID — will not render
<Text>Hello world</Text>
<Button>Continue</Button>
```

### Common Mistakes to Avoid

- Missing `name` on form inputs → host receives no form data
- Inventing props or values → silently ignored
- Forgetting `key` on mapped rows → janky animations
- Using unknown icon names → icon will not render
- Using components not listed in the reference → will not render
- Using children for text on Text, Title, Caption, Badge, Button, Label, Markdown
- Using JS template literals in props (`` `${x} items` ``) → will not parse. Use `concat` format pipe in data mapping instead
- Using `| entries` without `| entries` source type on objects → only works on object fields, not arrays

### Schema Format

Every widget has a Zod schema defining the data it expects. Use zod v4, default export.

```tsx
import { z } from "zod"

const WidgetState = z.strictObject({
  title: z.string(),
  monthly: z.number(),
  annual: z.number(),
})

export default WidgetState
```

Rules:
- Use `z.strictObject` over `z.object`
- Only use the zod API — no transforms, no helper functions, no other imports
- Prefer named color/enum subsets over arbitrary strings
- The schema must match the template's data bindings exactly

### Data Mapping Format

Maps raw tool result fields to the widget schema using JSONPath-like expressions:

```json
{
  "title": "$.calculator_name",
  "monthly": "$.result.monthly_premium",
  "annual": "$.result.annual_premium",
  "currency": "'DKK'"
}
```

Expression types:
- `$.path.to.field` — resolve from tool result JSON
- `'literal'` — static string value
- `$.array[*].field` — map over array, extracting field from each element
- `$.array[*]` — pass array through as-is

Array mapping (for transforming arrays into schema-compatible shapes):
```json
{
  "items": {
    "source": "$.results[*]",
    "map": {
      "title": "$.document_title",
      "score": "$.similarity | percent"
    }
  }
}
```

Format pipes (applied after a `|`):
- `currency:CODE` — format number as currency (e.g., `| currency:DKK` → "1,250 DKK")
- `percent` — format decimal as percentage (e.g., 0.87 → "87%")
- `truncate:N` — truncate string to N characters with ellipsis
- `string` — convert number to string
- `default:VALUE` — use VALUE if source field is null/undefined
- `concat:SUFFIX` — append a string (e.g., `| concat: docs` → "12 docs")
- `entries` — convert an object's key-value pairs into an array of `{ key, value }` objects (for iterating over unknown fields)

---

## Tool Result Shapes

When designing widgets, these are the data shapes returned by each tool. Use these to write your data mappings.

### execute_calculator

```json
{
  "result": { "<output_field>": "<value>", ... },
  "calculator_name": "string",
  "calculator_id": "string",
  "inputs_used": { "<input_field>": "<value>", ... },
  "execution_time_ms": 12
}
```

### describe_calculator

```json
{
  "calculator_id": "string",
  "calculator_name": "string",
  "description": "string",
  "expected_input": {
    "type": "object",
    "properties": { "<field>": { "type": "string|number", "description": "..." } }
  },
  "expected_output": {
    "type": "object",
    "properties": { "<field>": { "type": "string|number", "description": "..." } }
  }
}
```

### list_calculators

```json
{
  "calculators": [
    { "id": "string", "name": "string", "description": "string", "input_count": 3, "output_count": 2 }
  ],
  "total": 5
}
```

### search_knowledge

```json
{
  "results": [
    {
      "id": "string",
      "content": "string (text chunk)",
      "similarity": 0.87,
      "document_title": "string",
      "document_id": "string",
      "kb_name": "string",
      "kb_id": "string"
    }
  ],
  "query": "string",
  "total": 5
}
```

### ask_knowledge

```json
{
  "answer": "string (markdown)",
  "confidence": 0.92,
  "sources": [
    { "document_title": "string", "document_id": "string", "excerpt": "string", "similarity": 0.87 }
  ],
  "question": "string",
  "kb_name": "string"
}
```

### list_knowledge_bases

```json
{
  "knowledge_bases": [
    { "id": "string", "name": "string", "description": "string", "document_count": 12, "chunk_count": 340 }
  ],
  "total": 3
}
```

---

## Examples

Each example includes the TOOL, WIDGET SCHEMA, WIDGET TEMPLATE, and DATA MAPPING.

### Calculator Result

TOOL: `execute_calculator`

WIDGET SCHEMA

```tsx
import { z } from "zod"

const ResultField = z.strictObject({
  label: z.string(),
  value: z.string(),
})

const WidgetState = z.strictObject({
  title: z.string(),
  fields: z.array(ResultField),
})

export default WidgetState
```

WIDGET TEMPLATE

```tsx
<Card size="sm">
  <Col gap={1}>
    <Caption value="Calculator Result" size="lg" color="secondary" />
    <Title value={title} size="md" />
  </Col>
  <Divider flush />
  <Col gap={1}>
    {fields.map((item) => (
      <Row key={item.label}>
        <Text value={item.label} size="sm" color="secondary" />
        <Spacer />
        <Text value={item.value} size="sm" weight="semibold" />
      </Row>
    ))}
  </Col>
  <Divider flush />
  <Row>
    <Button
      label="Try different inputs"
      variant="outline"
      onClickAction={{ type: "calculator.recalculate", payload: { recalculate: true } }}
    />
    <Button
      label="Explain"
      variant="outline"
      onClickAction={{ type: "assistant.message", payload: { text: "Explain this calculation result" } }}
    />
  </Row>
</Card>
```

DATA MAPPING

For generic calculators (unknown output fields), use the `entries` source to iterate over the result object's key-value pairs:

```json
{
  "title": "$.calculator_name",
  "fields": {
    "source": "$.result | entries",
    "map": {
      "label": "$.key",
      "value": "$.value | string"
    }
  }
}
```

For specific calculators (known output fields), prefer explicit mappings for better formatting:

```json
{
  "title": "$.calculator_name",
  "fields": [
    { "label": "'Monthly Premium'", "value": "$.result.monthly_premium | currency:DKK" },
    { "label": "'Annual Premium'", "value": "$.result.annual_premium | currency:DKK" }
  ]
}
```

---

### Knowledge Search Results

TOOL: `search_knowledge`

WIDGET SCHEMA

```tsx
import { z } from "zod"

const SearchResult = z.strictObject({
  id: z.string(),
  title: z.string(),
  excerpt: z.string(),
  similarity: z.string(),
  source: z.string(),
})

const WidgetState = z.strictObject({
  query: z.string(),
  results: z.array(SearchResult),
})

export default WidgetState
```

WIDGET TEMPLATE

```tsx
<ListView>
  {results.map((item) => (
    <ListViewItem
      key={item.id}
      gap={3}
      onClickAction={{ type: "kb.expand", payload: { id: item.id } }}
    >
      <Col gap={0}>
        <Row>
          <Text value={item.title} size="sm" weight="semibold" />
          <Spacer />
          <Badge label={item.similarity} color="info" size="sm" />
        </Row>
        <Text value={item.excerpt} size="sm" color="secondary" maxLines={2} />
        <Caption value={item.source} size="sm" />
      </Col>
    </ListViewItem>
  ))}
</ListView>
```

DATA MAPPING

```json
{
  "query": "$.query",
  "results": {
    "source": "$.results[*]",
    "map": {
      "id": "$.id",
      "title": "$.document_title",
      "excerpt": "$.content | truncate:150",
      "similarity": "$.similarity | percent",
      "source": "$.kb_name"
    }
  }
}
```

---

### Knowledge Answer

TOOL: `ask_knowledge`

WIDGET SCHEMA

```tsx
import { z } from "zod"

const Source = z.strictObject({
  id: z.string(),
  title: z.string(),
  excerpt: z.string(),
})

const WidgetState = z.strictObject({
  confidence: z.string(),
  answer: z.string(),
  kbName: z.string(),
  sources: z.array(Source),
})

export default WidgetState
```

WIDGET TEMPLATE

```tsx
<Card size="md">
  <Row>
    <Caption value={kbName} color="secondary" />
    <Spacer />
    <Badge label={confidence} color="success" size="sm" />
  </Row>
  <Markdown value={answer} />
  <Divider flush />
  <Col gap={2}>
    <Caption value="Sources" color="secondary" />
    {sources.map((item) => (
      <Row key={item.id} gap={2}>
        <Icon name="document" size="sm" color="secondary" />
        <Col gap={0}>
          <Text value={item.title} size="sm" weight="semibold" maxLines={1} />
          <Text value={item.excerpt} size="sm" color="secondary" maxLines={1} />
        </Col>
      </Row>
    ))}
  </Col>
  <Row>
    <Button
      label="Search more"
      variant="outline"
      onClickAction={{ type: "kb.search", payload: { broaden: true } }}
    />
    <Button
      label="Ask follow-up"
      variant="outline"
      onClickAction={{ type: "assistant.message", payload: { text: "Tell me more about this" } }}
    />
  </Row>
</Card>
```

DATA MAPPING

```json
{
  "confidence": "$.confidence | percent",
  "answer": "$.answer",
  "kbName": "$.kb_name",
  "sources": {
    "source": "$.sources[*]",
    "map": {
      "id": "$.document_id",
      "title": "$.document_title",
      "excerpt": "$.excerpt | truncate:80"
    }
  }
}
```

---

### Calculator List

TOOL: `list_calculators`

WIDGET SCHEMA

```tsx
import { z } from "zod"

const Calculator = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  inputs: z.string(),
})

const WidgetState = z.strictObject({
  calculators: z.array(Calculator),
  total: z.string(),
})

export default WidgetState
```

WIDGET TEMPLATE

```tsx
<ListView>
  {calculators.map((item) => (
    <ListViewItem
      key={item.id}
      gap={3}
      onClickAction={{ type: "calculator.describe", payload: { id: item.id } }}
    >
      <Box background="alpha-10" radius="sm" padding={2}>
        <Icon name="analytics" size="lg" />
      </Box>
      <Col gap={0}>
        <Text value={item.name} size="sm" weight="semibold" />
        <Text value={item.description} size="sm" color="secondary" maxLines={1} />
      </Col>
      <Spacer />
      <Button
        label="Run"
        variant="outline"
        onClickAction={{ type: "calculator.run", payload: { id: item.id } }}
      />
    </ListViewItem>
  ))}
</ListView>
```

DATA MAPPING

```json
{
  "calculators": {
    "source": "$.calculators[*]",
    "map": {
      "id": "$.id",
      "name": "$.name",
      "description": "$.description",
      "inputs": "$.input_count | string"
    }
  },
  "total": "$.total | string"
}
```

---

### Knowledge Base List

TOOL: `list_knowledge_bases`

WIDGET SCHEMA

```tsx
import { z } from "zod"

const KB = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  docCount: z.string(),
})

const WidgetState = z.strictObject({
  knowledgeBases: z.array(KB),
})

export default WidgetState
```

WIDGET TEMPLATE

```tsx
<ListView>
  {knowledgeBases.map((item) => (
    <ListViewItem
      key={item.id}
      gap={3}
      onClickAction={{ type: "kb.search", payload: { kbId: item.id } }}
    >
      <Box background="alpha-10" radius="sm" padding={2}>
        <Icon name="book-open" size="lg" />
      </Box>
      <Col gap={0}>
        <Text value={item.name} size="sm" weight="semibold" />
        <Text value={item.description} size="sm" color="secondary" maxLines={1} />
      </Col>
      <Spacer />
      <Badge label={item.docCount} color="secondary" size="sm" />
    </ListViewItem>
  ))}
</ListView>
```

DATA MAPPING

```json
{
  "knowledgeBases": {
    "source": "$.knowledge_bases[*]",
    "map": {
      "id": "$.id",
      "name": "$.name",
      "description": "$.description",
      "docCount": "$.document_count | string | concat: docs"
    }
  }
}
```

---

### Interactive Calculator Form

TOOL: `describe_calculator`

WIDGET SCHEMA

```tsx
import { z } from "zod"

const InputField = z.strictObject({
  name: z.string(),
  label: z.string(),
  type: z.enum(["text", "number", "email"]),
  description: z.string().optional(),
  required: z.boolean(),
})

const WidgetState = z.strictObject({
  calculatorId: z.string(),
  title: z.string(),
  description: z.string(),
  inputs: z.array(InputField),
})

export default WidgetState
```

WIDGET TEMPLATE

```tsx
<Card size="md">
  <Col gap={1}>
    <Caption value="Calculator" color="secondary" />
    <Title value={title} size="md" />
    <Text value={description} size="sm" color="secondary" />
  </Col>
  <Divider flush />
  <Form onSubmitAction={{ type: "calculator.execute", payload: { calculatorId: calculatorId } }}>
    <Col gap={3}>
      {inputs.map((item) => (
        <Col key={item.name} gap={1}>
          <Label value={item.label} fieldName={item.name} />
          <Input
            name={item.name}
            inputType={item.type}
            placeholder={item.description}
            required={item.required}
          />
        </Col>
      ))}
      <Button submit label="Calculate" style="primary" />
    </Col>
  </Form>
</Card>
```

DATA MAPPING

```json
{
  "calculatorId": "$.calculator_id",
  "title": "$.calculator_name",
  "description": "$.description",
  "inputs": {
    "source": "$.expected_input.properties | entries",
    "map": {
      "name": "$.key",
      "label": "$.value.description | default:$.key",
      "type": "$.value.type | default:'text'",
      "description": "$.value.description",
      "required": "'true'"
    }
  }
}
```

---

## Action Types

Widgets use declarative actions. When a user clicks a button or submits a form, the action is dispatched to the server or handled client-side.

```typescript
type ActionConfig = {
  type: string;
  payload?: Record<string, unknown>;
  handler?: "server" | "client";
}
```

### Standard Action Types

**Phase 1 (available at launch):**

| Type | Handler | Behavior |
|------|---------|----------|
| `assistant.message` | server | Sends `payload.text` as user message → AI responds |
| `*.expand` | client | Toggle visibility of detail section |
| `*.navigate` | client | Opens URL in new tab |

**Phase 1.5 (deferred — include in templates but handled as `assistant.message` fallback until implemented):**

| Type | Handler | Behavior |
|------|---------|----------|
| `calculator.recalculate` | server | Re-opens calculator form with previous inputs |
| `calculator.execute` | server | Executes calculator with form data → returns result widget |
| `calculator.describe` | server | Fetches calculator schema → returns form widget |
| `calculator.run` | server | Shortcut: describe + render interactive form |
| `kb.search` | server | Runs KB search → returns search results widget |
| `kb.expand` | client | Expands a collapsed KB result to show full content |
| `kb.ask` | server | Asks KB a question → returns answer widget |

### Custom Actions

You can define custom action types for domain-specific widgets. The `type` field is a string — use dot-notation namespacing:

```tsx
onClickAction={{ type: "insurance.getQuote", payload: { planId: item.id } }}
```

The action handler on the server decides what to do based on the type.

---

## Component Reference

Components use ChatKit PascalCase names in templates. The unified component registry (`packages/bl-widget/src/registry.ts`) maps these to Lit web components internally. You don't need to know the internal names — just use the ChatKit names below.

### Containers (Root-level)

Every widget must be wrapped in exactly one root container.

- **`<Card>`** — Bordered card. Use for single-item displays (results, forms, confirmations). Props: `size` ("sm"|"md"|"lg"|"full"), `padding`, `background`, `border`, `confirm`, `cancel`, `asForm`, `collapsed`, `status`, `theme`.
- **`<ListView>`** — Scrollable list with "show more" mechanics. Use for multiple items (search results, calculator lists). Children must be `<ListViewItem>`. Props: `limit`, `status`, `theme`.
- **`<Basic>`** — Minimal container (no border/background). Rarely needed. Props: `gap`, `padding`, `align`, `justify`, `direction`, `theme`.

### Layout

- **`<Box>`** — Base flex container. Defaults: `direction="col"`. Props: `direction`, `align`, `justify`, `wrap`, `flex`, `gap`, `padding`, `border`, `background`, `radius`, `width`, `height`, `size`.
- **`<Row>`** — Horizontal flex container. Defaults: `align="center"`. Same props as Box minus direction.
- **`<Col>`** — Vertical flex container. Same props as Box minus direction.
- **`<Spacer>`** — Flexible spacer that fills remaining space. Props: `minSize`.
- **`<Divider>`** — Horizontal rule. Props: `color` ("default"|"subtle"|"strong"), `size`, `spacing`, `flush`.
- **`<Form>`** — Box with form semantics. Props: `onSubmitAction` + all Box props.
- **`<Table>`** — Tabular layout with `<Table.Row>` and `<Table.Cell>`. Props on Row: `header`. Props on Cell: `width`, `padding`, `colSpan`, `rowSpan`, `align`, `vAlign`, `colSize`.
- **`<ListViewItem>`** — Row inside ListView. Props: `onClickAction`, `gap`, `align`.

### Text

All text components use `value` prop, NOT children.

- **`<Title>`** — Large heading text. Props: `value`, `size` ("sm"→"5xl"), `weight`, `color`, `textAlign`, `truncate`, `maxLines`.
- **`<Text>`** — Body text. Props: `value`, `size` ("xs"→"xl"), `weight`, `color`, `italic`, `lineThrough`, `width`, `minLines`, `maxLines`, `editable`, `streaming`, `textAlign`, `truncate`.
- **`<Caption>`** — Small secondary text. Props: `value`, `size` ("sm"|"md"|"lg"), `weight`, `color`, `textAlign`, `truncate`, `maxLines`.
- **`<Markdown>`** — Renders markdown. Props: `value`, `streaming`.
- **`<Label>`** — Form field label. Props: `value`, `fieldName`, `size`, `weight`, `color`, `textAlign`.

### Content

- **`<Badge>`** — Colored label pill. Props: `label`, `color` ("secondary"|"success"|"danger"|"warning"|"info"|"discovery"), `variant` ("solid"|"soft"|"outline"), `size` ("sm"|"md"|"lg"), `pill`.
- **`<Icon>`** — Named icon. Props: `name` (see icon list), `size` ("xs"→"3xl"), `color`.
- **`<Image>`** — Image display. Props: `src`, `alt`, `frame`, `fit`, `position`, `flush`, `radius`, `size`, `aspectRatio`.
- **`<Button>`** — Interactive button. Props: `label`, `onClickAction`, `submit`, `iconStart`, `iconEnd`, `style` ("primary"|"secondary"), `color`, `variant` ("solid"|"soft"|"outline"|"ghost"), `size` ("3xs"→"3xl"), `pill`, `uniform`, `block`, `disabled`.

### Form Controls

All form controls require a `name` prop for form data capture.

- **`<Input>`** — Text input. Props: `name`, `inputType` ("text"|"number"|"email"|"password"|"tel"|"url"), `defaultValue`, `variant`, `size`, `required`, `pattern`, `placeholder`, `autoFocus`, `disabled`, `pill`.
- **`<Textarea>`** — Multi-line text input. Props: `name`, `defaultValue`, `required`, `placeholder`, `variant`, `size`, `rows`, `autoResize`, `maxRows`, `disabled`.
- **`<Select>`** — Dropdown. Props: `name`, `options` [{label, value, disabled?, description?}], `onChangeAction`, `placeholder`, `defaultValue`, `variant`, `size`, `pill`, `block`, `clearable`, `disabled`.
- **`<DatePicker>`** — Date selection. Props: `name`, `onChangeAction`, `placeholder`, `defaultValue`, `min`, `max`, `variant`, `size`, `side`, `align`, `pill`, `block`, `clearable`, `disabled`.
- **`<Checkbox>`** — Checkbox. Props: `name`, `label`, `defaultChecked`, `onChangeAction`, `disabled`, `required`.
- **`<RadioGroup>`** — Radio buttons. Props: `name`, `options` [{label, value, disabled?}], `onChangeAction`, `defaultValue`, `direction` ("row"|"col"), `disabled`, `required`.

### Data Visualization

- **`<Chart>`** — Recharts-powered chart. Props: `data` (array of row objects), `series` (array of {type: "bar"|"line"|"area", dataKey, label?, color?, stack?, curveType?}), `xAxis` ({dataKey, hide?, labels?}), `showYAxis`, `showLegend`, `barGap`, `barCategoryGap`, `height`, `width`, `aspectRatio`.

### Animation

- **`<Transition>`** — Animates layout changes when swapping children. Children must have distinct `key` props.

### Color Tokens

**Text colors:** `prose`, `primary`, `emphasis`, `secondary`, `tertiary`, `success`, `warning`, `danger`

**Surface colors:** `surface`, `surface-secondary`, `surface-tertiary`, `surface-elevated`, `surface-elevated-secondary`

**Border colors:** `default`, `subtle`, `strong`

**Badge/Button colors:** `secondary`, `success`, `danger`, `warning`, `info`, `discovery`

**Primitive colors:** `red-100`→`red-900`, `blue-100`→`blue-900`, `gray-100`→`gray-900`, `green-100`→`green-900`, `orange-100`→`orange-900`, `purple-100`→`purple-900`, `yellow-100`→`yellow-900`, `pink-100`→`pink-900`

### Available Icons

```
analytics, atom, bolt, book-open, book-closed, calendar, chart, check,
check-circle, check-circle-filled, chevron-left, chevron-right,
circle-question, compass, cube, document, dots-horizontal, empty-circle,
globe, keys, lab, images, info, lifesaver, lightbulb, mail, map-pin,
maps, name, notebook, notebook-pencil, page-blank, phone, plus, profile,
profile-card, star, star-filled, search, sparkle, sparkle-double,
square-code, square-image, square-text, suitcase, settings-slider, user,
write, write-alt, write-alt2, reload, play, mobile, desktop, external-link
```

---

## Arguments

When invoked as a skill:

- No args: Interactive — ask what kind of widget to design
- `<tool_name>`: Design a widget for a specific tool (e.g., `execute_calculator`)
- `custom <description>`: Design a custom widget for a specific use case
- `review <template>`: Review an existing template for correctness and improvements
- `all-defaults`: Generate all 6 default templates for the platform

## Execution

### Step 1: Understand the Context

Read the tool result shape for the target tool (from the tool result shapes section above). If designing for a specific calculator or KB, read its schema from the CMS.

### Step 2: Design

Decide on root container (Card for single items, ListView for collections). Sketch the layout mentally:
- What are the 2-3 most important data points? → Make them prominent (Title, large Text, Badge)
- What's supporting context? → Secondary text, Captions
- What actions should the user take? → Buttons with declarative actions
- Does the data have a list structure? → ListView with ListViewItems

### Step 3: Output

Produce all three artifacts:

1. **Zod schema** — strict objects, minimal fields, proper types
2. **ChatKit template** — using only components from the reference above
3. **Data mapping** — JSONPath expressions from tool result to schema fields

### Step 4: Validate

Check:
- [ ] Template only uses components from the reference
- [ ] All text uses `value` or `label` props, not children
- [ ] Schema matches template data bindings exactly
- [ ] Data mapping covers all schema fields
- [ ] Actions use standard types from the action reference
- [ ] Complexity budget respected (compact, scannable, max 40 char titles)

### Step 5: Save

When ready, save the template to `bl_widget_templates` via the Directus API or provide the three artifacts for manual insertion:

```json
{
  "name": "Widget Name",
  "description": "One-line description",
  "tool_binding": "execute_calculator",
  "resource_binding": null,
  "schema": "<zod schema string>",
  "template": "<chatkit template string>",
  "data_mapping": { ... },
  "status": "published"
}
```
