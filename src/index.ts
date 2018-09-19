'use strict';

import { WebForm } from "./WebForm";
import { http } from "./http";

// Todo: Needs to be split into more logical parts

export class Webservice {

    protected key: string;
    private http: http;
    protected webform: WebForm;
    protected data: any;
    private inputSchema: any;
    private outputSchema: any;
    private relatedData: any;
    private executeLater: boolean;

    constructor(key:string = '', webform?:WebForm) {
        this.key = key;
        this.data = {};
        this.webform = webform;
        this.http = new http(key);
        this.executeLater = false;
        this.init();
    }

    private init() : void{

        let vm = this;

        // Retrieve all relevant webservice metadata
        this.getScemas().then((result) => {
            vm.inputSchema = result.expected_input || {};
            vm.outputSchema = result.expected_output || {};
            vm.relatedData = result.available_data || {};
            if(this.webform) vm.enrichWebFormInputs();
        }).then(() => {
            // If execute was called before /describe was called
            if(this.executeLater) vm.execute();
        }).then(() => {
            // Autogenerate creation of a form if required

            // Handle associated webform
            if(this.webform) {
                for(let param in this.webform.inputs) {
                    let vm = this;
                    let value = (<HTMLInputElement>this.webform.inputs[param].input_el).value;
                    let type = vm.inputSchema.properties[param].type;
                    vm.setParam(param,value);
                    console.log();
                    this.webform.inputs[param].input_el.addEventListener('input',function (e) {
                        vm.setParam(param,this.value)
                    });
                    // If there is no submit button we execute the form upon a valid input
                    if(this.webform.controls['submit'] === undefined) {
                        this.webform.inputs[param].input_el.addEventListener('change',function (e) {
                            // TODO: Need to validate the input before executing the code
                            vm.execute();
                        })
                    }
                }
                for(let name in this.webform.controls) {
                    let vm = this;
                    this.webform.controls[name].control_el.addEventListener('click',function (e) {
                        if(name === 'submit') vm.execute();
                    })
                }
            }
            // Adds this webservice to the collection of Webservices
            Webservices.add(this.key,this);
            console.log('Webservice created')
        })


    }

    public setParams(params: any = {}): void {
        this.data = params;
    }

    public setParam(param: string, value: any): void {
        this.data[param] = value;
    }

    public execute(): Promise<any> {

        let vm = this;

        if(this.inputSchema) {
            this.correctDataTypes();
        } else {
            // Wait until we have webservice schema
            this.executeLater = true;
            return new Promise(() => {});
        }


        return new Promise((resolve: any, reject: any) => {
            this.http.makeRequest('POST','https://api.businesslogic.online/execute', this.data)
                .then(function (result) {
                    if(vm.webform) {
                        // If webservice was assigned to a webform print outputs to assigned elements
                        vm.handleWebformOutputs(result);
                    }
                    resolve(result);
                    log(result);
                })
                .catch(function (error) {
                    reject(error);
                    console.error('Augh, there was an error! ', error.status + ': ' + error.statusText);
                });
        });
    }


    private getScemas(): Promise<any> {

        return new Promise((resolve: any, reject: any) => {
            this.http.makeRequest('GET','https://api.businesslogic.online/describe')
                .then(function (result) {
                    resolve(result);
                    log(result);
                })
                .catch(function (error) {
                    reject(error);
                    console.error('Augh, there was an error! ', error.status + ': ' + error.statusText);
                });
        });
    }

    private enrichWebFormInputs():void {
        for(let param in this.webform.inputs) {
            for(let property in this.inputSchema.properties) {
                if(param === property && this.inputSchema.properties.hasOwnProperty(property)) {
                    let definition = this.inputSchema.properties[property];
                    let label = <HTMLInputElement>this.webform.inputs[property].label_el;
                    let description = <HTMLInputElement>this.webform.inputs[property].desc_el;
                    let type = this.inputSchema.properties[property].type;
                    let select: HTMLSelectElement;
                    let input = <HTMLInputElement>this.webform.inputs[property].input_el;

                    if(this.webform.inputs[property].input_el.tagName === 'SELECT') {
                        select = <HTMLSelectElement>this.webform.inputs[property].input_el;
                    }

                    // Set title and description
                    if(definition.title) label.innerHTML = definition.title;
                    if(definition.description) description.innerHTML = definition.description;

                    console.log(definition);

                    // Set required
                    if(!this.inputSchema.required[property])input.setAttribute('required','required');

                    // Set default
                    if(definition.default) input.value = definition.default;


                    // Set options
                    if(definition.enum) {

                        // Handle labels
                        let inputData:any;
                        let mappings:Array<string>;
                        let labelObjName:string;
                        let labelFieldName:string;
                        let valueObjName:string;
                        let valueFieldName:string;


                        // TODO: Revisit data mapping
                        if(definition.data_label_mapping) {
                            mappings = definition.data_label_mapping.split('.');
                            labelFieldName = mappings.pop();
                            labelObjName = mappings.pop();

                        }

                        if(definition.data_mapping) {
                            mappings = definition.data_mapping.split('.');
                            valueFieldName = mappings.pop();
                            valueObjName = mappings.pop();
                        }

                        inputData = this.relatedData[labelObjName||valueObjName] || null;

                        if(!!select) {
                            select.querySelectorAll("option:not([disabled])").forEach((o)=>{
                                o.remove();
                            });
                            for(let i=0; i < definition.enum.length; i++) {
                                let option = document.createElement('option');
                                option.text = inputData && inputData[i][labelFieldName] || definition.enum[i];
                                option.value = inputData && inputData[i]['year'] || definition.enum[i];
                                select.add(<HTMLOptionElement>option);
                            }
                        } else {
                            // TODO: Consider alternative inputs for select with options
                        }
                    }

                    // Set extras from webservice definitions (input json schema)
                    switch(type) {
                        case 'string':
                            if(definition.minLength) input.minLength = definition.minLength;
                            if(definition.maxLength) input.maxLength = definition.maxLength;
                            if(definition.pattern) input.pattern = definition.pattern;
                            //if(definition.format) consider what to do with formats;
                            break;
                        case 'number':
                            if(definition.minimum) input.min = definition.minimum;
                            if(definition.maximum) input.max = definition.maximum;
                            if(definition.pattern) input.pattern = definition.pattern;
                            if(definition.multipleOf) input.step = definition.multipleOf;
                            //code block
                            break;
                        case 'integer':
                            if(definition.minimum) input.min = definition.minimum;
                            if(definition.maximum) input.max = definition.maximum;
                            if(definition.pattern) input.pattern = definition.pattern;
                            if(definition.multipleOf) input.step = definition.multipleOf;
                            //code block
                            break;
                        default:
                        //code block
                    }
                }
            }
        }
    }


    private handleWebformOutputs(results: any = {}):void {
        for(let result in results) {
            for(let param in this.webform.outputs) {
                if(result === param) {
                    this.webform.outputs[param].output_el.innerHTML = results[param];
                }
                // TODO: Handle array outputs
            }
        }
    }

    private correctDataTypes() : void {
        if(this.inputSchema) {
            for(let param in this.data) {
                if(this.data.hasOwnProperty(param)){
                    let value = this.data[param];
                    if(this.inputSchema.properties.hasOwnProperty(param)) {
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
}


export interface IDictionary<Webservice> {
    [id: string]: Webservice;
}

// Create dictonary for keeping track of all webservice instances
export class ServiceContainer {

    private dict: IDictionary<Webservice> = {};

    public add(apiKey:string, webservice:Webservice): void {
        if(!this.dict[apiKey]) this.dict[apiKey] = webservice;
    }

    public get(apiKey:string): Webservice {
        return this.dict[apiKey];
    }

}

let Webservices:ServiceContainer  = new ServiceContainer();
let debug:boolean;

function log(message:any):void {
    if(debug) console.log(message);
}

export { Webservices };

(function (){

    // See if we are in debug mode
    if(!!document.querySelector("script[bl-debug]")) debug = true;
    log('Initialise businesslogic');

    let formList = document.querySelectorAll("[bl-name]");

    for(let f = 0; f < formList.length; f++) {
        let name = formList[f].getAttribute('bl-name');
        let key = formList[f].getAttribute('bl-token');
        let auto = (formList[f].getAttribute('bl-auto') === '');

        if(auto) {
            // We do autogeneration of the webform
            log('Automatically generated form: ' + name);
        } else {
            log('Creating form from termplate: ' + name);

            // Map out the DOM
            let inputs = formList[f].querySelectorAll("[bl-input]");
            let controls = formList[f].querySelectorAll("[bl-control]");
            let outputs = formList[f].querySelectorAll("[bl-output]");
            let param: string,type: string ,tagName : string;
            let el:Element;
            let lbl_el: Element, desc_el: Element;
            if(name && key) {
                let wf: WebForm = {
                    name: name,
                    inputs: {},
                    controls: {},
                    outputs: {}
                };
                // Handling inputs
                for(let i = 0; i < inputs.length; i++) {
                    param = inputs[i].getAttribute('bl-input');
                    type = inputs[i].getAttribute('type');
                    tagName = inputs[i].tagName;
                    el = inputs[i];
                    lbl_el = formList[f].querySelector("[bl-input-label=" + param + "]");
                    desc_el = formList[f].querySelector("[bl-input-description=" + param + "]");
                    wf.inputs[param] = { 'label_el': lbl_el, 'desc_el': desc_el, 'input_el': el };
                }
                // Handling controls
                for(let i = 0; i < controls.length; i++) {
                    param = controls[i].getAttribute('bl-control');
                    type = controls[i].getAttribute('type');
                    tagName = controls[i].tagName;
                    el = controls[i];
                    wf.controls[param] = { 'control_el': el };
                }
                // Handling outputs
                for(let i = 0; i < outputs.length; i++) {
                    param = outputs[i].getAttribute('bl-output');
                    type = outputs[i].getAttribute('type');
                    tagName = outputs[i].tagName;
                    el = outputs[i];
                    lbl_el = formList[f].querySelector("[bl-input-label=" + param + "]");
                    desc_el = formList[f].querySelector("[bl-input-description=" + param + "]");
                    wf.outputs[param] = { 'label_el': lbl_el, 'desc_el': desc_el, 'output_el': el };
                }
                let ws = new Webservice(key, wf);
                log(ws)
            }

        }
    }
})();

// TODO: Consider using https://github.com/epoberezkin/ajv for validation