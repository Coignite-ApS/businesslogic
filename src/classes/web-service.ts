import {WebForm, WebFormErrors} from "../interfaces/web-form";
import {TypedEvent} from "../Events/TypedEvent";
import {DataChangedEvent, ExecutedEvent, SchemaReceivedEvent, ValidationFailedEvent} from "../interfaces/events";
import * as helpers from "../Helpers/HelperFunctions";
import {log} from "../Helpers/HelperFunctions";
import {http} from '../http';
// import {debug} from "util";
import {Webservices} from "../index";

declare global {
    interface Window {
        Ajv: any;
    }
}

const ajv: any = helpers.isConstructor(window.Ajv) ? new window.Ajv() : null;

export class Webservice {
    protected key: string;
    private http: http;
    protected webform: WebForm;
    protected data: any;
    private inputSchema: any;
    private outputSchema: any;
    private relatedData: any;
    private cachedParams: any;
    private errors: WebFormErrors;
    private test: number;
    private debug: boolean;

    public SchemaReceviedListener = new TypedEvent<SchemaReceivedEvent>();
    public ValidationFailedListener = new TypedEvent<ValidationFailedEvent>();
    public DataChangedListener = new TypedEvent<DataChangedEvent>();
    public ExecutedListener = new TypedEvent<ExecutedEvent>();

    constructor(isDebug: boolean, key: string = '', webform?: WebForm) {
        this.key = key;
        this.data = {};
        this.webform = webform;
        this.http = new http(key);
        this.errors = {};
        this.cachedParams = {};
        this.test = 1;
        this.debug = isDebug;

        this.init();
    }

    private init(): void {
        let vm = this;

        // Adds this webservice to the collection of Webservices
        Webservices.add(this.key, this);

        this.describe().then(() => {
            vm.initDataTypes();
            vm.setParamsFromCachedParams();
            if (this.webform) vm.enrichWebFormInputs();
        }).then(() => {
            if (this.webform) vm.handleAssociatedWebform();
        });
    }

    private describe(): Promise<any> {
        let vm = this;

        return new Promise((resolve: any, reject: any) => {
            // Retrieve all relevant webservice metadata
            if (vm.inputSchema) {
                resolve('');
            } else {
                this.getWebserviceDocs().then((result) => {
                    this.SchemaReceviedListener.emit({
                        inputSchema: vm.inputSchema = result.expected_input || {},
                        outputSchema: vm.outputSchema = result.expected_output || {},
                        relatedData: vm.relatedData = result.available_data || {}
                    });

                    resolve(result);
                })
            }
        });
    }

    public assignWebForm(webform: WebForm): void {
        this.webform = webform;
    }

    private handleAssociatedWebform(): void {
        for (let param in this.webform.inputs) {
            let vm = this;
            let value = (<HTMLInputElement>this.webform.inputs[param].input_el).value;
            let type = vm.inputSchema.properties[param].type;

            vm.setParamFromWebform(param, value);

            this.webform.inputs[param].input_el.addEventListener('blur', function (e) {
                vm.validateInput(param);
                vm.webform.inputs[param].input_el.classList.add('touched');
            });
            this.webform.inputs[param].input_el.addEventListener('input', function (e) {
                vm.validateInput(param);
                vm.setParamFromWebform(param, this.value);
            });
            // If there is no submit button we execute the form upon a valid input
            if (this.webform.controls['submit'] === undefined) {
                this.webform.inputs[param].input_el.addEventListener('change', function (e) {
                    if (vm.validate()) vm.execute();
                })
            }
        }
        for (let name in this.webform.controls) {
            let vm = this;

            if (name == 'submit') {
                this.webform.controls[name].control_el.addEventListener('click', function (e) {
                    if (vm.validate()) vm.execute();
                })
            }
            if (name == 'reset') {
                this.webform.controls[name].control_el.addEventListener('click', function (e) {
                    vm.clearParams()
                })
            }
        }
    }

    public clearParams(): void {
        // Todo: clear the results as well
        if (this.inputSchema) {
            let vm = this;
            this.initDataTypes();
            this.correctDataTypes();
            for (let param in this.data) {
                if (this.data.hasOwnProperty(param)) {
                    if (this.webform) {
                        (<HTMLInputElement>this.webform.inputs[param].input_el).value = this.data[param];
                    }
                }
            }
            this.validate();
            this.DataChangedListener.emit({data: vm.data});
        }
    }

    public setParams(params: any = {}): void {
        // Todo: make it wait for schema
        if (this.inputSchema) {
            let vm = this;
            let dataChanged = false;
            this.data = params;
            for (let param in params) {
                if (this.data.hasOwnProperty(param)) {
                    if (this.data[param] !== params[param]) {
                        if (this.webform) {
                            (<HTMLInputElement>this.webform.inputs[param].input_el).value = params[param];
                        }
                        this.data[param] = params[param];
                        dataChanged = true;
                    }
                }
            }
            if (dataChanged) this.DataChangedListener.emit({data: vm.data});
        } else {
            for (let param in params) {
                if (params.hasOwnProperty(param)) {
                    this.cachedParams[param] = params[param];
                }
            }
        }
    }

    public setParam(param: string, value: any): void {
        // Todo: make it wait for schema
        if (this.inputSchema) {
            let vm = this;
            let dataChanged = false;
            if (this.data.hasOwnProperty(param)) {
                if (this.data[param] !== value) {
                    if (this.webform) {
                        (<HTMLInputElement>this.webform.inputs[param].input_el).value = value;
                    }
                    this.data[param] = value;
                    dataChanged = true;
                }
                if (dataChanged) this.DataChangedListener.emit({data: vm.data});
            }
        } else {
            this.cachedParams[param] = value;
        }
    }

    public getParams(): void {
        return this.data || this.cachedParams;
    }

    private setParamFromWebform(param: string, value: any): void {
        // Todo: make it wait for schema
        if (this.inputSchema) {
            let vm = this;
            let dataChanged = false;
            if (this.data.hasOwnProperty(param)) {
                if (this.data[param] !== value) {
                    this.data[param] = value;
                    dataChanged = true;
                }
            }
            if (dataChanged) this.DataChangedListener.emit({data: vm.data});
        } else {
            this.cachedParams[param] = value;
        }
    }

    private setParamsFromCachedParams(): void {
        if (!helpers.isEmpty(this.cachedParams)) {
            this.setParams(this.cachedParams);
            this.cachedParams = {};
        }
    }

    public getValidationErrors(): WebFormErrors {
        return this.errors;
    }

    public execute(): Promise<any> {
        let vm = this;
        //Wait for documents to get arround
        return new Promise((resolve: any, reject: any) => {
            let test: any;
            this.describe().then(() => {
                // Retrieve cached value
                vm.setParamsFromCachedParams();
            }).then(() => {
                // Correct data types
                vm.correctDataTypes();

                vm.http.makeRequest('POST', 'https://api.businesslogic.online/execute', vm.data)
                    .then(function (result) {
                        if (vm.webform) {
                            // If webservice was assigned to a webform print outputs to assigned elements
                            vm.handleWebformOutputs(result);
                        }
                        vm.ExecutedListener.emit(result);
                        test = result;
                        resolve(result);
                    })
                    .catch(function (error) {
                        reject(error);
                        console.error('Augh, there was an error! ', error.status + ': ' + error.statusText);
                    });
            });
        });
    }

    private validate(): Boolean {
        let valid: boolean = true;
        this.errors = {};

        if (ajv) ajv.validate(this.inputSchema, this.data);

        if (this.webform) {
            // Handle form validation when the webservice is associated with a webform

            if (this.webform.form_el) {
                // Use native form validation
                this.webform.form_el.customMessages = true;
                valid = this.webform.form_el.checkValidity();
            } else {
                // Use input validation
                let inputValid: boolean;
                for (let el in this.webform.inputs) {
                    this.validateInput(el);
                    this.webform.inputs[el].input_el.classList.add('touched');
                }
                if (!helpers.isEmpty(this.errors)) {
                    valid = false
                }
            }
        } else {
            //Handle pure data validation based on associated json schema
            // TODO: Consider using AJV library for schema validation instead of form validation
            // valid = ajv.validate(this.inputSchema, this.data);
        }

        if (!valid) {
            this.ValidationFailedListener.emit({
                errors: this.errors
            });
        }
        return valid;
    }

    private validateInput(param: string): Boolean {
        let input = <HTMLInputElement>this.webform.inputs[param].input_el;
        let inputValid = true;
        let message = '';
        if (!input.validity.valid) {
            inputValid = false;
            message = input.validationMessage;
            this.errors[param] = message;
            this.updateWebFormErrorMessage(param, message);
        } else {
            this.updateWebFormErrorMessage(param, '');
        }
        // Todo: Implement custom validation with language support
        // Todo: Implement custom validation with support for custom messages

        return inputValid;
    }

    private updateWebFormErrorMessage(input: any, message: string): void {
        if (this.webform && this.webform.inputs[input].err_el) {
            this.webform.inputs[input].err_el.textContent = message;
        }
    }

    private getWebserviceDocs(): Promise<any> {
        return new Promise((resolve: any, reject: any) => {
            this.http.makeRequest('GET', 'https://api.businesslogic.online/describe')
                .then(function (result) {
                    resolve(result);
                    log(this.debug, result);
                })
                .catch(function (error) {
                    reject(error);
                    console.error('Augh, there was an error! ', error.status + ': ' + error.statusText);
                });
        });
    }

    private enrichWebFormInputs(): void {
        // Enrich input elements
        for (let param in this.webform.inputs) {
            for (let property in this.inputSchema.properties) {
                if (param === property && this.inputSchema.properties.hasOwnProperty(property)) {
                    let definition = this.inputSchema.properties[property];
                    let label = <HTMLInputElement>this.webform.inputs[property].label_el;
                    let description = <HTMLInputElement>this.webform.inputs[property].desc_el;
                    let type = this.inputSchema.properties[property].type;
                    let select: HTMLSelectElement;
                    let input = <HTMLInputElement>this.webform.inputs[property].input_el;
                    if (this.webform.inputs[property].input_el.tagName === 'SELECT') {
                        select = <HTMLSelectElement>this.webform.inputs[property].input_el;
                    }

                    // Set title and description
                    if (definition.title) label.innerHTML = definition.title;
                    if (definition.description) description.innerHTML = definition.description;

                    // Set required
                    if (this.inputSchema.required.includes(property)) input.setAttribute('required', 'required');

                    // Set default to inputs (not select)
                    if (definition.default !== null) input.value = definition.default;

                    // Set options for enum
                    // TODO: Consider switching to simple version of enum without dataobject
                    if (definition.enum) {
                        // Handle labels
                        let inputData: any;
                        let mappings: Array<string>;
                        let labelObjName: string;
                        let labelFieldName: string;
                        let valueObjName: string;
                        let valueFieldName: string;

                        // TODO: Revisit data mapping
                        if (definition.data_label_mapping) {
                            mappings = definition.data_label_mapping.split('.');
                            labelFieldName = mappings.pop();
                            labelObjName = mappings.pop();
                        }

                        if (definition.data_mapping) {
                            mappings = definition.data_mapping.split('.');
                            valueFieldName = mappings.pop();
                            valueObjName = mappings.pop();
                        }

                        inputData = this.relatedData[labelObjName || valueObjName] || null;

                        // TODO: Consider support of optgroup
                        if (!!select) {
                            select.querySelectorAll('option').forEach((o) => {
                                if (o.getAttribute('bl-placeholder') === '') {
                                    (<HTMLOptionElement>o).value = '';
                                } else {
                                    o.remove();
                                }
                            });
                            for (let i = 0; i < definition.enum.length; i++) {
                                let option = document.createElement('option');
                                option.text = inputData && inputData[i][labelFieldName] || definition.enum[i];
                                option.value = inputData && inputData[i][labelObjName] || definition.enum[i];
                                // Set defaults for select
                                if (definition.default !== null) {
                                    if (option.value === String(definition.default)) {
                                        option.setAttribute('selected', 'selected')
                                    }
                                }
                                select.add(<HTMLOptionElement>option);
                            }
                        } else {
                            // TODO: Consider alternative inputs for select with options
                        }
                    }

                    // Set options for oneOf
                    if (definition.oneOf) {
                        // TODO: Consider support of optgroup
                        if (!!select) {
                            select.querySelectorAll('option').forEach((o) => {
                                if (o.getAttribute('bl-placeholder') === '') {
                                    (<HTMLOptionElement>o).value = '';
                                } else {
                                    o.remove();
                                }
                            });
                            for (let i = 0; i < definition.oneOf.length; i++) {
                                let option = document.createElement('option');
                                option.text = definition.oneOf[i].title;
                                option.value = definition.oneOf[i].const;
                                // Set defaults for select
                                if (definition.default !== null) {
                                    if (option.value === String(definition.default)) {
                                        option.setAttribute('selected', 'selected')
                                    }
                                }
                                select.add(<HTMLOptionElement>option);
                            }
                        } else {
                            // TODO: Consider alternative inputs for select with options
                        }
                    }

                    // Set extras from webservice definitions (input json schema)
                    switch (type) {
                        case 'string':
                            if (definition.minLength) input.minLength = definition.minLength;
                            if (definition.maxLength) input.maxLength = definition.maxLength;
                            if (definition.pattern) input.pattern = definition.pattern;
                            //if(definition.format) consider what to do with formats;
                            break;
                        case 'number':
                            if (definition.minimum) input.min = definition.minimum;
                            if (definition.maximum) input.max = definition.maximum;
                            if (definition.pattern) input.pattern = definition.pattern;
                            if (definition.multipleOf) input.step = definition.multipleOf;
                            //code block
                            break;
                        case 'integer':
                            if (definition.minimum) input.min = definition.minimum;
                            if (definition.maximum) input.max = definition.maximum;
                            if (definition.pattern) input.pattern = definition.pattern;
                            if (definition.multipleOf) input.step = definition.multipleOf;
                            //code block
                            break;
                        default:
                        //code block
                    }
                }
            }
        }

        // Enrich output elements
        // TODO: Consider other types of outputs like progress and meter tags
        // TODO: Consider other types of outputs like charts
        // TODO: Support array outputs
        for (let param in this.webform.outputs) {
            for (let property in this.outputSchema.properties) {
                if (param === property && this.outputSchema.properties.hasOwnProperty(property)) {
                    let definition = this.outputSchema.properties[property];
                    let label = this.webform.outputs[property].label_el;
                    let description = this.webform.outputs[property].desc_el;
                    let type = this.outputSchema.properties[property].type;
                    let output = this.webform.outputs[property].output_el;

                    // Set title and description
                    if (definition.title) label.innerHTML = definition.title;
                    if (definition.description) description.innerHTML = definition.description;

                    // Set default
                    if (definition.default) output.innerHTML = definition.default;
                }
            }
        }
    }

    private handleWebformOutputs(results: any = {}): void {
        for (let result in results) {
            for (let param in this.webform.outputs) {
                if (result === param) {
                    if (Array.isArray(results[param])) {
                        let values = '';
                        for (let field in results[param]) {
                            values += '<ul>';
                            for (let entry in results[param][field]) {
                                values += '<li>' + results[param][field][entry] + '</li>';
                            }
                            values += '</ul>';
                        }

                        // TODO: Handle array outputs with proper component from WebFormComponents
                        this.webform.outputs[param].output_el.innerHTML = values;
                    } else {
                        this.webform.outputs[param].output_el.innerHTML = results[param];
                    }
                }
            }
        }
    }

    private correctDataTypes(): void {
        if (this.inputSchema) {
            for (let param in this.data) {
                if (this.data.hasOwnProperty(param)) {
                    let value = this.data[param];
                    if (this.inputSchema.properties.hasOwnProperty(param)) {
                        let type = this.inputSchema.properties[param].type;
                        let val: any;
                        switch (type) {
                            case 'string':
                                val = String(value);
                                break;
                            case 'number':
                                val = Number(value);
                                break;
                            case 'integer':
                                val = parseInt(value);
                                break;
                            default:
                                this.data[param] = String(value);
                        }
                        this.data[param] = val;
                    } else {
                        // Strip miscellaneous params
                        delete this.data[param];
                    }
                }
            }
        }
    }

    private initDataTypes(): void {
        if (this.inputSchema) {
            for (let param in this.inputSchema.properties) {
                this.data[param] = null;
            }
        }
    }
}
