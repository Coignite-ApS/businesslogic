# Businesslogic webform styling guide

Adding link to the stylesheet and class attribute are optional. If you want to style the webform in your own different way you have the following options:
* You can select a different theme file
* You can override colors and variables using root selector `:root{--bl-color-primary: red}`
* You can override any styles directly, using a custom stylesheet
* You can replace a standard stylesheet with your own

## Businesslogic themes
Currently we provide only a standard theme.

Attach it with link to the stylesheet and by passing class:
* `bl-theme` attaches the theme (Optional)
* `bl-theme-fonts` overrides page fonts with ones from the theme (Optional)

```html
<script type="module" src="//businesslogic.online/lib/businesslogic.1.0.0.js"></script>
<link rel="stylesheet" href="//businesslogic.online/lib/businesslogic-standard-theme.css">
<div bl-token="5009a8b8529d4c059560a863f8904e31" bl-name="calc" bl-auto
class="bl-standard-theme bl-theme-fonts"></div>
```

### Root variables
You can override any color or variable in the theme root setting.

```html
<script type="module" src="//businesslogic.online/lib/businesslogic.1.0.0.js"></script>
<link rel="stylesheet" href="//businesslogic.online/lib/businesslogic-standard-theme.css">
<div bl-token="5009a8b8529d4c059560a863f8904e31" bl-name="calc" bl-auto
class="bl-standard-theme bl-theme-fonts"></div>

<!-- Override any of the following style variables -->
<style>
:root {
    --bl-font-base-size: 16px;
    --bl-color-primary: #007bff;
    --bl-color-secondary: #6c757d;
    --bl-color-success: #28a745;
    --bl-color-info: #17a2b8;
    --bl-color-warning: #ffc107;
    --bl-color-danger: #dc3545;
    --bl-color-gray: #6c757d;
    --bl-container-padding: 20px;
    --bl-container-background-color: #f8f9fa;
    --bl-input-height: calc(2.25rem + 2px);
    --bl-input-text-color: #444;
    --bl-input-placeholder-color: #6c757d;
    --bl-border-color: #ced4da;
    --bl-border-radius: 0.15rem;
    --bl-font-family-sans-serif: Roboto,Helvetica Neue,Arial,sans-serif;
    --bl-font-family-monospace: SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace;
}
</style>
```
### Grid system
You can display webforms as columns:
* `bl-grid-columns` gives inputs and then outputs as columns (Optional)
* `bl-grid-columns-reversed` gives outputs and then inputs as columns (Optional)

```html
<script type="module" src="//businesslogic.online/lib/businesslogic.1.0.0.js"></script>
<link rel="stylesheet" href="your-ovn-custom-theme.css">
<div bl-token="5009a8b8529d4c059560a863f8904e31" bl-name="calc" bl-auto
class="bl-theme bl-theme-fonts bl-grid-columns"></div>
```

### Custom styles
You can override any styles directly, using custom styles.

```html
<script type="module" src="//businesslogic.online/lib/businesslogic.1.0.0.js"></script>
<link rel="stylesheet" href="//businesslogic.online/lib/businesslogic-standard-theme.css">
<div bl-token="5009a8b8529d4c059560a863f8904e31" bl-name="calc" bl-auto
class="bl-theme bl-theme-fonts custom-theme"></div>

<!-- Override any styles with custom stylesheet -->
<style>
.custom-theme button {
    background: red !important;
}
</style>
```
### Custom theme
You can override any styles directly, using a custom stylesheet.

```html
<script type="module" src="//businesslogic.online/lib/businesslogic.1.0.0.js"></script>
<link rel="stylesheet" href="your-ovn-custom-theme.css">
<div bl-token="5009a8b8529d4c059560a863f8904e31" bl-name="calc" bl-auto
class="your-ovn-custom-theme"></div>
```