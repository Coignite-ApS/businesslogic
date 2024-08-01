'use strict';

import {getFormConfiguration, getFormContainer, purgeForm, mapWebForm} from './utils';
import {Logger, WebFormComponents, Webservice} from './classes';


(function () {
    // See if we are in debug mode
    const debug = !!document.querySelector('script[bl-debug]');
    const logger = Logger.getInstance(debug);
    const formList = document.querySelectorAll('[bl-name]');

    logger.log('Initialise businesslogic');

    for (let f = 0; f < formList.length; f++) {
        let ws: Webservice;
        const [name, key, auto, submitLabel, resetLabel] = getFormConfiguration(formList[f]);

        if (auto) {
            purgeForm(formList[f]);
            const container = getFormContainer();
            formList[f].appendChild(container);

            ws = new Webservice(key, logger);
            ws.SchemaReceviedListener.on((e) => {
                let inputs: WebFormComponents = new WebFormComponents('form-inputs');
                let outputs: WebFormComponents = new WebFormComponents('form-outputs');
                let signature: WebFormComponents = new WebFormComponents();

                for (let param in e.inputSchema.properties) {
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
                        switch (type) {
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

                container.appendChild(inputs.webformComponents);

                for (let param in e.outputSchema.properties) {
                    if (!e.outputSchema.properties.hasOwnProperty(param)) return;
                    let type = e.outputSchema.properties[param].type;
                    let enumeration = e.outputSchema.properties[param].enum || e.outputSchema.properties[param].oneOf;

                    if (enumeration) {
                        outputs.attachComponent('select', param);

                    } else {
                        switch (type) {
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


                container.appendChild(outputs.webformComponents);
                signature.attachComponent('businesslogic');

                formList[f].appendChild(signature.webformComponents);

                const wf = mapWebForm(formList[f]);

                ws.assignWebForm(wf);
            });
        } else {
            ws = new Webservice(key, logger, mapWebForm(formList[f]));
        }

        logger.log('Creating form from template: ' + name);
    }
})();

// TODO: Consider implementing datalist with input instead of select https://www.quackit.com/html/tags/html_datalist_tag.cfm
// TODO: Consider supporting http://inorganik.github.io/countUp.js/
// TODO: Consider supporting https://nosir.github.io/cleave.js/
