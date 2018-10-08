## Businesslogic webform templating guide

It is possible to create a template using any templating engine, such as bootstrap, material design. To wire your businesslogic form you simply need to tell the library which elements needs to be connected.

Initialse the form using `bl-token="[your-businesslogic-webservice-token]"`. You can also provide a name using `bl-name="[name]"` if you have multiple webforms.

```html
<div bl-token="cf4c7b6555db4c98bda752f750e2684f" bl-name="calc">
    <!-- content goes here -->
</div>
```
You can have html structure you'd like inside that container. The most important is to add the needed businesslogic using `bl-*` attributes:

## Input parameters
The following attributes are supported for inputs:
* `bl-input-label="[parameter]"` binds to title of the parameter. (Optional)
* `bl-input="[parameter]"` binds the input to the parameter and enriches it with all the metadata acquired from businesslogic describe service. (Required only for required parameters)
* `bl-input-description="[parameter]"` binds to description of the parameter. (Optional)
* `bl-input-error="[parameter]"` binds to the error message of the parameter. (Optional)
* `bl-placeholder` currently only is allowed on option tag. (Optional)
* `bl-control="submit"` binds a submission button. (Optional)

```html
<div bl-token="cf4c7b6555db4c98bda752f750e2684f" bl-name="calc">
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
</div>
```
**Please note:** *You can use other input tags, for example sliders for number inputs. You can use a different structure, other tags, classes and styles then what we provided in this tutorial. Please experiment and [sumbit your findings to us][issues].*

## Output parameters
The following attributes are supported for outputs:
* `bl-output-label="[parameter]"` binds to title of the parameter. (Optional)
* `bl-output="[parameter]"` binds to value of the parameter. (Optional)

```html
<div bl-token="cf4c7b6555db4c98bda752f750e2684f" bl-name="calc">
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
**Please note:** *It's not nessecary to show all the results if not needed. In some cases the results maybe shown later or sent to email.*

[issues]: https://github.com/rassvetdk/businesslogic/issues