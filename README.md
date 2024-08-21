<p align="center">
<img alt="businesslogic.js" title="businesslogic.js" src="https://uploads-ssl.webflow.com/6163f04af154637a4dfbc5a4/6164217046b607243a01c2c9_icon_256.png" width="120">
</p>
<h1 align="center" style="color: #1F3957">Businesslogic</h1>
<p align="center">A small javascript library for creating interactive content and decisioning automation using <a href="https://www.businesslogic.online" target="_blank">businesslogic.online</a> webservices.</p>

---
[![npm version](https://badge.fury.io/js/businesslogic.svg)](https://badge.fury.io/js/businesslogic)
[![Join the chat at https://gitter.im/businesslogiconline/Lobby](https://badges.gitter.im/businesslogiconline/Lobby.svg)](https://gitter.im/businesslogiconline/Lobby?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

## Use cases
Whenever you need interactive content, calculations or decisioning logic:

* Build an online calculator that takes inputs and converts them into outputs without revealing the logic.
* Create a pricing tool for your sales force without giving access to the underlying logic.
* Publish a public poll to provide custom insights to users based on your decisioning model.
* Convert a static consulting analysis into a dynamic charts and visualisations for your clients.
* [More use cases here...][use cases]

---

## How to use?
Businesslogic library is intended to be used in three ways:
1. [Create auto-generated webforms](#auto-generated-webforms)
1. [Create webforms based on a template](#webforms-based-on-a-template)
1. [Use businesslogic programmatically](#use-businesslogic-programmatically)

**Please note:** *It is possible to combine these approaches and to make different webforms and businesslogic webservices to interconnect and to communicate with each other or to communicate with other external services, plugins and libraries.*

---

### Auto-generated webforms
Create a businesslogic driven webform with only a few lines of code and your own webservice token `bl-token="[your-businesslogic-webservice-token]"`.

```html
<script type="module" src="https://lib.businesslogic.online/js/businesslogic.latest.js"></script>
<link rel="stylesheet" href="https://lib.businesslogic.online/js/businesslogic-standard-theme.css">
<div bl-token="cf4c7b6555db4c98bda752f750e2684f" bl-name="calc" bl-auto class="bl-theme bl-theme-fonts"></div>
```
Including it anywhere on your page will generate a form like the following example. [See a live example here][jsfiddle-automatic-webform].

[![alt text][automatic-webform]][jsfiddle-automatic-webform]

Auto-generated webform in `sleek` mode, just add `bl-auto-sleek` attribute and `bl-background-image` in order to add background image

```html
<div bl-name="calc2" bl-token="5009a8b8529d4c059560a863f8904e31" bl-auto-sleek bl-control-reset-label
     class="bl-theme bl-theme-fonts bl-grid-columns-sleek" bl-control-submit-label="Submit"
     bl-background-image="https://images.unsplash.com/photo-1614059632169-522876ce04c8?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=MnwxMDE5OXwwfDF8Y29sbGVjdGlvbnwxfEtYRUFnWFJoeHRFfHx8fHx8fDE2Mjg1NjkwNTY&ixlib=rb-1.2.1&q=80&w=1080">
</div>
```

![alt text][automatic-sleek-webform]

Use our [styling guidelines][styling guide] to achieve your unique look.

**Please note:** *Auto-generated forms are also accessible [programmatically](#use-businesslogic-programmatically).*

---

### Webforms based on a template
Wire your own webform template with businesslogic. In this cases businesslogic uses it as a template.

```html
<script type="module" src="https://lib.businesslogic.online/js/businesslogic.latest.js"></script>
<link rel="stylesheet" href="https://lib.businesslogic.online/js/businesslogic-standard-theme.css">

<!-- Your own webform -->
<div bl-token="cf4c7b6555db4c98bda752f750e2684f" bl-name="calc" class="bl-theme bl-theme-fonts">
  <div class="input-group">
    <div class="form-group">
      <label bl-input-label="salary_per_month" for="salary_per_month"></label>
      <input bl-input="salary_per_month" id="salary_per_month" type="number" class="form-control" >
      <small bl-input-description="salary_per_month"></small>
      <small bl-input-error="salary_per_month"></small>
    </div>
  </div>
  <div class="input-group">
    <div class="form-group">
      <label bl-input-label="start_year" for="start_year"></label>
      <select bl-input="start_year" id="start_year" class="form-control">
        <option selected bl-placeholder>Choose...</option>
      </select>
        <small bl-input-description="start_year"></small>
        <small bl-input-error="start_year"></small>
    </div>
  </div>
  <hr>
  <button bl-control="submit">Calculate</button>
  <hr>
  <p><span bl-output-label="total_amount"></span> is: <span bl-output="total_amount"></span></p>
</div>
```

This will generate a form like the following example. [See a live example here][jsfiddle-templated-webform].

[![alt text][templated-webform]][jsfiddle-templated-webform]

Use our [styling guidelines][styling guide] to achieve your unique look.

**Please note:** *Webforms created this way are also accessible [programmatically](#use-businesslogic-programmatically).*

A combination of templating and a programatic approach can be used to extend templates with rich visuals, like charts, using charting libraries. [See a live example here][jsfiddle-templated-webform-with-chart].

[![alt text][templated-webform-with-chart]][jsfiddle-templated-webform-with-chart]

---
### Use businesslogic programmatically
Here is an example how you can use it directly on the page using code.

#### Use the library on a webpage
Use businesslogic library to connect and to execute functionality in your businesslogic webservice. [See a live example here][jsfiddle-programmatic-implementation].

```html
<script type="module" src="https://lib.businesslogic.online/js/businesslogic.latest.js"></script>
<script>
  window.onload = function () {
  
    // You can execute a webservice using Webservice class
    
    var biz = new Businesslogic.Webservice('cf4c7b6555db4c98bda752f750e2684f');
    biz.setParams({ "goal": 10000, "deadline": 2019 });
    biz.setParam("goal", 10000);

    biz.execute().then(function (result) {
        console.log('Output from programmatic execution: ',result)
    }).catch(function (error) {
        console.log('Error in programmatic execution: ',error)
    });
  };
</script>
```

You are able to get and manipulate with any webservice from the collection.

```html
<script type="module" src="https://lib.businesslogic.online/js/businesslogic.latest.js"></script>
<script>
  window.onload = function () {
    
    var biz = new Businesslogic.Webservice('cf4c7b6555db4c98bda752f750e2684f');
    
    Businesslogic.Webservices.get('cf4c7b6555db4c98bda752f750e2684f').setParams({ "goal": 15000, "deadline": 2019 });
    Businesslogic.Webservices.get('cf4c7b6555db4c98bda752f750e2684f').setParam("goal", 10000);
    Businesslogic.Webservices.get('cf4c7b6555db4c98bda752f750e2684f').execute();
  };
</script>
```
In this way you can interconnect several webservices together or to enrich their functionality using external ressources.

#### Use the library in development environment
Install businesslogic library using [npm][npm-businesslogic]:

```
npm install businesslogic
```
  
Use it in the code like so:

```javascript
var Businesslogic = require('Businesslogic');

var biz = new Businesslogic.Webservice('cf4c7b6555db4c98bda752f750e2684f');
biz.setParams({ "goal": 10000, "deadline": 2019 });

biz.execute().then(function (result) {
    console.log('Output from programmatic execution: ',result)
}).catch(function (error) {
    console.log('Error in programmatic execution: ',error)
});

```
---
## Contributing
In lieu of a formal style guide, take care to maintain the existing coding style. Add unit tests for any new or changed functionality. Lint and test your code.

- Clone or fork this repository
- Make sure you have [node.js](https://nodejs.org/) installed
- run `npm install -g webpack webpack-dev-server typescript` to install global dependencies
- run `npm install` to install dependencies
- run `npm start` to fire up dev server
- open browser to [`http://localhost:8080`](http://localhost:8080)


[automatic-webform]: ./assets/images/businesslogic-automatic-approach.png "Automaticaly generated businesslogic webform based on a standard template"
[automatic-sleek-webform]: ./assets/images/businesslogic-automatic-sleek-approach.png "Automaticaly generated businesslogic webform based on a standard template"
[templated-webform]: ./assets/images/businesslogic-templating-approach.png "Businesslogic wrapped into a template of your choice"
[templated-webform-with-chart]: ./assets/images/businesslogic-charting.png "Businesslogic form with chartjs"
[styling guide]: ./wiki/styling-guide.md
[use cases]: ./wiki/use-cases.md
[jsfiddle-automatic-webform]: https://jsfiddle.net/kropsi/16ty8vna/
[jsfiddle-templated-webform]: https://jsfiddle.net/kropsi/7jk0yzx4/
[jsfiddle-templated-webform-with-chart]: https://jsfiddle.net/kropsi/f1cu830j/
[jsfiddle-programmatic-implementation]: https://jsfiddle.net/kropsi/mf3ux8hg/
[npm-businesslogic]: https://www.npmjs.com/package/businesslogic
[businesslogic-website]: https://businesslogic.online
