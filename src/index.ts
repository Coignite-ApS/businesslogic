'use strict';
import { WebFormComponents } from './Dom/WebFormComponents';
import { log, mapWebForm, setRangeListeners } from "./Helpers/HelperFunctions";
import { ServiceContainer } from "./classes/service-container";
import { Webservice } from "./classes/web-service";

let WebServicesContainer: ServiceContainer = new ServiceContainer();
let debug: boolean;


(function() {
    // See if we are in debug mode
    if (!!document.querySelector('script[bl-debug]')) debug = true;
    log('Initialise businesslogic', debug);

    let formList = document.querySelectorAll('[bl-name]');

    for(let f = 0; f < formList.length; f++) {
        let ws: Webservice;
        let name = formList[f].getAttribute('bl-name');
        let key = formList[f].getAttribute('bl-token');
        let auto = (formList[f].getAttribute('bl-auto') === '');
        let submitLabel = formList[f].getAttribute('bl-control-submit-label');
        let resetLabel = formList[f].getAttribute('bl-control-reset-label');

        if (auto) {
            formList[f].querySelectorAll('*').forEach((o) => o.remove());
            let container: HTMLDivElement = document.createElement('div');
            container.className = 'bl-form';
            formList[f].appendChild(container);
            ws = new Webservice(key, debug);

            ws.SchemaReceviedListener.on((e) => {
                let inputs: WebFormComponents = new WebFormComponents('form-inputs');
                let outputs: WebFormComponents = new WebFormComponents('form-outputs');
                let signature: WebFormComponents = new WebFormComponents();

                for(let param in e.inputSchema.properties) {
                    if (!e.inputSchema.properties.hasOwnProperty(param)) return;

                    let type = e.inputSchema.properties[param].type;
                    let enumeration = e.inputSchema.properties[param].enum || e.inputSchema.properties[param].oneOf;

                    let isRange = e.inputSchema.properties[param].maximum &&
                        e.inputSchema.properties[param].minimum !== undefined &&
                        e.inputSchema.properties[param].type === 'number' &&
                        e.inputSchema.properties[param].default

                    if (enumeration) {
                        //TODO: We can already here generate dropdown options
                        inputs.attachComponent('select', param);
                    } else if (isRange) {
                        inputs.attachComponent('range', param, e.inputSchema.properties[param]);
                    } else {
                        switch(type) {
                            case 'number':
                                inputs.attachComponent('number', param);
                                break;
                            case 'integer':
                                inputs.attachComponent('integer', param);
                                break;
                            default:
                                inputs.attachComponent('text', param);
                        }
                    }
                }

                if (resetLabel !== null) {
                    inputs.attachComponent('submit-reset', null, {
                        submit: submitLabel,
                        reset: resetLabel
                    });
                } else {
                    inputs.attachComponent('submit', null, {
                        submit: submitLabel
                    });
                }

                const formInputs = inputs.compileWebformComponents();

                setRangeListeners(formInputs);

                container.appendChild(formInputs);

                for(let param in e.outputSchema.properties) {
                    if (!e.outputSchema.properties.hasOwnProperty(param)) return;
                    let type = e.outputSchema.properties[param].type;
                    let enumeration = e.outputSchema.properties[param].enum || e.outputSchema.properties[param].oneOf;

                    if (enumeration) {
                        outputs.attachComponent('select', param);

                    } else {
                        switch(type) {
                            case 'number':
                                outputs.attachComponent('output', param);
                                break;
                            case 'integer':
                                outputs.attachComponent('output', param);
                                break;
                            //TODO: Consider how we can prepare placeholders for data in the output for an array
                            case 'array':
                                outputs.attachComponent('output-array', param, [{"name": 1}]);
                                break;
                            default:
                                outputs.attachComponent('output', param);
                        }
                    }
                }

                container.appendChild(outputs.compileWebformComponents());

                signature.attachComponent('businesslogic');

                formList[f].appendChild(signature.compileWebformComponents());

                let wf = mapWebForm(formList[f]);

                ws.assignWebForm(wf);
            });
        } else {
            ws = new Webservice(key, debug, mapWebForm(formList[f]));
        }

        log(`Creating form from termplate: ${name}`, debug);
    }
})();

export { WebServicesContainer };

// TODO: Consider implementing datalist with input instead of select https://www.quackit.com/html/tags/html_datalist_tag.cfm
// TODO: Consider supporting http://inorganik.github.io/countUp.js/
// TODO: Consider supporting https://nosir.github.io/cleave.js/
